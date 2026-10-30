// The architecture brief is current, complete and fits. HarteBurn.
// Source: github.com/Ngentix/redcell templates/scripts/__tests__/brief.test.mjs
// Run: node --test scripts/__tests__/brief.test.mjs   (a gate in verify.sh and pre-push)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
  root, check, stamp, ruleLines, briefParts, briefHead, MAX_BRIEF_CHARS, MAX_PARTS, HOOK_CAP,
  readPageMap, globRe, pagesCheck, scope, changes, repoPages, repoBrief,
} from "../brief-stamp.mjs";

// ⛔ A git hook runs this file with GIT_DIR (and other GIT_* variables) naming the real repository, and
// every child git inherits them, so each throwaway repo below would be the real one: on 2026-10-19 a
// pre-push from a worktree set the shared config's core.bare, moved a branch and origin/main, and made
// a branch. Neither this file nor its children ever see them.
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

// Every throwaway repo a test makes is removed when the file's tests finish.
const made = [];
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A repo with architecture pages must have a current brief. A repo with none (the plugin's own) skips.
const hasPages = existsSync(join(root(), "docs/architecture"));
// A push (REDCELL_PAGES_RANGE set) is judged by the brief as committed at the pushed tip; the full gate
// by the working tree.
test("this repo's brief is current, complete, and fits the hook cap", { skip: !hasPages && "no docs/architecture in this repo" }, () => {
  const problems = repoBrief(root());
  if (problems.length) assert.fail("\n" + problems.join("\n") + "\nFix: /brief, or node scripts/brief-stamp.mjs --no-rule-change if no rule changed");
});

// Code on the repo's map changed → one of its pages changed too (pre-push passes the pushed range in
// REDCELL_PAGES_RANGE; a gate before merging checks the branch since origin/main plus the working tree).
// The problems print as the failure's only text, so a hook that shows the last lines shows them.
test("this repo's architecture pages follow its code", (t) => {
  if (!readPageMap(root()).length) return t.skip("no page map in docs/architecture/README.md");
  const res = repoPages(root());
  if (res.skip) return t.skip(res.skip);
  if (res.problems.length) assert.fail("\n" + res.problems.join("\n"));
});

// The checks themselves, on a throwaway repo, so a vacuous check cannot pass silently.
function fixture() {
  const r = tmp("brief-");
  mkdirSync(join(r, "docs/architecture"), { recursive: true });
  writeFileSync(join(r, "docs/architecture/01-a.md"), "# A\n⛔ Never do X.\nplain line\nlast_verified: 2026-01-01\n");
  writeFileSync(join(r, "docs/_house-rules.md"), "- ⭐ Do Y (2026-10-14).\n");
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), "[B1] Never X. [B2] Do Y.\n");
  const [x, y] = ruleLines(r);
  writeFileSync(
    join(r, "docs/architecture/BRIEF-coverage.md"),
    `# Coverage\n\n## Sources\n\n| source | sha256 |\n|---|---|\n\n## Rules\n\n| id | source | where |\n|---|---|---|\n| ${x.id} | ${x.source} | B1 |\n| ${y.id} | ${y.source} | B2 |\n`,
  );
  assert.equal(stamp(r).ok, true);
  return r;
}

test("a fresh stamp passes", () => {
  assert.deepEqual(check(fixture()), []);
});

test("a date bump is not a change", () => {
  const r = fixture();
  const p = join(r, "docs/architecture/01-a.md");
  writeFileSync(p, readFileSync(p, "utf8").replace("2026-01-01", "2026-10-14"));
  assert.deepEqual(check(r), []);
});

test("an edited page without a re-stamp is stale, naming the page", () => {
  const r = fixture();
  appendFileSync(join(r, "docs/architecture/01-a.md"), "a new plain sentence\n");
  assert.match(check(r).join("\n"), /stale — docs\/architecture\/01-a\.md changed/);
  assert.equal(stamp(r).ok, true, "no rule changed, so the stamp is allowed");
  assert.deepEqual(check(r), []);
});

test("a new rule is unmapped and the stamp refuses it", () => {
  const r = fixture();
  appendFileSync(join(r, "docs/architecture/01-a.md"), "⛔ Never do Z.\n");
  assert.match(check(r).join("\n"), /unmapped rule .* "⛔ Never do Z\."/);
  const res = stamp(r);
  assert.equal(res.ok, false);
  assert.match(res.message, /a rule changed\. Run \/brief/);
});

