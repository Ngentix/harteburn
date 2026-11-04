#!/usr/bin/env node
// Builds the Prover's brief from files only, so no builder's summary can reach it (FEA-CC-439 §3.9).
//
//   node prove-prompt.mjs <prd.md> [--mode before|after] [--base <git ref>]
//                         [--steps <a-b>] [--role builds|reads] [--list-steps]
//
// Writes <git dir>/harteburn/prove-<timestamp>.md and prints its path. The file holds:
//   - the PRD's acceptance walkthrough (its "## 0." / "Acceptance Walkthrough" section, or the
//     ACCEPTANCE-*.md it links to)
//   - the commit under test (HEAD): the Prover moves its warm worktree there
//   - for --mode after: `git diff <base>` of committed and uncommitted changes (default base:
//     the merge-base with origin/main), plus the list of untracked files, and the builder's own
//     mutation results from <git dir>/harteburn/mutations.jsonl (one JSON object per line:
//     {guard, file, break, test, result}), or "none recorded"
// A reading swarm (retro 2026-10-18, jg): --steps 4-6 keeps only those walkthrough steps (by
// position, 1-based), --role marks the member: "builds" (the one that runs tests and mutations)
// or "reads" (reads and reasons only). --list-steps prints the steps found and writes nothing.
// Without these flags the brief is as before.
// Before mode (retro 2026-10-28, a 2026-10-28 product retro, Change 1) adds "Required screen rows": four red tests
// (links, help, session, failure) per screen the steps name; steps naming no screen are refused
// unless --no-screens "<why>".
// A re-pass (retro 2026-10-21, jg ratified Change 3): --repass <the earlier brief> --verdict <its
// dispelled verdict, saved word for word> makes round N+1 (each brief says its "Round:"), carries
// that verdict, and diffs only from the commit the earlier round tested, so the Prover checks the
// survivors against the fix instead of re-reading the whole change. Round 3 or later is refused
// (exit 3) without --lead-ruling <file>: a second dispel goes to the Lead, never a third automatic
// round (FEA-CC-452: one guard went 6 rounds, another 5; 1 of 9 rounds on 10-21 found a defect).
// Readers and callers (retro 2026-10-25, jg ratified Change 3): gate 4 found 2 real defects in a fix
// already "proven", both in tests that read a stored sentence the fix rewrote, which no proof ran;
// and 2 of 5 gates went red on races that show only under the gate's one process per test binary.
// --mode after lists every test file that names a function or string the diff changes, with the
// gate's command for each. --ruling <the Architect's design file> refuses (exit 1) a ruling with no
// "Stored values changed:" line, or one that changes a stored value with no "Readers:" line.
// What the Prover needs to judge (retro 2026-10-28, jg ratified Change 2): --mode after refuses
// (a) a guard log none of whose guards lists its `escapes` (a non-empty list, or "none, because <why>");
// (b) test fixture data with no source tag (see fixtureProblems); (c) lines removed from a loaded
// file (budgets.mjs's loadedFiles) without --removed <ledger>, one row per removed sentence and
// where its rule still lives. The brief carries the escapes, the fixtures' tags and the ledger.
// The dispatcher passes the Prover only "Read <path> and follow it." Nothing else.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, isAbsolute, resolve, relative, basename } from "node:path";
import { walkthrough, stepRanges, keepSteps, screensOf, SCREEN_ROWS, markdownTables } from "./walkthrough.mjs";
import { proverPrompt } from "./board-security.mjs";
import { createHash } from "node:crypto";
import { stateDir } from "./paths.mjs";
export { walkthrough, stepRanges, keepSteps, screensOf, SCREEN_ROWS };
// Exported alone into product repos (scripts/harteburn/), where budgets.mjs and the loaded files are absent.
// walkthrough.mjs is copied beside this file by the export.
const { loadedFiles } = await import("./budgets.mjs").catch(() => ({ loadedFiles: () => [] }));

const args = process.argv.slice(2);
const VALUED = new Set(["--mode", "--base", "--steps", "--role", "--repass", "--verdict", "--lead-ruling", "--no-guards", "--ruling", "--removed", "--no-screens", "--readers", "--no-new-outcome"]);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const prdArg = args.find((a, i) => !a.startsWith("--") && !["before", "after"].includes(a) && !VALUED.has(args[i - 1]));
const mode = opt("--mode") || "after";
const git = (a, cwd = process.cwd()) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const root = git(["rev-parse", "--show-toplevel"]);
const fail = (msg, code = 2) => {
  console.error(msg);
  process.exit(code);
};
if (!prdArg) fail("usage: prove-prompt.mjs <prd.md> [--mode before|after] [--base <ref>] [--steps <a-b>] [--role builds|reads] [--repass <earlier brief> --verdict <file> [--lead-ruling <file>]] [--list-steps]");
const role = opt("--role");
if (args.includes("--role") && !["builds", "reads"].includes(role)) fail(`--role must be "builds" or "reads", not "${role ?? ""}"`);
const prdPath = resolve(process.cwd(), prdArg);
const prd = readFileSync(prdPath, "utf8");







