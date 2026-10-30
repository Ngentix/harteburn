#!/usr/bin/env node
// The steward's proposals (rc-disk piece 2, jg 2026-10-28): what under <git dir>/harteburn is past its
// objective, with its size, and what is only listed. It removes nothing; the owner is asked first.
//
//   node scripts/steward.mjs <repo> --dry-run   one line per proposal and per listed entry, then a total
//   node scripts/steward.mjs <repo> --stamp     the sweep's result into harteburn/steward.last, and one line
//                                               of harteburn/steward.jsonl; silent, always exits 0
//   --with-script                               first runs the repo's own scripts/disk-sweep.sh --steward
//   --free-before <bytes>                       the caller ran that script, with this much free before it
//   --touched                                   another repo this objective changed: never its script, never
//                                               git status there (its worktrees are listed, not checked)
//   --answer <kind> <yes|no|always-here|always-everywhere|ask-again> [--here-only]
//                                               the owner's answer to the ask (rc-disk piece 6, jg 2026-10-28)
//   --since <iso>                               another repo's objective changed this one from then: nothing
//                                               newer is proposed
//
// "Past": older than the oldest open record (this repo's and each worktree's open-record.json); with no
// open record, untouched for 24 h. Links are never followed. A worktree with unsaved work is only listed.

import { execFileSync } from "node:child_process";
import { accessSync, appendFileSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classify } from "./retention.mjs";