test("an edited rule counts as a new rule", () => {
  const r = fixture();
  const p = join(r, "docs/_house-rules.md");
  writeFileSync(p, "- ⭐ Do Y twice (2026-10-14).\n");
  assert.equal(stamp(r).ok, false);
});

test("a map entry pointing at a missing anchor fails", () => {
  const r = fixture();
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), "[B1] Never X.\n");
  assert.match(check(r).join("\n"), /points at \[B2\], which the brief does not contain/);
});

test("a dropped rule needs a reason", () => {
  const r = fixture();
  const p = join(r, "docs/architecture/BRIEF-coverage.md");
  writeFileSync(p, readFileSync(p, "utf8").replace(/\| B2 \|/, "| dropped: |"));
  assert.match(check(r).join("\n"), /no reason it was dropped/);
});

test("a brief over one hook string is split at a heading, and each part fits", () => {
  const r = fixture();
  const half = "[B1] [B2] " + "y".repeat(7000);
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), half + "\n## Second half\n" + "z".repeat(7000));
  assert.deepEqual(check(r), []);
  const parts = briefParts(readFileSync(join(r, "docs/architecture/BRIEF.md"), "utf8"));
  assert.equal(parts.length, 2);
  assert.ok(parts[1].startsWith("## Second half"));
});

test("with no heading, the split falls at a line break, never inside a rule", () => {
  const r = fixture();
  const lines = Array.from({ length: 200 }, (_, i) => `[B${i < 2 ? i + 1 : 1}] rule line ${i} ` + "w".repeat(60));
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), lines.join("\n"));
  assert.deepEqual(check(r), []);
  const parts = briefParts(lines.join("\n"));
  assert.equal(parts.length, 2);
  assert.ok(parts[0].endsWith("\n") && parts[1].startsWith("[B"), "cut at a line start");
});

test("a brief that fits one hook string stays one part", () => {
  const body = "[B1] short\n## Rules\n[B2] also short\n";
  assert.deepEqual(briefParts(body), [body]);
});

test("the one-part room is exact: one character more is two parts", () => {
  // the Prover, 2026-10-19 (F4): only a brief of 9,687–9,699 characters reaches the one-part return
  const one = HOOK_CAP - 101 - briefHead(1, 1).length;
  assert.equal(briefParts("a".repeat(one)).length, 1);
  assert.equal(briefParts("a".repeat(one + 1)).length, 2);
});

test("a brief over two hook strings is sent in three, each cut at a heading and each fitting", () => {
  const r = fixture();
  // ~25,000 characters, a heading every ~3,000: two parts cannot hold it, three can
  const body = "[B1] [B2] intro\n" + Array.from({ length: 8 }, (_, i) => `## S${i}\n` + "s".repeat(3000) + "\n").join("");
  assert.ok(body.length > 24000 && body.length < MAX_BRIEF_CHARS);
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), body);
  assert.deepEqual(check(r), []);
  const parts = briefParts(body);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(""), body, "nothing lost or repeated");
  parts.forEach((p, i) => assert.ok((briefHead(i + 1, 3) + p).length < HOOK_CAP, `part ${i + 1} fits`));
  assert.ok(parts[1].startsWith("## ") && parts[2].startsWith("## "), "each later part starts at a heading");
});

test("a line longer than a part is cut where the part is full, so every part fits", () => {
  const body = "[B1] [B2] " + "x".repeat(20000);
  const parts = briefParts(body);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(""), body);
  parts.forEach((p, i) => assert.ok((briefHead(i + 1, 3) + p).length < HOOK_CAP, `part ${i + 1} fits`));
});

test("a brief within the limit fits three parts wherever its headings fall", () => {
  const r = fixture();
  // four sections each just over three quarters of a part: cut only at headings, this took four parts
  const body = "[B1] [B2]\n" + [7290, 7300, 7300, 7000].map((n, i) => `## S${i}\n` + "x".repeat(n) + "\n").join("");
  assert.ok(body.length < MAX_BRIEF_CHARS);
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), body);
  assert.deepEqual(check(r), []);
  const parts = briefParts(body);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(""), body);
  // and at the limit itself, with a heading wherever it would hurt most
  const atLimit = Array.from({ length: 40 }, (_, i) => `## S${i}\n` + "y".repeat(718)).join("\n").slice(0, MAX_BRIEF_CHARS);
  assert.ok(briefParts(atLimit).length <= MAX_PARTS);
});

