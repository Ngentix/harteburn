#!/usr/bin/env node
// The board in the IDE: renders the current objective's record (.harteburn/board.json, the same
// record the claude.ai board page shows) as .harteburn/board.md, which VS Code keeps open as a live
// Markdown preview (the session hook opens it; workspace setting maps it to the preview editor).
//
//   node scripts/board-md.mjs [<repo root>]     reads <root>/.harteburn/board.json, writes board.md
//
// The board is the Done checklist (jg 2026-10-19: "open items on top; the frame is the checklist
// that defines Done, not a log of work done"). On every run, finished work items (done, dropped)
// leave board.json for an append-only log, <git dir>/harteburn/log-<id>.jsonl, one JSON object per
// line, read by /retro. Each item is logged once (by its id). Earlier spellings are rewritten in
// place (scripts/board-schema.mjs), and anything the schema doesn't know is named at the top.
//
// One record, two views: the Tech Lead writes board.json, runs this, and sends the same file to the
// board page (ArtifactData set, file_path). It REFUSES a record it cannot show truly (retro 2026-10-21,
// jg ratified): every problem is listed at the board's top and on stderr, and the script exits 1, so
// the Tech Lead's own command fails until the record is put right. An unreadable record still writes
// a one-line note. The record's runs come from the dispatch ledger (board-schema.mjs runsFromLedger).

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join, isAbsolute, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { BEATS, STATE_WORD, OPEN, FINISHED, normalize, doneOrder, beatMinutes, currentTimebox, assignIds, slugOf, refusals, runsFromLedger, applyStamps, heldToRules, LIVE_RULES_FROM, deferredRegression, triageRefusals } from "./board-schema.mjs";
import { securityCheck, sessionFiles, headOf, SAFE, namedAccounts, isSecurity } from "./board-security.mjs";
import { seatGate } from "./seat-gate.mjs";
import { homeFlag } from "./login.mjs";
import { boardDir, stateDir } from "./paths.mjs";

const MARK = { done: "[x]", dropped: "[~]", doing: "[ ]", todo: "[ ]", blocked: "[!]" };
const BEAT_WORD = { done: "Done", todo: "To do", here: "Here", blocked: "Blocked", dropped: "Dropped" };
const KIND_LEAD = { found: "Found: ", mistake: "Our mistake: " };
/** A row's lead, unless its text already starts with it ("Found: Found:", RC-DESIGNER consult). */
const leadOf = (d) => {
  const lead = KIND_LEAD[d.kind] || "";
  return lead && String(d.text || "").toLowerCase().startsWith(lead.toLowerCase()) ? "" : lead;
};

const line = (d, prefix = "") => {
  const text = d.state === "dropped" ? `~~${d.text}~~` : d.text;
  const lead = leadOf(d);
  const tail = d.evidence ? ` — _${d.evidence}_` : d.note ? ` — _${d.note}_` : "";
  const proven = d.proven ? ` · proven: ${d.proven}` : "";
  return `- ${MARK[d.state] || "[ ]"} ${prefix}${lead}${text}${d.state === "doing" ? " ← here" : ""}${proven}${tail}`;
};

/**
 * A Done line with where its work stands (jg 2026-10-22: "a continuous indicator that the work has
 * been completed, but it just hasn't been tested in production"): ● done as its proof says ·
 * ◐ built, proven before production (`built`) · ○ not built yet.
 */
const STAGE = (d) => (d.state === "done" ? "●" : d.state === "dropped" ? "~" : d.built ? "◐" : "○");
const doneLine = (d) => {
  const text = d.state === "dropped" ? `~~${d.text}~~` : d.text;
  const lead = leadOf(d);
  const built = d.state !== "done" && d.built ? ` · built: ${d.built}` : "";
  const estimate = /^estimate\b/i.test(String(d.measured || "")) && d.state !== "done" ? " · ⚠ estimate" : "";
  const proven = d.proven ? ` · proven: ${d.proven}` : "";
  const tail = d.evidence ? ` — _${d.evidence}_` : d.note ? ` — _${d.note}_` : "";
  return `- ${STAGE(d)} ${lead}${text}${d.state === "doing" ? " ← here" : ""}${estimate}${built}${proven}${tail}`;
};