const w = walkthrough(prd, prdPath);
if (!w) fail(`no acceptance walkthrough found in ${prdPath} (no "## 0." or "Acceptance Walkthrough" section, no linked ACCEPTANCE-*.md)`, 1);

const ranges = stepRanges(w.text);
if (args.includes("--list-steps")) {
  const lines = w.text.split("\n");
  console.log(`${ranges.length} steps in ${w.source}`);
  ranges.forEach(([s], k) => console.log(`${k + 1}. ${lines[s].replace(/^#+\s*|\*\*/g, "").replace(/^\d+\.\s+/, "").trim().slice(0, 100)}`));
  process.exit(0);
}

let walk = w.text;
let stepsLine = "";
let suffix = "";
let swarmSteps = null;
if (args.includes("--steps")) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(opt("--steps") || "");
  if (!m) fail(`--steps takes a range such as 1-3 (or one step, 4), not "${opt("--steps") ?? ""}"`);
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  if (!ranges.length) fail(`--steps: no numbered steps found in ${w.source} (run --list-steps)`, 1);
  if (a < 1 || b < a || b > ranges.length) fail(`--steps ${a}-${b}: the walkthrough has steps 1-${ranges.length}`);
  walk = keepSteps(w.text, a, b);
  stepsLine = `Your steps: ${a === b ? a : `${a}–${b}`} of ${ranges.length}.\n`;
  suffix = `-steps-${a}-${b}`;
  swarmSteps = { steps: [a, b], of: ranges.length };
}

const ROLES = {
  builds:
    "**Your part: the swarm's one building member.** Other Provers read this change at the same time, each for its own steps, and none of them builds. You alone use the warm worktree: run every test the change has and the guard removals there, in one build, look at any page a person sees, then give your verdict on your steps. You prove only your steps. The change is proven only when every member says proven.",
  reads:
    "**Your part: a reading member of the swarm.** Read and reason about your steps only: the diff below, and files at the commit under test (`git show <commit>:<path>`). Build nothing, run no test, mutate nothing, and never open the warm worktree: the building member is mutating it. For each step: does the code do it, and would a test fail without it? A step with no such test is dispelled. A step only a run can settle (a page, a timing): name the run. You prove only your steps. The change is proven only when every member says proven.",
};

let gitDir = git(["rev-parse", "--git-common-dir"], root);
if (!isAbsolute(gitDir)) gitDir = join(root, gitDir);

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
// Each after-mode brief, the brief it re-passed (null for round 1), its round, PRD, steps and commit.
const chainFile = () => join(stateDir(gitDir), "rounds.jsonl");
const chain = () => (existsSync(chainFile()) ? readFileSync(chainFile(), "utf8").split("\n").filter(Boolean).flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
}) : []);

let round = 1;
let earlierPart = "";
let repassBase = "";
if (args.includes("--repass")) {
  if (mode !== "after") fail("--repass is for --mode after: a re-pass checks a fix");
  if (args.includes("--base")) fail("--repass takes its base from the earlier brief (the commit that round tested); drop --base");
  const prev = opt("--repass");
  if (!prev || !existsSync(prev)) fail(`--repass takes the earlier round's brief (prove-<time>.md), not "${prev ?? ""}"`);
  const text = readFileSync(prev, "utf8");
  // The round chain (Prover, 2026-10-21): a brief already re-passed is not the latest round, and
  // passing it again would restart the count below the Lead's ruling.
  const later = chain().find((c) => c.prev === real(prev));
  if (later) fail(`--repass: ${prev} was already re-passed by ${later.brief} (round ${later.round}); pass the latest round's brief`);
  const r = /^Round: (\d+)/m.exec(text);
  round = (r ? Number(r[1]) : 1) + 1;
  const c = /^Commit under test: ([0-9a-f]{7,40})/m.exec(text);
  if (!c) fail(`--repass: ${prev} has no "Commit under test:" line`);
  repassBase = c[1];
  const vf = opt("--verdict");
  if (!vf || !existsSync(vf)) fail("--repass needs --verdict <file>: the earlier round's dispelled verdict, saved word for word");
  const verdict = readFileSync(vf, "utf8").trim();
  if (!verdict) fail(`--verdict ${vf} is empty`);
  if (round >= 3) {
    const lf = opt("--lead-ruling");
    if (!lf || !existsSync(lf) || !readFileSync(lf, "utf8").trim()) {
      fail(`Round ${round} needs the Lead's ruling first (retro 2026-10-21): a second dispel goes to harteburn:architecture-lead with both verdicts, which rules in 5 min — fix the class, cut the item, or triage it out. Then pass --lead-ruling <its file>.`, 3);
    }
    earlierPart = `\n## The Lead's ruling before round ${round}\n\n${readFileSync(lf, "utf8").trim()}\n`;
  }
  earlierPart = `\n## The earlier verdict (round ${round - 1})\n\nCheck each survivor it lists against the fix diff below first, then sweep the steps' guards again.\n\n${verdict}\n` + earlierPart;
}

