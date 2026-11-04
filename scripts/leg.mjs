#!/usr/bin/env node
// A leg's measurements (bookends mode, jg 2026-10-23): wall-clock from the owner's `go` to deployed,
// the weekly usage % before and after, owner interventions during it, escapes found after it ended.
//
//   node leg.mjs start  <repo root> <label>        the owner said go
//   node leg.mjs note   <repo root> intervention|escape <what>
//   node leg.mjs end    <repo root>                 deployed (or the leg's own finish line)
//   node leg.mjs report <repo root>                 one line per leg
//
// Rows go to <git common dir>/harteburn/legs.jsonl. An intervention is noted while a leg is open; an
// escape (a defect found after "done") is noted after it ended and counts against the last ended leg.
// Usage comes from ~/.claude.json `cachedUsageUtilization` (Claude Code's own cached read; it may lag).

import { readFileSync, appendFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { stateDir } from "./paths.mjs";

/** Weekly and five-hour usage %, from Claude Code's cached read, or nulls. */
export function usage(home = homedir()) {
  try {
    const u = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).cachedUsageUtilization || {};
    const util = u.utilization || {};
    return { week_pct: util.seven_day?.utilization ?? null, five_hour_pct: util.five_hour?.utilization ?? null, usage_read_at: u.fetchedAtMs ? new Date(u.fetchedAtMs).toISOString() : null };
  } catch {
    return { week_pct: null, five_hour_pct: null, usage_read_at: null };
  }
}

export function legsFile(root) {
  let dir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
  if (!isAbsolute(dir)) dir = join(root, dir);
  mkdirSync(stateDir(dir), { recursive: true });
  return join(stateDir(dir), "legs.jsonl");
}

export function readRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Each leg, from the rows in order: its start, end, interventions and escapes. */
export function legs(rows) {
  const out = [];
  for (const r of rows) {
    const open = out.length && !out[out.length - 1].end ? out[out.length - 1] : null;
    if (r.event === "start") out.push({ label: r.label, start: r, end: null, interventions: [], escapes: [] });
    else if (r.event === "end" && open) open.end = r;
    else if (r.event === "note") {
      if (r.kind === "intervention" && open) open.interventions.push(r.what);
      else if (r.kind === "escape") {
        const ended = [...out].reverse().find((l) => l.end);
        if (ended) ended.escapes.push(r.what);
      }
    }
  }
  return out;
}

export function describe(leg) {
  const mins = leg.end ? Math.round((Date.parse(leg.end.ts) - Date.parse(leg.start.ts)) / 60000) : null;
  const a = leg.start.week_pct, b = leg.end?.week_pct;
  const week = a != null && b != null ? `week ${a}% → ${b}% (${b - a >= 0 ? "+" : ""}${b - a})`
    : a != null && !leg.end ? `week from ${a}%` : "week usage unread";
  return `${leg.label}: ${mins == null ? "open" : `${mins} min`} · ${week} · ${leg.interventions.length} owner interventions · ${leg.escapes.length} escapes`;
}

function main(argv) {
  const [cmd, root, ...rest] = argv;
  if (!["start", "note", "end", "report"].includes(cmd) || !root) {
    console.error("usage: leg.mjs start <root> <label> | note <root> intervention|escape <what> | end <root> | report <root>");
    return 2;
  }
  const file = legsFile(root);
  const all = legs(readRows(file));
  const open = all.length && !all[all.length - 1].end ? all[all.length - 1] : null;
  const ts = new Date().toISOString();
  if (cmd === "start") {
    if (open) { console.error(`leg "${open.label}" is still open; end it first`); return 1; }
    const label = rest.join(" ").trim();
    if (!label) { console.error("start needs a label"); return 2; }
    appendFileSync(file, JSON.stringify({ event: "start", ts, label, ...usage() }) + "\n");
  } else if (cmd === "note") {
    const [kind, ...what] = rest;
    if (!["intervention", "escape"].includes(kind) || !what.length) { console.error("note takes intervention|escape and what happened"); return 2; }
    if (kind === "intervention" && !open) { console.error("no open leg: an intervention belongs to one"); return 1; }
    if (kind === "escape" && !all.some((l) => l.end)) { console.error("no ended leg: an escape is found after one ends"); return 1; }
    appendFileSync(file, JSON.stringify({ event: "note", ts, kind, what: what.join(" ") }) + "\n");
  } else if (cmd === "end") {
    if (!open) { console.error("no open leg"); return 1; }
    appendFileSync(file, JSON.stringify({ event: "end", ts, ...usage() }) + "\n");
  }
  for (const l of legs(readRows(file)).slice(cmd === "report" ? 0 : -1)) console.log(describe(l));
  return 0;
}

// Real paths on both sides (tests/main-guard: a symlinked temp folder or Windows path never matched).
function startedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (process.argv[1] && startedDirectly()) process.exit(main(process.argv.slice(2)));
