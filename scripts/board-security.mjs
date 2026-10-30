// rc-security piece 3 (PRD-RC-SECURITY-3, jg 2026-10-28, D4): the board refuses Done on a piece whose
// diff touches a path on the project's security-domain table with no Security verdict that covers it.
// The verdict is never a typed field: the ledger's dispatch row is the key, and the word is read from
// the transcript Claude Code wrote for that run, which must agree with the row (agent type, dispatch
// id, prompt hash). A row typed by hand has no such transcript, so it does not count. Someone who also
// forges the transcript and its meta gets past this; the board shows a deliberate edit, it can't stop
// one (applyStamps, Lead ruling 2026-10-21).

import { readFileSync, existsSync, realpathSync, readdirSync, statSync, lstatSync, readlinkSync } from "node:fs";
import { join, relative, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parsePathTable, globRe } from "./globs.mjs";
import { ledgerId, heldToRules, DONE_RULES_FROM } from "./board-schema.mjs";
import { finalReply, LOCAL_FILES_HEAD } from "../hooks/redcell-hook.mjs";

export const HOUSE_RULES = "docs/_house-rules.md";
export const TABLE_HEADING = /^## Security-domain paths\s*$/;
/** Head stamps exist from 0.23.2 (built 2026-10-28): a done piece started since then with none had it removed. */
export const HEADS_FROM = "2026-10-28T20:30:00Z";
export const NO_TABLE = 'No "## Security-domain paths" table in docs/_house-rules.md: no piece is held for a Security verdict';
const SECURITY_ROLES = new Set(["redcell:security", "harteburn:security"]);
const isSecurity = (role) => SECURITY_ROLES.has(role);

/**
 * The one prompt a Security verdict is counted from, with only the two commits filled in. A real run
 * whose prompt narrows it ("judge only scripts/x.mjs") is not a verdict on the piece (Security's second
 * verdict on piece 3, 2026-10-28). Like /prove's brief, it is built by a script, never typed:
 * `node scripts/board-security.mjs --prompt <the piece's start> HEAD`.
 */
// While a "does not hold" stands, the prompt names each open one (`refused`: { id, first }), before the
// local files, which promptLocal and the hook's plain_sha256 split on (Architect on Security round 20).
export const securityPrompt = (base, head, local = [], refused = []) =>
  `Mode: verdict. Judge the diff --base ${base} --head ${head} in this repo (read it with \`git diff ${base}..${head}\`) against your charter: what an attacker, or an agent acting for one, can reach through it. Read the repo's house rules (${"docs/_house-rules.md"}) and its threat model first. Never edit files or commit. Your first line is your verdict, per your charter's Verdict section.` +
  (refused.length ? `${REFUSED_HEAD}\n${refused.map((x) => `- ${x.id} ${JSON.stringify(x.first)}`).join("\n")}` : "") +
  (local.length ? `${LOCAL_HEAD}\n${local.map(([f, h]) => `- ${JSON.stringify(f)} ${h ?? "removed"}`).join("\n")}` : "");
const LOCAL_HEAD = LOCAL_FILES_HEAD;
const REFUSED_HEAD = "\n\nEarlier verdicts on this piece: say whether each is fixed; holds only if every one is:";
export { LOCAL_FILES_HEAD };
/** The open refusals a prompt names, as securityPrompt takes them, or null when the list is malformed. */
export const promptRefused = (prompt) => {
  const i = prompt.indexOf(REFUSED_HEAD);
  if (i < 0) return [];
  const j = prompt.indexOf(LOCAL_HEAD, i);
  try {
    return prompt.slice(i + REFUSED_HEAD.length + 1, j < 0 ? undefined : j).split("\n").map((l) => {
      const m = /^- ([\w-]+) ("(?:[^"\\]|\\.)*")$/.exec(l);
      return { id: m[1], first: JSON.parse(m[2]) };
    });
  } catch {
    return null;
  }
};
/** The local files a prompt names, as securityPrompt takes them, or null when it names none. */
const promptLocal = (prompt) => {
  const i = prompt.indexOf(LOCAL_HEAD);
  if (i < 0) return [];
  try {
    return prompt.slice(i + LOCAL_HEAD.length + 1).split("\n").map((l) => {
      const m = /^- ("(?:[^"\\]|\\.)*") ([0-9a-f]{64}|removed)$/.exec(l);
      return [JSON.parse(m[1]), m[2] === "removed" ? null : m[2]];
    });
  } catch {
    return null;
  }
};

/**
 * What Claude Code and git load in every repo that git's file listing never shows (Architect's ruling
 * on Security round 17): untracked or ignored files these globs match (the table's glob code), plus
 * git's own hooks, config (and what it includes) and info files, read from disk. Nested repos and
 * committed checkouts are read the same way, and a symlinked folder by its files (automated reviews of
 * 5e607c4 and e23c569). A file git tracks is git's to show, never a session file (Architect on
 * e23c569). A worktree under .claude/worktrees is its own checkout with its own lock.
 */
export const SESSION_FILES = [".claude", ".claude/**", "CLAUDE*.md", ".mcp.json"].flatMap((g) => [g, `**/${g}`]);
const SESSION_RES = SESSION_FILES.map(globRe);
const NOT_SESSION = [".claude/worktrees/**", "**/.claude/worktrees/**"].map(globRe);
// For git: the same globs (git's `**/` also matches no folder), and `**/*/`, which lists nested repos.
const PATHSPECS = [...SESSION_FILES.map((g) => `:(glob,icase)${g}`), ":(glob)**/*/", ":(exclude,glob,icase)**/.claude/worktrees/**"];
/** Ignored files the board never hashes: its own writes, and the top folder's installed packages (Architect,
 * RC-SECURITY-9 A); a node_modules under a table folder is hashed (automated review of c5af5ae). */
export const LOCAL_ALLOW = [".redcell/**", "node_modules/**"];
const ALLOW_RES = LOCAL_ALLOW.map(globRe);
export const SESSION_CAP = { files: 200, bytes: 1 << 20, depth: 8 };
export const TOO_MANY = "too many session files to hash";
const capped = (why) => Object.assign(new Error(`${TOO_MANY} (${why})`), { capped: true });
/** { files: {path: sha256} }, or { error } past the cap or when one cannot be read (fails closed).
 * Paths are relative to `root`. */