const sha = git(["rev-parse", "HEAD"], root);
// The warm worktree's commands (tidy pass 2026-10-28: moved here from the Prover's charter, since the
// brief is all the Prover is given). A reading member never opens it.
const wt = join(stateDir(gitDir), "prover-wt");
const worktreePart =
  `## Where you build: one warm worktree\n\n` +
  `- **The worktree** is \`${wt}\`. Create it once: \`git worktree add --detach ${wt} ${sha}\`. Each pass, move it: \`git -C ${wt} checkout --detach --force ${sha}\`, then \`git -C ${wt} clean -fd\`. Anything left in it is an earlier pass's: discard it this way, never \`git stash\` it. End the pass the same way, so the next one starts clean. No \`-x\`: its ignored build folder (\`target/\`, \`node_modules/\`) stays, so each build is incremental. The first time, set it up as the repo's \`CLAUDE.md\` says (packages, databases); later passes reuse it.\n` +
  `- **Every mutation is made and built there**, one at a time, each run with a timeout (a hang is red), and undone with \`git -C ${wt} checkout -- .\` before the next. One warm build beats parallel cold ones.\n` +
  `- ⛔ Never mutate or build in the main working tree: other sessions may share it. Never \`cargo clean\` the worktree or delete its build folder.\n\n`;
const dirty = git(["status", "--porcelain"], root);
const commitLine =
  `Commit under test: ${sha}\nRound: ${round}\n` +
  (dirty ? `⚠ The tree also has uncommitted changes; the warm worktree holds only this commit. Say so on your first line.\n` : "");


function mutationsPart(changed) {
  const f = join(stateDir(gitDir), "mutations.jsonl");
  const rows = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()) : [];
  const head = "\n## The builder's own mutations\n\n";
  if (!rows.length) return head + `none recorded (\`${f}\` is missing or empty). Say so first: breaking its own guards is the builder's job before yours.\n`;
  const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
  // The builder's full test runs (retro 2026-10-26 Change 2) are listed under the table, not in it.
  const runs = rows.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m?.test_command);
  const runsLine = runs.length ? `\nThe builder's full runs: ${runs.map((m) => `\`${m.test_command}\` on ${String(m.commit).slice(0, 7)}: ${m.result ?? "?"}${m.tests != null ? ` (${m.tests} tests)` : ""}`).join("; ")}.\n` : "";
  const body = rows.filter((l) => { try { return !JSON.parse(l).test_command; } catch { return true; } }).map((l, i) => {
    try {
      const m = JSON.parse(l);
      const rel = typeof m.file === "string" && isAbsolute(m.file) ? relative(root, real(m.file)) : m.file;
      const file = cell(m.file) + (rel && changed.has(rel) ? "" : " (not in this diff)");
      const esc = Array.isArray(m.escapes) ? m.escapes.join("; ") : m.escapes;
      return `| ${cell(m.guard)} | ${file} | ${cell(m.break)} | ${cell(m.test)} | ${cell(m.result)} | ${cell(esc)} |`;
    } catch {
      return `| line ${i + 1}: not JSON | | | | | |`;
    }
  });
  return head + `From \`${f}\`. Re-run a break only when its result looks wrong (the break does not remove the guard, the test cannot observe it, the file is not in this diff); spend your time on guards this list does not cover, and on ways around a guard its escapes leave out.\n\n| guard | file | break | test | result | escapes |\n|---|---|---|---|---|---|\n${body.join("\n")}\n` + runsLine;
}

const TEST_FILE = /(^|\/)tests?\/|(^|\/)__tests__\/|[._]test\.[a-z]+$|\.spec\.[a-z]+$|(^|\/)test_[^/]+\.py$/;
const CODE_FILE = /\.(rs|py|ts|tsx|js|mjs|go|sql)$/;

/** Function names and string texts a diff changes in non-test code: the hunk's enclosing function,
 * functions defined on changed lines, and string literals of 12+ characters on changed lines (a
 * removed text is what its readers still expect). */
