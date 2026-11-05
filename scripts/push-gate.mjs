// The push gate (rc-security piece 4, slice 4a; PRD-RC-SECURITY-4): before an agent's Bash command
// that pushes, the target repo's pushed range needs a covering Security "holds" and Prover "proven".
// The hook's `push` mode (hooks/harteburn-hook.mjs) calls pushGate() and prints what it returns.
// Pure reads only: git with no fsmonitor and no hooks; where a push goes and the remote's tip by git's own
// dry-run push (Architect 2026-11-01, docs/reviews/RC-SECURITY-4-2026-11-01-architect-cap.md).
// prePushGate() is the same check from inside git: the pre-push hook (scripts/pre-push.sh) calls it.
import { readFileSync, existsSync, statSync, realpathSync, lstatSync } from "node:fs";
import { join, resolve, isAbsolute, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { GIT, gitEnv } from "./git-safe.mjs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { globRe } from "./globs.mjs";
import { acceptances, answers, askAfresh, pieceStart, verdicts, tableGlobs, tableGlobsAt, isAncestor, exactCommit, hooksDir, projectsDir, proverPrompt, parseProverPrompt, PROVER_FILES_HEAD } from "./board-security.mjs";
import { boardDir, stateDir } from "./paths.mjs";
import { seatGate } from "./seat-gate.mjs";

export { proverPrompt, parseProverPrompt, PROVER_FILES_HEAD };

/** The whole check's limit, under the hook's 60 s: past it a held push is refused. */
export const DEADLINE_MS = 45000;
export const S8 = "Push gate: cannot tell which repo or branch this pushes. Push one branch, as git -C <repo> push <remote> <branch>.";

// ---------- reading the command ----------

/** Words and operators of a shell command, quotes removed; a word holding $ or ` outside single quotes is dynamic. */
function lex(cmd) {
  const out = [];
  let w = null, dyn = false, i = 0;
  const end = () => { if (w != null) out.push({ w, dyn }); w = null; dyn = false; };
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "'") { const j = cmd.indexOf("'", i + 1); if (j < 0) return null; w = (w ?? "") + cmd.slice(i + 1, j); i = j + 1; continue; }
    if (c === '"') {
      let j = i + 1, s = "";
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === "\\" && j + 1 < cmd.length) { s += cmd[++j]; continue; }
        if (cmd[j] === "$" || cmd[j] === "`") dyn = true;
        s += cmd[j];
      }
      if (j >= cmd.length) return null;
      w = (w ?? "") + s; i = j + 1; continue;
    }
    if (c === "\\" && i + 1 < cmd.length) { w = (w ?? "") + cmd[i + 1]; i += 2; continue; }
    if (/\s/.test(c)) { if (c === "\n") { end(); out.push({ op: ";" }); } else end(); i++; continue; }
    // A redirect, with its target, is no word of the command (Prover round 1 on cf67338: `git push 2>&1`).
    // Digits are the redirect's fd only when they start a word (`2>&1`); typed at a word's end they stay
    // in it (`main2>/dev/null` pushes main2; automated review of e13b1ba).
    const redir = (w == null ? /^(\d*)(>>|>\||>&|<&|&>|>|<)(&?\d+|-)?/ : /^()(>>|>\||>&|<&|&>|>|<)(&?\d+|-)?/).exec(cmd.slice(i));
    if (redir) {
      // A word before it ends there (`git push<&-`).
      if (w != null) end();
      w = null; dyn = false; i += redir[0].length;
      if (!redir[3]) { while (/\s/.test(cmd[i] || "") && cmd[i] !== "\n") i++; out.push({ skip: true, write: /[>]/.test(redir[2]) }); }
      else if (/[>]/.test(redir[2])) out.push({ write: true });
      continue;
    }
    const op = /^(&&|\|\||[;&|()])/.exec(cmd.slice(i));
    if (op) { end(); out.push({ op: op[0] }); i += op[0].length; continue; }
    if (c === "$" || c === "`") dyn = true;
    w = (w ?? "") + c; i++;
  }
  end();
  return out;
}

/**
 * Each push in `command`, run from `cwd`: { dir, args } (args: the push's words) or { dir, unreadable }
 * or { unknown } when the folder cannot be told. [] when nothing in it pushes.
 */
