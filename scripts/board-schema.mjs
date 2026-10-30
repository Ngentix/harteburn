// The board record's one schema (jg 2026-10-19). The board is the objective's Done checklist,
// open lines first. Finished work leaves the record for an append-only log that the retro reads.
// board-md.mjs imports this file. templates/board/board.html keeps a copy of BEATS, STATE_WORD and
// the aliases, and tests/board.test.mjs holds the copy equal.
//
// Why a schema: before it, the record and its two views drifted, and every unknown value fell
// back to a default in silence (found 2026-10-19 on connector-cloud's board). The checkpoint's
// `waits_on`/`ship_now` were never shown. Items in states `open`/`here` lost their marks. Five
// items in beat `prd` never rendered. The page showed 0 minutes for every beat.

import { randomBytes } from "node:crypto";

/** [key, label, default timebox in minutes]. `prd` shows in the beat line only when the record has it. */
export const BEATS = [
  ["frame", "Frame", 10], ["ready", "Ready", 15], ["slices", "Slices", 5], ["prd", "PRD panel", null],
  ["build", "Build + prove", null], ["done", "Done review", 10], ["retro", "Retro", 10],
];
/** States of a Done line and of a work item. Open ones stay on the board; finished ones go to the log. */
export const STATE_WORD = { doing: "In progress", blocked: "Blocked", todo: "To do", done: "Done", dropped: "Dropped" };
export const OPEN = ["doing", "blocked", "todo"];
export const FINISHED = ["done", "dropped"];
/** A beat's states: `here` is the current beat. */
export const BEAT_STATES = ["todo", "here", "done", "blocked", "dropped"];
/** Earlier spellings, rewritten on the next render (the record is fixed in place, not only shown). */
export const STATE_ALIASES = { open: "todo", here: "doing" };
export const CHECKPOINT_ALIASES = { waits_on: "waiting", ship_now: "can_ship" };
/** A Done line's kind. An outcome (the default) is what Done means. `found` is a discovery the
 * spec never listed, `mistake` a defect our own change made, `gate` a gate (shown last). */
export const KINDS = ["outcome", "found", "mistake", "gate"];
export const STATUS = ["open", "done", "not done", "closed"];
export const PIECE_KINDS = ["feature", "prod-fix"];

export const KEYS = {
  record: ["id", "title", "project", "status", "opened_at", "closed_at", "updated_at", "done_when", "frame", "roles",
    "beats", "items", "pieces", "pieces_at_slices", "scope", "yours", "checkpoint", "runs", "session_model", "log_count", "work",
    // Retro 2026-10-28 (a 2026-10-28 product retro, ch ratified Change 2): the objective's token budget, set at Frame.
    "budget_tokens"],
  // `built`: where the work stands proven before production ("stub: kits_admin 17/17"), so the line
  // reads ◐ built, not yet in production, until its own proof makes it done (jg 2026-10-22).
  // `read_by` + `earliest` (retro 2026-10-23, jg ratified): who can read the line's proof
  // ("claude", or "owner" for a page Claude has no login to or a channel it can't read) and the
  // first time it can be read (24 h of runs can't exist on release day). `earliest` is optional, and
  // from WAITS_RULES_FROM it carries `waits_for`, what the proof waits on (jg 2026-10-27: every line
  // got a guessed future date, and RC-DESIGNER's five lines, all proven on release day, could not close).
  done_when: ["text", "state", "kind", "evidence", "proven", "built", "read_by", "earliest", "waits_for", "measured"],
  // The numbered work list the Tech Lead posts in chat, ticked as each lands (jg 2026-10-22).
  work: ["text", "state"],
  // `owner_act` (retro 2026-10-25, jg ratified Change 2): the act only the owner can do that this
  // item waits on ("grant CI read on the ghcr.io copies"); the board refuses it with no Yours line.
  item: ["id", "beat", "text", "state", "note", "kind", "owner_act"],
  // `kind` "prod-fix": a production fix, its own piece, released at once, never riding a feature
  // piece. `replans`: [{at: "<who> <YYYY-MM-DD>", price, why, text?}], the owner's re-price, split
  // or re-scope of a started piece (retro 2026-10-25, jg ratified Change 1).
  // `design` "consult" | "full", `mockup` "<who> YYYY-MM-DD: <link>" (the owner's approved blend),
  // `screens` [{name, fidelity}] (the Designer's verdict per visible screen at Done) (jg 2026-10-27).
  piece: ["n", "text", "check", "price", "timebox", "state", "started_at", "ended_at", "go", "owner_call", "note", "kind", "replans", "design", "mockup", "screens"],
  // `replans`: [{at: "<who> YYYY-MM-DD", timebox, why}], a beat's new timebox once it runs past 2×
  // (retro 2026-10-28, jg ratified Change 1).
  beat: ["key", "timebox", "used", "state", "started_at", "ended_at", "replans"],
  checkpoint: ["on_objective", "waiting", "can_ship"],
  scope: ["at", "change", "what", "why", "who", "price"],
  run: ["id", "at", "role", "model", "purpose", "tokens", "minutes"],
};