export function changedTokens(diffU0) {
  const fns = new Set();
  const texts = new Set();
  let file = "";
  for (const l of diffU0.split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(l);
    if (f) { file = f[1]; continue; }
    if (!file || TEST_FILE.test(file) || !CODE_FILE.test(file)) continue;
    const h = /^@@ [^@]+ @@ .*?\b(?:fn|def|function)\s+([A-Za-z_]\w{2,})/.exec(l);
    if (h) fns.add(h[1]);
    if (!/^[+-](?![+-])/.test(l)) continue;
    for (const m of l.matchAll(/\b(?:fn|def|function)\s+([A-Za-z_]\w{2,})|\b(?:const|let)\s+([A-Za-z_]\w{2,})\s*=\s*(?:async\s*)?\(/g)) fns.add(m[1] || m[2]);
    for (const m of l.matchAll(/"((?:[^"\\]|\\.){12,})"|'((?:[^'\\]|\\.){12,})'/g)) {
      const t = (m[1] ?? m[2]).split(/\{|\\/)[0].trim();
      if (t.length >= 12) texts.add(t);
    }
  }
  return { fns: [...fns], texts: [...texts] };
}

/** A crate's declared test programs: `autotests` and each `[[test]]` name + path. */
export function testTargets(cargoToml) {
  const autotests = !/^\s*autotests\s*=\s*false\b/m.test(cargoToml);
  const tests = [...cargoToml.matchAll(/^\[\[test\]\]\s*\n((?:(?!\[)[^\n]*\n?)*)/gm)].map((m) => ({
    name: /^\s*name\s*=\s*"([^"]+)"/m.exec(m[1])?.[1],
    path: /^\s*path\s*=\s*"([^"]+)"/m.exec(m[1])?.[1],
  }));
  return { autotests, tests };
}

/** The gate's command for one test file. A crate with `autotests = false` builds
 * its test files as modules of a declared program (connector-cloud's cc-server
 * `tests/it.rs`, 2026-10-26), so `--test <file>` names no target there: the
 * file runs as that program's `<file>::` tests, on nextest. */
export function gateCommand(path, pkgOf, targetsOf = () => null) {
  const rs = /^(.*?)\/tests\/([^/]+)\.rs$/.exec(path);
  if (rs) {
    const t = targetsOf(rs[1]);
    const own = t?.tests.find((x) => x.path === `tests/${rs[2]}.rs`);
    if (t && !t.autotests && !own && t.tests.length === 1) {
      return `cargo nextest run -p ${pkgOf(rs[1])} --test ${t.tests[0].name} -E 'test(/^${rs[2]}::/)'`;
    }
    return `cargo test -p ${pkgOf(rs[1])} --test ${own?.name ?? rs[2]}`;
  }
  if (/\.py$/.test(path)) return `python3 -m pytest ${path}`;
  if (/\.m?js$/.test(path)) return `node --test ${path}`;
  return `${path} (its own runner)`;
}

function readersPart(base) {
  const { fns, texts } = changedTokens(git(["diff", "-U0", base, "--", "."], root));
  const tokens = [...fns, ...texts].slice(0, 60);
  const head = "\n## Readers and callers: run them the gate's way\n\n";
  if (!tokens.length) return head + "The diff changes no function or string in code; nothing to list.\n";
  let hits = [];
  try {
    hits = git(["grep", "-l", "-F", ...tokens.flatMap((t) => ["-e", t]), "--", "."], root).split("\n").filter((f) => f && TEST_FILE.test(f));
  } catch {}
  const pkgOf = (dir) => {
    try {
      return /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, dir, "Cargo.toml"), "utf8"))?.[1] || dir.split("/").pop();
    } catch {
      return dir.split("/").pop();
    }
  };
  const targetsOf = (dir) => {
    try {
      return testTargets(readFileSync(join(root, dir, "Cargo.toml"), "utf8"));
    } catch {
      return null;
    }
  };
  const cmds = [...new Set(hits.map((f) => gateCommand(f, pkgOf, targetsOf)))];
  return head +
    `Every test file that names a function or string this diff changes (${fns.length} functions, ${texts.length} texts, \`git grep -F\`). Run each once with the command shown, one process per test binary as the gate runs it, besides your own nextest run: a race between tests, or a reader of a changed text, shows only this way.\n\n` +
    (cmds.length ? cmds.map((c) => "- `" + c + "`").join("\n") : "none found: say so, and name the readers you checked by hand") +
    `\n\n<details><summary>What was searched</summary>\n\n${tokens.map((t) => "- `" + t.replace(/`/g, "'") + "`").join("\n")}\n</details>\n`;
}

/** A guard log's rows that break a guard (not the builder's full runs), and whether any lists its
 * escapes: a non-empty list, or "none, because <a reason>". */
export function escapesListed(rows) {
  const guards = rows.filter((m) => m && typeof m === "object" && !m.test_command);
  const ok = (e) => (Array.isArray(e) ? e.some((x) => String(x ?? "").trim()) : /^none, because\s*\S/i.test(String(e ?? "").trim()));
  return { guards: guards.length, listed: guards.some((m) => ok(m.escapes)) };
}