test("the limit is what three hook parts hold, less their heads, in whole thousands", () => {
  assert.equal(MAX_PARTS, 3, "three hook parts (jg 2026-10-19)");
  // a part's room exactly as briefParts computes it: under the cap less 100, with its head
  const room = HOOK_CAP - 101 - briefHead(1, MAX_PARTS).length;
  assert.equal(MAX_BRIEF_CHARS, Math.floor((MAX_PARTS * room) / 1000) * 1000, `${MAX_PARTS} parts of ${room}`);
});

test("a push is judged by the brief it pushes, never by uncommitted edits in the tree", () => {
  const r = fixture();
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: r, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("add", ".");
  g("commit", "-qm", "base");
  const head = g("rev-parse", "HEAD");
  const page = join(r, "docs/architecture/01-a.md");
  appendFileSync(page, "another session's half-finished sentence\n");
  assert.match(repoBrief(r, []).join("\n"), /stale — docs\/architecture\/01-a\.md/, "the working tree is stale");
  assert.deepEqual(repoBrief(r, [`${head}..${head}`]), [], "what the push carries is current");

  g("commit", "-qam", "page edited, brief not restamped");
  const stale = g("rev-parse", "HEAD");
  assert.equal(stamp(r).ok, true, "restamped in the tree only");
  assert.deepEqual(repoBrief(r, []), [], "the tree is current");
  assert.match(repoBrief(r, [`${head}..${stale}`]).join("\n"), /stale — docs\/architecture\/01-a\.md changed .*\(at /, "the pushed commit is not");
  assert.match(repoBrief(r, [`${head}..${"f".repeat(40)}`]).join("\n"), /cannot read the pushed commit/);
});

test("a brief of exactly the limit passes; one character more fails", () => {
  const r = fixture();
  const brief = (n) => "[B1] [B2]\n" + Array.from({ length: 60 }, (_, i) => `## S${i}\n` + "y".repeat(500)).join("\n").slice(0, n - 10);
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), brief(MAX_BRIEF_CHARS));
  assert.equal(readFileSync(join(r, "docs/architecture/BRIEF.md"), "utf8").length, MAX_BRIEF_CHARS);
  assert.deepEqual(check(r), []);
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), brief(MAX_BRIEF_CHARS + 1));
  assert.match(check(r).join("\n"), /too long/);
});

test("an oversize brief fails with the limit", () => {
  const r = fixture();
  writeFileSync(join(r, "docs/architecture/BRIEF.md"), "[B1] [B2] " + "x".repeat(MAX_BRIEF_CHARS));
  assert.match(check(r).join("\n"), new RegExp(`too long — \\d+ characters, limit ${MAX_BRIEF_CHARS.toLocaleString("en-US")}`));
});

// ── Pages follow the code: the map, the globs, the check and the escape, on throwaway repos ──
const MAP = [
  "# Architecture",
  "",
  "## Read this first",
  "",
  "| code path | pages |",
  "|---|---|",
  "| `src/**` | `99-not-the-map.md` |",
  "",
  "## When you change code, update the page",
  "",
  "| code path | pages |",
  "|---|---|",
  "| `migrations/**` | `08-data.md` |",
  "| `deploy/**`, `scripts/release/Dockerfile*` | `13-deploy.md`, `docs/runbook.md` |",
  "| `scripts/verify.sh` | `/CLAUDE.md` |",
  "",
  "## Later section",
  "",
  "| code path | pages |",
  "|---|---|",
  "| `web/**` | `10-web.md` |",
  "",
].join("\n");

function mapRepo() {
  const r = tmp("pages-");
  mkdirSync(join(r, "docs/architecture"), { recursive: true });
  writeFileSync(join(r, "docs/architecture/README.md"), MAP);
  for (const p of ["docs/architecture/08-data.md", "docs/architecture/13-deploy.md", "docs/runbook.md", "CLAUDE.md"]) writeFileSync(join(r, p), "# page\n");
  return r;
}
const ESC = "Pages-unchanged: comment only";

test("the page map is read from its own section only, pages resolved", () => {
  assert.deepEqual(readPageMap(mapRepo()), [
    { paths: ["migrations/**"], pages: ["docs/architecture/08-data.md"] },
    { paths: ["deploy/**", "scripts/release/Dockerfile*"], pages: ["docs/architecture/13-deploy.md", "docs/runbook.md"] },
    { paths: ["scripts/verify.sh"], pages: ["CLAUDE.md"] },
  ]);
});