// Retro 2026-10-21 (connector-cloud FEA-CC-452, jg ratified Changes 1, 2 and 7): the board refuses
// a record instead of warning about it. That objective's board warned "record has 8 problems" while
// six updates sat in a key no view showed; it reached 55 open rows; 4 of its 11 Done lines could
// never pass where they said; Build ran 3 days 8 hours with no numbered list; and 43% of the agent
// dispatches never reached the record. A record opened before RULES_FROM keeps the rules it was
// framed under (proven-where, pieces, runs from the ledger); the unknown-key and open-row rules hold
// for every record.
export const RULES_FROM = "2026-10-22";
export const MAX_OPEN_ROWS = 12;
/** Done is outcomes the persona sees, never the build's fixes (retro 2026-10-23, jg ratified: KIT-001's
 * Done grew to 24 lines, 11 of them fixed bugs, "virtually useless"). */
export const MAX_DONE_LINES = 8;
export const READ_BY = ["claude", "owner"];
/** Records opened from this date are also held to the 2026-10-23 retro's Done rules. */
export const DONE_RULES_FROM = "2026-10-24";
/** Records opened from this date: a Done line with a time or cost number says, by the end of Slices,
 * which run measured that exact case, or that the number is an estimate (retro 2026-10-26, jg
 * ratified Change 2: OPS-CC-469's docker target moved 5 → 8 → 9 min, each value taken from a run
 * that was not the case the line names). */
export const MEASURED_RULES_FROM = "2026-10-27";
/** Records opened from this date: a full-pass piece starts only with the owner's approved mockup, and
 * the record closes only with the Designer's fidelity verdict on each visible screen (jg 2026-10-27:
 * a website overhaul met every requirement and could not ship as it looked). */
export const DESIGN_RULES_FROM = "2026-10-28";
/** Records opened from this date: a Done line's `earliest` says what the proof waits for (`waits_for`);
 * a line whose proof exists at release has no `earliest` (jg 2026-10-27). */
export const WAITS_RULES_FROM = "2026-10-28";
/** Records opened from this date: an open beat past 2× its timebox stops for a dated replan, as a piece
 * does (retro 2026-10-28, jg ratified Change 1: beats ran past 2× with no replan in 5 retros). */
export const BEAT_RULES_FROM = "2026-10-29";
export const DESIGNS = ["consult", "full"];
// Two verdicts only: "ships with fixes" passed the old /^ships\b/ (RC-DESIGNER, 2026-10-27).
const FIDELITY = /^(ships\.?\s*$|does not ship\s*:\s*\S)/i;
/** "<who> YYYY-MM-DD: <link>": who approved the blend, when, and where it is. */
const MOCKUP = /^(\S+)\s+(\d{4}-\d{2}-\d{2})\s*:\s*\S/;
/** A time or cost number in a Done line's text: "≤ 9 min", "15 minutes", "68 billed", "2 h", "$40". */
export const NUMBERED = /(\d[\d.,]*\s*(ms|s|sec|secs|seconds|min|mins|minutes|h|hrs|hours|days|billed)\b)|\$\s*\d/i;
const MEASURED = /^(run\s*:\s*\S|estimate\b)/i;
/** Where a Done line is proven; a `proven` value starts with one of these. */
// Retro 2026-10-28 (a 2026-10-28 product retro, ch ratified Change 1): a record opened from this date is refused
// while the ledger shows neither a live hook (a `session` row near or after its opening) nor a run
// recorded by hand for it (`ledger-stop --manual`). That objective's ledger stayed empty for 30 runs.
export const HOOKS_RULES_FROM = "2026-10-29";
export const HOOKS_REFUSAL = "the ledger shows no HarteBurn hook in this session and no run recorded by hand: the plugin's hooks are not running here. Record each role run after its result (`node <plugin>/hooks/redcell-hook.mjs ledger-stop --manual <role> \"<purpose>\" <tokens> <ms>`) and run board-md.mjs after every record edit";
/** True when the ledger proves runs reach it for `rec`: a session row from a day before its opening on, or a manual row for it. */
export function hooksLive(rec, ledger) {
  const opened = Date.parse(String(rec?.opened_at || "")) || 0;
  return (ledger || []).some((r) => (r?.event === "session" && Date.parse(r.ts) >= opened - 86_400_000) || (r?.manual && r.board === rec?.id));
}