const FIXTURE_PATH = /(^|\/)fixtures?\//;
const FIXTURE_TAG = /fixture:\s*(production\s+\S|made up, because\s+\S)/i;
const FIELD_LINE = /^\s*["']?[A-Za-z_$][\w$-]*["']?\s*:(?![:/])\s*\S/;
const INLINE_FIELD = /[{,]\s*["']?[A-Za-z_$][\w$-]*["']?\s*:(?![:/])/g;
/** Test fixture data a diff adds, and whether each names its source. Narrow on purpose, since a
 * false positive costs one comment: a fixture is (1) a file added or changed under a `fixtures/`
 * folder, or (2) added lines in a test file holding a literal of 3+ fields, on one line
 * (`{ id: 1, total: 42, currency: "USD" }`) or as 3+ consecutive `key: value` lines. Each needs an
 * added comment `fixture: production <the read>` or `fixture: made up, because <why>`: in the test
 * file's added lines, or for a fixtures/ file in it or in any added line that names its file name.
 * `added` maps each changed path to its added lines. Returns [{file, tag}] with tag null when missing. */
export function fixtureSources(added) {
  const allTags = [...added.values()].flat().filter((l) => FIXTURE_TAG.test(l));
  const out = [];
  for (const [file, lines] of added) {
    const tag = lines.find((l) => FIXTURE_TAG.test(l));
    if (FIXTURE_PATH.test(file)) {
      const named = tag ?? allTags.find((l) => l.includes(basename(file)));
      out.push({ file, tag: named ?? null });
      continue;
    }
    if (!TEST_FILE.test(file)) continue;
    let run = 0;
    const data = lines.some((l) => (run = FIELD_LINE.test(l) ? run + 1 : 0) >= 3 || (l.match(INLINE_FIELD) || []).length >= 3);
    if (data) out.push({ file, tag: tag ?? null });
  }
  return out;
}

/** Each path's added lines in a unified diff. */
export function addedLines(diff) {
  const m = new Map();
  let file = "";
  for (const l of diff.split("\n")) {
    const f = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/.exec(l);
    if (f) { file = f[1] ?? ""; if (file && !m.has(file)) m.set(file, []); continue; }
    if (file && l.startsWith("+")) m.get(file).push(l.slice(1));
  }
  return m;
}

/** A removal ledger's rows: its bullets, and its table rows less the header (the row above a |---| line). */
export function ledgerRows(text) {
  const lines = text.split("\n");
  const sep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const bullets = lines.filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
  const table = lines.filter((l) => /^\s*\|/.test(l) && !sep(l)).length - lines.filter(sep).length;
  return bullets + Math.max(0, table);
}

/** Loaded files (agents, skills, ethos.md, bookends.md) a -U0 diff removes non-blank lines from. */
export function removedFromLoaded(diffU0, loaded) {
  const set = new Set(loaded);
  const hit = new Set();
  let file = "";
  for (const l of diffU0.split("\n")) {
    const f = /^--- (?:a\/(.+)|\/dev\/null)$/.exec(l);
    if (f) { file = f[1] ?? ""; continue; }
    if (l.startsWith("+++")) continue;
    if (set.has(file) && /^-.*\S/.test(l)) hit.add(file);
  }
  return [...hit];
}

/** The Architect's ruling must say which stored values it changes, and each one's readers. */
export function rulingProblem(text) {
  const stored = /^\s*[-*]?\s*\**Stored values changed:?\**:?\s*(.*)$/im.exec(text);
  if (!stored) return 'no "Stored values changed:" line (write "Stored values changed: none" if it changes none)';
  if (/^none\b/i.test(stored[1].trim())) return null;
  if (!/^\s*[-*]?\s*\**Readers:?\**:?\s*\S/im.test(text)) return 'it changes a stored value but has no "Readers: <the grep>, N files" line';
  return null;
}

let rulingPart = "";
if (args.includes("--ruling")) {
  const rf = opt("--ruling");
  if (!rf || !existsSync(rf)) fail(`--ruling takes the Architect's design file, not "${rf ?? ""}"`);
  const rt = readFileSync(rf, "utf8");
  const why = rulingProblem(rt);
  if (why) fail(`refused: the ruling ${rf} has ${why}. The Architect lists who reads a stored value, not only who writes it (retro 2026-10-25).`, 1);
  const lines = rt.split("\n").filter((l) => /Stored values changed:|Readers:/i.test(l));
  rulingPart = `\n## The design ruling's stored values and readers\n\nFrom \`${rf}\`:\n\n${lines.join("\n")}\n`;
}

let diffPart = "";
let dispatch = null;
if (mode === "after") {
  let base = opt("--base") || repassBase;
  if (!base) {
    try {
      base = git(["merge-base", "HEAD", "origin/main"], root);
    } catch {
      base = "HEAD~1";
    }
  }
  const diff = git(["diff", base, "--", ".", ":(exclude)docs/architecture/BRIEF*.md"], root);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], root);
  const changed = new Set([...git(["diff", "--name-only", base], root).split("\n"), ...untracked.split("\n")].filter(Boolean));
  // The dispatch prompt names the commits and each changed file's sha256 as it is on disk now (rc-security
  // piece 4, A1): the push gate counts this run's proven for a pushed commit whose files are the same.
  // A swarm member names its steps; a slice's pass with --steps and no --role judges the whole change.
  const baseSha = git(["rev-parse", "--verify", `${base}^{commit}`], root);
  const files = [...changed].sort().map((p) => {
    try { return [p, createHash("sha256").update(readFileSync(join(root, p))).digest("hex")]; } catch { return [p, null]; }
  });
  dispatch = (brief) => proverPrompt(baseSha, sha, files, role ? swarmSteps : null, brief);
  // Retro 2026-10-23 (jg ratified Change 2): the Prover broke every guard itself on KIT-001's pieces
  // 1–10 because the builder logged none, and 8 of 13 passes ran 11–19 min against 8. A first pass
  // starts only once the builder has broken its own guards on this diff's code.
  if (round === 1) {
    const code = [...changed].filter((f) => !/\.(md|txt)$/i.test(f) && !f.startsWith("docs/"));
    const f = join(stateDir(gitDir), "mutations.jsonl");
    const logged = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
    const covered = logged.some((m) => code.includes(typeof m.file === "string" && isAbsolute(m.file) ? relative(root, real(m.file)) : m.file));
    const why = opt("--no-guards");
    if (code.length && !covered && !why) {
      process.stderr.write(`refused: no guard break of yours is logged for this diff's code (${code.slice(0, 5).join(", ")}${code.length > 5 ? ", …" : ""}). Break your own guards first and log each in ${f} ({"guard","file","break","test","result"}), or pass --no-guards "<why>" (e.g. a change with no guard).\n`);
      process.exit(1);
    }
  }
  const refuse = (msg) => {
    process.stderr.write(msg + "\n");
    process.exit(1);
  };
  // (a) Retro 2026-10-28 Change 2: a logged guard break names the ordinary ways around its guard.
  {
    const f = join(stateDir(gitDir), "mutations.jsonl");
    const rows = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
    const e = escapesListed(rows);
    if (e.guards && !e.listed) {
      refuse(`refused: no guard in ${f} lists its escapes. To each guard's line add "escapes": ["<each ordinary way around it (a second spelling, another path to the same data, a call from another module), each shown red by a test>"], or "escapes": "none, because <why>".`);
    }
  }
  // (b) Retro 2026-10-28 Change 2: a test fixture names its source.
  const added = addedLines(git(["diff", base, "--", "."], root));
  for (const u of untracked.split("\n").filter(Boolean)) {
    try { added.set(u, readFileSync(join(root, u), "utf8").split("\n")); } catch {}
  }
  const fixtures = fixtureSources(added);
  const untagged = fixtures.filter((x) => !x.tag).map((x) => x.file);
  if (untagged.length) {
    refuse(`refused: test fixture data with no source: ${untagged.join(", ")}. Add one comment in its added lines (for a fixtures/ file, in it or in an added line naming its file name): "fixture: production <the read>" (the command and date it was fetched with) or "fixture: made up, because <why>" (why production's shape does not matter here). Detected: a file under fixtures/, or a test file's added literal of 3+ fields.`);
  }
  // (c) Retro 2026-10-28 Change 2: a sentence removed from a loaded file says where its rule still lives.
  const loadedHit = removedFromLoaded(git(["diff", "-U0", base, "--", "."], root), loadedFiles(root));
  const ledger = opt("--removed");
  if (args.includes("--removed")) {
    const ok = ledger && existsSync(ledger) && ledgerRows(readFileSync(ledger, "utf8")) > 0;
    if (!ok) refuse(`refused: --removed ${ledger ?? ""} is missing or has no row. Write one row per removed sentence and where its rule still lives (| removed | lives in |), marking an origin story "story".`);
  } else if (loadedHit.length) {
    refuse(`refused: lines removed from a loaded file (${loadedHit.join(", ")}) with no removal ledger. Pass --removed <file>: one row per removed sentence and where its rule still lives (| removed | lives in |), marking an origin story "story". A pure addition needs none.`);
  }
  const fixturesPart = fixtures.length
    ? `\n## Test fixtures and their sources\n\nThe builder's tag for each fixture this diff adds. Check that a "production" fixture has production's shape, and that a "made up" reason holds for the steps it serves.\n\n${fixtures.map((x) => `- ${x.file}: ${x.tag.trim().replace(/^(\/\/|#|--|\/\*)\s*/, "")}`).join("\n")}\n`
    : "";
  const removedPart = ledger
    ? `\n## Removed from loaded files\n\nThe builder's ledger: \`${resolve(process.cwd(), ledger)}\` (lines removed from: ${loadedHit.join(", ") || "none in this diff"}). Check every row that is not an origin story: its rule still lives where the row says, word for word or in a refusal that enforces it. A removed sentence the ledger leaves out, or a row whose rule lives nowhere, is a defect.\n`
    : "";
  // Retro 2026-10-26 (a website overhaul, jg ratified Change 2): the builder ran only new test
  // files after one change; a gate test went red unseen and three mutation lines claimed "red" on a
  // test that was already red. When the repo's house rules name a `Test command:`, every after-pass
  // needs the builder's own run of that command on the commit under test, logged in mutations.jsonl
  // as {"test_command": "<the command>", "commit": "<sha>", "result": "pass" | "fail"}.
  {
    const rules = ["CLAUDE.md", "AGENTS.md"].map((n) => join(root, n)).filter((p) => existsSync(p)).map((p) => readFileSync(p, "utf8")).join("\n");
    const testCommand = rules.match(/^\s*[-*]?\s*\**Test command:?\**:?\s*`?([^`\n]+?)`?\s*$/im)?.[1]?.trim();
    if (testCommand) {
      const f = join(stateDir(gitDir), "mutations.jsonl");
      const rows = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
      const ran = rows.some((m) => m.test_command === testCommand && typeof m.commit === "string" && m.commit.length >= 7 && sha.startsWith(m.commit));
      if (!ran) {
        process.stderr.write(`refused: the house rules' test command (${testCommand}) has no logged run on the commit under test (${sha.slice(0, 7)}). Run it, then log {"test_command": ${JSON.stringify(testCommand)}, "commit": "${sha.slice(0, 7)}", "result": "pass"} in ${f}.\n`);
        process.exit(1);
      }
    }
  }
  // Retro 2026-10-28 (connector-cloud FEA-CC-456, jg ratified Change 1): two staff screens kept counting
  // a new outcome the old way, and five piece-end reviews never read them. A first pass says whether the
  // diff adds an outcome; if it does, each reader of it is listed (found by grep) and checked here.
  let outcomesPart = "";
  if (round === 1) {
    const readers = opt("--readers");
    const none = opt("--no-new-outcome");
    const WHAT = "a check outcome, verdict, status or exclusion state";
    if (args.includes("--readers") && args.includes("--no-new-outcome")) refuse(`refused: pass --readers <file> or --no-new-outcome "<why>", not both.`);
    if (!args.includes("--readers") && !args.includes("--no-new-outcome")) {
      refuse(`refused: say whether this diff adds an outcome (${WHAT}). If it does, pass --readers <file>: one row per view that counts or shows it, found by grep (| outcome | reader | found by |). If not, pass --no-new-outcome "<why>".`);
    }
    if (args.includes("--no-new-outcome") && !String(none ?? "").trim()) refuse(`refused: --no-new-outcome needs its reason: --no-new-outcome "<why this diff adds no ${WHAT}>".`);
    if (readers != null) {
      if (!existsSync(readers)) refuse(`refused: no file at --readers ${readers}. One row per view that counts or shows each new outcome: | outcome | reader | found by |.`);
      const rows = markdownTables(readFileSync(readers, "utf8")).flatMap((t) => t.rows);
      if (!rows.length) refuse(`refused: --readers ${readers} has no row. One row per view that counts or shows each new outcome: | outcome | reader | found by |.`);
      // The list itself is never evidence: left untracked in the repo, its own rows would be "added lines".
      const self = relative(root, real(resolve(process.cwd(), readers)));
      const addedText = [...added].filter(([f]) => f !== self).flatMap(([, l]) => l).join("\n");
      // A whole token, not a substring: a one-letter outcome would match any diff.
      const holds = (o) => new RegExp(`${/^\w/.test(o) ? "(?<!\\w)" : ""}${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${/\w$/.test(o) ? "(?!\\w)" : ""}`).test(addedText);
      // A file inside the repo, by its real path: a repo-relative spelling, never a symlink out or a folder.
      const inRepo = (p) => {
        if (!p || isAbsolute(p)) return false;
        try {
          const r = relative(realpathSync(root), realpathSync(resolve(root, p)));
          return Boolean(r) && !r.startsWith("..") && !isAbsolute(r) && statSync(join(root, r)).isFile();
        } catch {
          return false;
        }
      };
      const bad = [];
      for (const { line: row, cells } of rows) {
        const [outcome, reader] = cells;
        const path = String(reader || "").split(/[:\s]/)[0];
        if (cells.length !== 3 || cells.some((c) => !c)) bad.push(`${row} (each row has an outcome, a reader and the grep that found it)`);
        else if (!inRepo(path)) bad.push(`${row} (no ${path} in the repo)`);
        else if (!holds(outcome)) bad.push(`${row} (this diff's added lines do not hold "${outcome}")`);
      }
      if (bad.length) refuse(`refused: --readers ${readers}: ${bad.join("; ")}.`);
      outcomesPart = `\n## New outcomes and their readers\n\nThe builder's list (\`${resolve(process.cwd(), readers)}\`), one row per view that counts or shows a new outcome:\n\n${rows.map((r) => r.line).join("\n")}\n\nRender each reader once from one fixture run and assert they agree: one quantity, one answer. A reader that \`git grep\` finds for an outcome and the list leaves out is a defect, as are two readers that disagree.\n`;
    } else {
      outcomesPart = `\n## New outcomes and their readers\n\nThe builder says this diff adds no new outcome: "${none}". If the diff does add one (${WHAT}), that is a defect, and so is each reader of it left unread.\n`;
    }
  }
  diffPart =
    `\n\n## The change (git diff ${base.slice(0, 12)} — committed and uncommitted)\n\n` +
    "```diff\n" + diff + "\n```\n" +
    (untracked ? `\nUntracked files (read them directly):\n${untracked.split("\n").map((f) => "- " + f).join("\n")}\n` : "") +
    mutationsPart(changed) +
    readersPart(base) +
    outcomesPart +
    fixturesPart +
    removedPart +
    rulingPart;
}

let screensPart = "";
if (mode === "before") {
  const screens = screensOf(walk);
  const why = opt("--no-screens");
  if (screens.length) {
    screensPart = `\n## Required screen rows (retro 2026-10-28, a 2026-10-28 product retro, ch ratified Change 1)\n\nFor each screen these steps name, write these four tests red now, beside the steps' own, and list them in your report as \`<screen> · <row>\`. A row that cannot apply to a screen gets one line saying why (e.g. "no session: public page"), never silence.\n\n` +
      screens.map((p) => `### \`${p}\`\n` + SCREEN_ROWS.map((r) => `- [ ] ${r}`).join("\n")).join("\n\n") + "\n";
  } else if (!why) {
    process.stderr.write(`refused: these steps name no screen (no local page path such as /buyer/keys). If the piece has no page a person sees, pass --no-screens "<why>"; else name the paths in the walkthrough.\n`);
    process.exit(1);
  } else screensPart = `\n## Required screen rows\n\nNone: ${why}\n`;
}

const task =
  mode === "before"
    ? "Mode 1 (before the build): turn every walkthrough step into a failing test, run each, and confirm it fails for the right reason. Report one line per step."
    : "Mode 2 (after the build): give one verdict on this change against the walkthrough: **proven**; **defect** (the code does not do a step: the only verdict that blocks); or **proven, gaps to pin** (the code is right, but a test stays green with its guard gone: list each, the builder pins it, no re-pass). Run the Readers and callers list once, each with its gate command, before your verdict. Test names, a red-on-removal, and the screen for anything a person sees. Sweep every guard your steps depend on and list every survivor, not only the first red; when two or more share a cause, name the class and its structural fix. Tag each find `regression of this diff? y/n`, measured against the diff's base (y: the base did not do it). A classifier or filter change carries a before/after count over every real input set it touches, each lost member named; a \"conforms\" without it is a defect." +
      (round > 1 ? ` This is round ${round}, after a defect: the brief carries the earlier verdict, and the diff runs only from the commit that round tested.` : "");

const out =
  `# Prover brief — ${new Date().toISOString()}\n\n` +
  `Assembled by harteburn/scripts/prove-prompt.mjs from files only. It contains no account by the builder; if anything here reads like one, say so and ignore it.\n\n` +
  `Repo: ${root}\nPRD: ${prdPath}\nWalkthrough: ${w.source}\n${commitLine}${stepsLine}\n**Task.** ${task}\n\n` +
  (role ? ROLES[role] + "\n\n" : "") +
  (role === "reads" ? "" : worktreePart) +
  `## The acceptance walkthrough\n\n${walk}` +
  screensPart +
  earlierPart +
  diffPart;

mkdirSync(stateDir(gitDir), { recursive: true });
const file = join(stateDir(gitDir), `prove-${Date.now()}${suffix}.md`);
writeFileSync(file, out);
// The Prover's whole dispatch prompt, beside the brief: /prove sends exactly this file's text.
if (dispatch) writeFileSync(`${file}.prompt`, dispatch(file));
// Every after-mode brief has its row, round 1 too, so /retro counts each pass per PRD and steps and a
// fresh round 1 after a dispel shows as a restart (Lead ruling, 2026-10-21: refusing it would need a
// verdict state this script does not hold).
if (mode === "after") {
  appendFileSync(chainFile(), JSON.stringify({ brief: real(file), prev: args.includes("--repass") ? real(opt("--repass")) : null, round, prd: prdPath, steps: opt("--steps") ?? null, commit: sha }) + "\n");
}
console.log(file);