test("globs: ** crosses folders, * stays in one", () => {
  assert.ok(globRe("deploy/**").test("deploy/multicloud/gcp/main.tf"));
  assert.ok(globRe("scripts/release/Dockerfile*").test("scripts/release/Dockerfile.runner"));
  assert.ok(!globRe("scripts/release/Dockerfile*").test("scripts/release/sub/Dockerfile"));
  assert.ok(!globRe("deploy/*").test("deploy/a/b.tf"));
  assert.ok(!globRe("deploy/**").test("redeploy/a.tf"), "anchored at the start");
  assert.ok(!globRe("a.yml").test("aXyml"), "a dot is literal");
});

test("mapped code changed without its page fails, naming the file and the pages", () => {
  const msg = pagesCheck(mapRepo(), { changed: ["deploy/main.tf", "src/x.rs"] }).join("\n");
  assert.match(msg, /deploy\/main\.tf changed, but none of docs\/architecture\/13-deploy\.md, docs\/runbook\.md did/);
  assert.match(msg, /Pages-unchanged: <why>/);
  assert.doesNotMatch(msg, /08-data/, "the migrations row was not touched");
});

test("any one listed page satisfies its row; unmapped code needs nothing; a root page (/CLAUDE.md) counts", () => {
  const r = mapRepo();
  assert.deepEqual(pagesCheck(r, { changed: ["deploy/main.tf", "docs/runbook.md"] }), []);
  assert.deepEqual(pagesCheck(r, { changed: ["src/x.rs", "web/a.tsx"] }), [], "rows outside the map section do not count");
  assert.equal(pagesCheck(r, { changed: ["scripts/verify.sh"] }).length, 1);
  assert.deepEqual(pagesCheck(r, { changed: ["scripts/verify.sh", "CLAUDE.md"] }), []);
});

test("each row is judged alone: one row's page does not excuse another", () => {
  const msg = pagesCheck(mapRepo(), { changed: ["migrations/001.sql", "deploy/main.tf", "docs/runbook.md"] }).join("\n");
  assert.match(msg, /migrations\/001\.sql changed, but none of docs\/architecture\/08-data\.md did/);
  assert.doesNotMatch(msg, /deploy\/main\.tf/);
});

test("an escape excuses only the files its own commit changed", () => {
  const r = mapRepo();
  const net = ["deploy/main.tf", "migrations/001.sql"];
  const one = scope({ net, commits: [{ message: `tier\n\n${ESC}`, files: ["deploy/main.tf"] }, { message: "feat: table", files: ["migrations/001.sql"] }] });
  assert.deepEqual(one.checked, ["migrations/001.sql"]);
  assert.match(pagesCheck(r, one).join("\n"), /migrations\/001\.sql changed/);
  const both = scope({ net, commits: [{ message: `tier\n\n${ESC}`, files: ["deploy/main.tf"] }, { message: "fix: tier again", files: ["deploy/main.tf"] }] });
  assert.ok(both.checked.includes("deploy/main.tf"), "a later plain commit to the same file is held to its page");
  assert.ok(both.checked.includes("migrations/001.sql"), "a file no commit lists (a merge) is held");
});

test("an escape needs a reason, at a line start; uncommitted work is never excused", () => {
  const files = ["migrations/001.sql"];
  assert.deepEqual(scope({ net: files, commits: [{ message: `feat: x\n\n${ESC}`, files }] }).checked, []);
  assert.deepEqual(scope({ net: files, commits: [{ message: "feat: x\n\nPages-unchanged:   ", files }] }).checked, files);
  assert.deepEqual(scope({ net: files, commits: [{ message: "feat: x mentions Pages-unchanged: inline", files }] }).checked, files);
  assert.deepEqual(scope({ net: files, commits: [{ message: `feat: x\n\n${ESC}`, files }], extra: files }).checked, files);
});

test("a map naming a page that does not exist fails", () => {
  const r = mapRepo();
  writeFileSync(join(r, "docs/architecture/README.md"), MAP.replace("`08-data.md`", "`08-typo.md`"));
  assert.match(pagesCheck(r, { changed: [] }).join("\n"), /names docs\/architecture\/08-typo\.md, which does not exist/);
});

