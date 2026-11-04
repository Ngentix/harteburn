#!/usr/bin/env node
// HarteBurn architecture brief: stamp, check and list. Lives in each repo so anyone
// can clear a stale brief without the plugin. Source: the HarteBurn plugin,
// templates/scripts/brief-stamp.mjs; copy, don't fork.
//
//   node scripts/brief-stamp.mjs --check [<a>..<b> ...]
//                                               exit 1 and name what is stale or unmapped (in the
//                                               working tree, or as committed at each range's tip)
//   node scripts/brief-stamp.mjs --stamp        re-hash the sources after a compile, or after an
//                                               edit that changed no rule (alias --no-rule-change).
//                                               Refuses if any rule line is unmapped: a new or
//                                               edited rule needs /brief, not a stamp.
//   node scripts/brief-stamp.mjs --list-rules   every rule line as  id <TAB> source <TAB> text
//   node scripts/brief-stamp.mjs --pages [<a>..<b> ...]
//                                               exit 1 if code on the repo's map changed and none of
//                                               its pages did (ranges from the args, else
//                                               HARTEBURN_PAGES_RANGE, else the branch since origin/main
//                                               plus the working tree). Escape: a commit saying
//                                               `Pages-unchanged: <why>` excuses the files it changed.
//
// Definitions:
//   sources   docs/architecture/*.md except BRIEF*.md, plus docs/_house-rules.md
//   rule line a line in a source containing ⛔ or ⭐
//   rule id   first 12 hex of sha256("<source path>\n<line, trimmed, spaces collapsed>")
//   hash      sha256 of the source with any `last_verified:` line removed (a date bump is not a change)
//   coverage  docs/architecture/BRIEF-coverage.md: a Sources table (path, hash) and a Rules table
//             (id, source, where): where = a brief anchor like B7, or "folded: B7 <why>", or
//             "dropped: <why>". Every rule id in the sources must appear exactly once.
//   page map  a table under "## When you change code, update the page" in docs/architecture/README.md:
//             | code path | pages |, each cell a comma-separated list of `backticked` entries. A path is
//             a glob (* within a folder, ** across folders). A page with no "/" is in docs/architecture/;
//             a page starting with "/" is at the repo root (`/CLAUDE.md`); any other is repo-relative.
//             Changing any one listed page satisfies the row (HarteBurn 0.10.0).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BRIEF = "docs/architecture/BRIEF.md";
export const COVERAGE = "docs/architecture/BRIEF-coverage.md";
// The hook cuts any one context string at 10,000 characters, so a brief over one string's room is sent
// in up to four parts, each split at a "## " heading (jg 2026-10-14: size is fine; never drop a rule for space).
export const MAX_BRIEF_CHARS = 38000; // four hook parts of 10,000 less their heads, 38,744 (29,000 in three until 2026-10-30; 19,400 in two until jg, 2026-10-19)
export const HOOK_CAP = 10000;
export const MAX_PARTS = 4; // the parts the plugin's hooks.json sends: brief-session and brief-subagent 1–4
// briefHead and briefParts must stay identical to the copies in the plugin's hooks/harteburn-hook.mjs;
// the plugin's tests compare them.
export const HOOK_HEAD =
  "ARCHITECTURE BRIEF for this repo (docs/architecture/BRIEF.md, compiled from the architecture pages; " +
  "the pages win over the brief, the code wins over the pages). Honour it in every answer and change.\n\n";