export function sessionFiles(root) {
  try {
    return hashSession(root);
  } catch (e) {
    return { error: e?.reason || "the board could not hash the session files" };
  }
}
function hashSession(root) {
  const paths = new Set();
  try {
    sessionPaths(root, paths, 0);
  } catch (e) {
    if (e.capped) return { error: e.message };
    throw e;
  }
  const files = {};
  for (const f of paths) {
    // A symlink is hashed by where it points, and by its target's content when that is a file.
    const l = lstatSync(f);
    const link = l.isSymbolicLink() ? `symlink:${readlinkSync(f)}\0` : "";
    let st = l;
    try { st = statSync(f); } catch {}
    if (st.isFile() && st.size > SESSION_CAP.bytes) return { error: capped(`${relative(root, f)} is over 1 MB`).message };
    if (!st.isFile() && !link) continue;
    const h = createHash("sha256").update(link);
    if (st.isFile()) h.update(readFileSync(f));
    files[relative(root, f)] = h.digest("hex");
  }
  return { files };
}
function sessionPaths(root, paths, depth, top = root, loose = false) {
  if (depth > SESSION_CAP.depth) throw capped(`nested repos deeper than ${SESSION_CAP.depth}`);
  // A repo whose work tree is set elsewhere lists nothing from its own folder: it refuses, as a
  // committed checkout's does (Security r5 on piece 9).
  if (depth > 0 && git(root, ["rev-parse", "--show-toplevel"]).trim() !== realpathSync(root))
    throw Object.assign(new Error(), { reason: `the nested repo ${JSON.stringify(relative(top, root))} has its work tree set elsewhere` });
  const mine = new Set();
  const add = (f) => {
    mine.add(f);
    if (paths.size + mine.size > SESSION_CAP.files) throw capped(`more than ${SESSION_CAP.files} files`);
  };
  const abs = (args) => git(root, ["rev-parse", "--path-format=absolute", ...args]).trim();
  const nested = new Set(), checkouts = new Set();
  for (const f of nul(git(root, ["ls-files", "-z", "--others", "--", ...PATHSPECS]))) {
    if (NOT_SESSION.some((re) => re.test(f))) continue;
    if (f.endsWith("/")) nested.add(f.slice(0, -1));
    else if (SESSION_RES.some((re) => re.test(f))) add(join(root, f));
  }
  for (const f of tableFilesIn(top, root, depth, loose)) add(join(root, f));
  // The index: what git tracks (a session file only while its bytes on disk differ from HEAD's, or a
  // symlink), committed checkouts (mode 160000, with or without .gitmodules), and tracked files the
  // globs match. The bytes are compared raw, never through git's diff, which a stat cache, an
  // fsmonitor, a clean filter or an index flag can blind (automated reviews of dae9cef and a61e082).
  const tracked = new Set(), links = new Set(), sessionTracked = [];
  for (const e of nul(git(root, ["ls-files", "-s", "-z"]))) {
    const tab = e.indexOf("\t");
    const f = e.slice(tab + 1);
    tracked.add(f);
    if (e.startsWith("160000 ")) { nested.add(f); checkouts.add(f); continue; }
    // A tracked symlink: git shows its text, never what its target holds.
    if (e.startsWith("120000 ")) links.add(f);
    if (!NOT_SESSION.some((re) => re.test(f)) && SESSION_RES.some((re) => re.test(f))) sessionTracked.push(f);
  }
  // Inside a nested repo or committed checkout, its own HEAD is no baseline: a commit there is shown
  // by no diff the board reads, so every tracked session file counts by content (Security round 19).
  const same = depth > 0 ? new Set() : sameAsHead(root, sessionTracked.filter((f) => !links.has(f)));
  for (const f of sessionTracked) if (!same.has(f)) add(join(root, f));
  // hooksDir reads core.hooksPath; config.worktree is a linked worktree's own config; --includes
  // names every file the repo's config pulls in (include.path, includeIf).
  const common = abs(["--git-common-dir"]), own = abs(["--git-dir"]), hooks = hooksDir(root, common);
  let hookFiles = [];
  try { hookFiles = readdirSync(hooks).filter((f) => !f.endsWith(".sample")).map((f) => join(hooks, f)); } catch {}
  let included = [];
  try { included = nul(git(root, ["config", "--local", "--list", "--show-origin", "--includes", "-z"])).filter((x) => x.startsWith("file:")).map((x) => resolve(root, x.slice(5))); } catch {}
  for (const f of [...hookFiles, join(common, "config"), join(own, "config.worktree"), ...included, join(common, "info", "exclude"), join(common, "info", "attributes")]) {
    try { if (lstatSync(f)) add(f); } catch {}
  }
  // A symlinked folder: every entry through the link, following links inside it too (each one is
  // hashed by its target), once per real folder, within the cap (automated review of 324531e).
  const seen = new Set();
  const walk = (d) => {
    let real;
    try { real = realpathSync(d); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    for (const x of readdirSync(d)) {
      const g = join(d, x);
      const l = lstatSync(g);
      if (l.isSymbolicLink() || l.isFile()) add(g);
      try { if (statSync(g).isDirectory()) walk(g); } catch {}
    }
  };
  for (const f of [...mine]) {
    try { if (lstatSync(f).isSymbolicLink() && statSync(f).isDirectory()) walk(f); } catch {}
  }
  // A tracked file is git's to show only while its bytes are HEAD's; changed, or a symlink, it stays a
  // session file (automated review of 324531e).
  const inRepo = (rel) => !(rel.startsWith("..") || isAbsolute(rel));
  const rels = [...mine].map((f) => relative(root, f).split("\\").join("/"));
  const sameNow = depth > 0 ? new Set() : sameAsHead(root, rels.filter((r, i) => inRepo(r) && tracked.has(r) && !links.has(r) && !lstatSync([...mine][i]).isSymbolicLink()));
  for (const [i, f] of [...mine].entries()) if (!sameNow.has(rels[i])) paths.add(f);
  for (const d of nested) {
    const sub = join(root, d);
    if (existsSync(join(sub, ".git"))) sessionPaths(sub, paths, depth + 1, top, !checkouts.has(d));
  }
}
/** Files the security table matches that no diff the board reads shows (automated review of 0.23.2;
 * Architect, RC-SECURITY-9 A; Security r4): hashed as session files. One listing with folders
 * collapsed; a folder is opened only when a table glob's literal start can reach into it. */
/** Whether some glob can match a path inside folder `d` ("x/y/"): its literal start (up to the first
 * * or ?) is a prefix of `d`, or the reverse. It over-approximates, so what it prunes is never reached. */
const reacher = (globs) => {
  const lits = globs.map((g) => g.slice(0, (g.search(/[*?]/) + 1 || g.length + 1) - 1).toLowerCase());
  return (d) => lits.some((p) => p.startsWith(d.toLowerCase()) || d.toLowerCase().startsWith(p));
};
/** The table's regexes, each carrying its glob, so folder reach can be judged from them. */
const heldRes = (globs) => globs.map((g) => Object.assign(globRe(g), { glob: g }));
function tableFilesIn(top, root, depth, loose) {
  const globs = tableGlobs(top);
  if (!globs?.length) return [];
  const res = globs.map(globRe);
  const reach = reacher(globs);
  // Matched against the top repo's table, by the path from the top (Security r4 on piece 9).
  const pre = depth ? `${relative(top, root).split("\\").join("/")}/` : "";
  const allowed = (f) => ALLOW_RES.some((re) => re.test(pre + f));
  const on = (f) => !allowed(f) && res.some((re) => re.test(pre + f));
  const list = (...a) => nul(git(root, ["ls-files", "-z", ...a]));
  // The top repo's untracked files are git's to show (changedSince); in a nested repo or a committed
  // checkout no diff the board reads shows them, so those count too, and in a nested repo the top
  // repo does not track, so do its tracked files.
  const kinds = [["--others", "--ignored", "--exclude-standard"], ...(depth ? [["--others", "--exclude-standard"]] : [])];
  const out = [];
  for (const k of kinds)
    for (const e of list(...k, "--directory")) {
      if (!e.endsWith("/")) { if (on(e)) out.push(e); continue; }
      if (allowed(`${e}x`) || !reach(pre + e)) continue;
      // A folder entry inside it is a nested repo: sessionPaths reads those on its own.
      for (const f of list(...k, "--", `:(literal)${e}`)) if (!f.endsWith("/") && on(f)) out.push(f);
    }
  if (depth && loose) for (const f of list()) if (on(f)) out.push(f);
  return out;
}
/** The paths in `rels` that are exactly their blob at HEAD: the same mode (a regular file, the same
 * exec bit), reached through no symlinked folder, and the same raw bytes, hashed here as git's blob id
 * in the repo's own object format (no filters, no stat cache, no name git re-reads; automated review
 * of 6935be9). Anything unreadable counts as changed. */
function sameAsHead(root, rels) {
  const out = new Set();
  const want = rels.filter((r) => !/[\n\r]/.test(r));
  if (!want.length) return out;
  try {
    const head = new Map();
    for (const e of nul(git(root, ["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--", ...want]))) {
      const tab = e.indexOf("\t");
      const [mode, type, id] = e.slice(0, tab).split(" ");
      if (type === "blob" && (mode === "100644" || mode === "100755")) head.set(e.slice(tab + 1), { mode, id });
    }
    const fmt = git(root, ["rev-parse", "--show-object-format"]).trim() === "sha256" ? "sha256" : "sha1";
    const real = realpathSync(root);
    for (const r of want) {
      const h = head.get(r);
      if (!h) continue;
      try {
        const f = join(root, r), l = lstatSync(f);
        if (!l.isFile() || realpathSync(f) !== join(real, r)) continue;
        if ((l.mode & 0o111 ? "100755" : "100644") !== h.mode) continue;
        const bytes = readFileSync(f);
        if (createHash(fmt).update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === h.id) out.add(r);
      } catch {}
    }
  } catch {}
  return out;
}
/** The session files added, changed or removed from `a` to `b`: [[path, sha256 or null]], sorted. */
export const localDelta = (a = {}, b = {}) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((f) => a[f] !== b[f]).map((f) => [f, b[f] ?? null]);

// A repo's config never runs code while the board reads it (automated review of 0.23.2; Architect,
// RC-SECURITY-9 B): no fsmonitor, no hooks, and every filter driver it names turned off (a clean or
// process filter runs on a work-tree diff). The file's only git spawn. A filter's file on the table
// (Git LFS) then reads as changed in a work-tree diff: it refuses, never passes. The filters go in as
// GIT_CONFIG_KEY/VALUE pairs, which take a key whole: `-c` splits at the first "=", so a filter named
// "a=b" stayed on (Security r1 on piece 9). Needs git 2.31 or later.
// No transport at all, so a partial clone's lazy fetch of a missing object never runs
// remote.<promisor>.uploadpack (Security r2 on piece 9); a missing blob then reads as unreadable. A
// repo's protocol.<name>.allow beats protocol.allow, so each built-in transport is named too (automated
// review of 44ced9b); a remote helper by another name must already be on PATH. GIT_NO_LAZY_FETCH
// (git 2.45 or later) is set as well, in git() below.
const TRANSPORTS = ["file", "ext", "ssh", "git", "http", "https", "ftp", "ftps", "fd"];
export const SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", ...TRANSPORTS.flatMap((p) => ["-c", `protocol.${p}.allow=never`])];
/** HEAD's id with every override on, or "" when there is none; throws when git refuses the overrides. */
export function headOf(root) {
  filtersOff(root);
  try { return git(root, ["rev-parse", "--verify", "HEAD"]).trim(); } catch { return ""; }
}
function git(root, args, { input, buffer, raw, env } = {}) {
  return execFileSync("git", [...SAFE, ...args], {
    cwd: root, input, env: { ...(env || (raw ? process.env : filtersOff(root))), GIT_NO_LAZY_FETCH: "1" }, encoding: buffer ? undefined : "utf8", maxBuffer: 1 << 30,
    stdio: [input == null ? "ignore" : "pipe", "pipe", "ignore"],
  });
}
const filtersCache = new Map();
function filtersOff(root) {
  if (!filtersCache.has(root)) {
    let keys = [];
    try {
      keys = nul(git(root, ["config", "-z", "--get-regexp", "^(filter|protocol)\\."], { raw: true })).map((e) => e.split("\n")[0]);
    } catch (e) {
      // Status 1 is "no filters"; anything else is a config the board cannot read, so it refuses.
      if (e.status !== 1) throw e;
    }
    const names = new Set(keys.filter((k) => /^filter\./i.test(k)).map((k) => k.slice("filter.".length, k.lastIndexOf("."))).filter(Boolean));
    const pairs = [...names].flatMap((n) => [["clean", ""], ["smudge", ""], ["process", ""], ["required", "false"]].map(([k, v]) => [`filter.${n}.${k}`, v]));
    // Every protocol.<name>.allow the repo sets goes back to never, whatever the name: a remote helper
    // the repo allows by its own name beats protocol.allow (automated review of fdec551).
    for (const k of keys) if (/^protocol\..+\.allow$/i.test(k)) pairs.push([k, "never"]);
    const env = { ...process.env, GIT_CONFIG_COUNT: String(pairs.length) };
    pairs.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
    // A git that ignores the pairs (older than 2.31) would leave every filter on: the board checks that
    // git reads the first one back from the command line, as set, and refuses otherwise (automated review of e58a9db).
    if (pairs.length) {
      let back = "";
      try { back = git(root, ["config", "-z", "--show-scope", "--get", pairs[0][0]], { env }); } catch {}
      if (back !== `command\0${pairs[0][1]}\0`) throw new Error("git did not take the board's filter overrides (git 2.31 or later is needed)");
    }
    filtersCache.set(root, env);
  }
  return filtersCache.get(root);
}
/** Where git runs this repo's hooks: core.hooksPath as the repo's own config sets it (SAFE overrides it
 * for every call, so it is read by scope), expanded by git itself (--type=path: ~, ~user, %(prefix)/;
 * Prover on c5af5ae: "~user/" read as a folder in the work tree), a relative one from the work tree's
 * top; else the common dir's hooks. A value git cannot expand refuses. */
function hooksDir(root, common) {
  let t = [];
  try {
    // -z prints scope and value as two entries each; an empty value is an empty entry.
    t = git(root, ["config", "-z", "--show-scope", "--type=path", "--get-all", "core.hooksPath"]).split("\0");
  } catch (e) {
    if (e.status !== 1) throw Object.assign(new Error(), { reason: "the board could not expand core.hooksPath" });
  }
  let v = "";
  for (let i = 0; i + 1 < t.length; i += 2) if (t[i] !== "command") v = t[i + 1];
  if (!v) return join(common, "hooks");
  return resolve(git(root, ["rev-parse", "--show-toplevel"]).trim(), v);
}
const isAncestor = (root, a, b) => {
  try {
    git(root, ["merge-base", "--is-ancestor", "--end-of-options", a, b]);
    return true;
  } catch {
    return false;
  }
};
/** `x` when it is a full object id that git resolves to exactly itself, else "": an id read from a
 * prompt or a ledger row is compared as an id, never looked up by name (a ref named like it never
 * stands in; Architect Lead's ruling on the third dispel of step 16). */
const exactCommit = (root, x) => (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(String(x)) && commitOf(root, x) === x ? x : "");
const commitOf = (root, sha) => {
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^{commit}`]).trim();
  } catch {
    return "";
  }
};

/** The repo's security-domain globs, or null when its house rules have no table. */
export function tableGlobs(root) {
  const f = join(root, HOUSE_RULES);
  const rows = existsSync(f) ? parsePathTable(readFileSync(f, "utf8"), TABLE_HEADING) : null;
  return rows && rows.flatMap((r) => r.paths);
}

/** The table as committed at `sha`, or null: a piece is held to the table it started under too, so
 * removing a row in the same piece never frees that path (Security's sixth verdict on piece 3). */
function tableGlobsAt(root, sha) {
  try {
    const id = exactCommit(root, sha);
    if (!id) return null;
    const rows = parsePathTable(git(root, ["cat-file", "blob", "--end-of-options", `${id}:${HOUSE_RULES}`]), TABLE_HEADING);
    return rows && rows.flatMap((r) => r.paths);
  } catch {
    return null;
  }
}

const nul = (s) => s.split("\0").filter(Boolean);
/** Tracked files git is told not to look at (`update-index --skip-worktree` or `--assume-unchanged`):
 * git's diff never shows their edits, so they always count as changed (automated review of dae9cef). */
function hiddenTracked(root) {
  const out = new Set();
  for (const e of nul(git(root, ["ls-files", "-v", "-z"])))
    if (e[0] === "S" || (e[0] >= "a" && e[0] <= "z")) out.add(e.slice(2));
  return out;
}
/** Files changed since `sha` (committed or not) plus untracked files, that the globs match. Read with
 * -z, so git never quotes a path ("hooks/\303\251.mjs" matched no glob), and --no-renames, so a file
 * moved off the table shows at its old path (Security's verdict on piece 3, 2026-10-28). */
function changedSince(root, sha, res) {
  // Against HEAD as well as the working tree: a committed change the working tree puts back is still
  // the piece's (Prover round 4 on ff8d871).
  const files = new Set([
    ...nul(git(root, ["diff", "--name-only", "-z", "--no-renames", "--end-of-options", sha, "HEAD"])),
    ...nul(git(root, ["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=dirty", "--end-of-options", sha])),
    // And the index: a staged change whose working copy is put back is still committed next (Prover
    // round 5 on 172968a).
    ...nul(git(root, ["diff", "--name-only", "-z", "--no-renames", "--cached", "--end-of-options", sha])),
    ...nul(git(root, ["ls-files", "-z", "--others", "--exclude-standard"])),
    ...hiddenTracked(root),
  ]);
  // The work-tree diff skips inside committed checkouts (their status would run their own filters), so
  // each one on the table is read as its own repo, with its own overrides: any edit, staged change or
  // new file in it counts at its path; a git failure there throws, and the piece refuses (Security r3).
  // A checkout counts whole when the table reaches into it (a glob that matches only some of its files
  // too: its changes are not listed one by one), and any change in it, or its commit, counts at its
  // path (automated review of 8fcbec9). A regex with no glob reaches everything (fails closed).
  const reach = res.every((re) => re.glob != null) ? reacher(res.map((re) => re.glob)) : () => true;
  const links = new Set();
  for (const e of [...nul(git(root, ["ls-files", "-s", "-z"])), ...nul(git(root, ["ls-tree", "-r", "-z", "--end-of-options", sha]))])
    if (e.startsWith("160000 ")) links.add(e.slice(e.indexOf("\t") + 1));
  for (const e of nul(git(root, ["ls-files", "-s", "-z"])))
    if (e.startsWith("160000 ")) {
      const d = e.slice(e.indexOf("\t") + 1);
      if (reach(`${d}/`) && checkoutDirty(join(root, d), e.split(" ")[1], 0)) files.add(d);
    }
  return [...files].filter((f) => res.some((re) => re.test(f)) || (links.has(f) && reach(`${f}/`)));
}
/** Whether the checkout at `dir` differs from `want` (the commit the parent records) or from its own
 * HEAD in any way. A folder with content but no git of its own, or whose git is another folder's,
 * counts as changed (automated review of 8fcbec9). */
function checkoutDirty(dir, want, depth) {
  if (!existsSync(join(dir, ".git"))) {
    try { return readdirSync(dir).length > 0; } catch { return false; }
  }
  if (depth > SESSION_CAP.depth) throw capped(`nested checkouts deeper than ${SESSION_CAP.depth}`);
  if (git(dir, ["rev-parse", "--show-toplevel"]).trim() !== realpathSync(dir)) return true;
  const head = git(dir, ["rev-parse", "--verify", "HEAD"]).trim();
  if (want && head !== want) return true;
  if (nul(git(dir, ["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=dirty", "--end-of-options", head])).length) return true;
  if (nul(git(dir, ["diff", "--name-only", "-z", "--no-renames", "--cached", "--end-of-options", head])).length) return true;
  if (nul(git(dir, ["ls-files", "-z", "--others", "--exclude-standard"])).length) return true;
  return nul(git(dir, ["ls-files", "-s", "-z"])).some((x) => x.startsWith("160000 ") && checkoutDirty(join(dir, x.slice(x.indexOf("\t") + 1)), x.split(" ")[1], depth + 1));
}

/** Table paths changed from `from` to `to` (a closed range), or, with no `to`, since `from` in the
 * working tree, uncommitted and untracked included (an open range: the piece still at the tip). */
function changedIn(root, from, to, res) {
  if (!to) return changedSince(root, from, res);
  return nul(git(root, ["diff", "--name-only", "-z", "--no-renames", "--end-of-options", from, to])).filter((f) => res.some((re) => re.test(f)));
}

/**
 * A piece's range (Architect rulings on Security rounds 8 and 14): the record's history split so each
 * commit belongs to at least one piece, and to exactly one unless a piece is reopened after a later one
 * started (shared commits then need both pieces' verdicts). start = the merge-base of the piece's head
 * with its `from_head`, stamped once by applyStamps and never recomputed (a store from before 0.23.2
 * has none, and the start is the head). end = the start of the first piece that started after it
 * ended, or none while it is the latest (then HEAD and the working tree); a reopen only widens it.
 */
function pieceStart(root, st) {
  const head = exactCommit(root, st.head);
  if (!head) throw new Error("head is not a commit");
  if (!st.from_head) return head;
  // A stamped start that is not a commit refuses, never shrinks the range (Architect, rounds 8 and 14).
  const from = exactCommit(root, st.from_head);
  if (!from) throw new Error("from_head is not a commit");
  return git(root, ["merge-base", "--end-of-options", head, from]).trim();
}
function pieceRange(root, rec, stamps, n) {
  const start = pieceStart(root, stamps.pieces[n]);
  const ended = Date.parse(String(stamps.pieces[n].ended_at ?? ""));
  let next = null, first = Infinity;
  for (const q of rec.pieces || []) {
    const sq = stamps.pieces?.[q.n];
    const begun = Date.parse(String(sq?.started_at ?? ""));
    if (q.n === n || !sq?.head || !(begun >= ended) || begun >= first) continue;
    first = begun;
    next = q.n;
  }
  return { start, end: next == null ? null : pieceStart(root, stamps.pieces[next]), next };
}

/** The table's paths in `text`, sorted, or null: what the lock reads from the house rules. */
const tablePaths = (text) => {
  const rows = parsePathTable(text, TABLE_HEADING);
  return rows && JSON.stringify([...new Set(rows.flatMap((r) => r.paths))].sort());
};

const ZERO = /^0+$/;
/** Blob contents by id, read in one `git cat-file --batch` (Prover on 4975394: one `git show` per file
 * took 2.5-20 s on a 300-1500 file diff). A gitlink or missing id reads as its id, so it never equals a file. */
function blobs(root, ids) {
  const want = [...new Set(ids.filter((x) => x && !ZERO.test(x)))];
  const out = new Map();
  if (!want.length) return out;
  const buf = git(root, ["cat-file", "--batch"], { input: want.join("\n") + "\n", buffer: true });
  let at = 0;
  for (const id of want) {
    const nl = buf.indexOf(10, at);
    const [, type, size] = buf.toString("latin1", at, nl).split(" ");
    at = nl + 1;
    if (type !== "blob") { out.set(id, `\0${id}`); if (size) at += Number(size) + 1; continue; }
    out.set(id, buf.toString("utf8", at, at + Number(size)));
    at += Number(size) + 1;
  }
  return out;
}
const changedCache = new Map();
/** Table paths really changed from `from` to the commit `to`, judged by content with every whitespace
 * character removed (one rule for edits and moves alike). A refusal stays until the code really
 * changes: a one-space edit is no fix (Security's twelfth verdict), nor an empty file, nor a move with
 * the same content wherever it went, spaces changed or not (Prover and automated review, 906f5f4). The
 * house rules count only when their table's paths change (automated review of 52c9c69). Only committed
 * code counts: files on disk never erase a refusal (automated review of a4c8680). */
function reallyChanged(root, from, to, res) {
  const key = `${from}\0${to}\0${res.map(String).join("\0")}`;
  if (!changedCache.has(key)) changedCache.set(key, contentChanged(root, from, to, res));
  return changedCache.get(key);
}
function contentChanged(root, from, to, res) {
  const t = nul(git(root, ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", "--end-of-options", from, to]));
  const on = (f) => res.some((re) => re.test(f));
  const rows = [];
  for (let i = 0; i + 1 < t.length; i += 2) {
    const [, , a, b, st] = t[i].split(" ");
    rows.push({ a, b, st: st[0], f: t[i + 1] });
  }
  const gone = rows.filter((x) => x.st === "D"), added = rows.filter((x) => x.st === "A");
  const moves = [...gone, ...added].some((x) => on(x.f));
  const edits = rows.filter((x) => x.st !== "D" && x.st !== "A" && on(x.f));
  const text = blobs(root, [...edits.flatMap((x) => [x.a, x.b]), ...(moves ? [...gone.map((x) => x.a), ...added.map((x) => x.b)] : [])]);
  const raw = (id) => (ZERO.test(id) ? null : text.get(id) ?? `\0${id}`);
  const norm = (id) => { const x = raw(id); return x == null ? null : x.replace(/\s+/g, ""); };
  const out = edits.filter((x) => (x.f === HOUSE_RULES ? tablePaths(raw(x.a)) !== tablePaths(raw(x.b)) : norm(x.a) !== norm(x.b))).map((x) => x.f);
  if (!moves) return out;
  // A path deleted or added counts unless it is empty (spaces aside) or the same content went the other
  // way in the range: one rule both ways (automated review of f170eaa).
  const was = gone.map((x) => norm(x.a)), now = added.map((x) => norm(x.b));
  for (const [i, x] of gone.entries()) if (on(x.f) && was[i] !== "" && !now.includes(was[i])) out.push(x.f);
  for (const [i, x] of added.entries()) if (on(x.f) && now[i] !== "" && !was.includes(now[i])) out.push(x.f);
  return out;
}

/** Claude Code's projects dir: transcripts anywhere else never count. */
export const projectsDir = (env = process.env) => join(env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude"), "projects");

/** `path` is `dir` or under it, by real paths. */
function within(dir, path) {
  try {
    const rel = relative(realpathSync(dir), realpathSync(path));
    return !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

function inside(dir, path) {
  try {
    const rel = relative(realpathSync(dir), realpathSync(path));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

// What a later user line in a Security run may be, and nothing else (fail closed, round 6): tool
// results, and Claude Code's own notices (surveyed 2026-10-28 over every transcript on this machine).
// A notice is one whole <system-reminder> element with nothing after it, Claude Code's hand-back
// nudge, or exactly "Tool loaded." (matched whole, never by its opening: round 7's review).
const HANDBACK_NUDGE = "[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.";
const isNotice = (t) => {
  const x = String(t).trim();
  if (x === "Tool loaded.") return true;
  if (x === HANDBACK_NUDGE) return true;
  return x.startsWith("<system-reminder>") && x.endsWith("</system-reminder>") && x.split("</system-reminder>").length === 2;
};
function harnessOnly(content, prompt) {
  if (typeof content === "string") return isNotice(content);
  if (!Array.isArray(content) || !content.length) return false;
  return content.every((b) => b?.type === "tool_result" || (b?.type === "text" && (isNotice(b.text) || String(b.text).trim() === String(prompt).trim())));
}

/**
 * What the board reads from a Security run's transcript (all of it: a run is a few hundred lines):
 * - `prompt`: the first user message's text, the prompt the run was given;
 * - `steered`: anything after it that is not a tool result or Claude Code's own notice (the prompt's
 *   restatement included): a message sent mid-run can narrow it (Security, rounds 5 and 6). Any line
 *   with an `origin` mark, and any queued message, counts as steering;
 * - `end`: its last timestamp, the verdict's own time (never the ledger row's, which an agent can write).
 */
function transcriptFacts(path) {
  let prompt = null, steered = false, end = "";
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (!l.trim()) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const t = String(o?.timestamp ?? "");
    if (t > end) end = t;
    if (o?.origin || o?.attachment?.origin || o?.attachment?.type === "queued_command") steered = true;
    if (o?.message?.role !== "user") continue;
    const c = o.message.content;
    if (prompt == null) {
      prompt = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("") : "";
    } else if (!harnessOnly(c, prompt)) steered = true;
  }
  return { prompt, steered, end };
}

/**
 * The Security runs the board can corroborate for record `id`, latest stop first:
 * { id, ts, base, head, word: "holds" | "does not hold", first }. A pair counts only when its
 * transcript is under the projects dir, its meta names harteburn:security and the dispatch id, and
 * its first user message hashes to the dispatch row's prompt_sha256 and names --base and --head.
 */
export function verdicts(root, id, ledger, { env = process.env } = {}) {
  const dispatches = new Map();
  for (const row of ledger || []) if (row?.event == null) dispatches.set(ledgerId(row), row);
  const projects = projectsDir(env);
  const out = [];
  for (const stop of ledger || []) {
    if (stop?.event !== "stop" || !isSecurity(stop.role) || stop.board !== id || !stop.dispatch) continue;
    const d = dispatches.get(stop.dispatch);
    const tp = String(stop.transcript || "");
    if (!d || !isSecurity(d.role) || !tp || !inside(projects, tp)) continue;
    try {
      const meta = JSON.parse(readFileSync(tp.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      if (!isSecurity(meta.agentType) || meta.toolUseId !== stop.dispatch) continue;
      const { prompt, steered, end } = transcriptFacts(tp);
      if (prompt == null || steered || !end || createHash("sha256").update(prompt).digest("hex") !== d.prompt_sha256) continue;
      // Full commit ids only: git reads a short one as a tag or branch of that name first, so a ref
      // could move a run off its piece (Prover round 3 on 60e07f9).
      const base = /--base\s+([0-9a-f]{40}(?:[0-9a-f]{24})?)\b/.exec(prompt)?.[1];
      const head = /--head\s+([0-9a-f]{40}(?:[0-9a-f]{24})?)\b/.exec(prompt)?.[1];
      const first = String(finalReply(tp) || "").split("\n")[0].trim();
      const word = /^does not hold\b/i.test(first) ? "does not hold" : /^holds\b/i.test(first) ? "holds" : "";
      const local = promptLocal(prompt), refused = promptRefused(prompt);
      if (!base || !head || !word || !local || !refused || prompt !== securityPrompt(base, head, local, refused)) continue;
      out.push({ id: stop.dispatch, ts: end, base, head, word, first, local: JSON.stringify(local), named: refused });
    } catch {}
  }
  return out.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

// A whole element Claude Code adds beside a typed message: a notice, or a note of the file open in the
// IDE (a path, never its text). A selection (<ide_selection>) carries text, so it never counts.
const besideTyped = (t) => {
  const x = String(t).trim();
  return [["<system-reminder>", "</system-reminder>"], ["<ide_opened_file>", "</ide_opened_file>"]].some(([a, b]) => x.startsWith(a) && x.endsWith(b) && x.split(b).length === 2);
};

/**
 * What the owner typed, when Claude Code marked the line as theirs (`origin: human`): the one text
 * block that is not a notice, and only if it is a single line. A pasted handoff or an IDE selection
 * can carry text an agent wrote (Security's eleventh verdict), so a longer message counts for nothing.
 */
function humanText(o) {
  const human = o?.origin?.kind === "human" || o?.attachment?.origin?.kind === "human";
  if (!human) return null;
  const c = o.message?.content ?? o.attachment?.prompt;
  const blocks = typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => String(b.text)) : [];
  const typed = blocks.filter((b) => !besideTyped(b));
  if (typed.length !== 1 || blocks.length !== typed.length + blocks.filter(besideTyped).length) return null;
  const text = typed[0].trim();
  return text && !/[\n\r\u2028\u2029\u0085]/.test(text) ? { text, ts: String(o.timestamp ?? o.attachment?.timestamp ?? "") } : null;
}

/**
 * The owner's own acceptances for record `id`: "accept" rows the prompt hook wrote, each counted only
 * when its transcript is under the projects dir and has a line the owner typed reading "accept: <text>",
 * in a session working in this repo (the line's `cwd`).
 * An agent's text, a tool result or a typed row has no such line. The time is the typed line's own,
 * never the row's: a row an agent writes could date an old acceptance after a new verdict (Security's
 * fourth verdict on piece 3). { id, ts, text }, oldest first.
 */
export function acceptances(root, id, ledger, { env = process.env } = {}) {
  const projects = projectsDir(env);
  const out = [];
  const said = new Map();
  for (const row of ledger || []) {
    if (row?.event !== "accept" || row.board !== id || !row.text || !Number.isInteger(row.piece) || !inside(projects, String(row.transcript || ""))) continue;
    try {
      if (!said.has(row.transcript)) {
        const typed = [];
        for (const l of readFileSync(row.transcript, "utf8").split("\n")) {
          if (!l.includes('"human"')) continue;
          try {
            const o = JSON.parse(l);
            const t = humanText(o);
            if (t && within(root, String(o.cwd ?? o.attachment?.cwd ?? ""))) typed.push(t);
          } catch {}
        }
        said.set(row.transcript, typed);
      }
      const re = new RegExp(`^\\s*accept\\s+piece\\s+${row.piece}\\s*:\\s*${row.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
      const typed = said.get(row.transcript).filter((t) => re.test(t.text)).map((t) => t.ts).sort().pop();
      if (typed) out.push({ id: row.id, ts: typed, piece: row.piece, text: row.text });
    } catch {}
  }
  return out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

/** An acceptance answers a finding when it quotes the whole finding (whitespace and case aside), typed
 * after the verdict: part of a two-finding line never accepts the other (Security round 20). */
const folded = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
const answers = (a, v, finding) => folded(a.text) === folded(finding) && String(a.ts) >= String(v.ts);

/**
 * The security check for each done piece of a record held to the rules. Changes `stamps` in place
 * (`pieces[n].security`, the verdict the board saw). Returns { problems, notes, shown }, where
 * `shown[n]` is the piece line's security text.
 */
export function securityCheck(root, rec, stamps, ledger, { env = process.env, local } = {}) {
  const res = { problems: [], notes: [], shown: {} };
  if (!root || !rec?.id || !heldToRules({ opened_at: stamps?.opened_at ?? rec.opened_at })) return res;
  let globs;
  // No repo: nothing to hold. Read raw (it reads no object), so a git that refuses the overrides gets
  // past here and is refused below, never read as "no repo" (automated review of e58a9db). Then no
  // commit yet: nothing to hold, read with the overrides on (a missing commit is a lazy fetch).
  try {
    git(root, ["rev-parse", "--git-dir"], { raw: true });
  } catch {
    return res;
  }
  try {
    filtersOff(root);
  } catch (e) {
    for (const p of rec.pieces || [])
      if (["done", "dropped"].includes(p.state)) res.problems.push(`Piece ${p.n}: ${e.message}: it stays refused until the board can turn this repo's filter drivers off`);
    return res;
  }
  try {
    git(root, ["rev-parse", "--verify", "HEAD"]);
    globs = tableGlobs(root);
  } catch {
    return res;
  }
  local ||= sessionFiles(root);
  if (!globs) res.notes.push(NO_TABLE);
  let all;
  // A stamp reaches git only as a checked commit id; one that is not refuses, never reads as "no table"
  // (automated review of 0.23.2: "--output=<file>" was a git option).
  const badOpened = stamps?.opened_head != null && !exactCommit(root, stamps.opened_head);
  if (badOpened)
    for (const p of rec.pieces || [])
      if (["done", "dropped"].includes(p.state)) res.problems.push(`Piece ${p.n}: the record's opened_head stamp (${JSON.stringify(stamps.opened_head)}) is not a commit: it stays refused until it is put back`);
  for (const p of rec.pieces || []) {
    const st = stamps?.pieces?.[p.n];
    // A dropped piece's commits stay in the repo: it is held like a done one (automated review, 2bbb933).
    if (!["done", "dropped"].includes(p.state)) continue;
    const at = `Piece ${p.n}`;
    // A piece started once head stamps existed always has one; a missing one was removed (round 6).
    // With no table, a piece with no start commit has nothing to be held to (a repo with no table
    // holds nothing; the board shows NO_TABLE).
    if (!st?.head && !globs && !(stamps?.opened_head && tableGlobsAt(root, stamps.opened_head))) continue;
    if (!st?.head) {
      // A piece never started on the board has no start to stamp: refusals() names it ("done but never
      // started"), from DONE_RULES_FROM. Otherwise exempt only when both of the board's stamps predate head stamps: the record's first-seen
      // opening and the piece's start. A missing or unreadable date is not exempt (fail closed).
      const from = Date.parse(HEADS_FROM);
      const opened = Date.parse(String(stamps?.opened_at ?? ""));
      const begun = Date.parse(String(st?.started_at ?? ""));
      let legacy;
      if (st?.started_at == null) {
        // refusals() names a never-started piece only from DONE_RULES_FROM. Before it, a piece with no
        // start is exempt only if it finished before head stamps (a deleted end is re-stamped "now").
        if (opened >= Date.parse(DONE_RULES_FROM)) continue;
        legacy = Date.parse(String(st?.ended_at ?? "")) < from;
      } else legacy = opened < from && begun < from;
      if (!legacy) res.problems.push(`${at} has no start commit in the board's stamps (the board writes it when a piece starts; it was removed): the piece stays refused until it is put back`);
      continue;
    }
    try {
      const { start, end, next } = pieceRange(root, rec, stamps, p.n);
      // Held to the table today, at the piece's start and when the record opened, whichever is larger;
      // and once there is a table, the file that holds it is on it too (Security's twelfth verdict).
      const held = [...new Set([...(globs || []), ...(tableGlobsAt(root, start) || []), ...(stamps?.opened_head ? tableGlobsAt(root, stamps.opened_head) || [] : [])])];
      if (held.length) held.push(HOUSE_RULES);
      if (!held.length) continue;
      const re = heldRes(held);
      if (local.error) {
        delete st.security;
        res.problems.push(`${at}: ${local.error}: it stays refused until ${local.error.startsWith(TOO_MANY) ? `there are ${SESSION_CAP.files} or fewer, each 1 MB or less` : "the board can read them"}`);
        continue;
      }
      // The session files changed in the range (from its stamped start to the next piece's, or the disk
      // now): git cannot show them, so a verdict covers them only when its prompt names their hashes.
      const delta = localDelta(st.from_local || {}, next == null ? local.files : stamps.pieces[next].from_local || {});
      const key = JSON.stringify(delta);
      const sameLocal = (x) => (x?.local ?? "[]") === key;
      // The runs that cover the piece's current code: given its whole range, on HEAD's history, with
      // no table path changed since. A "does not hold" among them stands until the code changes and a holds
      // names it, or the owner accepts it: a later "holds" on the same code never clears it (no verdict shopping,
      // Security's seventh verdict on piece 3).
      const hit = [...changedIn(root, start, end, re), ...delta.map(([f]) => f)];
      // A verdict on `head` covers the piece when the piece's end is in what it saw, or nothing on the
      // table changed between it and the piece's end.
      const covers = (head) => exactCommit(root, head) && (end ? isAncestor(root, end, head) || !changedIn(root, head, end, re).length : !changedSince(root, head, re).length);
      all ||= verdicts(root, rec.id, ledger, { env });
      const started = Date.parse(st.started_at || "") || 0;
      const covering = all.filter((x) =>
        Date.parse(x.ts) > started &&
        exactCommit(root, x.base) && exactCommit(root, x.head) &&
        // The base is exactly the piece's start: the only base the refusal names, and the only one the
        // lost-run check hashes, so no verdict counts that could vanish unseen (Security, round 10).
        exactCommit(root, x.base) === start && isAncestor(root, x.head, "HEAD") && covers(x.head) && sameLocal(x));
      const finding = (x) => x.first.replace(/^does not hold\b\s*[:.,—-]*\s*/i, "").trim();
      const accepted = (x) => {
        const f = finding(x);
        return f && acceptances(root, rec.id, ledger, { env }).find((a) => a.piece === p.n && answers(a, x, f));
      };
      // Every "does not hold" the board has seen on this piece stays, kept in its stamps: removing the run
      // from the ledger never frees the piece. It clears only when the table paths really change after it
      // (whitespace never counts) and a later covering holds names it, on a prompt naming every refusal
      // open before that holds; a blind re-run after any commit is a re-roll (Architect on Security
      // round 20). A cleared one stays, marked, so cleanup of the holds' transcript never revives it.
      // By content, never by ancestry: an amend or rebase that orphans the refused commit keeps the
      // refusal while the code is the same (automated review of ba5e2ca). A commit git has lost keeps it too.
      // Judged on committed code only (to HEAD while the piece is at the tip, never the working tree).
      const stillAbout = (head) => !exactCommit(root, head) || (end && isAncestor(root, end, head)) || !reallyChanged(root, head, end || "HEAD", re).length;
      st.refused ||= [];
      const standing = all.filter((x) => x.word === "does not hold" && Date.parse(x.ts) > started && exactCommit(root, x.base) === start);
      // While its run is readable, a stored refusal's fields are the run's: none typed into the stamps
      // stands (Prover round 6).
      for (const x of standing) {
        const y = st.refused.find((y) => y.id === x.id);
        if (y) Object.assign(y, { ts: x.ts, head: x.head, first: x.first, word: x.word });
        else st.refused.push({ id: x.id, ts: x.ts, head: x.head, first: x.first, word: x.word });
      }
      const open = () => (st.refused || []).filter((x) => !x.cleared);
      const before = (x, h) => Date.parse(x.ts) < Date.parse(h.ts);
      const names = (h, x) => (h.named || []).some((y) => y.id === x.id && y.first === x.first);
      // A run counts only if every refusal its prompt names is one the board stored, word for word: a
      // prompt naming any other text is never a verdict on this piece (automated review of 167f38c).
      const honest = (h) => (h.named || []).every((y) => (st.refused || []).some((x) => x.id === y.id && x.first === y.first && x.word === "does not hold"));
      // `cleared` is worked out again from the readable runs at every render. A stored one stands alone
      // only once the board witnessed the close and that holds' transcript was cleaned up, and only while
      // the code still differs from the refused code (a revert reopens it; automated review of 167f38c).
      // Only a stored pass the board can still validate counts as witnessed (automated review, 7246e8d),
      // and only its witness keeps a mark (automated review of f83ef99).
      const witnessed = st.security?.closed_seen && closedNow(rec) && covers(st.security.head) && sameLocal(st.security) && stampHolds(root, rec, st.security, ledger, env);
      const knownAtClose = witnessed ? new Set([st.security.dispatch, ...(st.security.known || [])]) : new Set();
      for (const x of st.refused) if (x.cleared && !(knownAtClose.has(x.cleared) && !all.some((h) => h.id === x.cleared) && !stillAbout(x.head))) delete x.cleared;
      // A clearing holds covers the piece's current code: once later code changes, it clears nothing and
      // the next prompt names the refusal again (automated review of f83ef99).
      const clearing = covering.filter((h) => h.word === "holds");
      for (const h of clearing.reverse()) {
        const due = open().filter((x) => before(x, h));
        if (due.length && due.length === h.named.length && due.every((x) => names(h, x) && !stillAbout(x.head))) for (const x of due) x.cleared = h.id;
      }
      if (!st.refused.length) delete st.refused;
      // A run given this piece's canonical prompt (its hash, from the hook's dispatch row) must still
      // be readable: a missing, changed or unfinished one keeps the piece refused.
      // Past /done, with the board's own witness, Claude Code's cleanup of transcripts is expected.
      // Cleanup removes old transcripts: after a witnessed close, a missing run older than the stored
      // pass is expected; one newer than it went missing for another reason, and still refuses.
      // After a witnessed close, the runs the board knew of then may be cleaned up; any other canonical
      // run that cannot be read refuses, whatever time its row claims (rows are agent-writable).
      // A run is this piece's by the --base the hook stored on its row, never by a hash recomputed from
      // HEAD or the session files, so an amend, a reset or a file change never hides a lost run (Lead's
      // ruling on the second dispel of step 16): its base is the piece's start (or no longer resolves).
      // Never bounded by the row's time, which an agent can write (a backdated run that vanished still
      // refuses; this over-holds two pieces that share a start). A run whose own first message, still matching
      // its row, was never the canonical prompt is a narrowed run, never a verdict, and never lost.
      // A row from before the stored base keeps the hash match.
      const canon = canonicalHashes(root, start, delta), plain = canonicalHashes(root, start);
      const ours = (d) => d.base != null
        ? (!exactCommit(root, d.base) || d.base === start) && !narrowedRun(d, ledger, env)
        : canon.has(d.prompt_sha256) || plain.has(d.plain_sha256);
      const known = witnessed ? new Set([st.security.dispatch, ...(st.security.known || [])]) : new Set();
      const lost = hit.length && (ledger || []).find((d) => d?.event == null && isSecurity(d.role) && d.board === rec.id && ours(d) && !known.has(ledgerId(d)) && !all.some((x) => x.id === ledgerId(d)));
      // The one prompt to dispatch, as both "no verdict" sentences print it (Architect ruling on the
      // first dispel of step 14): "re-run Security" alone leads to a narrowed run, which never counts.
      const dispatchIt = `commit, then dispatch harteburn:security with exactly the prompt \`node <plugin>/scripts/board-security.mjs --prompt ${start.slice(0, 12)} ${end ? end.slice(0, 12) : "HEAD"}${delta.length ? ` ${rec.id} ${p.n}` : ""}\` prints; a ledger row typed by hand, or a narrowed prompt, does not count`;
      if (lost) {
        delete st.security;
        res.problems.push(`${at} changes security-domain paths (${listed(hit)}) with no Security verdict on them: a Security run on its code (${ledgerId(lost)}) cannot be read (it has not returned, or its transcript is missing or changed); wait for it, or ${dispatchIt}`);
        continue;
      }
      const refusal = open().find((x) => x.word === "does not hold" && !accepted(x));
      if (refusal) {
        delete st.security;
        const f = finding(refusal);
        res.problems.push(`${at}'s Security verdict is "does not hold" (${refusal.first}): fix it, commit, then dispatch harteburn:security with exactly the prompt \`node <plugin>/scripts/board-security.mjs --prompt ${start.slice(0, 12)} ${end ? end.slice(0, 12) : "HEAD"} ${rec.id} ${p.n}\` prints (it names the open refusals); or the owner accepts the risk by sending, alone in one message, "accept piece ${p.n}: ${f || "<the finding>"}" (an agent's words never count)`);
        continue;
      }
      // What the board saw stays, until a table path changes after the verdict's head. It counts only
      // while the ledger still has that Security run for this record, and, while its transcript still
      // exists, only if the transcript still says the same (a stamp typed into the store is refused).
      if (st.security && covers(st.security.head) && sameLocal(st.security) && stampHolds(root, rec, st.security, ledger, env)) {
        // The board's own witness that it read the evidence while the record was past /done: only
        // then may Claude Code's later cleanup of the transcripts leave the pass standing.
        if (closedNow(rec) && evidenceOnDisk(st.security, ledger) && !st.security.closed_seen) {
          st.security.closed_seen = true;
          // The canonical runs the board could read when it witnessed the close.
          st.security.known = (ledger || []).filter((d) => d?.event == null && isSecurity(d.role) && d.board === rec.id && ours(d) && all.some((x) => x.id === ledgerId(d))).map(ledgerId);
        }
        res.shown[p.n] = shownText(st.security);
        continue;
      }
      delete st.security;
      if (!hit.length) continue;
      // No open refusal is left here unaccepted: a holds that names fewer was refused above.
      const v = covering.find((x) => x.word === "holds" && honest(x)) || covering.find((x) => accepted(x));
      if (!v) {
        res.problems.push(`${at} changes security-domain paths (${listed(hit)}) with no Security verdict on them: ${dispatchIt}`);
        continue;
      }
      const seen = { dispatch: v.id, verdict: v.word, head: v.head, at: v.ts, ...(delta.length && { local: key }) };
      if (v.word === "does not hold") {
        // Only the owner accepts a risk (jg 2026-10-28): by typing it, never by a field an agent can
        // write. A verdict that names no finding can only be fixed and re-run.
        const a = accepted(v);
        seen.accept = a.id;
        seen.risk_accepted = `${String(a.ts).slice(0, 10)}: ${a.text}`;
      }
      st.security = seen;
      res.shown[p.n] = shownText(seen);
    } catch {
      res.problems.push(`${at}: the board could not read its diff (git failed): it stays refused until it can`);
    }
  }
  return res;
}

/** The dispatch `d` was given a prompt that was never canonical: its transcript is readable, its meta
 * agrees, and its first message hashes to the row's prompt_sha256 yet is not securityPrompt's form. */
function narrowedRun(d, ledger, env) {
  const stop = (ledger || []).find((r) => r?.event === "stop" && r.dispatch === ledgerId(d));
  const tp = String(stop?.transcript || "");
  if (!tp || !inside(projectsDir(env), tp)) return false;
  try {
    const meta = JSON.parse(readFileSync(tp.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    if (!isSecurity(meta.agentType) || meta.toolUseId !== ledgerId(d)) return false;
    const { prompt } = transcriptFacts(tp);
    if (prompt == null || createHash("sha256").update(prompt).digest("hex") !== d.prompt_sha256) return false;
    const base = /--base\s+([0-9a-f]{40}(?:[0-9a-f]{24})?)\b/.exec(prompt)?.[1], head = /--head\s+([0-9a-f]{40}(?:[0-9a-f]{24})?)\b/.exec(prompt)?.[1];
    const local = promptLocal(prompt), refused = promptRefused(prompt);
    return !(base && head && local && refused && prompt === securityPrompt(base, head, local, refused));
  } catch {
    return false;
  }
}

const listed = (hit) => hit.slice(0, 5).join(", ") + (hit.length > 5 ? ` (+${hit.length - 5} more)` : "");

/** The hashes of this piece's canonical Security prompts: base its start, head any commit since. */
function canonicalHashes(root, start, delta = []) {
  const base = commitOf(root, start);
  // Every head a covering verdict may name (base..HEAD), never fewer than `covering` accepts.
  const heads = [base, ...git(root, ["rev-list", "--end-of-options", `${base}..HEAD`]).split("\n").filter(Boolean)];
  return new Set(heads.map((h) => createHash("sha256").update(securityPrompt(base, h, delta)).digest("hex")));
}

const closedNow = (rec) => ["done", "closed"].includes(rec.status);
function evidenceOnDisk(seen, ledger) {
  const stop = (ledger || []).find((r) => r?.event === "stop" && r.dispatch === seen.dispatch);
  const acc = seen.accept && (ledger || []).find((r) => r?.event === "accept" && r.id === seen.accept);
  return existsSync(String(stop?.transcript || "")) && (!seen.accept || existsSync(String(acc?.transcript || "")));
}

// While the record is open, the evidence must still be on disk: a stamp plus typed ledger rows that
// point at a missing transcript is refused (Security's fifth verdict). Past /done, Claude Code's
// cleanup of old transcripts never reopens a finished piece.
function stampHolds(root, rec, seen, ledger, env) {
  const id = rec.id;
  // `closed_seen`, never the record's typed status: the board saw the evidence after /done.
  const open = !(seen.closed_seen && closedNow(rec));
  const stop = (ledger || []).find((r) => r?.event === "stop" && isSecurity(r.role) && r.board === id && r.dispatch === seen.dispatch);
  const dispatch = stop && (ledger || []).find((r) => r?.event == null && ledgerId(r) === seen.dispatch && isSecurity(r.role));
  if (!dispatch) return false;
  // A transcript cleaned up later keeps the pass only if it was where Claude Code writes them.
  const tp = String(stop.transcript || "");
  const rel = relative(resolve(projectsDir(env)), resolve(tp));
  if (!tp || rel.startsWith("..") || isAbsolute(rel)) return false;
  if (seen.accept) {
    const acc = (ledger || []).find((r) => r?.event === "accept" && r.id === seen.accept && r.board === id);
    if (!acc) return false;
    if ((open || existsSync(String(acc.transcript || ""))) && !acceptances(root, id, ledger, { env }).some((x) => x.id === seen.accept)) return false;
  } else if (seen.verdict !== "holds") return false;
  if (!existsSync(tp)) return !open;
  const v = verdicts(root, id, ledger, { env }).find((x) => x.id === seen.dispatch);
  return !!v && v.word === seen.verdict;
}

const shownText = (s) => (s.risk_accepted ? `security: risk accepted by the owner ${s.risk_accepted}` : `security: holds (${s.dispatch})`);

// `node scripts/board-security.mjs --prompt <base> <head>`: Security's prompt for a piece, with both
// commits resolved to full shas in the current repo.
const startedDirectly = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
// With the record's id and the piece's number (the refusal names both when session files changed or a
// refusal stands), the prompt also names those files and the open refusals, read from the board's
// stamps and the disk now.
if (process.argv[1] && startedDirectly() && process.argv[2] === "--prompt") {
  const root = process.cwd();
  const [base, head] = process.argv.slice(3, 5).map((x) => commitOf(root, String(x || "")));
  const [id, n] = process.argv.slice(5, 7);
  let local = [], refused = [];
  try {
    if (id != null) {
      if (!/^[\w.-]+$/.test(id) || !/^\d+$/.test(String(n))) throw new Error("bad id or piece");
      const stamps = JSON.parse(readFileSync(join(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(), "redcell", `stamps-${id}.json`), "utf8"));
      const rec = JSON.parse(readFileSync(join(root, ".redcell", "board.json"), "utf8"));
      const { next } = pieceRange(root, rec, stamps, Number(n));
      const files = sessionFiles(root);
      if (files.error) throw new Error(files.error);
      local = localDelta(stamps.pieces[n].from_local || {}, next == null ? files.files : stamps.pieces[next].from_local || {});
      // The open refusals, from the board's own stamps (Architect on Security round 20).
      refused = (stamps.pieces[n].refused || []).filter((x) => !x.cleared && x.word === "does not hold").map((x) => ({ id: x.id, first: x.first }));
      if (refused.some((x) => !/^[\w-]+$/.test(x.id))) throw new Error("a stored refusal is malformed");
    }
  } catch (e) {
    local = null;
    process.stderr.write(`board-security.mjs --prompt: ${e.message}\n`);
  }
  if (!base || !head || !local) {
    process.stderr.write("usage: board-security.mjs --prompt <the piece's start commit> <HEAD> [<record id> <piece>]; both must be commits in this repo\n");
    process.exitCode = 2;
  } else process.stdout.write(securityPrompt(base, head, local, refused) + "\n");
}