function gitRepo() {
  const r = mapRepo();
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: r, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("add", ".");
  g("commit", "-qm", "base");
  const base = g("rev-parse", "HEAD");
  g("update-ref", "refs/remotes/origin/main", base);
  mkdirSync(join(r, "deploy"));
  writeFileSync(join(r, "deploy/main.tf"), "tier\n");
  g("add", "deploy/main.tf");
  g("commit", "-qm", `tier\n\n${ESC}`);
  const head = g("rev-parse", "HEAD");
  mkdirSync(join(r, "migrations"));
  writeFileSync(join(r, "migrations/001.sql"), "create table t();\n");
  appendFileSync(join(r, "docs/runbook.md"), "an uncommitted edit\n");
  appendFileSync(join(r, "deploy/main.tf"), "an uncommitted change after the escaped commit\n");
  return { r, base, head };
}

test("changes(): a range sees only its commits; no range sees the branch, the tree and untracked files", () => {
  const { r, base, head } = gitRepo();
  const ranged = changes(r, [`${base}..${head}`]);
  assert.deepEqual(ranged.changed, ["deploy/main.tf"], "a push is judged by its commits, never by uncommitted pages");
  assert.deepEqual(ranged.checked, [], "its commit said why");
  const branch = changes(r);
  assert.deepEqual(branch.changed.sort(), ["deploy/main.tf", "docs/runbook.md", "migrations/001.sql"]);
  assert.ok(branch.checked.includes("deploy/main.tf"), "an uncommitted change is held even where a commit escaped");
  assert.match(pagesCheck(r, branch).join("\n"), /^pages: migrations\/001\.sql changed/);
  assert.equal(pagesCheck(r, branch).length, 1, "the deploy commit's escape holds; the untracked migration is held");
});

test("the repo check uses the pushed range it is given, and an unreadable range fails", () => {
  const { r, base, head } = gitRepo();
  assert.deepEqual(repoPages(r, [`${base}..${head}`]), { problems: [] }, "the push itself is clean");
  assert.equal(repoPages(r, []).problems.length, 1, "the branch with its untracked migration is not");
  const bad = repoPages(r, [`${"f".repeat(40)}..${head}`]);
  assert.match(bad.problems.join("\n"), /cannot read the pushed range .* git fetch/);
});

test("a push is judged by the page map it pushes, never by the tree's map", () => {
  const r = mapRepo();
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: r, encoding: "utf8" }).trim();
  const readme = join(r, "docs/architecture/README.md");
  g("init", "-q", "-b", "main");
  g("add", ".");
  g("commit", "-qm", "base");
  const base = g("rev-parse", "HEAD");
  mkdirSync(join(r, "deploy"));
  writeFileSync(join(r, "deploy/main.tf"), "tier\n");
  g("add", ".");
  g("commit", "-qm", "tier, no page");
  const c1 = g("rev-parse", "HEAD");
  writeFileSync(readme, MAP.replace("| `deploy/**`, `scripts/release/Dockerfile*` | `13-deploy.md`, `docs/runbook.md` |\n", ""));
  assert.match(repoPages(r, [`${base}..${c1}`]).problems.join("\n"), /deploy\/main\.tf changed/, "deleting the row in the tree does not let the push through");

  writeFileSync(readme, MAP);
  mkdirSync(join(r, "src"));
  writeFileSync(join(r, "src/x.rs"), "fn main() {}\n");
  g("add", "src/x.rs");
  g("commit", "-qm", "code");
  const c2 = g("rev-parse", "HEAD");
  writeFileSync(readme, MAP.replace("## Later section", "| `src/**` | `08-data.md` |\n\n## Later section"));
  assert.deepEqual(repoPages(r, [`${c1}..${c2}`]).problems, [], "another session's new row in the tree does not block the push");

  writeFileSync(readme, MAP.replace("## Later section", "| `web/**` | `14-new.md` |\n\n## Later section"));
  g("add", readme);
  g("commit", "-qm", "a row naming a page not committed");
  const c3 = g("rev-parse", "HEAD");
  writeFileSync(join(r, "docs/architecture/14-new.md"), "# only in the tree\n");
  assert.match(repoPages(r, [`${c2}..${c3}`]).problems.join("\n"), /names docs\/architecture\/14-new\.md, which does not exist/, "a page must exist in the pushed commit");
});