export function briefHead(i, n) {
  return n === 1 ? HOOK_HEAD : HOOK_HEAD.replace("BRIEF.md,", `BRIEF.md, part ${i} of ${n},`);
}
// The fewest parts any split could use (hard cuts waste nothing, so ⌈length ÷ room⌉ is always
// reachable); within that count each part ends at its last "## " heading that still lets the rest fit
// the parts left, else at its last such line break (every rule is one line, so no rule is split), else
// where it is full; a heading or line break counts only if it leaves the part at least half full. So
// a brief within the limit always fits, and no part but the last is under half (the Prover, 2026-10-19:
// cutting only at headings, then budget alone, left one repo's part 1 with 477 characters).
export function briefParts(body) {
  if ((briefHead(1, 1) + body).length < HOOK_CAP - 100) return [body];
  const room = HOOK_CAP - 101 - briefHead(1, 2).length; // a part's most characters (every multi-part head is this long)
  const parts = [];
  let rest = body;
  for (let left = Math.ceil(body.length / room); rest.length > room; left--) {
    const fits = (cut) => cut >= room / 2 && cut <= room && rest.length - cut <= (left - 1) * room;
    let cut = 0;
    for (const m of rest.matchAll(/\n(?=## )/g)) {
      if (m.index + 1 > room) break;
      if (fits(m.index + 1)) cut = m.index + 1;
    }
    if (!cut) {
      const line = rest.lastIndexOf("\n", room - 1) + 1;
      cut = fits(line) ? line : room;
    }
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts;
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

export function root() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

export function sources(r) {
  const dir = join(r, "docs/architecture");
  const pages = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md") && !f.startsWith("BRIEF"))
        .sort()
        .map((f) => `docs/architecture/${f}`)
    : [];
  if (existsSync(join(r, "docs/_house-rules.md"))) pages.push("docs/_house-rules.md");
  return pages;
}

export function sourceHash(r, path) {
  const text = readFileSync(join(r, path), "utf8")
    .split("\n")
    .filter((l) => !/^last_verified:/.test(l))
    .join("\n");
  return sha(text);
}

export const norm = (line) => line.trim().replace(/\s+/g, " ");

export function ruleLines(r) {
  const out = [];
  for (const path of sources(r)) {
    for (const line of readFileSync(join(r, path), "utf8").split("\n")) {
      if (!/[⛔⭐]/.test(line)) continue;
      const text = norm(line);
      out.push({ id: sha(`${path}\n${text}`).slice(0, 12), source: path, text });
    }
  }
  return out;
}

// Parse the two tables of BRIEF-coverage.md. Rows are `| a | b | c |`; header and rule rows skipped.
export function readCoverage(r) {
  const p = join(r, COVERAGE);
  const cov = { sources: new Map(), rules: new Map(), dupes: [] };
  if (!existsSync(p)) return cov;
  let section = "";
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (/^## Sources/.test(line)) section = "sources";
    else if (/^## Rules/.test(line)) section = "rules";
    else if (/^## /.test(line)) section = "";
    if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ""));
    if (section === "sources" && cells[0] && cells[0] !== "source") cov.sources.set(cells[0], cells[1]);
    if (section === "rules" && /^[0-9a-f]{12}$/.test(cells[0])) {
      if (cov.rules.has(cells[0])) cov.dupes.push(cells[0]);
      cov.rules.set(cells[0], { source: cells[1], where: cells[cells.length - 1] });
    }
  }
  return cov;
}

export function anchors(briefText) {
  return new Set([...briefText.matchAll(/\[(B\d+)\]/g)].map((m) => m[1]));
}

// Every problem as one plain line. Empty array = the brief is current and complete.
export function check(r) {
  const problems = [];
  const briefPath = join(r, BRIEF);
  if (!existsSync(briefPath)) return [`brief: missing — ${BRIEF} (run /brief)`];
  const brief = readFileSync(briefPath, "utf8");
  if (brief.length > MAX_BRIEF_CHARS)
    problems.push(`brief: too long — ${brief.length} characters, limit ${MAX_BRIEF_CHARS.toLocaleString("en-US")}`);
  // Within the limit a brief always fits MAX_PARTS parts: briefParts uses the fewest any split could,
  // and the limit is pinned to MAX_PARTS parts' room by test. So the length is the one check.

  const cov = readCoverage(r);
  const src = sources(r);
  for (const path of src) {
    const want = cov.sources.get(path);
    if (!want) problems.push(`brief: stale — ${path} is a new source (run /brief)`);
    else if (want !== sourceHash(r, path)) problems.push(`brief: stale — ${path} changed since the brief was compiled`);
  }
  for (const path of cov.sources.keys())
    if (!src.includes(path)) problems.push(`brief: stale — ${path} is gone but still listed`);

  const live = ruleLines(r);
  const liveIds = new Set(live.map((x) => x.id));
  const have = anchors(brief);
  for (const rule of live) {
    const c = cov.rules.get(rule.id);
    if (!c) {
      problems.push(`brief: unmapped rule ${rule.id} in ${rule.source}: "${rule.text.slice(0, 90)}"`);
      continue;
    }
    const m = c.where.match(/^(?:folded:\s*)?(B\d+)/);
    if (m && !have.has(m[1])) problems.push(`brief: rule ${rule.id} points at [${m[1]}], which the brief does not contain`);
    if (!m && !/^dropped:\s*\S/.test(c.where))
      problems.push(`brief: rule ${rule.id} has no place in the brief and no reason it was dropped`);
  }
  for (const id of cov.rules.keys())
    if (!liveIds.has(id)) problems.push(`brief: stale — rule ${id} is in the map but no longer in any source`);
  for (const id of cov.dupes) problems.push(`brief: rule ${id} is mapped twice`);
  return problems;
}

export function stamp(r) {
  const cov = readCoverage(r);
  const unmapped = ruleLines(r).filter((x) => !cov.rules.has(x.id));
  if (unmapped.length) {
    return {
      ok: false,
      message:
        `refused: ${unmapped.length} rule line(s) are new or edited, so a rule changed. Run /brief.\n` +
        unmapped.map((x) => `  ${x.id}  ${x.source}: ${x.text.slice(0, 90)}`).join("\n"),
    };
  }
  const p = join(r, COVERAGE);
  const text = readFileSync(p, "utf8");
  const table =
    "## Sources\n\n| source | sha256 |\n|---|---|\n" +
    sources(r).map((s) => `| ${s} | ${sourceHash(r, s)} |`).join("\n") +
    "\n";
  const liveIds = new Set(ruleLines(r).map((x) => x.id));
  const pruned = text
    .split("\n")
    .filter((l) => {
      const id = l.match(/^\|\s*`?([0-9a-f]{12})`?\s*\|/);
      return !id || liveIds.has(id[1]); // a rule line that was deleted from a source leaves the map
    })
    .join("\n");
  const next = pruned.replace(/## Sources\n[\s\S]*?(?=\n## |$)/, table);
  writeFileSync(p, next);
  return { ok: true, message: `stamped ${sources(r).length} sources; ${liveIds.size} rule lines all mapped` };
}

// ── Pages follow the code (jg 2026-10-17): the map turns "when you change X, update page Y" into a check.
export const PAGE_MAP = "docs/architecture/README.md";
const MAP_HEADING = /^## When you change code, update the page\b/;
export const ESCAPE = /^Pages-unchanged:[ \t]*\S/m;

const cellItems = (cell) =>
  cell
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, "").trim())
    .filter(Boolean);
export const pagePath = (p) => (p.startsWith("/") ? p.slice(1) : p.includes("/") ? p : `docs/architecture/${p}`);

export const readPageMap = (r) => (existsSync(join(r, PAGE_MAP)) ? parsePageMap(readFileSync(join(r, PAGE_MAP), "utf8")) : []);

export function parsePageMap(text) {
  const rows = [];
  let inMap = false;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) inMap = MAP_HEADING.test(line);
    if (!inMap || !line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 2 || /^\s*code path\s*$/i.test(cells[0])) continue;
    const paths = cellItems(cells[0]);
    const pages = cellItems(cells[1]).map(pagePath);
    if (paths.length && pages.length) rows.push({ paths, pages });
  }
  return rows;
}

// * stays inside one folder; ** crosses folders ("deploy/**" matches deploy/a/b.tf).
export function globRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // Case-insensitive: on a case-insensitive disk `Claude.md` is `CLAUDE.md` (Security round 16); it only ever holds more.
  return new RegExp(`^${re}$`, "i");
}