export const PROVEN_WHERE = ["production", "canary", "stub"];
const DATED = /\b\d{4}-\d{2}-\d{2}\b/;
/** Is this record held to the 0.15.0 rules (a Done checklist with proven-where, numbered pieces, runs from the ledger)? */
// A missing or malformed date (not YYYY-MM-DD…) is held too: it never exempts a record (Prover, 2026-10-21).
export const heldToRules = (rec) => {
  const d = String(rec?.opened_at ?? "");
  return !/^\d{4}-\d{2}-\d{2}/.test(d) || d.slice(0, 10) >= RULES_FROM;
};
const isOutcome = (d) => d.kind == null || d.kind === "outcome";
const textOf = (y) => (typeof y === "string" ? y : y?.text || "");
/** A beat's timebox now: its latest dated replan's, else its own, else the beat's default. */
export const currentTimebox = (b) => [...(b?.replans || [])].reverse().find((r) => DATED.test(String(r?.at || "")) && r?.timebox > 0)?.timebox
  ?? b?.timebox ?? BEATS.find(([k]) => k === b?.key)?.[2];
/** A piece's price now: its latest replan's, else the price Slices gave it. */
export const currentPrice = (p) => [...(p?.replans || [])].reverse().find((r) => r?.price > 0)?.price ?? p?.price;
const PROVEN = new RegExp(`^(${PROVEN_WHERE.join("|")})\\s*:\\s*\\S`, "i");

/**
 * What the board refuses, one sentence each, on a normalized record. board-md.mjs shows them at the
 * board's top and exits 1, so the Tech Lead's own command fails until the record is put right.
 */