// The env glue, end to end: this test file and the CLI, spawned in a throwaway repo with and without a
// pushed range (the Prover showed the glue could be removed with every other test green).
test("spawned with a pushed range, the gate judges the pushed commit; without one, the tree", { skip: process.env.REDCELL_SPAWNED && "inside a spawned run" }, () => {
  const r = fixture();
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(join(r, "scripts/__tests__"), { recursive: true });
  copyFileSync(join(here, "../brief-stamp.mjs"), join(r, "scripts/brief-stamp.mjs"));
  copyFileSync(fileURLToPath(import.meta.url), join(r, "scripts/__tests__/brief.test.mjs"));
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: r, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("add", ".");
  g("commit", "-qm", "base");
  const c1 = g("rev-parse", "HEAD");
  appendFileSync(join(r, "docs/architecture/01-a.md"), "edited, not restamped\n");
  g("commit", "-qam", "stale brief");
  const c2 = g("rev-parse", "HEAD");
  assert.equal(stamp(r).ok, true, "the tree restamped, uncommitted");
  // NODE_TEST_CONTEXT is how node:test spots a nested run; left in, the child skips its files and exits 0.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const run = (args, range) =>
    spawnSync("node", args, { cwd: r, encoding: "utf8", env: { ...env, REDCELL_SPAWNED: "1", REDCELL_PAGES_RANGE: range ?? "" } });
  const pushed = run(["--test", "--test-reporter=spec", "scripts/__tests__/brief.test.mjs"], `${c1}..${c2}`);
  assert.notEqual(pushed.status, 0, "the pushed commit's brief is stale");
  assert.match(pushed.stdout, /stale — docs\/architecture\/01-a\.md changed .*\(at /);
  const tree = run(["--test", "scripts/__tests__/brief.test.mjs"]);
  assert.equal(tree.status, 0, "the tree's brief is current");
  assert.match(tree.stdout, /# pass [1-9]/, "and the child really ran its tests");
  assert.equal(run(["scripts/brief-stamp.mjs", "--check", `${c1}..${c2}`]).status, 1, "the CLI judges a range's tip");
  assert.equal(run(["scripts/brief-stamp.mjs", "--check"]).status, 0, "and the tree without one");
});

test("a push of two branches is judged range by range, each against its own tip's map", () => {
  const r = mapRepo();
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: r, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("add", ".");
  g("commit", "-qm", "base");
  const base = g("rev-parse", "HEAD");
  mkdirSync(join(r, "deploy"));
  writeFileSync(join(r, "deploy/main.tf"), "tier\n");
  g("add", ".");
  g("commit", "-qm", "tier, no page");
  const a = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "other", base);
  writeFileSync(join(r, "docs/architecture/README.md"), MAP.replace("| `deploy/**`, `scripts/release/Dockerfile*` | `13-deploy.md`, `docs/runbook.md` |\n", ""));
  g("commit", "-qam", "another branch drops the deploy row");
  const b = g("rev-parse", "HEAD");
  const problems = repoPages(r, [`${base}..${a}`, `${base}..${b}`]).problems.join("\n");
  assert.match(problems, /deploy\/main\.tf changed/, "branch a is judged by its own map, which has the row");
});

// The guard above, proven: this file run again with GIT_DIR naming a decoy repository leaves the decoy
// exactly as it was (its refs, HEAD and config). The run inside skips this test.
test("its throwaway repos never touch a repository a hook's GIT_DIR names", { skip: process.env.REDCELL_DECOY_CHILD === "1" && "the run inside" }, () => {
  const decoy = mkdtempSync(join(tmpdir(), "decoy-"));
  const d = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-C", decoy, ...a], { encoding: "utf8" }).trim();
  d("init", "-q", "-b", "main");
  writeFileSync(join(decoy, "keep.txt"), "the decoy\n");
  d("add", "keep.txt");
  d("commit", "-qm", "decoy");
  const state = () => [d("for-each-ref"), d("rev-parse", "HEAD"), d("symbolic-ref", "HEAD"), d("config", "--list", "--local")].join("\n");
  const before = state();
  // NODE_TEST_CONTEXT marks a test runner's own child; a nested run that keeps it runs nothing.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const run = spawnSync(process.execPath, ["--test", fileURLToPath(import.meta.url)], {
    encoding: "utf8",
    env: { ...env, GIT_DIR: join(decoy, ".git"), REDCELL_DECOY_CHILD: "1" },
  });
  assert.match(run.stdout || "", /# pass [1-9]/, "the run inside ran its tests:\n" + (run.stdout || "").slice(-1000));
  assert.equal(state(), before, "the decoy repository changed:\n" + (run.stdout || "").slice(-2000));
  rmSync(decoy, { recursive: true, force: true });
});