// Which changed files the check holds to their pages. A `Pages-unchanged: <why>` answers for its own
// commit only: a file only escaped commits touched is excused; one any other commit (or uncommitted
// work, `extra`) touched is not. `net` is the range's diff, so a change made and undone counts as none.
export function scope({ net, commits = [], extra = [] }) {
  const escaped = new Set(), plain = new Set();
  for (const c of commits) for (const f of c.files) (ESCAPE.test(c.message) ? escaped : plain).add(f);
  const changed = [...new Set([...net, ...extra])];
  const checked = changed.filter((f) => extra.includes(f) || plain.has(f) || !escaped.has(f));
  return { changed, checked };
}

// Where the map and its pages are read: the working tree, or (treeView vs tipView) a pushed commit.
export const treeView = (r) => ({ map: readPageMap(r), exists: (p) => existsSync(join(r, p)) });

// Every problem as one plain line. Empty = every checked change brought one of its row's pages along.
export function pagesCheck(r, { changed, checked = changed }, view = treeView(r)) {
  const { map, exists } = view;
  const problems = [];
  for (const row of map)
    for (const page of row.pages)
      if (!exists(page)) problems.push(`pages: the map in ${PAGE_MAP} names ${page}, which does not exist`);
  const touched = new Set(changed);
  for (const row of map) {
    const res = row.paths.map(globRe);
    const hit = checked.filter((f) => res.some((re) => re.test(f)));
    if (!hit.length || row.pages.some((p) => touched.has(p))) continue;
    const shown = hit.slice(0, 3).join(", ") + (hit.length > 3 ? ` (+${hit.length - 3} more)` : "");
    problems.push(
      `pages: ${shown} changed, but none of ${row.pages.join(", ")} did. ` +
        `Update the page, or say why not in that commit: "Pages-unchanged: <why>".`,
    );
  }
  return problems;
}