const DAY = 24 * 3600e3;
/** A number from the environment, or NaN when unset or empty (an empty setting is not 0). */
const envNum = (name) => (process.env[name] ? Number(process.env[name]) : NaN);
const SELF = fileURLToPath(import.meta.url);
// Another repo's config never runs code here (security review of 0.22.5): no fsmonitor, no hooks.
const SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
const git = (cwd, ...a) => execFileSync("git", [...SAFE, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (cwd, ...a) => { try { return git(cwd, ...a); } catch { return null; } };
// git prints real paths (checked 2026-10-28); real() on both sides still guards a link in the path.
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/** Size on disk of a path, never following a link; for a directory, its total, file count, a sample and
 * its newest file's time (a folder is past only when everything in it is). */
function measure(p) {
  let bytes = 0, files = 0, newest = 0;
  const sample = [];
  const walk = (q, top) => {
    const s = lstatSync(q);
    bytes += s.blocks * 512;
    if (!s.isDirectory()) {
      files++;
      newest = Math.max(newest, s.mtimeMs);
      if (sample.length < 3 && !top) sample.push(q.slice(p.length + 1));
      return;
    }
    for (const n of readdirSync(q).sort()) walk(join(q, n), false);
  };
  walk(p, true);
  return { bytes, files, sample, newest };
}

/** Each worktree but the main one (`all`: the main one first too): its real path, whether detached. */
function worktrees(root, { all = false } = {}) {
  const out = [];
  let cur = null;
  for (const l of (tryGit(root, "worktree", "list", "--porcelain") || "").split("\n")) {
    if (l.startsWith("worktree ")) out.push((cur = { path: real(l.slice(9)), detached: false }));
    else if (l === "detached" && cur) cur.detached = true;
  }
  return all ? out : out.slice(1);
}

/** Why a worktree must not be removed, or "" when it is clean and on its remote. */
function unsaved(wt, detached) {
  if (tryGit(wt, "status", "--porcelain")) return "uncommitted";
  if (detached) return tryGit(wt, "branch", "-r", "--contains", "HEAD") ? "" : "unpushed";
  if (tryGit(wt, "rev-parse", "--abbrev-ref", "@{u}") == null) return "no upstream";
  return Number(tryGit(wt, "rev-list", "--count", "@{u}..HEAD") || 0) > 0 ? "unpushed" : "";
}

/** The oldest open record's time across the common dir and every worktree's git dir, or null. */
function oldestOpen(common) {
  const files = [join(common, "redcell", "open-record.json")];
  const wd = join(common, "worktrees");
  if (existsSync(wd)) for (const n of readdirSync(wd)) files.push(join(wd, n, "redcell", "open-record.json"));
  const ats = files.flatMap((f) => {
    try { return [Date.parse(JSON.parse(readFileSync(f, "utf8")).at)]; } catch { return []; }
  }).filter(Number.isFinite);
  return ats.length ? Math.min(...ats) : null;
}

// ── The build-output trim (rc-disk piece 5): under SWEEP_BELOW_GB free, a Rust repo with no
// scripts/disk-sweep.sh of its own is asked about its target/; a yes runs `cargo sweep --maxsize`, which
// removes the oldest build pieces only (never cargo clean, never rm). Assumes no tool is installed.
export const SWEEP_BELOW_GB = 40;
export const TRIM_CAP_GB = 20;
const freeGb = (root) => Math.round(freeBytes(root) / 1e8) / 10;
const sweepInstalled = () => {
  try { execFileSync("cargo", ["sweep", "--version"], { stdio: "ignore", timeout: 20000 }); return true; } catch { return false; }
};
/** Whether a trim is due here (`due`), and if so whether cargo-sweep can do it, the top and target's size. */
function buildState(root, { touched = false } = {}) {
  const none = { due: false };
  if (touched) return none;
  const top = real(tryGit(root, "rev-parse", "--show-toplevel") || "");
  const main = worktrees(root, { all: true })[0]?.path;
  if (!top || top !== main) return none; // never inside a worktree, the warm Prover's among them
  if (!existsSync(join(top, "Cargo.toml")) || repoScript(root)) return none;
  const target = join(top, "target");
  try { if (!lstatSync(target).isDirectory()) return none; } catch { return none; }
  const below = envNum("REDCELL_SWEEP_BELOW_GB");
  if (!(freeGb(root) < (Number.isFinite(below) ? below : SWEEP_BELOW_GB))) return none;
  if (!sweepInstalled()) return { due: true, installed: false };
  return { due: true, installed: true, top, bytes: measure(target).bytes };
}

/** { items, listed } for the repo holding `root`. Removes nothing. */
export function proposals(root, { now = Date.now(), since = null, touched = false } = {}) {
  const items = [], listed = [];
  const g = tryGit(root, "rev-parse", "--git-common-dir");
  if (!g) return { items, listed };
  const common = real(isAbsolute(g) ? g : resolve(root, g));
  const rc = join(common, "redcell");
  if (!existsSync(rc)) return { items, listed };
  // `since`: the start of another repo's objective that changed this one; the older cutoff wins.
  const own = oldestOpen(common) ?? now - DAY;
  const s = Date.parse(since);
  const cutoff = Number.isFinite(s) ? Math.min(own, s) : own;
  const wts = new Map(worktrees(root).map((w) => [w.path, w]));

  for (const [path] of wts) if (!path.startsWith(rc + "/")) listed.push({ name: path, kind: "worktree", reason: "not HarteBurn's", bytes: null });

  for (const name of readdirSync(rc).sort()) {
    const p = join(rc, name);
    const s = lstatSync(p);
    const link = s.isSymbolicLink();
    const wt = !link && s.isDirectory() ? wts.get(real(p)) : undefined;
    const kind = classify(name, { dir: s.isDirectory(), worktree: !!wt, link });
    if (kind === "keep") continue;
    if (kind === "link") { listed.push({ name, kind, reason: "link", bytes: s.blocks * 512 }); continue; }
    if (s.mtimeMs >= cutoff) continue;
    const m = measure(p);
    if (kind === "dir" && m.newest >= cutoff) continue; // a worktree's edits are caught by unsaved()
    if (kind === "worktree") {
      // In another repo no git status runs: a filter driver there would (security review of 0.22.6).
      const why = touched ? "other repo: not checked" : unsaved(p, wt.detached);
      if (why) { listed.push({ name, kind, reason: why, bytes: m.bytes }); continue; }
      items.push({ name, kind, bytes: m.bytes });
    } else if (kind === "dir") items.push({ name, kind, bytes: m.bytes, files: m.files, sample: m.sample });
    else items.push({ name, kind, bytes: m.bytes });
  }
  const b = buildState(root, { touched });
  if (b.installed) items.push({ name: "target", kind: "build", bytes: b.bytes });
  return { items, listed };
}

/** The repo's own executable scripts/disk-sweep.sh, or "". */
export function repoScript(root) {
  const top = tryGit(root, "rev-parse", "--show-toplevel");
  if (!top) return "";
  const p = join(top, "scripts", "disk-sweep.sh");
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile() ? p : "";
  } catch {
    return "";
  }
}

const freeBytes = (root) => { const f = statfsSync(root); return f.bavail * f.bsize; };

/** Sweep and record the result: steward.last (the latest) and one line of steward.jsonl (every sweep).
 * The repo's own script runs first (`withScript`, or the hook ran it and passes `freeBefore`), so
 * removed_bytes is what it freed and the proposals are read after it. Throws nothing. */
export function stamp(root, { withScript = false, freeBefore = null, trimmed = false, since = null, touched = false, now = Date.now() } = {}) {
  try {
    const g = tryGit(root, "rev-parse", "--git-common-dir");
    if (!g) return null;
    const rc = join(real(isAbsolute(g) ? g : resolve(root, g)), "redcell");
    const script = repoScript(root);
    if (withScript && script && !touched) {
      freeBefore = freeBytes(root);
      trimmed = true;
      try { execFileSync(script, ["--steward"], { cwd: dirname(dirname(script)), stdio: "ignore", timeout: 120000, killSignal: "SIGKILL" }); } catch {}
    }
    const belowEnv = envNum("REDCELL_SWEEP_BELOW_GB");
    const attempted = !!trimmed && freeBefore != null && freeBefore / 1e9 < (Number.isFinite(belowEnv) ? belowEnv : SWEEP_BELOW_GB);
    const always = alwaysKinds(rc);
    const everywhere = kindsIn(everywhereFile());
    const ran = {};
    for (const k of always) {
      const bytes = removeKind(root, rc, k, { touched, since, now });
      if (bytes > 0) ran[k] = { bytes, where: everywhere.includes(k) ? "every repo" : "this repo" };
    }
    const { items, listed } = proposals(root, { now, since, touched });
    const free = freeBytes(root);
    const result = {
      at: new Date(now).toISOString(),
      free_gb: Math.round(free / 1e8) / 10,
      proposed_bytes: items.reduce((a, i) => a + i.bytes, 0),
      proposed: items.length,
      listed: listed.length,
      // Only what the steward itself removed (Done review: free space after less before counted other
      // writers on the disk as removed).
      removed_bytes: Object.values(ran).reduce((a, r) => a + r.bytes, 0),
      repo_script: !!script,
      // The repo's own script trims only under the threshold; above it, its run is no trim attempt.
      trim_attempted: attempted,
      // Free space after the repo's script less before: other writers make it approximate.
      script_freed_approx: attempted && freeBefore != null ? Math.max(0, free - freeBefore) : 0,
    };
    if (Object.keys(ran).length) result.always = ran;
    const b = buildState(root, { touched });
    if (b.due && !b.installed) result.trim_skipped = "cargo-sweep not installed";
    mkdirSync(rc, { recursive: true });
    writeFileSync(join(rc, "steward.last"), JSON.stringify(result) + "\n");
    appendFileSync(join(rc, "steward.jsonl"), JSON.stringify(result) + "\n");
    writeAsk(rc, items, always);
    return result;
  } catch {
    return null;
  }
}

// ── The ask (rc-disk piece 6, jg 2026-10-28: "rather than doing it automatically, the steward should ASK,
// with the option to change it to 'always do it' on each ask"). Nothing is removed without an answer.
export const ASK_KINDS = ["scratch", "dir", "worktree", "build"];
const rcOf = (root) => {
  const g = tryGit(root, "rev-parse", "--git-common-dir");
  return g ? join(real(isAbsolute(g) ? g : resolve(root, g)), "redcell") : "";
};
/** The every-repo answers file: $REDCELL_HOME, else ~/.claude/redcell. */
export const everywhereFile = () => join(process.env.REDCELL_HOME || join(homedir(), ".claude", "redcell"), "steward-always.json");
const readJson = (f, dflt) => { try { return JSON.parse(readFileSync(f, "utf8")) ?? dflt; } catch { return dflt; } };
const kindsIn = (f) => { const k = readJson(f, {})?.kinds; return Array.isArray(k) ? k.filter((x) => ASK_KINDS.includes(x)) : []; };
const writeKinds = (f, kinds) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ kinds: [...new Set(kinds)].sort() }) + "\n"); };
/** The kinds on always for this repo: its own answers and the every-repo ones. */
export const alwaysKinds = (rc) => [...new Set([...kindsIn(join(rc, "steward-always.json")), ...kindsIn(everywhereFile())])];