export function refusals(rec, now = Date.now(), { stamps, ledger } = {}) {
  const out = [];
  if (!rec?.title) return out;
  const openedDay = String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10);
  if (Array.isArray(ledger) && openedDay >= HOOKS_RULES_FROM && !["done", "closed"].includes(rec.status) && !hooksLive({ ...rec, opened_at: stamps?.opened_at ?? rec.opened_at }, ledger)) out.push(HOOKS_REFUSAL);
  const pieces = rec.pieces || [];
  const open = (rec.items || []).filter((i) => OPEN.includes(i.state)).length + pieces.filter((p) => OPEN.includes(p.state)).length;
  if (open > MAX_OPEN_ROWS) out.push(`${open} open rows, more than ${MAX_OPEN_ROWS}: finish or drop some; a find that blocks no piece goes on its priced list, or becomes a piece by the owner's dated go`);
  // Retro 2026-10-25 (jg ratified Change 2): CI's docker job on main was red 8 times over 4 days;
  // "the lasting fix is the owner's" sat in a troubleshooting doc and reached jg only when /done
  // blocked. An item waiting on an owner act is on Yours, for every record.
  (rec.items || []).forEach((i) => {
    if (!OPEN.includes(i.state) || !String(i.owner_act || "").trim()) return;
    const act = String(i.owner_act).trim();
    if (!(rec.yours || []).some((y) => textOf(y).includes(act))) out.push(`"${String(i.text || "").slice(0, 50)}" waits on an owner act: put it on Yours ("${act}: <both sides, with an example>, by <date>")`);
  });
  // Retro 2026-10-25 (jg ratified Change 1): KIT-001's piece 12 ran 2,208 of 120 min after three
  // owner-approved items joined its card, and one "continue" met the 2× stop for good. For every
  // record: a started piece keeps the scope it started with, and each 2× of its current price stops it.
  for (const p of pieces) {
    if (!OPEN.includes(p.state)) continue;
    const at = `Piece ${p.n}`;
    const st = stamps?.pieces?.[p.n];
    const rescoped = [...(p.replans || [])].reverse().find((r) => r?.text)?.text;
    if (st?.text != null && p.text !== st.text && p.text !== rescoped) {
      out.push(`${at}'s scope changed after it started ("${String(st.text).slice(0, 40)}…"): new work opens its own numbered piece with its price and the owner's dated go; or a dated replan carries the new text and price`);
    }
    if (p.kind != null && !PIECE_KINDS.includes(p.kind)) out.push(`${at} has kind "${p.kind}": "feature" or "prod-fix"`);
    if (p.kind === "prod-fix" && !/^production\s*:/i.test(String(p.check || ""))) out.push(`${at} is a production fix: its check is read in production ("check": "production: <the read>")`);
    for (const r of p.replans || []) if (!DATED.test(String(r?.at || "")) || !(r?.price > 0)) out.push(`${at} has a replan without the owner's dated call and a price ({"at": "<who> <YYYY-MM-DD>", "price": <min>, "why": …})`);
  }
  // The Done cap reaches a record framed before it, at its close (retro 2026-10-25: KIT-001 met
  // /done with 22 lines; the 10-23 cap bound only new records).
  const legacy = String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10) < DONE_RULES_FROM;
  if (legacy && ["done", "closed"].includes(rec.status)) {
    const outcomes = (rec.done_when || []).filter((d) => isOutcome(d) && d.state !== "dropped").length;
    if (outcomes > MAX_DONE_LINES) out.push(`${outcomes} Done lines, more than ${MAX_DONE_LINES}: merge them into the outcomes the persona sees before /done closes the record`);
  }
  if (!heldToRules({ opened_at: stamps?.opened_at ?? rec.opened_at })) return out;
  if (!rec.done_when?.length) out.push("no Done checklist yet (`done_when`): /frame writes it");

  const doneRules = String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10) >= DONE_RULES_FROM;
  if (doneRules) {
    const lines = rec.done_when || [];
    lines.forEach((d, n) => {
      if (d.kind === "found" || d.kind === "mistake") out.push(`Done line ${n + 1} is a ${d.kind} row: a fix belongs in items with its proof, never in Done (Done is what the persona sees)`);
    });
    const outcomes = lines.filter((d) => isOutcome(d) && d.state !== "dropped").length;
    if (outcomes > MAX_DONE_LINES) out.push(`${outcomes} Done lines, more than ${MAX_DONE_LINES}: Done is the outcomes the persona sees; build checks stay with their pieces`);
    lines.forEach((d, n) => {
      if (!isOutcome(d)) return;
      const where = `Done line ${n + 1}`;
      if (!READ_BY.includes(d.read_by)) out.push(`${where} does not say who can read its proof ("read_by": "claude", or "owner" when it is a page Claude has no login to or a channel it can't read)`);
      const opened = String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10);
      if (d.earliest != null && d.earliest !== "" && !/^\d{4}-\d{2}-\d{2}/.test(String(d.earliest))) out.push(`${where}'s earliest read time is not a date ("earliest": "YYYY-MM-DD[THH:MM]")`);
      else if (d.earliest && opened >= WAITS_RULES_FROM && !String(d.waits_for || "").trim()) out.push(`${where} waits until ${d.earliest}: say what its proof waits for ("waits_for": "a day of runs"), or drop "earliest" when the proof exists at release`);
      if (d.read_by === "owner" && !(rec.yours || []).some((y) => new RegExp(`\\bDone line ${n + 1}\\b`).test(typeof y === "string" ? y : y?.text || ""))) {
        out.push(`${where} is read by the owner: put it on Yours ("Done line ${n + 1}: <what to look at>, by <date>")`);
      }
    });
    const slicesDone = (rec.beats || []).some((b) => b.key === "slices" && b.state === "done");
    if (slicesDone && String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10) >= MEASURED_RULES_FROM) {
      lines.forEach((d, n) => {
        if (!isOutcome(d) || !NUMBERED.test(String(d.text || ""))) return;
        if (!MEASURED.test(String(d.measured || ""))) out.push(`Done line ${n + 1} has a time or cost number: say which run measured that exact case ("measured": "run: <id or read>"), or mark it "measured": "estimate — reset after the first measured run (owner's go)"`);
      });
    }
    if (["done", "closed"].includes(rec.status)) {
      lines.forEach((d, n) => {
        const t = Date.parse(String(d.earliest || ""));
        if (isOutcome(d) && Number.isFinite(t) && t > now) out.push(`Done line ${n + 1} can't be read before ${d.earliest}: the objective stays open until then`);
      });
    }
  }

  (rec.done_when || []).forEach((d, n) => {
    if (!isOutcome(d)) return;
    const where = `Done line ${n + 1}`;
    if (!d.proven) out.push(`${where} does not say where it is proven ("proven": "production: <the read that shows it>", or canary, or stub)`);
    else if (!PROVEN.test(String(d.proven))) out.push(`${where}: "proven" reads "production: <the read>", "canary: <the run>" or "stub: <the test>", not "${String(d.proven).slice(0, 30)}"`);
  });

  const slices = (rec.beats || []).find((b) => b.key === "slices");
  if (slices?.state === "done" && !pieces.length) out.push("Slices is done but there are no numbered pieces (`pieces`)");
  // N is the board's own stamp (`stamps.n`, see applyStamps), never the record's typed number: a typed
  // 99 once let a piece in with no go, and a typed N skipped this refusal (Prover, 2026-10-21).
  const n = stamps?.n;
  const build = (rec.beats || []).find((b) => b.key === "build");
  if (pieces.length && typeof n !== "number" && (["here", "done"].includes(build?.state) || pieces.some((p) => p.state !== "todo"))) {
    out.push("the pieces are not frozen: mark Slices done (the board then freezes N) before any piece is built");
  }
  // A frozen piece is never removed or renumbered: its clock would pass to whatever takes its number
  // (Lead ruling, 2026-10-21: deleting dropped piece 2 and renumbering 3 turned "200 of 60 min" into 0).
  if (typeof n === "number") {
    for (let k = 1; k <= n; k++) if (!pieces.some((p) => p.n === k)) out.push(`Piece ${k} was removed, but Slices froze ${n} pieces: mark it dropped, never remove or renumber it`);
  }
  pieces.forEach((p, k) => {
    const at = `Piece ${p.n ?? k + 1}`;
    if (p.n !== k + 1) out.push(`${at} is row ${k + 1}: pieces are numbered 1..N in order`);
    if (!p.check) out.push(`${at} has no production check (\`check\`)`);
    if (!(p.price > 0)) out.push(`${at} has no price in build minutes (\`price\`)`);
    if (!(p.timebox > 0)) out.push(`${at} has no timebox in minutes (\`timebox\`)`);
    // Retro 2026-10-23 (jg ratified Change 2): KIT-001's pieces went todo → done unseen, so no piece
    // recorded the minutes it used and no price was ever checked against one.
    if (String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10) >= DONE_RULES_FROM && p.state === "done" && !p.started_at) {
      out.push(`${at} is done but never started on the board: mark it "doing" when it starts, so its minutes are measured against its price`);
    }
    if (typeof n === "number" && p.n > n && !DATED.test(String(p.go || ""))) out.push(`${at} was added after Slices without the owner's dated go ("go": "<who> <YYYY-MM-DD>"); an added piece takes the next number (N+1), pieces 1..N keep theirs`);
    const used = beatMinutes(p, now);
    // Each 2× stops it (retro 2026-10-25, jg ratified Change 1): one dated "continue" (`owner_call`)
    // carries a piece to 4× its timebox at most; past that, or past 2× a replan's price, only a new
    // dated replan does. KIT-001's piece 12 ran 2,208 of 240 min on one "continue".
    const replanned = (p.replans || []).some((r) => r?.price > 0);
    const budget = replanned ? currentPrice(p) : p.timebox;
    const continued = !replanned && DATED.test(String(p.owner_call || "")) && used <= 4 * p.timebox;
    if (OPEN.includes(p.state) && budget > 0 && used > 2 * budget && !continued) {
      out.push(replanned
        ? `${at} is past 2× its replanned price (${used} of ${budget} min): replan again — a dated replan with a new price, the rest moved to a new piece (split), or dropped (cut)`
        : `${at} is past 2× its timebox (${used} of ${p.timebox} min): it stops for the owner's call — "owner_call": "<who> <YYYY-MM-DD>: <the call>" once (to 4× at most), then a dated replan with a new price ("replans"), a split, or a cut`);
    }
  });
  if (String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10) >= BEAT_RULES_FROM) {
    for (const b of rec.beats || []) {
      const at = `Beat "${BEATS.find(([k]) => k === b.key)?.[1] || b.key}"`;
      for (const r of b.replans || []) if (!DATED.test(String(r?.at || "")) || !(r?.timebox > 0)) out.push(`${at} has a replan without a dated call and a timebox ({"at": "<who> <YYYY-MM-DD>", "timebox": <min>, "why": …})`);
      const box = currentTimebox(b);
      const used = beatMinutes(b, now);
      if (b.state === "here" && box > 0 && used > 2 * box) out.push(`${at} is past 2× its timebox (${used} of ${box} min): it stops for a replan — add to the beat's "replans" {"at": "<who> <YYYY-MM-DD>", "timebox": <new min>, "why": "<what took longer>"}, or finish the beat`);
    }
  }
  if (String(stamps?.opened_at ?? rec.opened_at ?? "").slice(0, 10) >= DESIGN_RULES_FROM) {
    const closing = ["done", "closed"].includes(rec.status);
    pieces.forEach((p, k) => {
      const at = `Piece ${p.n ?? k + 1}`;
      if (p.design != null && !DESIGNS.includes(p.design)) out.push(`${at} has design "${p.design}": "consult" or "full"`);
      if (p.design === "full" && !["todo", "dropped"].includes(p.state)) {
        const approved = MOCKUP.exec(String(p.mockup || "").trim())?.[2];
        const started = String(stamps?.pieces?.[p.n]?.started_at ?? p.started_at ?? "").slice(0, 10);
        if (!approved) out.push(`${at} is a full design pass: it starts only with the owner's approved mockup ("mockup": "<who> YYYY-MM-DD: <link>")`);
        else if (started && approved > started) out.push(`${at}'s mockup is dated ${approved}, after the piece started (${started}): the owner approves the blend before the build`);
      }
      if (p.screens != null && !Array.isArray(p.screens)) out.push(`${at}'s screens is not a list: [{"name": "<screen>", "fidelity": "ships"}]`);
      if (!closing) return;
      (Array.isArray(p.screens) ? p.screens : []).forEach((s) => {
        if (!FIDELITY.test(String(s?.fidelity || "").trim())) out.push(`${at}'s screen "${s?.name || "?"}" has no fidelity verdict from the Designer ("fidelity": "ships", or "does not ship: <why>")`);
      });
    });
  }
  // A run is the ledger's, never typed (Lead close-out, 2026-10-21): a typed run sits beside the
  // ledger's copy of the same dispatch and is counted twice; 0.14.0's /frame told the Tech Lead to type them.
  const seen = new Set();
  (rec.runs || []).forEach((r, k) => {
    if (r.id && seen.has(r.id)) out.push(`Run ${k + 1} repeats run ${r.id}: each dispatch is one run; remove the copy`);
    if (r.id) seen.add(r.id);
    if (!r.id) out.push(`Run ${k + 1} (${r.role || "?"}: ${String(r.purpose || "").slice(0, 40)}) has no id: runs come from the ledger; put its tokens and minutes on the ledger's run, then remove this one`);
  });
  return out;
}