const git = (r, args) => execFileSync("git", args, { cwd: r, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const commitsIn = (r, range) =>
  git(r, ["log", "--format=%x1e%B%x1f", "--name-only", range])
    .split("\x1e")
    .filter((c) => c.includes("\x1f"))
    .map((c) => ({ message: c.slice(0, c.indexOf("\x1f")), files: lines(c.slice(c.indexOf("\x1f") + 1)) }));

// What a check covers, as { changed, checked } (see scope). Given ranges (a push): their commits only;
// a range git cannot read is an { error }, never a pass. Given none (a gate before merging): the branch
// since origin/main, plus uncommitted and untracked work; { skip } when there is no origin/main.
export function changes(r, ranges = []) {
  if (ranges.length) {
    const net = new Set(), commits = [];
    for (const range of ranges) {
      try {
        lines(git(r, ["diff", "--name-only", range])).forEach((f) => net.add(f));
        commits.push(...commitsIn(r, range));
      } catch {
        return { error: `pages: cannot read the pushed range ${range} (a remote commit not fetched?). Run git fetch, then push again.` };
      }
    }
    return scope({ net: [...net], commits });
  }
  let base;
  try {
    base = git(r, ["merge-base", "HEAD", "origin/main"]).trim();
  } catch {
    return { skip: "no origin/main to compare with" };
  }
  const extra = [...new Set([...lines(git(r, ["diff", "--name-only", "HEAD"])), ...lines(git(r, ["ls-files", "--others", "--exclude-standard"]))])];
  return scope({ net: lines(git(r, ["diff", "--name-only", base])), commits: commitsIn(r, `${base}..HEAD`), extra });
}

// This file is copied into each product repo on its own, so it reads the variable itself (the plugin reads
// HARTEBURN_PAGES_RANGE too; a product that copies this template sets that name in its CI).
export const envRanges = () => (process.env.HARTEBURN_PAGES_RANGE || "").split(/\s+/).filter(Boolean);
export const tipsOf = (ranges) => [...new Set(ranges.map((x) => x.split("..").pop()))];

// The brief's files as committed at `rev`, written to a throwaway directory.
export function briefAt(r, rev) {
  const dir = mkdtempSync(join(tmpdir(), "brief-at-"));
  for (const f of lines(git(r, ["ls-tree", "-r", "--name-only", rev, "--", "docs/architecture", "docs/_house-rules.md"]))) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), git(r, ["show", `${rev}:${f}`]));
  }
  return dir;
}