/** Remove this kind's current proposals, read fresh now: a stale ask or a hand-edited file never names
 * what goes. A worktree goes through `git worktree remove` (which refuses unsaved work); a link never. */
function removeKind(root, rc, kind, { touched = false, since = null, now = Date.now() } = {}) {
  let freed = 0;
  for (const i of proposals(root, { touched, since, now }).items) {
    if (i.kind !== kind) continue;
    if (kind === "build") {
      const top = real(tryGit(root, "rev-parse", "--show-toplevel") || "");
      const cap = envNum("REDCELL_TRIM_CAP_GB") || TRIM_CAP_GB;
      try {
        execFileSync("cargo", ["sweep", "--maxsize", `${cap}GB`, top], { cwd: top, stdio: "ignore", timeout: 600000 });
        freed += Math.max(0, i.bytes - measure(join(top, "target")).bytes);
      } catch {}
      continue;
    }
    const p = join(rc, i.name);
    try {
      if (lstatSync(p).isSymbolicLink()) continue;
      if (kind === "worktree") git(root, "worktree", "remove", p);
      else rmSync(p, { recursive: kind === "dir", force: false });
      freed += i.bytes;
    } catch {}
  }
  return freed;
}

/** What is pending for the owner: each kind not on always with an item not already declined. */
function writeAsk(rc, items, always) {
  const f = join(rc, "steward-ask.json");
  const prev = readJson(f, {});
  const declined = prev && typeof prev.declined === "object" ? prev.declined : {};
  const kinds = {};
  for (const k of ASK_KINDS) {
    if (always.includes(k)) continue;
    const mine = items.filter((i) => i.kind === k);
    if (!mine.length || mine.every((i) => (declined[k] || []).includes(i.name))) continue;
    kinds[k] = { count: mine.length, bytes: mine.reduce((a, i) => a + i.bytes, 0), sample: mine.slice(0, 3).map((i) => i.name) };
  }
  writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), kinds, declined }) + "\n");
}