/**
 * The board's own stamps (Lead ruling, 2026-10-21): rule inputs the board witnessed itself, kept in
 * a store only board-md.mjs writes (`<git dir>/redcell/stamps-<id>.json`), never the record the
 * Tech Lead edits. The board never trusts a value an ordinary edit can change; a deliberate edit is
 * shown, not stopped (no file can stop one: the Tech Lead writes the record, the git dir and the
 * plugin). `s` is that store, changed in place:
 * - `opened_at`: the record's date as the board first saw it; a later typed change is refused;
 * - `n`: N, the piece count when Slices first reads done, never a typed number;
 * - `opened_head`: the commit HEAD was at when the board first saw the record;
 * - `opened_local`, and each piece's `from_local` and `end_local`: the session files' hashes (`local`,
 *   from board-security.mjs sessionFiles) beside each head stamp, copied and kept the same way;
 * - `pieces[n]`: each piece's first in-progress time and commit (`head`), the commit its range starts
 *   from (`from_head`), its finished time and commit (`end_head`), and the Security verdicts the board
 *   saw (`security`, `refused`); all but the start, `from_head`, `from_local` and `refused` are cleared
 *   if it reopens.
 * The record's copies are rewritten from the store, so editing or deleting a stamp changes nothing,
 * and an open piece's minutes always run from its first start. Returns the problems it found.
 */
