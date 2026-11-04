#!/usr/bin/env node
// Reads CI for the commit a release just deployed, and puts a red job on the owner's list the same
// session (retro 2026-10-25, connector-cloud KIT-001, jg ratified Change 2): CI's docker job on
// main was red at every v0.60.x release and on 4 runs before, the cause was written down as "the
// owner's" on 10-21, and jg was asked only when /done blocked on 10-25.
//
//   node ci-after-release.mjs <repo root> <released commit> [--runs <file.json>]
//
// For each failed job of the commit's CI runs (`gh run list --commit`, then the run's jobs) it adds
// to `.harteburn/board.json`: a found item that waits on the owner (`owner_act`), and a Yours line
// with both sides. The same job red at the release before (from <git dir>/harteburn/ci-releases.jsonl)
// makes the item say so and ask for Product's triage. Then run board-md.mjs as usual.
// --runs reads `[{name, conclusion, status, jobs: [{name, conclusion}]}]` from a file (tests).
// Exit 0: all green, or the red ones are on the board · 2: a run is still going (read again later).

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { boardDir, stateDir } from "./paths.mjs";

/** Failed jobs of a commit's runs, as "<workflow> / <job>". */
export const failedJobs = (runs) => runs.flatMap((r) => (r.jobs || []).filter((j) => j.conclusion === "failure").map((j) => `${r.name} / ${j.name}`));

/** Adds each failed job to the record; `previous` is the failed list at the release before. */
export function addToBoard(rec, sha, failed, previous, today) {
  const short = sha.slice(0, 8);
  const added = [];
  for (const job of failed) {
    const act = `CI ${job} red at ${short}`;
    if ((rec.items || []).some((i) => i.owner_act === act)) continue;
    const again = previous.includes(job);
    rec.items = [...(rec.items || []), {
      beat: "build", kind: "found", state: "todo", owner_act: act,
      text: `Found: CI ${job} red after the release of ${short}${again ? " — red at 2 releases in a row: Product triage" : ""}`,
    }];
    rec.yours = [...(rec.yours || []), `${act}: fix it now (priced, e.g. "mirror the base images, ~30 min") or accept it and re-run (e.g. "a registry's rate limit, re-run after 1 h"), by ${today}`];
    added.push(job);
  }
  return added;
}

function main() {
  const args = process.argv.slice(2);
  const [root, sha] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--runs");
  if (!root || !sha) {
    console.error("usage: ci-after-release.mjs <repo root> <released commit> [--runs <file.json>]");
    process.exit(1);
  }
  const git = (a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  const full = git(["rev-parse", sha]);
  let runs;
  if (args.includes("--runs")) runs = JSON.parse(readFileSync(args[args.indexOf("--runs") + 1], "utf8"));
  else {
    const list = JSON.parse(execFileSync("gh", ["run", "list", "--commit", full, "--json", "databaseId,name,status,conclusion"], { cwd: root, encoding: "utf8" }));
    runs = list.map((r) => ({ ...r, jobs: JSON.parse(execFileSync("gh", ["run", "view", String(r.databaseId), "--json", "jobs"], { cwd: root, encoding: "utf8" })).jobs }));
  }
  if (!runs.length) {
    console.log(`no CI run for ${full.slice(0, 8)} yet: read again once it starts`);
    process.exit(2);
  }
  const going = runs.filter((r) => r.status && r.status !== "completed");
  const failed = failedJobs(runs);
  if (going.length && !failed.length) {
    console.log(`CI for ${full.slice(0, 8)} still running (${going.map((r) => r.name).join(", ")}): read again when it ends`);
    process.exit(2);
  }
  let gitDir = git(["rev-parse", "--git-common-dir"]);
  if (!isAbsolute(gitDir)) gitDir = join(root, gitDir);
  const hist = join(stateDir(gitDir), "ci-releases.jsonl");
  const rows = existsSync(hist) ? readFileSync(hist, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.sha !== full) : [];
  const previous = rows.at(-1)?.failed || [];
  mkdirSync(stateDir(gitDir), { recursive: true });
  if (!going.length) appendFileSync(hist, JSON.stringify({ sha: full, at: new Date().toISOString(), failed }) + "\n");
  if (!failed.length) {
    console.log(`CI green for ${full.slice(0, 8)}: ${runs.map((r) => r.name).join(", ")}`);
    return;
  }
  const f = join(boardDir(root), "board.json");
  const rec = JSON.parse(readFileSync(f, "utf8"));
  const added = addToBoard(rec, full, failed, previous, new Date().toISOString().slice(0, 10));
  if (added.length) writeFileSync(f, JSON.stringify(rec, null, 2) + "\n");
  console.log(`CI red for ${full.slice(0, 8)}: ${failed.join(", ")} — ${added.length ? "on the board (found + Yours); run board-md.mjs" : "already on the board"}`);
}

const self = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (self()) main();