/** The owner's answer for one kind. Returns the line to print. */
export function answer(root, kind, reply, { everywhere = false } = {}) {
  const rc = rcOf(root);
  if (!rc || !ASK_KINDS.includes(kind)) return `steward: no such kind "${kind}" (${ASK_KINDS.join(", ")})`;
  mkdirSync(rc, { recursive: true });
  const here = join(rc, "steward-always.json");
  const askFile = join(rc, "steward-ask.json");
  const ask = readJson(askFile, {}) || {};
  ask.kinds = ask.kinds || {};
  ask.declined = ask.declined || {};
  let freed = 0, did = "";
  if (reply === "no") {
    ask.declined[kind] = proposals(root).items.filter((i) => i.kind === kind).map((i) => i.name);
    did = "kept, not asked again until a new one appears";
  } else if (reply === "ask-again") {
    // Off always wherever it was set: the owner asked to be asked (Prover, piece 6: an every-repo always
    // stayed on). --here-only leaves the every-repo answer for other repos.
    const files = everywhere === "here-only" ? [here] : [here, everywhereFile()];
    for (const f of files) if (kindsIn(f).includes(kind)) writeKinds(f, kindsIn(f).filter((k) => k !== kind));
    did = everywhere === "here-only" && kindsIn(everywhereFile()).includes(kind)
      ? "off always here, but still on always in every repo, so it still runs here (ask-again without --here-only to stop it)"
      : `off always${everywhere === "here-only" ? " here" : ""}; asked again from now`;
  } else if (["yes", "always-here", "always-everywhere"].includes(reply)) {
    if (reply === "always-here") writeKinds(here, [...kindsIn(here), kind]);
    if (reply === "always-everywhere") writeKinds(everywhereFile(), [...kindsIn(everywhereFile()), kind]);
    freed = removeKind(root, rc, kind);
    delete ask.declined[kind];
    did = `removed ${human(freed)}${reply === "yes" ? "" : `, and always ${reply === "always-here" ? "here" : "in every repo"} from now`}`;
  } else return `steward: answer yes, no, always-here, always-everywhere or ask-again`;
  if (reply !== "ask-again") delete ask.kinds[kind];
  writeFileSync(askFile, JSON.stringify({ at: ask.at || new Date().toISOString(), kinds: ask.kinds, declined: ask.declined }) + "\n");
  return `steward: ${kind}: ${did}`;
}