export function applyStamps(rec, s, now = new Date(), { head, local } = {}) {
  const out = [];
  const at = now.toISOString();
  const fresh = s.opened_at == null;
  if (fresh) {
    s.opened_at = rec.opened_at ?? at;
    // The commit HEAD was at when the board first saw the record: the first piece's range starts here,
    // so no commit before a piece reads doing falls outside every piece (rc-security piece 3, round 8).
    if (head) s.opened_head = head;
  }
  // The hashes of the session files git does not show (board-security.mjs sessionFiles), beside each
  // head stamp. A store from before them gets an empty one, never the disk now, which could already
  // hold the change: every session file then needs one verdict (automated review of 5e607c4).
  if (local && s.opened_local == null) s.opened_local = fresh ? local : {};
  // A typed copy is named, then rewritten from the store, so no reader (the runs import, the piece
  // lines) ever sees it (Lead ruling, 2026-10-21: a typed newer date had imported runs for good).
  if (rec.opened_at != null && rec.opened_at !== s.opened_at) out.push(`\`opened_at\` read ${rec.opened_at}, but the board first saw this record opened ${s.opened_at}: put back`);
  rec.opened_at = s.opened_at;
  if (!heldToRules({ opened_at: s.opened_at })) return out;
  s.pieces ||= {};
  for (const p of rec.pieces || []) {
    if (p.n == null) continue;
    const st = (s.pieces[p.n] ||= {});
    // The commit a piece started from (rc-security piece 3): its diff is head..HEAD. Passed in by
    // the caller, so this stays pure; a piece started before 0.23.2 has none and is never held.
    if (p.state === "doing" && !st.started_at) {
      st.started_at = at;
      if (head) st.head = head;
    }
    // The scope a piece started with (retro 2026-10-25, Change 1); a dated replan's text is the new one.
    if (st.started_at && st.text == null) st.text = p.text ?? "";
    const rescoped = [...(p.replans || [])].reverse().find((r) => r?.text && DATED.test(String(r?.at || "")) && r?.price > 0)?.text;
    if (rescoped && p.text === rescoped) st.text = rescoped;
    if (FINISHED.includes(p.state)) {
      const endsNow = !st.ended_at;
      st.ended_at ||= at;
      // The commit a piece ended at: the next piece's range starts there.
      if (head && !st.end_head) st.end_head = head;
      if (local && !st.end_local) st.end_local = endsNow ? local : {};
    } else {
      delete st.ended_at;
      delete st.end_head;
      delete st.end_local;
      delete st.security; // a reopened piece needs a fresh verdict; a refusal it saw stays (securityCheck drops it once the code changes)
    }
    if (st.started_at) p.started_at = st.started_at;
    else delete p.started_at;
    if (st.ended_at) p.ended_at = st.ended_at;
    else delete p.ended_at;
  }
  // The commit each piece's range starts from (Architect ruling on Security round 14): the end commit
  // of the piece that ended last at or before it started, else the opening. Stamped once, after the
  // loop so a piece ending in this same render counts, and never recomputed: reopening an earlier piece
  // moves its ended_at, and a moving start dropped a standing refusal. A store without one is backfilled.
  for (const p of rec.pieces || []) {
    const st = s.pieces[p.n];
    if (!st?.head || (st.from_head && (st.from_local || !local))) continue;
    const begun = Date.parse(String(st.started_at ?? ""));
    let latest = -Infinity, prev = null;
    for (const q of rec.pieces || []) {
      const sq = s.pieces[q.n];
      const ended = Date.parse(String(sq?.ended_at ?? ""));
      if (q.n === p.n || !sq?.end_head || !(ended <= begun) || ended <= latest) continue;
      latest = ended;
      prev = sq;
    }
    // Copied the same way, from the same piece, and never recomputed (from_local, beside from_head).
    if (!st.from_head) st.from_head = prev?.end_head ?? s.opened_head;
    if (!st.from_head) delete st.from_head;
    if (local && !st.from_local) st.from_local = prev?.end_local ?? s.opened_local ?? {};
  }
  const slices = (rec.beats || []).find((b) => b.key === "slices");
  if (s.n == null && slices?.state === "done" && rec.pieces?.length) {
    s.n = rec.pieces.length;
    s.n_at = at;
  }
  if (typeof s.n === "number") {
    if (rec.pieces_at_slices != null && rec.pieces_at_slices !== s.n) out.push(`\`pieces_at_slices\` read ${rec.pieces_at_slices}, but Slices froze ${s.n} (the piece count when Slices first read done): put back; N moves only by an added piece with the owner's dated go`);
    rec.pieces_at_slices = s.n;
  }
  return out;
}