export function pushesIn(command, cwd) {
  // Read with quotes and escapes taken out: `"g"it pu"sh"` is git push to the shell (Prover on e13b1ba).
  const plain = String(command).replace(/["'\\]/g, "");
  if (!/\b(push|git)\b/.test(plain) && !/[$`*?[]/.test(String(command)) && !RUNS_SCRIPT.test(plain)) return [];
  // An unknown command that names another folder or runs code from text can act on any repo: it holds
  // everywhere, never only where the session's folder is held (automated review of b6ca3b9).
  const elsewhere = /(^|\s)(-C|--git-dir|--work-tree|--chdir|pushd)\b|chdir|(^|[\s;&|('"])cd\s|\s-[ce]\s|\s\/[\w.-]/.test(plain);
  // A here-doc or here-string hands a shell its command as text (Security on e13b1ba). One alone, with a quoted
  // delimiter and only written to a file outside .git, runs nothing: its text is data (0.26.1, owner 2026-11-04).
  if (/<<|[<>]\(/.test(plain) && /\b(push|git)\b/.test(plain)) return quotedHereDocToFile(String(command), cwd) ? [] : [{ unknown: true, dir: null }];
  // A command substitution can run a push the reader never sees as a word (automated review of b7bfbc6).
  if (/`|\$\(/.test(String(command)) && /\b(push|git)\b/.test(String(command))) return [{ unknown: true }];
  const toks = lex(String(command));
  if (!toks) return [{ unknown: true }];
  const segs = [[]];
  // A redirect's target (the word after a bare > or <) is dropped too.
  let skipNext = false;
  const ops = [], writes = [];
  for (const t of toks) {
    if (t.write) writes[segs.length - 1] = true;
    if (t.skip) { skipNext = true; continue; }
    if (t.write) continue;
    if (t.op) { ops[segs.length - 1] = t.op; segs.push([]); skipNext = false; continue; }
    if (skipNext) { skipNext = false; continue; }
    segs[segs.length - 1].push(t);
  }
  const out = [];
  // A subshell's cd, pushd/popd or a cd with an option leave the folder unknown (Prover on e13b1ba).
  let dir = cwd, lost = toks.some((x) => x.op === "(") && segs.some((s) => ["cd", "pushd", "popd"].includes(s[0]?.w));
  // Fail closed (Security on e13b1ba): a "push" word anywhere must sit in a readable git push, or in a
  // reader (echo, grep) that pipes into nothing; else the command is one this reader cannot place.
  let loose = false;
  // The new readers count only in a command that is one pipeline: any ;, &&, ||, &, newline or ( ) lets an earlier part
  // make the reader a shell (a function, builtin alias, PATH=; Security on e44025b..ac3e68f, high).
  const aliasy = ops.some((o) => o !== "|") || segs.some((s) => ["alias", "unalias", "function"].includes(s[0]?.w) || s.some((x) => /\(\)/.test(x.w)));
  const headOf = (s) => { let k = 0; while (k < s.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s[k].w) || WRAPPERS.includes(s[k].w))) k++; return k; };
  // A new reader (sed, a pipe of readers) counts only typed bare, in one pipeline that defines no alias and writes no
  // file: sed copying a pushing script into .git/hooks pushed live (Prover on b0c5896).
  // And only when every part of the command is a bare reader, never less or rg: sed piped into tee, perl or node pushed
  // live (Security and Prover on 6f498d1). The shape is closed: readers reading, nothing else.
  const pure = !aliasy && !writes.some(Boolean) && segs.every((x) => x.length && headOf(x) === 0 && !["less", "rg"].includes(basename(x[0].w)) && isReader(x));
  const newReader = (s, k) => pure && k === 0 && isReader(s);
  // Each segment piped into is a reader typed bare (no NAME=, no env or other wrapper in front), never less, whose
  // LESSOPEN runs a program on the piped text, nor rg, whose --pre does (Security on e44025b..d80fed8, high).
  const pipesToReaders = (j) => { for (let m = j; ops[m] === "|"; m++) { const s = segs[m + 1] || []; if (writes[m + 1] || headOf(s) !== 0 || ["less", "rg"].includes(basename(s[0]?.w ?? "")) || !isReader(s)) return false; } return true; };
  segs.forEach((s, j) => {
    if (!s.some((x) => /\bpush\b/.test(x.w))) return;
    let k = 0;
    while (k < s.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s[k].w) || WRAPPERS.includes(s[k].w))) k++;
    const h = basename(s[k]?.w ?? "");
    if (h === "git" || h === "cd") return;
    // A reader that pipes only into readers (grep -n S8 push-gate.mjs | head -30) is still a reader (0.26.1).
    // The new readers (sed, a pipe of readers) count only typed bare, in a command that defines no alias; anything else
    // reads as 0.26.0 did (Prover and Security on d80fed8 and 615cac2: PATH=bin sed, alias cat=sh).
    if (!writes[j] && (ops[j] === "|" ? newReader(s, k) && pipesToReaders(j) : READERS.includes(h) || newReader(s, k))) return;
    loose = true;
  });
  for (const s of segs) {
    if (!s.length) continue;
    // A variable or file read into the shell can redirect every later git (automated review of b7bfbc6).
    if (["export", "declare", "typeset", "set", "source", ".", "alias", "unset"].includes(s[0].w)) {
      if ((s[0].w === "source" || s[0].w === ".") && s[1] && scriptPushes(resolve(dir, s[1].w))) out.push({ unknown: true, dir: null });
      lost = true;
      continue;
    }
    if (s[0].w === "pushd" || s[0].w === "popd" || (s[0].w === "cd" && s[1]?.w.startsWith("-"))) { lost = true; continue; }
    if (s[0].w === "cd") {
      if (!s[1] || s[1].dyn || s[1].w.startsWith("~")) { lost = !s[1] ? (dir = homedir(), false) : true; continue; }
      dir = resolve(dir, s[1].w);
      continue;
    }
    // A wrapper or a variable before git, as the shell would read it (automated review of cf67338).
    let k = 0, envBad = false;
    while (k < s.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s[k].w) || WRAPPERS.includes(s[k].w))) { if (/^GIT_/.test(s[k].w)) envBad = true; k++; }
    // env -S splits its text into a command the gate never parses (env -S "sh ship.sh"; Security on d2c074b).
    if (s.some((x, i) => basename(x.w) === "env" && /^(-[A-Za-z]*S|--split-string)/.test(s[i + 1]?.w ?? ""))) { out.push({ unknown: true, dir: lost ? null : dir }); continue; }
    const head = s[k]?.w ?? "";
    // A head in a variable or a glob could be git (automated review of b6ca3b9): held repos only.
    if (s[k] && (s[k].dyn || /[*?[]/.test(head))) { out.push({ unknown: true, dir: lost ? null : dir }); continue; }
    if (segs.filter((x) => x.length).length === 1 && ownEntry(s, k, dir)) continue;
    // A script the command runs is read: one that pushes is a push the gate cannot place.
    // A shell's options are skipped to find the file it runs (-o and -O take a word); a head with a
    // slash in it is a file run directly (automated review of 2fe32a3). A lost folder holds everywhere.
    // Every word after a shell is read (its options' own words too); an unknown long option fails closed.
    let sp = false;
    if (SHELLS.includes(basename(head)) || head === "source" || head === ".") {
      const words = s.slice(k + 1).map((x) => x.w).filter((w) => w !== "-c");
      if (words.some((w) => w.startsWith("--") && !["--norc", "--noprofile", "--posix", "--login", "--"].includes(w) && !/^--(rcfile|init-file)$/.test(w))) sp = true;
      const first = words.find((w) => !w.startsWith("-") && !w.startsWith("+"));
      if (first && !existsSync(resolve(dir, first)) && !s.some((x) => x.w === "-c")) sp = true;
      for (const w of words) if (!w.startsWith("-") && !w.startsWith("+") && existsSync(resolve(dir, w))) { const r = lost ? true : scriptPushes(resolve(dir, w), 0, { cwd: dir }); if (r === true || (r && sp !== true)) sp = r; }
    } else if (head.includes("/")) sp = lost ? true : scriptPushes(resolve(dir, head), 0, { direct: true, cwd: dir });
    else if (INTERPRETERS.includes(basename(head))) sp = lost ? true : interpPushes(s.slice(k + 1).map((x) => x.w), dir);
    // A package runner runs package.json's scripts, read like a script file (Security on 88e3571, F1a).
    // Its config in the environment can pick another package (automated review of c85767d).
    if (!sp && RUNNERS.includes(basename(head))) sp = lost || s.slice(0, k).some((x) => RUNNER_ENV.test(x.w)) ? true : runnerPushes(basename(head), s.slice(k + 1), dir);
    // A package script runs in its package's folder, which may be a held repo above an unheld one.
    if (sp) { out.push({ unknown: true, dir: sp === "here" ? dir : sp.here ?? null }); continue; }
    if (SHELLS.includes(basename(head)) || head === "eval" || head === "xargs") {
      if (s.slice(k + 1).some((x) => /\bpush\b/.test(x.w))) out.push({ unknown: true });
      // An interpreter or a runner handed to a shell, eval or xargs runs text the gate cannot read (Security on 51598c8).
      else if (s.slice(k + 1).some((x) => RUNNER_WORD.test(x.w) || INTERP_WORD.test(x.w) || RUNNERS.includes(basename(x.w)) || INTERPRETERS.includes(basename(x.w)))) out.push({ unknown: true, dir: lost ? null : dir });
      // Text a shell's -c, eval or xargs runs is never parsed: naming git, or with { $ ` or a glob, it fails closed
      // (bash -c "{git,pu''sh}", an alias; Security on fe47feb, 6459d60, 78eeabf; jg 2026-11-02 blunt rule). Held repos only.
      else if (blindText(head, s.slice(k + 1), dir)) out.push({ unknown: true, dir: lost ? null : dir });
      continue;
    }
    if (basename(head) !== "git") {
      // git further on, under a program that may run it (`nice -n 5 git push`, `xargs`): fail closed.
      // Any git (or git-<command>, run directly) there fails closed, push word or not: an alias can hide
      // it (automated review of e13b1ba). Held repos only: pushGate lets an unheld folder's pass.
      if (!(READERS.includes(basename(head)) || newReader(s, k)) && s.slice(k).some((x) => /^git(-|$)/.test(basename(x.w)) || /(^|[\s/;&|(])git(-[\w-]+)?\s/.test(x.w.replace(/["'\\]/g, "")))) out.push({ unknown: true, dir: lost ? null : dir });
      // A package runner further on (timeout 60 npm run x, corepack pnpm x): its scripts are not read (automated review of c85767d).
      else if (!(READERS.includes(basename(head)) || newReader(s, k)) && s.slice(k + 1).some((x) => RUNNERS.includes(basename(x.w)) || RUNNER_WORD.test(x.w))) out.push({ unknown: true, dir: lost ? null : dir });
      else if (!(READERS.includes(basename(head)) || newReader(s, k))) {
        // A program in front of an interpreter (timeout 60 node x.js) or of a script typed by path (nice ./x.sh):
        // that file is read as if typed alone (Security on 51598c8).
        const j = s.findIndex((x, i) => i > k && INTERPRETERS.includes(basename(x.w)));
        const f = s.slice(k + 1).find((x) => x.w.includes("/") && !x.w.startsWith("-") && isFile(resolve(dir, x.w)));
        // Or of a shell (timeout 60 bash ship.sh): every file after it is read, as after a shell typed alone (automated review of 4c1eb26).
        const sh = s.findIndex((x, i) => i > k && (SHELLS.includes(basename(x.w)) || x.w === "eval" || x.w === "xargs"));
        if (sh > 0 && blindText(basename(s[sh].w), s.slice(sh + 1), dir)) { out.push({ unknown: true, dir: lost ? null : dir }); continue; }
        const files = sh > 0 ? s.slice(sh + 1).filter((x) => !x.w.startsWith("-") && !x.w.startsWith("+") && isFile(resolve(dir, x.w))) : [];
        // A shell whose first word is no file here (find's {}, a name made later) runs what the gate cannot read,
        // as a shell typed alone (find . -exec sh {} \;; Security on d2c074b).
        const first = sh > 0 && SHELLS.includes(basename(s[sh].w)) ? s.slice(sh + 1).find((x) => !x.w.startsWith("-") && !x.w.startsWith("+")) : null;
        if (first && !isFile(resolve(dir, first.w))) { out.push({ unknown: true, dir: lost ? null : dir }); continue; }
        const rs = lost ? [] : files.map((x) => scriptPushes(resolve(dir, x.w), 0, { cwd: dir }));
        const fr = rs.find((x) => x === true) ?? rs.find((x) => x);
        // Each reading is made, so one cannot hide another (timeout 600 bash ship.sh ./config.json; automated review of 78eeabf).
        const all = lost && (j > 0 || f || files.length) ? [true] : [j > 0 && interpPushes(s.slice(j + 1).map((x) => x.w), dir), f && scriptPushes(resolve(dir, f.w), 0, { direct: true, cwd: dir }), fr];
        const r = all.find((x) => x === true) ?? all.find((x) => x) ?? false;
        if (r) out.push({ unknown: true, dir: r === "here" ? dir : null });
      }
      continue;
    }
    let i = k + 1, d = dir, bad = lost || envBad;
    for (; i < s.length && s[i].w.startsWith("-"); i++) {
      const o = s[i].w;
      if (o === "-C") { const x = s[++i]; if (!x || x.dyn) bad = true; else d = resolve(d, x.w); }
      else if (o === "--config-env" || o.startsWith("--config-env=")) bad = true;
      else if (o === "-c") { const kv = s[++i]?.w ?? ""; if (/^(remote|url|push|branch|core|credential|protocol|alias|include|includeif|submodule)\./i.test(kv)) bad = true; }
      else if (o.startsWith("--git-dir") || o.startsWith("--work-tree") || o.startsWith("--namespace")) bad = true;
    }
    const sub = s[i]?.w;
    if (s[i]?.dyn) { out.push({ unknown: true, dir: lost ? null : d }); continue; }
    if (sub === "send-pack" || sub === "http-push") { out.push({ unknown: true }); continue; }
    if (sub !== "push") {
      // Not a builtin: an alias (git's own, or one -c made), or another program (`git subtree push`).
      if (sub && !BUILTIN.has(sub)) out.push(bad ? { unknown: true } : { dir: d, alias: sub, bad, words: s.slice(i + 1).map((x) => x.w) });
      continue;
    }
    if (bad) { out.push({ unknown: true }); continue; }
    const args = s.slice(i + 1);
    out.push(args.some((a) => a.dyn) ? { dir: d, unreadable: true } : { dir: d, args: args.map((a) => a.w) });
  }
  if (loose) out.push({ unknown: true, dir: lost || elsewhere ? null : dir });
  return out.map((p) => (p.unknown && p.dir && elsewhere ? { ...p, dir: null } : p));
}

/** A command that runs a script file: read, since the file can push (automated review of b6ca3b9). */
export const RUNS_SCRIPT = /(^|[\s;&|(])(\S*\/|(ba|z|da|k|fi|c|tc|mk|ya)?sh(\s|$)|busybox\s|eval(\s|$)|xargs\s|env\s|source\s|\.\s|(p?npm|yarn(pkg)?|bun)(\s|$)|(node|deno|tsx|ts-node|zx|python3?|ruby|perl|php)(\s|$))/;

const RUNNERS = ["npm", "pnpm", "yarn", "yarnpkg", "bun"];
const RUNNER_WORD = /(^|[\s/;&|(])(p?npm|yarn(pkg)?|bun)\s/;
const INTERP_WORD = /(^|[\s/;&|(])(node|deno|tsx|ts-node|zx|python3?|ruby|perl|php)\s/;
// Text the gate never parses (jg 2026-11-02 blunt rule): any eval; a shell given -c or reading stdin (| bash, bash -s,
// bash < x); xargs running anything but a plain program (a shell, eval, git, a runner, an interpreter, . source exec,
// a path or a file) or with { $ ` or a glob outside -I{} (Security on 78eeabf and 5ac6165, automated reviews).
const blindText = (head, rest, dir) => {
  if (head === "eval") return true;
  if (head === "xargs") return rest.some((x) => x.w !== "{}" && !/^-I/.test(x.w) && (/[{$`*?[]/.test(x.w) || /git/i.test(x.w.replace(/["'\\]/g, "")) ||
    [...SHELLS, ...INTERPRETERS, ...RUNNERS, "eval", ".", "source", "exec"].includes(basename(x.w)) || x.w.includes("/") || isFile(resolve(dir, x.w))));
  return rest.some((x) => /^-[A-Za-z]*[cs][A-Za-z]*$/.test(x.w) || x.w.startsWith("<")) || !rest.some((x) => !x.w.startsWith("-") && !x.w.startsWith("+"));
};
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
// A runner named anywhere in a package script's text (npx runs a fetched tool: piece 8's).
const RUNNER_MENTION = /(?:^|[^\w.-])(?:p?npm|yarn(?:pkg)?|bun)(?![\w.-])|npm_(?:node_)?execpath/;
// npm accepts any unique prefix of a command, so only these exact ones are read; any other fails closed
// (Security on 02182d2). The read-only ones run no script.
const NPM_READS = ["ls", "list", "la", "ll", "view", "info", "show", "v", "outdated", "whoami", "search", "doctor", "explain", "why", "root", "prefix", "bin", "audit", "-v"];
const NPM_KNOWN = [...NPM_READS, "run", "run-script", "rum", "urn", "test", "t", "tst", "start", "stop", "restart", "it", "install-test", "cit", "install-ci-test",
  "publish", "version", "pack", "install", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall", "add", "ci", "clean-install", "ic", "install-clean", "isntall-clean", "exec", "x", "config", "c"];
// Runner config that can pick another package or folder: in the environment, or the package's .npmrc.
const RUNNER_ENV = /^(npm_config_|yarn_|pnpm_|bun_)/i;
// Tools that run package scripts by name: their names are not read, so they could run anything.
const SCRIPT_RUNNERS = ["run-s", "run-p", "npm-run-all", "concurrently"];
// npm commands that install and then run the test script.
const TEST_TOO = ["it", "install-test", "cit", "install-ci-test"];
// The scripts a runner runs by itself for publish, version and pack; any other command is read as an install.
const PREPARE = ["preprepare", "prepare", "postprepare"];
const INSTALLS = ["install", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall", "add", "ci", "clean-install", "uninstall", "remove", "rm", "r", "un", "unlink", "update", "up", "upgrade", "udpate"];
// Install options that pick another folder, package set, config or shell; a short flag naming any of them too.
const ELSEWHERE = /^(--(prefix|dir|cwd|global|location|workspaces?|ws|filter|recursive|include-workspace-root|iwr|userconfig|globalconfig|script-shell|shell|node-options|config|cache|C)\b|-[A-Za-z]*[CgwrFW])/;
const LIFECYCLE = {
  publish: ["prepublishOnly", "prepack", ...PREPARE, "postpack", "prepublish", "publish", "postpublish"],
  version: ["preversion", "version", "postversion"],
  pack: ["prepack", ...PREPARE, "postpack"],
  install: ["preinstall", "install", "postinstall", "prepublish", ...PREPARE, "dependencies"],
};

/**
 * Whether a package runner's command runs a package.json script that could push: as scriptPushes, on the
 * scripts it names (with their pre and post scripts) in the nearest package.json up from `dir`. An option
 * that picks another package or folder, or a script name in a variable, could run anything (true).
 * A program the runner fetches (npx, exec, dlx) is its own code: piece 8's (jg 2026-11-02).
 */
function runnerPushes(runner, words, dir, depth = 0) {
  if (words.some((x) => x.dyn) || depth > 3) return true;
  const w = words.map((x) => x.w);
  const own = w.includes("--") ? w.slice(0, w.indexOf("--")) : w;
  // An install runs only its package's install scripts: of its options, only those that pick another folder,
  // package or shell fail closed (npm install -D was S8 in every repo since 737543e; jg 2026-11-03). Any
  // other command keeps the strict reading.
  const plain = (o) => ["-s", "--silent", "--if-present", "-v", "--version"].includes(o) ||
    (INSTALLS.includes(own.find((x) => !x.startsWith("-"))) && !ELSEWHERE.test(o));
  if (own.some((o) => o.startsWith("-") && !plain(o))) return true;
  let [sub, name] = own.filter((o) => !o.startsWith("-"));
  // `npm -- run x` puts the command after --; `npm run -- x` the script's name (Security on 02182d2).
  if (w.includes("--") && !sub) return true;
  if (w.includes("--") && !name) name = w[w.indexOf("--") + 1];
  if (runner === "npm" && sub && !NPM_KNOWN.includes(sub)) return true;
  if (runner === "npm" && ["config", "c"].includes(sub)) return !["get", "list", "ls"].includes(name);
  if (runner === "npm" && NPM_READS.includes(sub)) return false;
  // A fetched tool's own code is piece 8's; an interpreter it launches (npm exec -- node x.js) is read further on.
  if (["exec", "x", "dlx"].includes(sub)) return false;
  if (["workspace", "workspaces", "recursive", "multi", "m"].includes(sub)) return true;
  // bun runs a file as an interpreter does (bun x.ts, bun run x.ts).
  const file = runner === "bun" && [sub, name].find((x) => x && /\.(m?[jt]sx?|cjs)$/.test(x));
  if (file) return existsSync(resolve(dir, file)) ? scriptPushes(resolve(dir, file), 0, { cwd: dir }) : false;
  let at = dir, pkg;
  for (;;) {
    const f = join(at, "package.json");
    if (existsSync(f)) {
      try { if (statSync(f).size > 1 << 18) return true; pkg = JSON.parse(readFileSync(f, "utf8")); } catch { return true; }
      break;
    }
    if (dirname(at) === at) return false;
    at = dirname(at);
  }
  try { if (/^\s*(workspaces?|prefix|include-workspace-root|filter|recursive|script-shell|shell|browser|viewer|editor|node-options|git)\s*=/m.test(readFileSync(join(at, ".npmrc"), "utf8"))) return true; } catch {}
  const scripts = pkg?.scripts ?? {};
  if (typeof scripts !== "object" || Array.isArray(scripts)) return true;
  const has = (n) => Object.hasOwn(scripts, n);
  const names = ["run", "run-script", "rum", "urn"].includes(sub) ? (name ? [name] : [])
    : ["test", "t", "tst", "start", "stop", "restart"].includes(sub) ? [{ t: "test", tst: "test" }[sub] ?? sub, ...(sub === "restart" ? ["stop", "start"] : [])]
    : TEST_TOO.includes(sub) ? ["test"]
    : runner !== "npm" && sub && has(sub) ? [sub]
    : null;
  // A lifecycle command runs its own scripts too, beside a script of the same name (pnpm publish).
  const life = LIFECYCLE[sub] ?? (!names || TEST_TOO.includes(sub) ? LIFECYCLE.install : []);
  const run = [...life, ...(names ?? []).flatMap((n) => [`pre${n}`, n, `post${n}`])];
  const r = [...new Set(run)].filter(has).map((n) => {
    if (typeof scripts[n] !== "string") return true;
    const t = scripts[n].replace(/["'\\]/g, "");
    // A script that runs another script through a runner is read in turn (automated review of c85767d).
    // Wrappers (cross-env, env) are looked past; a runner anywhere else in the command fails closed (Security on b517aee).
    let followed = 0;
    const cmds = t.split(/&&|\|\||[;|&\n]/).map((c) => c.trim().split(/\s+/));
    // Runner config set inside the script, or a folder change before a runner, picks another package.
    if (cmds.some((ws) => ws.some((w) => RUNNER_ENV.test(w)))) return true;
    if (RUNNER_MENTION.test(t) && (/[()`]/.test(t) || cmds.some((ws) => ws.some((x) => ["cd", "pushd"].includes(basename(x)))))) return true;
    const inner = cmds.map((ws) => ws.filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))).map((ws) => {
      let i = 0;
      while (i < ws.length && (WRAPPERS.includes(ws[i]) || ["cross-env", "cross-env-shell"].includes(basename(ws[i])))) i++;
      const hd = basename(ws[i] ?? "");
      // A command led by a variable ($npm_execpath run x) could be a runner (automated review of the 0c2c9a4 fix).
      if (/[$`]/.test(ws[i] ?? "")) return true;
      if (SCRIPT_RUNNERS.includes(hd)) return true;
      if (RUNNERS.includes(hd)) followed++;
      if (RUNNERS.includes(hd)) return runnerPushes(hd, ws.slice(i + 1).map((w) => ({ w, dyn: /[$`]/.test(w) })), at, depth + 1);
      return ws.slice(i + 1).some((w) => RUNNERS.includes(basename(w)) || SCRIPT_RUNNERS.includes(basename(w)));
    });
    // Every runner the text names must be one followed at a command's head; brackets, $(...) and backticks
    // hide the rest, so they fail closed (Security on 0c2c9a4).
    if ((t.match(new RegExp(RUNNER_MENTION.source, "g")) ?? []).length > followed) return true;
    return inner.some((x) => x === true) ? true : inner.find((x) => x) || textPushes(t, at, 0, at);
  });
  return r.includes(true) ? true : r.some((x) => x) ? { here: at } : false;
}

/**
 * Whether a script file the command runs could push: git and push in it, a script it runs (./x, sh x,
 * source x, followed three deep) that could, or a file it cannot read or that is over 256 KB (fail
 * closed; automated review of 2fe32a3). A binary (a NUL in its first 8 KB) is a program, not a script.
 */
function scriptPushes(path, depth = 0, { direct = false, cwd = dirname(path) } = {}) {
  let raw;
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > 1 << 18) return true;
    raw = readFileSync(path);
  } catch { return true; }
  // Only a real program (ELF or Mach-O) run directly is no script (automated review of 11a0d6b).
  const magic = raw.subarray(0, 4).toString("hex");
  if (direct && ["7f454c46", "cffaedfe", "cefaedfe", "feedfacf", "feedface", "cafebabe"].includes(magic)) return false;
  // Read as the shell would: quotes and escapes out.
  return textPushes(raw.toString("utf8").replace(/["'\\]/g, ""), dirname(path), depth, cwd, path);
}

// The entry points the gate's own refusals and the board tell an agent to run, at the plugin's own path: code
// this hook runs already. Read as scripts, each was S8 in every held repo, as all they import names git and
// push (2026-11-04: board-security.mjs --prompt, the remedy for "no Security holds", could not run). A copy
// in a project, or any other file, is read as before; a changed plugin file is piece 8's (B13).
// Only the plain form node <plugin>/scripts/<entry>: nothing before node, no option before the file (a loader,
// --preserve-symlinks), no $ word, and the path as typed, no symlink (automated review of 778921f, medium).
// The command alone, with no NODE_OPTIONS around it: an export before it can set a loader (automated review of bcc322c, medium).
const OWN_ENTRIES = ["board-security.mjs", "prove-prompt.mjs", "board-md.mjs"];
function ownEntry(s, k, dir) {
  if (k !== 0 || s[0].w !== "node" || !s[1] || s.some((x) => x.dyn) || process.env.NODE_OPTIONS) return false;
  const typed = resolve(dir, s[1].w);
  try {
    if (lstatSync(typed).isSymbolicLink()) return false;
    return OWN_ENTRIES.some((f) => [PLUGIN, realpathSync(PLUGIN)].some((p) => typed === join(p, "scripts", f)));
  } catch { return false; }
}

/** scriptPushes on a script's text, quotes and escapes out; `from` is the folder its callees are found in. */
function textPushes(t, from, depth, cwd, self = "") {
  // "here": it pushes from the folder it is run in; true: it could act on any repo (it changes folder,
  // names one, or could not be read whole), so it holds everywhere.
  const away = /(^|[\s;&|(])(-C|--git-dir|--work-tree|--namespace|cd|pushd)(\s|=)|chdir|\bGIT_[A-Z_]+=|\s(\/|\.\.\/)\S/m.test(ownFolder(t, from, cwd));
  const git = /\bgit\b/.test(t);
  // Where a push lands, not whether the text could push somewhere (jg 2026-11-03: "a ridiculous overreach":
  // a $ beside a reading git was S8 in every repo). With git in it, eval, a command that is a variable or
  // substitution, or git's subcommand built from one could be the push (fail closed). A $ elsewhere is data.
  // A script a shell, source, . or exec runs from a variable path could be anything, git here or not
  // (sh "$DIR/publish.sh", exec "$(dirname "$0")/x"; Security on 22885cb, medium).
  // Neither waits for the word git: $GIT push, eval "$CMD" (automated review of afa69e0, medium).
  if (runsVar(t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")) || runsVarPath(ownFolder(t, from, cwd))) return true;
  if (/\beval\b/.test(t) || dynamicHead(t)) return true;
  const subs = git ? [...t.matchAll(GIT_SUB)].map((m) => m[1]) : [];
  if (subs.some((w) => /[$`*?[{]/.test(w))) return true;
  // A word after git that is no builtin is pushed by an alias only when this repo's config says so.
  const aliased = subs.some((w) => !BUILTIN.has(w) && w !== "push" && aliasPushes(cwd, w).odd);
  if (git && (/\bpush\b/.test(t) || aliased)) return away ? true : "here";
  if (depth >= 3) return /(^|[\s;&|(])(\.{1,2}\/|(ba|z|da|k)?sh\s+\S|source\s|\.\s+\S)/m.test(t);
  // Every word with a slash, or ending .sh, is a script it may run: from its own folder or the command's;
  // one that is found nowhere could be anything (automated review of 11a0d6b).
  const called = [...new Set([...t.matchAll(/(?:^|[\s;&|(])((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\/[\w.-]+|[\w-]+\.sh|[\w.-]+\.(?:m?[jt]sx?|cjs|py|rb|pl|php))\b/gm)].map((m) => m[1]))];
  const r = called.map((c) => {
    const at = [resolve(from, c), resolve(cwd, c)].find((p) => existsSync(p));
    // A script naming itself (a usage line) runs nothing new: it is being read already (release-preflight.sh).
    if (at && self && at === self) return false;
    return at ? scriptPushes(at, depth + 1, { direct: true, cwd }) : /\.sh$/.test(c) || c.startsWith(".") ? true : false;
  });
  return r.includes(true) || (r.includes("here") && away) ? true : r.includes("here") ? "here" : false;
}

/** The script's text as far as where it acts: comment lines out, and a cd that stays in the command's repo
 * out (`cd "$(dirname "$0")/.."`, or BASH_SOURCE, to the script's own repo top; a plain relative folder such
 * as `cd apps/web`). connector-cloud's verify.sh does both and pushes a refs/verified marker (2026-11-03).
 * A cd that leaves the repo, or names its folder in a variable, is kept. */
function ownFolder(t, from, cwd) {
  const top = (d) => tryGit(d, ["rev-parse", "--show-toplevel"]);
  const here = top(cwd);
  const stays = (...ds) => Boolean(here) && ds.some((d) => existsSync(d) && top(d) === here);
  return t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
    .replace(/(^|[\s;&|(])(cd|pushd)\s+\$\(dirname\s+\$(?:0|\{?BASH_SOURCE(?:\[0\])?\}?)\)((?:\/\.\.)*)\/?(?=[\s;&|)]|$)/gm,
      (m, lead, _cd, ups) => (stays(resolve(from, ...ups.split("/").filter(Boolean))) ? lead : m))
    .replace(/(^|[\s;&|(])(cd|pushd)\s+([\w][\w.-]*(?:\/[\w.-]+)*)\/?(?=[\s;&|)]|$)/gm,
      (m, lead, _cd, d) => (!d.split("/").includes("..") && stays(resolve(here || cwd, d), resolve(from, d)) ? lead : m));
}
/** A command that is a variable or a substitution ($TOOL x, `cat f`): its words come from outside the text.
 * Comment lines and arithmetic $(( )) run nothing, and a substitution of a git builtin ($(git rev-parse HEAD),
 * a value) is data; connector-cloud's verify.sh had all three (2026-11-03). */
// Where a command starts: a line, a separator, a keyword or a prefix that runs the next word (Security on 22885cb).
const HEAD_AT = String.raw`(?:^|[;&|(!{]|\b(?:then|do|else|if|elif|while|until|time|exec|command|nohup|nice)\b)`;
/** A shell (by its name, /bin/sh too), source, exec or command, anywhere in a line, with a $ or backtick in
 * any word after it up to the command's end, options and their values included (bash -O x "$X"); a
 * redirect's target is no word it runs (exec >"$LOG"). A `.` counts only as a command, not as find's folder.
 * Anywhere in a line, not only at its head: a helper (gate() { if "$@"; ... }) runs words passed to it. */
function runsVar(t) {
  const shell = String.raw`(?:\S*\/)?(?:${SHELLS.join("|")}|source|exec|command)`;
  const at = new RegExp(String.raw`(?:${HEAD_AT}\s*(?:\.|${shell})|\s${shell})(?=\s)([^;&|)\n]*)`, "gm");
  return [...t.matchAll(at)].some((m) => /[$`]/.test(m[1].replace(/(^|\s)\d*[<>]+&?\s*\S*/g, " ")));
}
/** A file run through a variable path with no shell in front: an interpreter's file, a program behind timeout
 * or nice, or the command itself (node "$DIR/publish.mjs", timeout 60 "$DIR/bin/x", bin/x-$T). Its words come
 * from outside the text, so it fails closed (Security on 16b4d73, medium: 22885cb read these as no push).
 * A $ path as a plain argument (mkdir -p "$OUT/logs") or a redirect's target is data. */
function runsVarPath(t) {
  const dyn = (w) => /[$`]/.test(w);
  const runs = new Set([...WRAPPERS, ...INTERPRETERS, ...RUNNERS, "timeout", "xargs", "stdbuf", "ionice", "chrt", "taskset", "setsid", "flock"]);
  for (const cmd of t.split(/[;&|\n]/)) {
    // A redirect and its target (2>"$LOG", > "$OUT/x") are not words it runs; a substitution's or subshell's
    // brackets are not part of a word (out=$(node "$DIR/x.mjs"); automated review of 9d49fae).
    const words = cmd.trim().replace(/^\(?[^\s($`]*\)\s/, "").replace(/^coproc\s+\w+\s+(?=[{(])/, "coproc ").split(/\s+/).filter((w, i, all) => w && !/^\d*[<>]/.test(w) && !/^\d*[<>]+&?$/.test(all[i - 1] || ""))
      .map((w) => w.replace(/^[A-Za-z_]\w*=(?=\$\(|`)/, "").replace(/^(?:\$\(|[(`{])+/, "").replace(/[)`}]+$/, "")).filter(Boolean);
    // What runs is the first word after a case branch's pattern (prod) or (prod) ...), assignments and keywords,
    // and coproc's name (coproc PUB { ... }).
    while (words.length && (/^[A-Za-z_]\w*=/.test(words[0]) || ["if", "then", "do", "else", "elif", "while", "until", "!", "{", "}", "time", "coproc"].includes(words[0]))) words.shift();
    const [head, ...rest] = words;
    if (!head) continue;
    if (words.some((w) => dyn(w) && /\.(?:sh|bash|zsh|m?[jt]sx?|cjs|py|rb|pl|php)$/.test(w))) return true;
    if (dyn(head) && head.includes("/")) return true;
    // A runner handed any $ word could run it (node "$SCRIPT", --require=$DIR/hook); an env assignment's
    // value without a path is data (env FOO="$X" make; automated review of 2c1ab44).
    if (runs.has(basename(head)) && rest.some((w) => dyn(w) && !/^[A-Za-z_]\w*=[^/]*$/.test(w))) return true;
  }
  return false;
}
function dynamicHead(t) {
  t = t.replace(/\$\(\([\s\S]*?\)\)/g, "0").replace(/^[ \t]*#.*$/gm, (c) => " ".repeat(c.length));
  const inFn = fnBodies(t);
  let start = 0;
  for (const line of t.split("\n")) {
    const lineAt = start;
    start += line.length + 1;
    for (const m of line.matchAll(new RegExp(`${HEAD_AT}\\s*(\\$\\(|\`|\\$\\{?[\\w@*#?!-])`, "g"))) {
      // A function's own arguments ($@, $1) are the words at its call sites, read in this same text; at a
      // script's top level they are its caller's words, which no reading here sees (automated review of afa69e0).
      const word = m.index + m[0].length - m[1].length;
      if (/^\$[@*1-9]/.test(line.slice(word)) && inFn(lineAt + word)) continue;
      if (m[1] === "$(" || m[1] === "`") {
        const sub = /^\s*git\s+([\w-]+)/.exec(line.slice(m.index + m[0].length));
        if (sub && BUILTIN.has(sub[1])) continue;
      }
      return true;
    }
  }
  return false;
}
/** Whether a place in the text is inside a function's braces (name() {, function name {), one line or many. */
function fnBodies(t) {
  const spans = [];
  for (const h of t.matchAll(/(?:^|[\s;&|])(?:function\s+[\w.:-]+(?:\s*\(\))?|[\w.:-]+\s*\(\))\s*\{/gm)) {
    let i = h.index + h[0].length, d = 1;
    for (; i < t.length && d; i++) d += t[i] === "{" ? 1 : t[i] === "}" ? -1 : 0;
    spans.push([h.index + h[0].length, i]);
  }
  return (p) => spans.some(([a, b]) => p >= a && p < b);
}
// The word git runs, after its own options (-C dir, -c key=value, --git-dir=x, --no-pager).
const GIT_SUB = /\bgit(?:\s+(?:-[Cc]|--git-dir|--work-tree|--namespace|--exec-path|--config-env)\s+\S+|\s+-\S+)*\s+([^\s;&|()<>]+)/g;
/** A git alias resolved as git does, alias to alias: `odd` when it is a shell alias (!), names a push, or
 * holds what this reading cannot follow; `a` is "" when the chain ends at a builtin or at no alias. */
function aliasPushes(dir, name) {
  let a = "", n = 0, odd = false;
  // Only plain words pass, led by a builtin or another alias: quotes, escapes or a leading option
  // could hide a push from this reading (automated review of b1bb581), so they are S8.
  while (n++ < 10 && (a = tryGit(dir, ["config", "--get", `alias.${name}`]))) {
    if (a.startsWith("!") || /\bpush\b|send-pack|http-push/.test(a) || !/^[A-Za-z0-9 ._\/=:@+-]+$/.test(a.trim()) || a.trim().startsWith("-")) { odd = true; break; }
    name = a.trim().split(/\s+/)[0];
    if (BUILTIN.has(name)) { a = ""; break; }
  }
  return { odd: odd || n > 10, a };
}
// git's own subcommands that never push: no alias can take their names.
const BUILTIN = new Set("add am apply bisect blame branch cat-file checkout cherry-pick clean clone commit config describe diff diff-tree fetch for-each-ref grep hash-object init log ls-files ls-remote ls-tree merge merge-base mv notes pull rebase reflog remote reset restore rev-list rev-parse revert rm shortlog show show-ref stash status submodule switch symbolic-ref tag worktree".split(" "));
// Programs that only read their words: `echo git push` and `grep push` run no git.
const READERS = ["echo", "printf", "grep", "rg", "cat", "less", "head", "tail", "wc", "jq", "true", "false", "test", "[", "ls"];
/** A segment (from its head) that only reads: a READERS program, or sed printing lines, `sed -n 1,2p FILE`, with
 * no option but -n, -E, -r and one script of p commands, so no e, w, s///e, -i or -f can run or write (0.26.1). */
function isReader(ws) {
  // Named by a path (bin/cat, ./bin/cat), a reader is whatever was planted there (Prover on 130a63a).
  if ((ws[0]?.w ?? "").includes("/")) return false;
  const h = basename(ws[0]?.w ?? "");
  if (READERS.includes(h)) return true;
  if (h !== "sed" || ws.some((x) => x.dyn)) return false;
  const rest = ws.slice(1).map((x) => x.w);
  const opts = rest.filter((w) => w.startsWith("-")), args = rest.filter((w) => !w.startsWith("-"));
  return opts.every((o) => /^-[nEr]+$/.test(o)) && args.length >= 1 && /^(\d+|\$)(,(\d+|\$))?p$/.test(args[0]);
}
/** One `cat > FILE <<'X'` (or >>, >|; "X" too) whose body ends the command at its delimiter: text into a file outside
 * .git, which no shell reads (0.26.1). An unquoted delimiter expands $(...) and stays refused. */
function quotedHereDocToFile(cmd, cwd) {
  const m = /^\s*cat\s*(?:>>|>\||>)\s*([\w.\/-]+)\s*<<(-?)\s*(['"])([A-Za-z_]\w*)\3[ \t]*\n([\s\S]*)$/.exec(cmd);
  // A relative path in the repo with no dot part: .git in any case (a case-insensitive disk), .husky, .gitconfig, a
  // path outside the repo, may be a file git runs (Security on e44025b..615cac2).
  if (!m || m[1].startsWith("/") || m[1].split("/").some((p) => p.startsWith("."))) return false;
  // Nor typed from inside .git, nor through a symlink (gd -> .git): each part that exists must be a plain folder or
  // file (Security on e44025b..ac3e68f, medium).
  if (!cwd) return false;
  try { if (realpathSync.native(cwd).split("/").some((p) => /^\.git$/i.test(p))) return false; } catch { return false; }
  const parts = m[1].split("/").filter((p) => p && p !== ".");
  for (let i = 1; i <= parts.length; i++) {
    let st;
    try { st = lstatSync(join(cwd, ...parts.slice(0, i))); } catch { break; }
    if (st.isSymbolicLink()) return false;
    // A file already there must be a plain file with one name: a hard link may be a hook (Security on e44025b..130a63a).
    if (i === parts.length && (!st.isFile() || st.nlink !== 1)) return false;
  }
  // Nor into git's own folder or the one core.hooksPath names, wherever they are (Prover on ac3e68f).
  let gitDirs;
  try {
    gitDirs = execFileSync(GIT, ["-c", "core.fsmonitor=false", "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--git-path", "hooks"], { cwd, env: { ...gitEnv(process.env), GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 })
      .trim().split("\n").map((d) => { try { return realpathSync.native(d); } catch { return resolve(cwd, d); } });
  } catch { return false; }
  let parent = resolve(cwd, dirname(m[1]));
  while (!existsSync(parent)) parent = dirname(parent);
  // The disk's own case (realpathSync.native), and compared without case: HK is hk on a case-insensitive disk
  // (Security on e44025b..130a63a).
  // Nor under any git folder, a nested repo's included (a folder holding HEAD with config or hooks; Security on 6f498d1).
  for (let d = realpathSync.native(parent); ; d = dirname(d)) {
    if (existsSync(join(d, "HEAD")) && (existsSync(join(d, "config")) || existsSync(join(d, "hooks")))) return false;
    if (dirname(d) === d) break;
  }
  const real = realpathSync.native(parent).toLowerCase();
  if (gitDirs.some((d) => real === d.toLowerCase() || real.startsWith(d.toLowerCase() + "/"))) return false;
  // The shell ends the body at the first line that is the delimiter (tabs stripped under <<-): it must be the last
  // line, or the lines after it run as commands.
  const lines = m[5].replace(/\n$/, "").split("\n");
  const end = (l) => (m[2] ? l.replace(/^\t+/, "") : l).replace(/[ \t]+$/, "") === m[4];
  return end(lines[lines.length - 1]) && lines.slice(0, -1).every((l) => !end(l));
}
const WRAPPERS = ["env", "command", "exec", "nohup", "time", "nice", "builtin", "sudo", "!", "{", "}", "if", "then", "do", "else", "elif", "while", "until"];
const SHELLS = ["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "mksh", "yash", "busybox"];
// Interpreters whose file is read like a script; what it imports is piece 8's (jg 2026-11-02, "draw the line").
const INTERPRETERS = ["node", "deno", "tsx", "ts-node", "zx", "python", "python3", "ruby", "perl", "php"];
// Their options that take the next word as a value, so the file is the word after it.
const TAKES_VALUE = ["-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file", "-C", "--conditions", "--title", "-W", "-X"];

/** Whether the file an interpreter runs directly could push, read as scriptPushes reads a script (Security on 737543e). */
function interpPushes(words, dir) {
  for (let i = words[0] === "run" ? 1 : 0; i < words.length; i++) {
    const w = words[i];
    if (TAKES_VALUE.includes(w)) { i++; continue; }
    // Code in the command itself (-e, -c, -m a module) is read by the git-word check, or is piece 8's.
    if (["-e", "--eval", "-p", "--print", "-c", "-m"].includes(w)) return false;
    if (w.startsWith("-")) continue;
    const f = resolve(dir, w);
    return existsSync(f) ? scriptPushes(f, 0, { cwd: dir }) : false;
  }
  return false;
}
const WHOLE = ["--tags", "--all", "--mirror", "--delete", "-d", "--prune"];
const TAKES = ["--repo", "-o", "--push-option", "--receive-pack", "--exec", "--signed"];
/** { remote, src, dest } from a push's words, or null when it pushes more than one branch or can't be read. */
function readArgs(args) {
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { pos.push(...args.slice(i + 1)); break; }
    // Submodules are pushed too, each to its own remote, unjudged (Security round 2 on b6ca3b9).
    if (a === "--recurse-submodules" || (a.startsWith("--recurse-submodules=") && !/=(check|no)$/.test(a))) return null;
    if (WHOLE.includes(a) || a.startsWith("--receive-pack") || a.startsWith("--exec") || a.startsWith("--repo")) return null;
    if (TAKES.includes(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    pos.push(a);
  }
  if (pos.length > 2) return null;
  const [remote = "", spec = ""] = pos;
  if (!spec) return { remote, src: "", dest: "" };
  const s = spec.replace(/^\+/, "");
  if (/[*]/.test(s)) return null;
  const [src, dest, extra] = s.split(":");
  if (extra != null || src === "" || dest === "") return null;
  const short = (x) => x.replace(/^refs\/heads\//, "");
  if (/^refs\//.test(short(src)) || (dest && /^refs\//.test(short(dest)))) return null;
  return { remote, src: short(src), dest: dest == null ? "" : short(dest) };
}

// ---------- the repo's state ----------

const RO = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
function git(root, args, { buffer } = {}) {
  // Never a prompt: the gate's own git asks no one for a password (automated review of 0cede9f).
  return execFileSync(GIT, [...RO, ...args], { cwd: root, env: { ...gitEnv(process.env), GIT_TERMINAL_PROMPT: "0" }, encoding: buffer ? undefined : "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 30, timeout: 15000 });
}
const tryGit = (root, args) => { try { return git(root, args).trim(); } catch { return ""; } };
/** The work tree `dir` belongs to, also from inside its git dir, where --show-toplevel fails but a push still
 * pushes the repo (Prover 4-10 on ce6e6e6). A git dir whose work tree cannot be found throws, marked `gitDir`. */
export function topLevel(dir) {
  try { return git(dir, ["rev-parse", "--show-toplevel"]).trim(); } catch (e) {
    // git's own hook there runs with GIT_DIR=. and says it is not inside the git dir: read the common dir.
    const common = tryGit(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (!common) throw e;
    // A bare clone still pushes the repo's commits: judged as itself, by the table at its HEAD (Prover 4-10 on d48dc59).
    if (tryGit(dir, ["rev-parse", "--is-bare-repository"]) === "true") return common;
    // Only the main git dir maps to its parent: a linked worktree's own git dir shares the common dir but has
    // its own HEAD, so it fails closed (automated review of d48dc59).
    const own = tryGit(dir, ["rev-parse", "--absolute-git-dir"]);
    if (own === common && basename(common) === ".git" && !tryGit(dir, ["config", "--get", "core.worktree"])) return dirname(common);
    throw Object.assign(new Error(`${dir} is inside a git dir whose work tree is not its parent`), { gitDir: true });
  }
}

function readLedger(root) {
  let common = git(root, ["rev-parse", "--git-common-dir"]).trim();
  if (!isAbsolute(common)) common = join(root, common);
  const f = join(stateDir(common), "ledger.jsonl");
  if (!existsSync(f)) return [];
  const rows = [];
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o && typeof o === "object") rows.push(o); } catch {}
  }
  return rows;
}

const short = (x) => x.slice(0, 12);
const list = (ps) => ps.slice(0, 5).join(", ") + (ps.length > 5 ? `, and ${ps.length - 5} more` : "");
const deny = (reason) => ({ deny: reason });

// Keys in the repo's own config that make reading (or pushing to) a remote run a program or go
// elsewhere (automated review of cf67338): refused, never cleared, so the owner's own setup still works.
const RUNS = /^(core\.sshcommand|core\.gitproxy|core\.askpass|credential\..*|remote\..*\.(uploadpack|receivepack|vcs|proxy|push|pushurl|mirror)|url\..*|protocol\..*|include\..*|includeif\..*|push\.default|push\.recursesubmodules|submodule\..*|http\..*\.proxy|http\.proxy)$/i;
// The worktree's own config too: with extensions.worktreeConfig, `git config --worktree` keys are not --local
// (automated review of c4a81d0). Without it, --worktree is --local.
const localRuns = (root) => [...new Set(["--local", "--worktree"].flatMap((s) => tryGit(root, ["config", s, "--name-only", "--list"]).split("\n")))].filter((k) => RUNS.test(k));
// Of those, the keys that change where or how git reaches a remote, so the gate's ask could hear another remote
// than the push reaches (automated review of 7bdc63e). Submodule and credential keys leave the ask alone.
const REDIRECTS = /^(core\.sshcommand|core\.gitproxy|remote\..*\.(vcs|proxy)|url\..*|protocol\..*|include\..*|includeif\..*|http\..*\.proxy|http\.proxy)$/i;

/** Whether the repo at `dir` holds pushes: its table in the working tree, at HEAD or on a remote branch.
 * Not a repo: no. An error once it is a repo: yes (fail closed). */
export function heldRepo(dir, { ask = false } = {}) {
  let root;
  try { root = topLevel(dir); } catch (e) { return e.gitDir === true; }
  try { return pointed(root) || holds(root, Infinity, ask ? () => remoteHolds(root, null, {}) : undefined); } catch { return true; }
}
/** Once held, always held: the hook's pointer stays after every ref here lost the table (jg 2026-11-01). */
function pointed(root) {
  try { return existsSync(hookSite(root).pointer); } catch { return false; }
}

/** Whether `root`'s pushes are held: the table in the working tree, at HEAD or on the remote's branch, so
 * deleting it from the working tree never frees a push (automated review of cf67338). At most the likeliest 50
 * commits on remote and local branches; past `until`, the push is held (automated review of b7bfbc6). */
function holds(root, until, past = () => false) {
  if (tableGlobs(root) || tableGlobsAt(root, tryGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"]))) return true;
  // Local branches too: a bare clone has no refs/remotes, and its HEAD can name a branch with no table (automated review of 9d5f91e).
  // Distinct commits, not refs: a pushed branch and its tracking ref are one (Prover 18-24 on ff5bc4b).
  // The likeliest carriers first, so a capped read still sees them: the remote's HEAD, HEAD's upstream, then the
  // newest branches (automated review of 5026873).
  const first = ["refs/remotes/origin/HEAD", "@{upstream}"].map((r) => tryGit(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", r]));
  const raw = tryGit(root, ["for-each-ref", "--count=201", "--sort=-committerdate", "--format=%(objectname)", "refs/remotes", "refs/heads"]).split("\n").filter(Boolean);
  const refs = [...new Set([...first.filter(Boolean), ...raw])];
  // Past the cap only the likeliest 50 are read, for a push and the install alike: none carries the table, not
  // held; once held stays held by the hook's pointer (jg 2026-11-01, the cap's fail-closed rule dropped). A push
  // past the cap asks the remote too (`past`).
  const over = refs.length > 50;
  refs.length = Math.min(refs.length, 50);
  return refs.some((c) => Date.now() > until || tableGlobsAt(root, c)) || (over && past());
}
const lateAfter = (until) => () => { if (Date.now() > until) throw Object.assign(new Error(`over ${DEADLINE_MS / 1000} s`), { check: "time" }); };

const why = (e) => `${e.check || (e.code === "ENOENT" ? "git" : "push check")}: ${String(e.message || e).split("\n")[0].replace(/[()]/g, "")}`;
/** S11 and W2: an error once the repo is known to be held refuses; before, it passes with a warning. */
const s11 = (root, e) => `Push gate: could not check ${root} (${why(e)}), so this push is refused. Try the push again; if it fails the same way, the owner can push from their own terminal with git push --no-verify.`;
const w2 = (e) => `Push gate: could not run (${why(e)}); this push is not checked.`;
export const NO_VERIFY = "Push gate: --no-verify skips the pre-push check, which only the owner may do, typed in their own terminal. Push without it.";

/** The pre-push hook's file (slice 4a-hook): the same bytes in every repo and every version. */
export const PRE_PUSH = readFileSync(new URL("./pre-push.sh", import.meta.url));
/** Any version's shim: its second line, which every version keeps. */
export const ourHook = (b) => String(b).split("\n")[1] === String(PRE_PUSH).split("\n")[1];
/** Where the hook goes for `dir`'s repo, for the install and the Bash gate alike: `own` when git runs
 * hooks from the common dir's own folder, the only place it is installed (Architect on 5271ab8). */
export function hookSite(dir) {
  const root = topLevel(dir);
  let common = git(root, ["rev-parse", "--git-common-dir"]).trim();
  if (!isAbsolute(common)) common = join(root, common);
  const dirOf = hooksDir(root, common);
  return { root, common, dir: dirOf, own: dirOf === join(common, "hooks"), hook: join(common, "hooks", "pre-push"), pointer: join(stateDir(common), "plugin-root") };
}
const PLUGIN = fileURLToPath(new URL("..", import.meta.url));
/** plugin-root's whole text for a session: the install writes it, the Bash gate compares it byte for byte (a
 * path compared by its target could be a symlink switched later; automated review of aa9cb41). */
export const pointerText = (env = process.env) => `${resolve(env.CLAUDE_PLUGIN_ROOT || PLUGIN)}\n${dirname(projectsDir(env))}\n`;
/** "" when `dir`'s repo never had the hook installed (no plugin-root) or has it
 * intact, naming this session's plugin and transcripts folder; else the Bash gate's refusal. A forged
 * pointer is refused from the next command on (automated review of 5271ab8); one forged and used in
 * the same command is piece 8's. */
function hookState(dir, env) {
  const s = hookSite(dir);
  if (!existsSync(s.pointer)) return "";
  // Hooks moved elsewhere after the install: git no longer runs the check, so refuse, with advice that
  // works (a session never installs there; Architect on 5271ab8).
  if (!s.own) return `Push gate: ${s.root} now runs git hooks from ${s.dir}, so its pre-push check does not run. Undo that (git -C ${s.root} config --unset core.hooksPath), then push.`;
  let ok = false;
  try { ok = (statSync(s.hook).mode & 0o100) !== 0 && readFileSync(s.hook).equals(PRE_PUSH); } catch {}
  if (!ok) return `Push gate: ${s.root}'s pre-push check is missing or changed. Start a new session in ${s.root} to put it back, then push.`;
  if (readFileSync(s.pointer, "utf8") !== pointerText(env)) return `Push gate: ${s.pointer} names another HarteBurn or transcripts folder than this session's. Start a new session in ${s.root} to put it back, then push.`;
  return "";
}

/**
 * The pre-push hook's check (slice 4a-hook): git's own arguments (remote name, URL) and its stdin lines
 * (<local ref> <local sha> <remote ref> <remote sha>), so however the push was typed, each ref sent is
 * judged as the Bash gate judges a push; the first refusal wins. `--tags`, `--all` and several refspecs
 * are just several lines. Not judged here: the environment's GIT_ variables (git sets GIT_DIR for a
 * worktree's hook) and the repo's own config (S10): git has already read both. Any error refuses (S11),
 * even before the table is read: the hook is only installed where the repo was held, and an agent can
 * make the house rules unreadable with a plain chmod.
 */
export function prePushGate(argv, lines, cwd, env = process.env, { deadlineMs = DEADLINE_MS, seat } = {}) {
  askAfresh();
  const until = Date.now() + deadlineMs;
  let root = cwd;
  try {
    root = topLevel(cwd);
    // No holds() short cut: the hook is installed only where the repo was held, so every push here is judged (jg 2026-11-01).
    const none = (x) => !x || /^0+$/.test(x);
    const commit = (x) => exactCommit(root, tryGit(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${x}^{commit}`]));
    // Read once per push, not once per ref: the remote's HEAD, the ledger and the verdicts (Architect on b6aa603).
    const warns = [], memo = { seat };
    for (const l of lines) {
      const [, local, dest = "", remote] = l.trim().split(/\s+/);
      if (none(local)) continue; // a deletion sends no commits
      const T = commit(local);
      if (!T) return deny(S8);
      let tip = "";
      if (!none(remote)) {
        tip = commit(remote);
        if (!tip) return deny(`Push gate: ${root}'s remote ${argv[0]} has ${short(remote)} on ${dest.replace(/^refs\/(heads|tags)\//, "")}, which this clone does not have. Fetch, then push.`);
      } else {
        // A new ref: from where it leaves the remote's default branch, asked of the remote as the Bash gate does.
        const url = String(argv[1] || "");
        if (!url || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(url)) return deny(S8);
        const h = (memo.head ??= git(root, ["-c", "protocol.ext.allow=never", "-c", "protocol.fd.allow=never", "ls-remote", "--upload-pack=git-upload-pack", "--end-of-options", url, "HEAD"]).split("\t")[0].trim());
        tip = h && exactCommit(root, h) ? tryGit(root, ["merge-base", "--end-of-options", T, h]) : "";
      }
      const r = judgeRange(root, T, tip, env, lateAfter(until), memo);
      if (r.deny) return r;
      if (r.warn) warns.push(r.warn);
    }
    return warns.length ? { warn: [...new Set(warns)].join("\n") } : {};
  } catch (e) {
    return { deny: s11(root, e) };
  }
}

/** The branch HEAD is on, the push's source and the commit it sends ("" when it names none). */
function sourceOf(root, at) {
  const branch = tryGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const src = !at.src || at.src === "HEAD" ? (at.src === "HEAD" ? "HEAD" : branch) : at.src;
  const T = src ? exactCommit(root, tryGit(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${src}^{commit}`])) : "";
  return { branch, src, T: T || "" };
}

// Only git's own transports from the gate: a remote helper (x::y), ext or fd would run a program (Prover on cf67338).
const TRANSPORTS = ["-c", "protocol.allow=never", ...["file", "ssh", "git", "http", "https"].flatMap((t) => ["-c", `protocol.${t}.allow=always`])];

/** git's own reading of a readable push: a dry run, hooks off, built from readArgs only (never the raw words),
 * forced so each update names the remote's old tip, even one this clone lacks. One per push, for the cap's ask and
 * the range alike (Architect 2026-11-01; jg reopened "ask the remote" for it, 2026-11-01). { url, refs: [{ flag,
 * to, old, sum }] }; throws when git cannot plan the push. */
function planOf(p, root, at) {
  if (p.plan) return p.plan;
  const spec = at.src ? [at.dest ? `${at.src}:${at.dest}` : at.src] : [];
  const out = git(root, [...TRANSPORTS, "-c", "core.abbrev=no", "push", "--dry-run", "--porcelain", "--force", "--no-recurse-submodules", "--receive-pack=git-receive-pack", "--", ...(at.remote ? [at.remote] : []), ...spec]).split("\n");
  const refs = out.filter((l) => /^[ +\-*=!]\t/.test(l)).map((l) => {
    const [flag, fromTo = "", sum = ""] = l.split("\t");
    const at = fromTo.indexOf(":");
    return { flag, from: fromTo.slice(0, at), to: fromTo.slice(at + 1), old: /^([0-9a-f]{40,64})\.\.\.?/.exec(sum)?.[1] || "", sum };
  });
  return (p.plan = { url: (out.find((l) => l.startsWith("To ")) || "").slice(3), refs });
}

/** Past the ref cap, what the remote reports (jg 2026-11-01, "ask the remote"; Prover 4-10 on 1fd388a). A
 * readable push: git's own plan for it, held when a tip it would overwrite carries the table or is one this clone
 * lacks (git refuses that push unless it is forced), or git would refuse it. A push that cannot be read: every
 * configured remote's branches, held when one this clone has carries the table. Held too when the repo's own
 * config redirects how git reaches a remote, or the ask fails: the push would not reach it either (automated
 * review of 7bdc63e). */
function remoteHolds(root, at, p) {
  try {
    if (localRuns(root).some((k) => REDIRECTS.test(k))) return true;
    if (at) return planOf(p, root, at).refs.some((r) => r.flag === "!" || (r.old && (!exactCommit(root, r.old) || tableGlobsAt(root, r.old))));
    for (const name of tryGit(root, ["remote"]).split("\n").filter(Boolean)) {
      const url = tryGit(root, ["remote", "get-url", "--push", "--end-of-options", name]) || name;
      const tips = git(root, [...TRANSPORTS, "ls-remote", "--heads", "--upload-pack=git-upload-pack", "--end-of-options", url]).split("\n").map((l) => l.split("\t")[0]).filter(Boolean);
      if (tips.some((t) => tableGlobsAt(root, t))) return true;
    }
    return false;
  } catch { return true; }
}

/** The verdict for one push: { deny } | { warn } | {} (allowed, nothing to say). */
function judge(p, env) {
  const root = topLevel(p.dir);
  p.root = root;
  const at = readArgs(p.args || []);
  // Held by the repo's refs, or by the commit being pushed: a commit on no branch still carries its table
  // (automated review of ff5bc4b).
  const so = at && sourceOf(root, at);
  if (!pointed(root) && !holds(root, p.until, () => remoteHolds(root, p.unreadable ? null : at, p)) && !(so && tableGlobsAt(root, so.T))) return {};
  p.held = true;
  if (p.unreadable || !at) return deny(S8);
  const planted = localRuns(root);
  if (planted.length) return deny(`Push gate: ${root}'s own git config sets ${planted.slice(0, 3).join(", ")}, which would run or redirect before the push is judged. Push from your own terminal, or move the setting to your global git config; do not delete it.`);
  // Which branch goes where.
  const { branch, src, T } = sourceOf(root, at);
  if (!src || !T) return deny(S8);
  // Where it goes and what it overwrites, as git reads it: one branch, or S8 (Prover round 1 on cf67338: git's own
  // push settings can push several).
  // Submodules pushed by the owner's own push.recurseSubmodules go unjudged, as --recurse-submodules does (Prover 4-10
  // on 0cede9f).
  // Unset, git falls back to submodule.recurse (true: on-demand), read as git reads a bool (automated review of e6314f4).
  const rs = tryGit(root, ["config", "--get", "push.recurseSubmodules"]);
  const sr = rs ? "" : tryGit(root, ["config", "--get", "submodule.recurse"]);
  if (rs ? !/^(check|no|false|off|0)$/i.test(rs) : sr && tryGit(root, ["config", "--type=bool", "--get", "submodule.recurse"]) !== "false") return deny(S8);
  let plan;
  try { plan = planOf(p, root, at); } catch (e) {
    // git cannot plan it: a remote it cannot reach is S8 (no URL, or a helper's, never run); any other failure, S11.
    const url = tryGit(root, ["remote", "get-url", "--push", "--end-of-options", at.remote || "origin"]);
    if (at.remote && (!url || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(url))) return deny(S8);
    throw e;
  }
  // Tags git adds by push.followTags point into the pushed history, judged with it (Prover 18-24 on 0cede9f).
  const peel = (r) => tryGit(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${r}^{commit}`]);
  const refs = plan.refs.length > 1 ? plan.refs.filter((r) => !(r.to.startsWith("refs/tags/") && peel(r.from) && isAncestor(root, peel(r.from), T))) : plan.refs;
  if (refs.length !== 1) return deny(S8);
  const [{ flag, from, to, old, sum }] = refs;
  if (flag === "!") throw Object.assign(new Error(sum), { check: "dry run" });
  // The commit git would send is the one judged: a push refspec in any config can send another (automated
  // review of 0cede9f).
  if (peel(from) !== T) return deny(S8);
  const dest = to.replace(/^refs\/heads\//, "");
  // The remote by its configured name, as the hook names it (git's argv): the one whose push URL git used (Prover
  // 18-24 on 0cede9f).
  const named = at.remote || tryGit(root, ["remote"]).split("\n").filter(Boolean).find((n) => tryGit(root, ["remote", "get-url", "--push", "--end-of-options", n]) === plan.url) || plan.url;
  if (old && !exactCommit(root, old)) return deny(`Push gate: ${root}'s remote ${named} has ${short(old)} on ${dest}, which this clone does not have. Fetch, then push.`);
  let tip = flag === "=" ? T : old;
  // A new branch: judged from where it leaves the remote's HEAD.
  if (!tip) {
    const h = git(root, [...TRANSPORTS, "ls-remote", "--upload-pack=git-upload-pack", "--end-of-options", plan.url, "HEAD"]).split("\t")[0].trim();
    tip = h && exactCommit(root, h) ? tryGit(root, ["merge-base", "--end-of-options", T, h]) : "";
  }
  return judgeRange(root, T, tip, env, lateAfter(p.until), { seat: p.seat });
}

/** The verdict on a held repo's pushed range tip..T (no tip: all of T), for the Bash gate and the pre-push
 * hook alike: one reading of the table, the ledger and the verdicts. */
/** The piece of board `id` whose stamped start is `base`, or null (no stamps, none matches). */
function pieceAt(root, id, base) {
  try {
    const common = tryGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (!common) return null;
    const stamps = JSON.parse(readFileSync(join(stateDir(common), `stamps-${id}.json`), "utf8"));
    const b = exactCommit(root, base);
    for (const [n, st] of Object.entries(stamps.pieces || {})) { try { if (b && pieceStart(root, st) === b) return Number(n); } catch {} }
  } catch {}
  return null;
}

function judgeRange(root, T, tip, env, late, memo = {}) {
  const name = basename(root);
  const globs = tableGlobs(root);
  const held = [...new Set([...(globs || []), ...(tip ? tableGlobsAt(root, tip) || [] : []), ...(tableGlobsAt(root, T) || [])])].map(globRe);
  const onTable = (f) => held.some((re) => re.test(f));
  const commits = git(root, ["rev-list", "--reverse", "--end-of-options", T, ...(tip ? [`^${tip}`] : [])]).split("\n").filter(Boolean);
  const touched = new Map();
  for (const c of commits) {
    late();
    const fs = git(root, ["diff-tree", "-r", "--no-commit-id", "--name-only", "--no-renames", "-z", "--root", "-m", "--first-parent", "--end-of-options", c]).split("\0").filter(Boolean).filter(onTable);
    if (fs.length) touched.set(c, [...new Set(fs)]);
  }
  if (!touched.size) return {};
  late();
  const ledger = (memo.ledger ??= readLedger(root));
  const boards = [...new Set(ledger.filter((r) => r.event === "stop" && typeof r.board === "string").map((r) => r.board))];
  const all = (role) => (memo[role] ??= boards.flatMap((b) => verdicts(root, b, ledger, { env, role })));
  const warn = existsSync(join(boardDir(root), "board.json")) ? "" : `Push gate: no board record in ${root}; verdicts read from the ledger only.`;
  const out = (r) => (warn ? { ...r, warn } : r);
  // Security: each commit on the table inside a run's --base..--head; the latest such run wins.
  const sec = all("security");
  // A run covers only from a real base on its head's first-parent line: a base that is no commit here, or
  // one off to the side, would cover commits its review never showed (Prover on aa9cb41).
  const line = new Map();
  const anchored = (v) => {
    if (!exactCommit(root, v.head) || !exactCommit(root, v.base)) return false;
    if (!line.has(v.head)) line.set(v.head, new Set(git(root, ["rev-list", "--first-parent", "--end-of-options", v.head]).split("\n").filter(Boolean)));
    return line.get(v.head).has(v.base);
  };
  const within = (c, v) => anchored(v) && isAncestor(root, c, v.head) && !isAncestor(root, c, v.base);
  const uncovered = [];
  for (const [c, fs] of touched) {
    const over = sec.filter((v) => within(c, v)).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    if (!over.length) { uncovered.push(...fs); continue; }
    if (over[0].word === "does not hold") {
      const finding = over[0].first.replace(/^does not hold[\s.:,-]*/i, "").trim();
      // The owner's typed acceptance of this whole finding, after the verdict, clears it, read as the board
      // reads it: an agent's words never count (jg 2026-11-02: the gate must not block the owner's go).
      // Only for the piece the run judged: the one the board stamped starting at its base (Security on d2c074b, low).
      // On a Team license only the security owner's accept counts, as the board's seat check reads it (B1; Security on 7f189db, F1).
      const seated = (b) => seatGate(root, { id: b }, null, ledger, { env, ...memo.seat }).ledger;
      if (finding && boards.some((b) => { const n = pieceAt(root, b, over[0].base); return n != null && acceptances(root, b, seated(b), { env }).some((a) => a.piece === n && answers(a, over[0], finding)); })) continue;
      return out(deny(`Push gate: Security does not hold on ${root} ${short(T)}: "${finding || "see its verdict"}". Fix it, re-run Security, then push. Or the owner accepts the risk by sending, alone in one message, "accept piece <n>: ${finding || "<the finding>"}".`));
    }
  }
  if (uncovered.length) {
    const ps = [...new Set(uncovered)];
    return out(deny(`Push gate: ${root} ${short(T)} has commits on security-domain paths with no Security "holds" covering them (${list(ps)}). In a ${name} session, dispatch harteburn:security with exactly the prompt node <plugin>/scripts/board-security.mjs --prompt ${tip || "<the remote tip>"} ${T} prints, then push.`));
  }
  late();
  // Prover: one run (or one swarm) proven on these files as they are at T, from at or before the tip.
  const pushed = [...new Set(git(root, ["diff", "--name-only", "--no-renames", "-z", "--end-of-options", ...(tip ? [tip, T] : [git(root, ["hash-object", "-t", "tree", "/dev/null"]).trim(), T])]).split("\0").filter(Boolean).filter(onTable))];
  if (!pushed.length) return out({});
  const at_T = new Map(pushed.map((f) => {
    try { return [f, createHash("sha256").update(git(root, ["cat-file", "blob", "--end-of-options", `${T}:${f}`], { buffer: true })).digest("hex")]; } catch { return [f, null]; }
  }));
  const fits = (v) => tip && exactCommit(root, v.base) && isAncestor(root, v.base, tip) && pushed.every((f) => v.files.some(([p, s]) => p === f && s === at_T.get(f)));
  const runs = all("prover").filter(fits).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  if (runs[0]?.word === "defect") return out(deny(`Push gate: the Prover found a defect on ${root} ${short(T)}: fix it and prove again, then push.`));
  // A whole run's proven counts when no defect is newer (runs are newest first). A swarm counts per step:
  // the newest member on that step, from one head and one swarm size, says proven (Prover on b6ca3b9).
  const firstDefect = runs.findIndex((v) => v.word === "defect");
  const whole = runs.some((v, i) => !v.swarm && v.word === "proven" && (firstDefect < 0 || i < firstDefect)) || [...new Set(runs.filter((v) => v.swarm).map((v) => `${v.head} ${v.swarm.of}`))].some((k) => {
    const [h, of] = k.split(" "), word = new Map();
    for (const v of runs) {
      if (v.swarm && !(v.head === h && String(v.swarm.of) === of)) continue;
      const [a, z] = v.swarm ? v.swarm.steps : [1, Number(of)];
      for (let s = a; s <= z; s++) if (!word.has(s)) word.set(s, v.word);
    }
    return Array.from({ length: Number(of) }, (_, i) => i + 1).every((s) => word.get(s) === "proven");
  });
  if (whole) return out({});
  const good = all("prover").filter((v) => v.word === "proven" && tip && exactCommit(root, v.base) && isAncestor(root, v.base, tip));
  const missing = pushed.filter((f) => !good.some((v) => v.files.some(([p, s]) => p === f && s === at_T.get(f))));
  return out(deny(`Push gate: no Prover "proven" covers ${root} ${short(T)} (${list(missing.length ? missing : pushed)}). Run /prove after --base ${tip ? short(tip) : "<the remote tip>"} (or an earlier commit), then push.`));
}

/**
 * The push gate for one Bash command: { deny?, warn? }. Any error inside a check allows, with one
 * warning (W2): the hook never breaks a session. A board record that cannot be read is W2 too.
 */
export function pushGate(command, cwd, env = process.env, { deadlineMs = DEADLINE_MS, seat } = {}) {
  askAfresh();
  // A git the reader could not place, in a folder it knows, holds only where that repo is held: an
  // unheld project's `timeout 60 git fetch` is left alone. With no folder, it holds everywhere.
  const pushes = pushesIn(command, cwd).filter((p) => !(p.unknown && p.dir && !heldRepo(p.dir, { ask: true })));
  if (!pushes.length) return {};
  // A git variable in the environment the push runs in changes what it reads (automated review of b7bfbc6).
  const vars = Object.keys(env).filter((k) => /^GIT_(CONFIG|DIR$|WORK_TREE$|NAMESPACE$|COMMON_DIR$|INDEX_FILE$|OBJECT_DIRECTORY$|ALTERNATE)/.test(k));
  if (vars.length && pushes.some((p) => !p.alias)) return { deny: `Push gate: the environment sets ${vars.slice(0, 3).join(", ")}, which changes what this push reads. Push from your own terminal, without it.` };
  if (pushes.some((p) => p.unknown || (p.dir && !existsSync(p.dir)))) return { deny: S8 };
  // In a held repo the pre-push hook is the check git itself runs: an agent may not skip it, and a
  // hook file removed or changed, by any spelling, refuses every push until a session puts it back.
  for (const p of pushes) {
    if (!heldRepo(p.dir)) continue;
    if ([...(p.args || []), ...(p.words || [])].some((a) => a.length >= 7 && "--no-verify".startsWith(a))) return { deny: NO_VERIFY };
    let state;
    try { state = hookState(p.dir, env); } catch (e) { return { deny: s11(p.dir, e) }; }
    if (state) return { deny: state };
  }
  const warns = [];
  const until = Date.now() + deadlineMs;
  for (const p of pushes) {
    let r;
    try {
      if (p.alias != null) {
        // A git alias that pushes is read by no one here (automated review of cf67338).
        // Resolved as git does, alias to alias; a shell alias (!) or a push anywhere in it is S8, and so is
        // a program that is not an alias but is told to push (`git subtree push`, `git lfs push`).
        const { odd, a } = aliasPushes(p.dir, p.alias);
        r = odd || (!a && p.words.includes("push")) ? { deny: S8 } : {};
      } else { p.until = until; p.seat = seat; r = judge(p, env); }
    } catch (e) {
      // Before the repo is known to be held, an error allows with one warning (W2); once it is held,
      // the push is refused: an error the agent can cause never opens the gate (automated review of cf67338).
      r = p.held ? { deny: s11(p.root, e) } : { warn: w2(e) };
    }
    if (r.deny) return r;
    if (r.warn) warns.push(r.warn);
  }
  return warns.length ? { warn: [...new Set(warns)].join("\n") } : {};
}