/** The numbered work list (jg 2026-10-22): ✅ done · ▶ doing · ⛔ blocked · ⬜ to do. */
const WORK_MARK = { done: "✅", doing: "▶", blocked: "⛔", todo: "⬜", dropped: "~~" };

/** A numbered piece: "3. text — check · used of timebox min · price N min", plus its go when added. */
const pieceLine = (p, frozen, now, security, signoff) => {
  const used = beatMinutes(p, now);
  const over = p.timebox && used > 2 * p.timebox ? " ⚠ over 2×" : p.timebox && used > p.timebox ? " over" : "";
  const added = typeof frozen === "number" && p.n > frozen ? ` · added after Slices: ${p.go || "⚠ no go"}` : "";
  const call = (p.owner_call ? ` · owner: ${p.owner_call}` : "") + (p.holds_back ? ` · holds back ${p.holds_back}` : "");
  // Design and screens on their own line, one screen per line: a reason with commas stays readable
  // and the piece's own line stays short (RC-DESIGNER consult, 2026-10-27).
  const link = String(p.mockup || "").replace(/(https?:\/\/\S+?)([.,;:)]*)(?=\s|$)/, "[mockup]($1)$2");
  const design = p.design ? [`  - design: ${p.design}${p.design === "full" ? ` · ${link || "⚠ no mockup"}` : ""}`] : [];
  const screens = Array.isArray(p.screens) ? p.screens.map((s) => `  - ${s?.name || "?"}: ${String(s?.fidelity || "").replace(/^does not ship/i, "**does not ship**") || "**⚠ no fidelity yet**"}`) : [];
  const note = p.note ? ` — _${p.note}_` : "";
  const sec = security ? [`  - ${security}`] : [];
  const signed = signoff ? [`  - ${signoff}`] : [];
  return [`- ${MARK[p.state] || "[ ]"} ${p.n}. ${p.state === "dropped" ? `~~${p.text}~~` : p.text}${p.state === "doing" ? " ← here" : ""} — check: ${p.check || "⚠ none"} · ${used} of ${p.timebox ?? "?"} min${over} · price ${p.price ?? "?"} min${added}${call}${note}`, ...design, ...screens, ...sec, ...signed].join("\n");
};

/**
 * @param o the record (normalized or not)
 * @param now the clock
 * @param extra { warnings: string[], notes: string[] (shown, never refused), security: { [n]: text },
 *   log: { path, count, found, mistakes } }
 */