/** A ledger row's identity: the hook's own id (0.15.0), else, for an older row, its time, session,
 * role and prompt hash together. Never its time alone: parallel dispatches share a millisecond
 * (connector-cloud's ledger, 2026-10-21: 478 rows, 450 distinct times; all 478 distinct this way). */
export const ledgerId = (row) => row?.id || `${row?.ts}|${row?.session ?? ""}|${row?.role ?? ""}|${row?.prompt_sha256 ?? ""}`;

/**
 * The record's runs, from the dispatch ledger (retro 2026-10-21, Change 7): each ledger row the
 * hook tagged with this record's id becomes a run once, by its identity (`id`), so no run is
 * written by hand and none is lost. Only for a record held to the 0.15.0 rules: an older record's
 * runs were written by hand, and importing would count them twice. Returns how many it added.
 */
export function runsFromLedger(rec, ledgerRows) {
  if (!rec?.id || !heldToRules(rec)) return 0;
  rec.runs ||= [];
  const have = new Set(rec.runs.map((r) => r.id).filter(Boolean));
  let added = 0;
  for (const row of ledgerRows || []) {
    if (row?.board !== rec.id || !row.ts) continue;
    // A run's end (SubagentStop, retro 2026-10-23) carries its minutes for /retro; it is not a second run.
    if (row.event === "stop") continue;
    // A touch row (rc-disk piece 4) names another repo the objective changed; it is not a run.
    if (row.event === "touch") continue;
    const id = ledgerId(row);
    if (have.has(id)) continue;
    rec.runs.push({
      id,
      at: row.ts,
      role: String(row.role || "general-purpose").replace(/^(?:redcell|harteburn):/, ""),
      model: row.model || "inherit",
      purpose: row.description || "",
      ...(row.tokens != null && { tokens: row.tokens }),
      ...(row.minutes != null && { minutes: row.minutes }),
    });
    have.add(id);
    added++;
  }
  // A run's end fills its tokens and minutes (retro 2026-10-28, jg ratified Change 3: 12 of 15 runs
  // showed none). A stop row joins its dispatch by the dispatch's id (`dispatch`), else by the
  // subagent's id both rows carry (`agent_id`); a value already on the run is never overwritten.
  const byAgent = new Map();
  for (const row of ledgerRows || []) if (row?.event !== "stop" && row?.agent_id) byAgent.set(row.agent_id, ledgerId(row));
  const empty = (v) => v == null || v === "";
  for (const row of ledgerRows || []) {
    if (row?.event !== "stop") continue;
    const id = row.dispatch || byAgent.get(row.agent_id);
    const run = id && rec.runs.find((r) => r.id === id);
    if (!run) continue;
    if (empty(run.tokens) && row.tokens != null) run.tokens = row.tokens;
    if (empty(run.minutes) && row.minutes != null) run.minutes = row.minutes;
  }
  return added;
}

/**
 * Gives every item that has none a new random id, and says whether it added any. The caller writes
 * the record back BEFORE anything is logged, so a crash between the log and the record replays
 * with the same ids and logs nothing twice. Never derived from the text: two items with the same
 * beat and text are two items (Prover 2026-10-19; a hashed id lost the second, as v0.53.0 lost
 * 13 of 14 checks with one name).
 */