/** The reminder's lines: what is asked, and what ran under always at the last sweep. */
export function reminderLines(root) {
  const rc = rcOf(root);
  if (!rc) return "";
  const out = [];
  const kinds = readJson(join(rc, "steward-ask.json"), {})?.kinds || {};
  // Plain words, singular for one (Done review: "dir: 1 old folders").
  const WORD = { scratch: ["old scratch file", "old scratch files"], dir: ["old scratch folder", "old scratch folders"], worktree: ["old worktree", "old worktrees"], build: ["build output, trimmed to its newest pieces", "build outputs"] };
  const asked = ASK_KINDS.filter((k) => kinds[k]?.count > 0).map((k) => {
    const eg = (kinds[k].sample || []).filter((n) => typeof n === "string").slice(0, 2).join(", ");
    return `${k}: ${kinds[k].count} ${WORD[k][kinds[k].count === 1 ? 0 : 1]} (${human(kinds[k].bytes || 0)}${eg ? `, e.g. ${eg}` : ""})`;
  });
  const top = tryGit(root, "rev-parse", "--show-toplevel") || root;
  if (asked.length) out.push(`Steward: ${asked.join("; ")} are past their objective. Ask the owner about each: yes, no, always here (this repo), or always in every repo (then: node "${SELF}" "${top}" --answer <kind> <yes|no|always-here|always-everywhere>).`);
  const last = readJson(join(rc, "steward.last"), {}) || {};
  const below = envNum("REDCELL_SWEEP_BELOW_GB");
  if (last.trim_skipped === "cargo-sweep not installed") out.push(`Steward: free space is under ${Number.isFinite(below) ? below : SWEEP_BELOW_GB} GB and this repo's build output could be trimmed, but cargo-sweep is not installed; to let it: cargo install cargo-sweep.`);
  const ran = last.always || {};
  const done = Object.keys(ran).filter((k) => ran[k]?.bytes > 0);
  if (done.length) out.push(`Steward removed under always: ${done.map((k) => `${k} (always in ${ran[k].where}) ${human(ran[k].bytes)}`).join(", ")}. Tell the owner, who can say ${done.map((k) => `'ask again: ${k}'`).join(" or ")} (--answer ${done[0]} ask-again).`);
  return out.join(" ");
}

export const human = (b) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${i ? b.toFixed(1) : b} ${u[i]}`;
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const root = process.argv.slice(2).find((a) => !a.startsWith("--")) || process.cwd();
  const ai = process.argv.indexOf("--answer");
  if (ai > 0) {
    const at = process.argv.slice(2, ai).find((a) => !a.startsWith("--")) || process.cwd();
    console.log(answer(at, process.argv[ai + 1], process.argv[ai + 2], { everywhere: process.argv.includes("--here-only") ? "here-only" : process.argv.includes("--everywhere") }));
    process.exit(0);
  }
  if (process.argv.includes("--stamp")) {
    const fb = process.argv.indexOf("--free-before");
    const si = process.argv.indexOf("--since");
    stamp(root, { withScript: process.argv.includes("--with-script"), freeBefore: fb > 0 ? Number(process.argv[fb + 1]) : null, trimmed: fb > 0, since: si > 0 ? process.argv[si + 1] : null, touched: process.argv.includes("--touched") });
    process.exit(0);
  }
  const { items, listed } = proposals(root, { touched: process.argv.includes("--touched") });
  for (const i of items) console.log(`propose  ${i.kind.padEnd(8)} ${i.name}  ${human(i.bytes)}${i.sample ? `  (${i.files} files: ${i.sample.join(", ")})` : ""}`);
  for (const l of listed) console.log(`list     ${l.kind.padEnd(8)} ${l.name}  ${l.bytes == null ? "size not measured" : human(l.bytes)}  ${l.reason}`);
  console.log(`total proposed: ${human(items.reduce((a, i) => a + i.bytes, 0))} in ${items.length}; listed only: ${listed.length}`);
}