// The brief check a gate runs. Given pushed ranges: the brief as committed at each pushed tip, so a push
// is judged by what it pushes, never by another session's uncommitted edits in a shared tree (jg
// 2026-10-17). Given none (the full gate, a local run): the working tree.
export function repoBrief(r, ranges = envRanges()) {
  if (!ranges.length) return check(r);
  const problems = [];
  for (const tip of tipsOf(ranges)) {
    let dir;
    try {
      const sha = git(r, ["rev-parse", "--verify", `${tip}^{commit}`]).trim();
      dir = briefAt(r, sha);
      problems.push(...check(dir).map((p) => `${p} (at ${sha.slice(0, 8)})`));
    } catch {
      problems.push(`brief: cannot read the pushed commit ${tip}`);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
  return problems;
}

// The map and its pages as committed at `tip`.
export function tipView(r, tip) {
  let text = "";
  try {
    text = git(r, ["show", `${tip}:${PAGE_MAP}`]);
  } catch {
    /* no map at that commit */
  }
  const exists = (p) => {
    try {
      git(r, ["cat-file", "-e", `${tip}:${p}`]);
      return true;
    } catch {
      return false;
    }
  };
  return { map: parsePageMap(text), exists };
}

// The repo's own check: { skip } or { problems } (an unreadable range is a problem). A push is judged
// range by range, each against the map as committed at its tip, never the working tree's map.
export function repoPages(r, ranges = envRanges()) {
  if (!ranges.length) {
    const got = changes(r);
    return got.skip ? { skip: got.skip } : { problems: pagesCheck(r, got) };
  }
  const problems = [];
  for (const range of ranges) {
    const got = changes(r, [range]);
    if (got.error) problems.push(got.error);
    else problems.push(...pagesCheck(r, got, tipView(r, range.split("..").pop())));
  }
  return { problems };
}

function main() {
  const r = root();
  const arg = process.argv[2] || "--check";
  if (arg === "--pages") {
    const args = process.argv.slice(3);
    const res = repoPages(r, args.length ? args : envRanges());
    if (res.skip) {
      console.log(`pages: skipped — ${res.skip}`);
      return 0;
    }
    const problems = res.problems;
    problems.forEach((p) => console.log(p));
    if (!problems.length) console.log(`pages: follow the code (${readPageMap(r).length} map rows)`);
    return problems.length ? 1 : 0;
  }
  if (arg === "--list-rules") {
    for (const x of ruleLines(r)) console.log(`${x.id}\t${x.source}\t${x.text}`);
    return 0;
  }
  if (arg === "--stamp" || arg === "--no-rule-change") {
    const res = stamp(r);
    console.log(res.message);
    if (!res.ok) return 1;
    const left = check(r);
    left.forEach((p) => console.log(p));
    return left.length ? 1 : 0;
  }
  const problems = arg === "--check" && process.argv[3] ? repoBrief(r, process.argv.slice(3)) : check(r);
  problems.forEach((p) => console.log(p));
  if (!problems.length) console.log("brief: current");
  return problems.length ? 1 : 0;
}

// Compare paths, not a hand-built file:// string: on Windows argv[1] has backslashes and a
// drive letter, so the string form never matches and the script silently did nothing (#1).
// Started by its own path? Real paths on both sides: Node reports this module's real path, while
// argv[1] is the path as typed — on macOS a temp folder (/var → /private/var) or any symlinked
// checkout differs, and the script silently did nothing (found 2026-10-18, tests/main-guard).
function startedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (process.argv[1] && startedDirectly()) process.exit(main());