export function assignIds(rec) {
  let added = 0;
  // The record's own id names its log file. A record from before 0.12.0 has none: it gets one from
  // its title, saved with the item ids, so the log's name never changes later (Prover 2026-10-19:
  // setting it by hand afterwards would have started a second, empty log).
  if (rec && !rec.id) { rec.id = slugOf(rec.title); added++; }
  for (const i of rec?.items || []) if (!i.id) { i.id = randomBytes(5).toString("hex"); added++; }
  return added;
}

/** A title as a file-name-safe id. */
export function slugOf(s) {
  return String(s || "objective").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "objective";
}

const unknownKeys = (obj, allowed, where, out) => {
  for (const k of Object.keys(obj || {})) if (!allowed.includes(k)) out.push(`unknown key "${k}" in ${where}`);
};

/**
 * Returns a normalized copy of the record and a warning for each value the schema does not know.
 * It never throws, and it never drops data: an unknown key stays in the record and is named.
 */
export function normalize(rec) {
  const warnings = [];
  const o = structuredClone(rec || {});
  unknownKeys(o, KEYS.record, "the record", warnings);
  if (o.status && !STATUS.includes(o.status)) warnings.push(`unknown status "${o.status}"`);
  const fixState = (x, where) => {
    if (x.state in STATE_ALIASES) x.state = STATE_ALIASES[x.state];
    if (x.state == null) x.state = "todo";
    if (!(x.state in STATE_WORD)) warnings.push(`unknown state "${x.state}" on ${where}`);
  };
  (o.done_when || []).forEach((d, n) => {
    const where = `Done line ${n + 1}`;
    unknownKeys(d, KEYS.done_when, where, warnings);
    fixState(d, where);
    if (d.kind != null && !KINDS.includes(d.kind)) warnings.push(`unknown kind "${d.kind}" on ${where}`);
  });
  (o.work || []).forEach((w, n) => {
    const where = `work item ${n + 1}`;
    unknownKeys(w, KEYS.work, where, warnings);
    fixState(w, where);
  });
  (o.items || []).forEach((i, n) => {
    const where = `item ${n + 1}`;
    unknownKeys(i, KEYS.item, where, warnings);
    fixState(i, where);
    if (i.beat != null && !BEATS.some(([k]) => k === i.beat)) warnings.push(`unknown beat "${i.beat}" on ${where}`);
    if (i.kind != null && !KINDS.includes(i.kind)) warnings.push(`unknown kind "${i.kind}" on ${where}`);
  });
  (o.pieces || []).forEach((p, n) => {
    const where = `piece ${p.n ?? n + 1}`;
    unknownKeys(p, KEYS.piece, where, warnings);
    fixState(p, where);
  });
  (o.beats || []).forEach((b, n) => {
    unknownKeys(b, KEYS.beat, `beat ${n + 1}`, warnings);
    if (b.state === "open") b.state = "todo";
    if (!BEATS.some(([k]) => k === b.key)) warnings.push(`unknown beat "${b.key}"`);
    if (b.state != null && !BEAT_STATES.includes(b.state)) warnings.push(`unknown state "${b.state}" on beat "${b.key}"`);
  });
  if (o.checkpoint) {
    for (const [old, now] of Object.entries(CHECKPOINT_ALIASES)) {
      if (old in o.checkpoint) {
        if (o.checkpoint[now] == null) o.checkpoint[now] = o.checkpoint[old];
        delete o.checkpoint[old];
      }
    }
    unknownKeys(o.checkpoint, KEYS.checkpoint, "the checkpoint", warnings);
  }
  (o.scope || []).forEach((s, n) => unknownKeys(s, KEYS.scope, `scope change ${n + 1}`, warnings));
  (o.runs || []).forEach((r, n) => unknownKeys(r, KEYS.run, `run ${n + 1}`, warnings));
  return { record: o, warnings };
}

/** Open first: in progress, blocked, to do; then done, then dropped. Gates last. Stable within a state. */
export function doneOrder(lines) {
  const order = ["doing", "blocked", "todo", "done", "dropped"];
  // An unknown state sorts last (it is named in the drift line), as in Open work.
  const rank = (d) => (d.kind === "gate" ? 10 : 0) + ((order.indexOf(d.state ?? "todo") + 6) % 6);
  return lines.map((d, n) => [d, n]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([d]) => d);
}

/** A beat's minutes: from its stamps when it has them (retro 2026-10-17, R1), else the typed number. */
export function beatMinutes(b, now = Date.now()) {
  if (b?.started_at) return Math.round(((b.ended_at ? Date.parse(b.ended_at) : now) - Date.parse(b.started_at)) / 60000);
  return b?.used ?? 0;
}