export function boardMarkdown(o, now = Date.now(), extra = {}) {
  if (!o || !o.title) return "# HarteBurn board\n\nNo objective yet. `/frame` starts one.\n";
  const out = [];
  const mins = o.updated_at ? Math.round((now - Date.parse(o.updated_at)) / 60000) : null;
  const fresh = mins == null ? "" : mins > 10 && o.status === "open" ? ` · ⚠ **no update for ${mins} min**` : ` · updated ${mins < 1 ? "just now" : mins + " min ago"}`;
  out.push(`# ${o.title}`, "", `**${(o.status || "open").toUpperCase()}**${o.project ? ` · ${o.project}` : ""}${fresh}`, "");
  // An exempt record says so (Lead ruling, 2026-10-21): a new record back-dated before the rules
  // cannot be told from a real older one, so it is shown, never silent.
  if (!heldToRules(o)) out.push(`_Older record (opened ${String(o.opened_at).slice(0, 10)}): held only to the unknown-key and 12-row rules._`, "");
  if (extra.warnings?.length) {
    const n = extra.warnings.length;
    out.push(`⛔ **The board refuses this record: ${n} problem${n > 1 ? "s" : ""}. Put ${n > 1 ? "them" : "it"} right first.**`, ...extra.warnings.map((w) => `- ${w}`), "");
  }
  if (extra.notes?.length) out.push(...extra.notes.map((w) => `⚠ ${w}`), "");

  // The numbered work list leads with what remains, doing first; finished items go to the
  // board's foot (jg 2026-10-22: "I need to see the full list of what remains"). Each keeps its number.
  const work = (o.work || []).map((w, n) => ({ ...w, n: n + 1 }));
  const workLine = (w) => {
    const text = w.state === "dropped" ? `~~${w.text}~~` : w.text;
    return `${w.n}. ${WORK_MARK[w.state] || "⬜"} ${text}${w.state === "doing" ? " ← here" : ""}`;
  };
  const finished = work.filter((w) => w.state === "done" || w.state === "dropped");
  if (work.length) {
    const left = work.filter((w) => !finished.includes(w));
    const order = { doing: 0, blocked: 1 };
    left.sort((a, b) => (order[a.state] ?? 2) - (order[b.state] ?? 2) || a.n - b.n);
    out.push(`## Now — ${left.length} left (${finished.length} finished, at the foot)`);
    out.push(...(left.length ? left.map(workLine) : ["_Nothing left._"]), "");
  }

  // The Done checklist; open lines first, gates last.
  const dw = o.done_when || [];
  if (dw.length) {
    const finished = dw.filter((d) => d.kind !== "gate" && d.state === "done").length;
    const total = dw.filter((d) => d.kind !== "gate" && d.state !== "dropped").length;
    const built = dw.filter((d) => d.kind !== "gate" && d.state !== "done" && d.state !== "dropped" && d.built).length;
    out.push(`## Done when — ${finished} of ${total}${built ? ` · ${built} built, not yet in production` : ""}`);
    out.push("_● done · ◐ built, proven before production · ○ not built yet_");
    const ordered = doneOrder(dw);
    out.push(...ordered.filter((d) => d.kind !== "gate").map((d) => doneLine(d)));
    const gates = ordered.filter((d) => d.kind === "gate");
    if (gates.length) out.push("", "**Gates**", ...gates.map((d) => line(d)));
    out.push("");
  } else if (o.frame?.length) {
    out.push("**The objective in production terms**", ...o.frame.map((f) => `- ${f}`), "");
  }
  if (o.roles) out.push(`_${[].concat(o.roles).join(", ")}_`, "");

  // Retro 2026-10-21 (Change 2): the numbered pieces Slices froze, "piece n of N".
  // N counts every numbered piece, a dropped one too (it keeps its number), so "piece n of N" never
  // reads "3 of 2" after a cut (Prover, 2026-10-21).
  const pieces = o.pieces || [];
  if (pieces.length) {
    const cur = pieces.find((p) => p.state === "doing");
    const done = pieces.filter((p) => p.state === "done").length;
    const dropped = pieces.filter((p) => p.state === "dropped").length;
    const counts = [`${done} done`, dropped ? `${dropped} dropped` : ""].filter(Boolean).join(", ");
    out.push(`## Pieces — ${cur ? `piece ${cur.n} of ${pieces.length} (${counts})` : `${done} of ${pieces.length} done${dropped ? ` (${dropped} dropped)` : ""}`}`, ...pieces.map((p) => pieceLine(p, o.pieces_at_slices, now, extra.security?.[p.n], extra.signoff?.[p.n])), "");
  }

  if (o.yours?.length) out.push("## Yours", ...o.yours.map((y) => `- **${y}**`), "");

  const beats = Object.fromEntries((o.beats || []).map((b) => [b.key, b]));
  out.push("| Beat | State | Time |", "|---|---|---|");
  for (const [key, label, def] of BEATS) {
    const b = beats[key];
    if (key === "prd" && !b) continue;
    const box = b ? currentTimebox(b) : def;
    const used = beatMinutes(b || {}, now);
    const over = box && used > 2 * box ? " ⚠ over 2×" : box && used > box ? " over" : "";
    const st = b?.state || "todo";
    out.push(`| ${label} | ${st === "here" ? "← here" : BEAT_WORD[st] || STATE_WORD[st] || "To do"} | ${used} of ${box ?? "?"} min${over} |`);
  }
  out.push("");

  // A dropped regression of our own diff stays on the record (settle keeps it): it is still open work.
  const open = (o.items || []).filter((i) => !FINISHED.includes(i.state) || deferredRegression(i));
  if (open.length) {
    const label = Object.fromEntries(BEATS.map(([k, l]) => [k, l]));
    const rank = (i) => (OPEN.indexOf(i.state) + 4) % 4;
    out.push(`## Open work (${open.length})`);
    for (const i of open.map((x, n) => [x, n]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x)) {
      out.push(line(i, i.beat ? `[${label[i.beat] || i.beat}] ` : ""));
    }
    out.push("");
  }

  if (o.checkpoint) {
    const c = o.checkpoint;
    out.push("## Last checkpoint", `- On the objective: **${c.on_objective || "—"}**`, `- Waiting on: **${c.waiting || "—"}**`, `- Can ship now: **${c.can_ship || "—"}**`, "");
  }
  out.push(`## Scope changes (${(o.scope || []).length})`);
  if (o.scope?.length) {
    // Retro 2026-10-16/17 (R3): a scope change carries its price; an unpriced one says so.
    for (const s of [...o.scope].reverse()) out.push(`- **${s.change || "changed"}**: ${s.what} — ${[s.why, s.who, s.at].filter(Boolean).join(" · ")} · ${s.price ? `price: ${s.price}` : "⚠ **unpriced**"}`);
  } else out.push("_None yet._");
  out.push("");

  if (finished.length) {
    out.push(`## Finished work (${finished.length})`, ...finished.map(workLine), "");
  }

  // What the retro reads stays out of the summary: one line each.
  const log = extra.log;
  const count = log?.count ?? o.log_count;
  if (count != null) {
    const kinds = [log?.found ? `${log.found} found` : "", log?.mistakes ? `${log.mistakes} our own mistakes` : ""].filter(Boolean).join(", ");
    out.push(`_Log: ${count} finished item${count === 1 ? "" : "s"}${kinds ? ` (${kinds})` : ""}${log?.path ? ` in \`${log.path}\`` : ""}, read by /retro._`);
  }
  if (o.runs?.length || o.session_model) {
    const total = (o.runs || []).reduce((a, r) => a + (r.tokens || 0), 0);
    // Retro 2026-10-28 (Change 2): tokens against the objective's budget, so a usage limit is seen coming.
    const budget = Number(o.budget_tokens) > 0 ? Number(o.budget_tokens) : 0;
    const over = budget && total > budget;
    out.push(`_Agent runs: ${(o.runs || []).length}${total ? ` · ${Math.round(total / 1000)}k tokens` : ""}${budget ? ` of a ${Math.round(budget / 1000)}k budget${over ? " ⚠ over budget: narrow the next briefs, or the owner raises it" : ""}` : ""}${o.session_model ? ` · Tech Lead on ${o.session_model}` : ""} (each run is in the record; /retro reads them)._`);
  }
  out.push("");
  return out.join("\n");
}

/**
 * One open record per tree (Lead ruling, 2026-10-21): a pointer in the tree's own git dir (a
 * worktree's is its own) holds the open record's id. A different id while it is set is refused: a
 * changed id would start a fresh stamp store, and every N, clock and date with it. A render whose
 * status is not `open` clears the pointer. Returns the problems.
 */
export function openRecordPointer(root, rec) {
  let dir = "";
  try {
    const g = execFileSync("git", [...SAFE, "rev-parse", "--git-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    dir = stateDir(isAbsolute(g) ? g : join(root, g));
  } catch {
    return [];
  }
  const f = join(dir, "open-record.json");
  let open = null;
  try {
    open = JSON.parse(readFileSync(f, "utf8")).id;
  } catch {}
  if (!rec?.id) return [];
  if (open && open !== rec.id) return [`this tree's open record is "${open}", but board.json holds "${rec.id}": close "${open}" (status closed, one render) before framing another; a changed id restarts every stamp. If "${open}" was abandoned, delete ${f}`];
  if (rec.status === "open") {
    if (open !== rec.id) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(f, JSON.stringify({ id: rec.id, at: new Date().toISOString() }) + "\n");
    }
  } else if (open === rec.id) rmSync(f, { force: true });
  return [];
}

/** Where the log lives: the repo's git dir (never committed, like the ledger), else .harteburn/. */
export function logPath(root, rec) {
  let dir = boardDir(root);
  try {
    let g = execFileSync("git", [...SAFE, "rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (g) dir = stateDir(isAbsolute(g) ? g : join(root, g));
  } catch {}
  return join(dir, `log-${rec.id || slugOf(rec.title)}.jsonl`);
}

function readLog(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

/**
 * The record's step: normalize it, move finished items to the log (each once), and return what to
 * write back and render. A record that has never been through this (no `log_count`) is from before
 * the log, so its finished items carry no finish time (`ts: null`, `migrated: true`).
 * `persist(record)` is called with the record once every item has an id and before anything is
 * logged (the script writes board.json there), so a crash after the log never logs twice.
 * A log row keeps every key its item had, unknown ones too.
 */
export function settle(raw, file, now = new Date(), { persist, ledger, root, home } = {}) {
  const { record, warnings } = normalize(raw);
  // Retro 2026-10-25 (jg ratified Change 1): a fix is never a Done line, on an open record framed
  // before that rule too (KIT-001 met /done with 11 fixed defects among its 22 lines). Each found or
  // mistake row moves to items with its proof, once, on the record's next write.
  if (record.status !== "closed" && (record.done_when || []).some((d) => d.kind === "found" || d.kind === "mistake")) {
    const moved = record.done_when.filter((d) => d.kind === "found" || d.kind === "mistake");
    record.done_when = record.done_when.filter((d) => !moved.includes(d));
    record.items = [...(record.items || []), ...moved.map((d) => ({
      beat: "build", text: d.text, state: d.state, kind: d.kind,
      ...([d.evidence, d.proven, d.built].some(Boolean) && { note: [d.proven, d.evidence, d.built].filter(Boolean).join(" · ") }),
    }))];
    if (persist) persist(record);
  }
  if (assignIds(record) && persist) persist(record);
  // The board's own stamps, beside the log; only this script writes them (board-schema.mjs applyStamps).
  const stampsFile = join(dirname(file), `stamps-${record.id}.json`);
  let stamps = {};
  try {
    stamps = JSON.parse(readFileSync(stampsFile, "utf8"));
  } catch {}
  const was = JSON.stringify(stamps);
  let head = "";
  // Through the board's own git: a git that refuses its overrides leaves no head, and securityCheck
  // refuses every done piece on the same check (automated review of 8fcbec9).
  if (root) try { head = headOf(root); } catch {}
  // Hashed once per render; past the cap, an empty baseline is stamped, so every file counts as new.
  let local;
  if (head) local = sessionFiles(root);
  // When this record's Security runs were dispatched or ended: a parked piece judged while it ran keeps its start.
  const securityRuns = (ledger || []).filter((r) => r && isSecurity(r.role) && r.board === record.id).map((r) => String(r.ts ?? ""));
  const stamped = applyStamps(record, stamps, now, { head, local: local && (local.files || {}), securityRuns });
  // A Team license: the right seat's typed go, before Security reads the ledger (a builder's accept
  // must not clear a verdict). Cloud, and no license, leaves the ledger as it is.
  const seats = seatGate(root, record, stamps, ledger, { now: now.getTime(), ...(home && { home }) });
  // A done piece that changed a security-domain path needs a Security verdict (rc-security piece 3).
  const security = securityCheck(root, record, stamps, seats.ledger, { local });
  if (JSON.stringify(stamps) !== was) {
    mkdirSync(dirname(stampsFile), { recursive: true });
    writeFileSync(stampsFile, JSON.stringify(stamps, null, 1) + "\n");
  }
  runsFromLedger(record, ledger);
  const rows = readLog(file);
  const logged = new Map(rows.map((r) => [r.id, r]));
  const before = !("log_count" in (raw || {}));
  // An id already in the log is the same item only if every key matches the logged row (a crash
  // replayed it). Otherwise it is a copied line, or an item reopened and finished again: it gets a
  // new id, saved before it is logged, so it is never lost and a replay logs it once (Prover 2026-10-19).
  let renewed = 0;
  const same = (i, row) => Object.keys(i).every((k) => JSON.stringify(i[k]) === JSON.stringify(row[k]));
  for (const i of record.items || []) {
    const row = FINISHED.includes(i.state) && logged.get(i.id);
    if (row && !same(i, row)) { i.id = randomBytes(5).toString("hex"); renewed++; }
  }
  if (renewed && persist) persist(record);
  // A dropped regression of our own diff stays on the record, so its refusal stands until it is put back
  // (retro 2026-10-28, connector-cloud FEA-CC-456, Change 2): logged, it would leave unseen.
  const kept = (i) => String(stamps?.opened_at ?? record.opened_at ?? "").slice(0, 10) >= LIVE_RULES_FROM && deferredRegression(i);
  const moving = (record.items || []).filter((i) => FINISHED.includes(i.state) && !logged.has(i.id) && !kept(i));
  const fresh = moving.map((i) => ({ ts: before ? null : now.toISOString(), ...(before ? { migrated: true } : {}), ...i }));
  if (fresh.length) {
    mkdirSync(join(file, ".."), { recursive: true });
    appendFileSync(file, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  record.items = (record.items || []).filter((i) => !FINISHED.includes(i.state) || kept(i));
  const all = [...rows, ...fresh];
  record.log_count = all.length;
  // Product's triage list carries the regression column, and holds no regression of our own diff.
  const triageFile = root && join(root, "docs", "triage.md");
  const triage = triageFile && String(stamps?.opened_at ?? record.opened_at ?? "").slice(0, 10) >= LIVE_RULES_FROM && existsSync(triageFile)
    ? triageRefusals(readFileSync(triageFile, "utf8")) : [];
  return {
    record, warnings: [...warnings, ...stamped, ...refusals(record, now.getTime(), { stamps, ledger, accounts: root ? namedAccounts(root, record.id, ledger, { since: stamps?.opened_at ?? record.opened_at ?? "" }) : [] }), ...triage, ...seats.problems, ...security.problems],
    notes: security.notes, security: security.shown, signoff: seats.shown,
    log: { count: all.length, found: all.filter((r) => r.kind === "found").length, mistakes: all.filter((r) => r.kind === "mistake").length },
  };
}

// Compare paths: splitting argv[1] on "/" fails on Windows backslash paths, so the script
// silently wrote nothing there (#1).
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
if (process.argv[1] && startedDirectly()) {
  const root = process.argv[2] || process.cwd();
  const src = join(boardDir(root), "board.json");
  let md;
  let problems = [];
  try {
    const raw = existsSync(src) ? JSON.parse(readFileSync(src, "utf8")) : null;
    if (raw && typeof raw === "object" && Object.keys(raw).length && !raw.title) {
      // A record with keys but no title would render "No objective yet" in silence (Prover, 2026-10-21).
      problems = [`the record has no \`title\` (its keys: ${Object.keys(raw).slice(0, 8).join(", ")})`];
      md = `# HarteBurn board\n\n⛔ **The board refuses this record: 1 problem. Put it right first.**\n- ${problems[0]}\n`;
    } else if (!raw || !raw.title) md = boardMarkdown(raw);
    else {
      const save = (rec) => {
        const text = JSON.stringify(rec, null, 1) + "\n";
        if (text !== readFileSync(src, "utf8")) writeFileSync(src, text);
      };
      // One open record per tree, checked before anything is written: a refused rename must leave no
      // stamp store behind under its new id (Prover, 2026-10-21, round 4).
      const pointer = openRecordPointer(root, { ...raw, id: raw.id || slugOf(raw.title) });
      if (pointer.length) {
        const { record, warnings } = normalize(raw);
        problems = [...pointer, ...warnings];
        md = boardMarkdown(record, Date.now(), { warnings: problems });
      } else {
        const file = logPath(root, raw); // the record's id, else its title: what assignIds will save as its id
        const ledger = readLog(join(file, "..", "ledger.jsonl"));
        const { record, warnings, log, notes, security, signoff } = settle(raw, file, new Date(), { persist: save, ledger, root, home: homeFlag() });
        save(record);
        md = boardMarkdown(record, Date.now(), { warnings, notes, security, signoff, log: { ...log, path: relative(root, file) || file } });
        problems = warnings;
      }
    }
  } catch (e) {
    problems = [`the record could not be read: ${e.message}`];
    md = `# HarteBurn board\n\n⛔ **The board refuses this record: 1 problem. Put it right first.**\n- ${problems[0]}\n`;
  }
  writeFileSync(join(boardDir(root), "board.md"), md);
  if (problems.length) {
    process.stderr.write(`⛔ The board refuses .harteburn/board.json (${problems.length} problem${problems.length > 1 ? "s" : ""}):\n${problems.map((p) => `- ${p}\n`).join("")}`);
    process.exitCode = 1;
  }
  // The license folder is never the environment's (a project's settings can set it); tests pass --home.
  import("./login.mjs").then(({ homeFlag, licensePath }) => {
    const home = homeFlag();
    if (!existsSync(licensePath(home))) return;
    return import("./board-sync.mjs").then((m) => Promise.all([m.pushBoard(root, { home }), m.pushLedger(root, { home })]));
  }).catch(() => {});
}
