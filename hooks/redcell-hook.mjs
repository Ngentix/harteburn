#!/usr/bin/env node
// HarteBurn hook entry point. One script, one mode per hook entry:
//   ethos           SessionStart  -> the HarteBurn way of working, as context
//   brief-session N of M   SessionStart  -> part N of this repo's docs/architecture/BRIEF.md, as context
//   brief-subagent N of M  SubagentStart -> the same part, into every subagent
//   (a brief over one context string's room is sent in up to MAX_PARTS parts, one hook entry each;
//   M is how many entries hooks.json registers. A bare N is a session that read hooks.json before
//   0.13.0, which registered two: its part 2 carries the rest, never dropped silently)
//   reminder        UserPromptSubmit -> one line: name convened/excused roles (bookends: roles at a piece's ends only)
//   ledger          PostToolUse(Agent) -> append the dispatch to <git dir>/redcell/ledger.jsonl
//   ledger-stop     SubagentStop -> append the run's end, minutes and tokens (from its transcript)
//   ledger-stop --manual <role> <purpose> <tokens> <ms> [--model <m>]
//                   by hand, where the hooks don't run (retro 2026-10-28, ch ratified Change 1): one run row
//   (ethos also appends a `session` row: the proof, for the board, that this session's hooks are live)
//   session-clear   PostToolUse(ExitWorktree) -> forget the worktree this session kept (sessionTree)
//   steward prover  PostToolUse(Agent), SubagentStop -> after a Prover pass, the repo's disk steward
//                   (`scripts/disk-sweep.sh --steward`), in the background
//   steward gate    PreToolUse(Bash) -> before a command running verify.sh, the same, waited for (120 s)
//
// Rules: never fail a session. Every path exits 0; any error means "add nothing".
// Each string stays under Claude Code's 10,000-character context cap (above it the
// harness silently swaps the text for a file path), so oversize input is cut here,
// loudly, instead of there, silently.

import { readFileSync, existsSync, mkdirSync, appendFileSync, renameSync, statSync, openSync, readSync, closeSync, accessSync, writeFileSync, constants, realpathSync, rmSync, utimesSync, statfsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { reminderLines } from "../scripts/steward.mjs";
import { behindNotice } from "../scripts/rules-fetch.mjs";
import { licensePath } from "../scripts/login.mjs";

export const CAP = 10000;
// Brief parts hooks.json sends, to sessions and agents alike (jg 2026-10-19: two parts → three).
export const MAX_PARTS = 3;
// The parts a session sends when its hook entries name no count: hooks.json before 0.13.0. A running
// session reads hooks.json once, at its start, but runs this script as it is now (the Prover, 2026-10-19).
export const OLD_CONFIG_PARTS = 2;
export const BRIEF_PATH = "docs/architecture/BRIEF.md";
/** Where a Security prompt's list of local files begins (board-security.mjs securityPrompt). */
export const LOCAL_FILES_HEAD = "\n\nAlso judge these files, which git does not show but Claude Code or git loads, changed in this piece: read each from disk (its sha256 follows the path; \"removed\" means it is gone):";
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(HERE, "..");

function readStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// A repo's config never runs code from a hook (security review, 2026-10-28): no fsmonitor, no hooks.
/** Appends one row to <git dir>/redcell/ledger.jsonl of `tree`; "" tree or no git dir: nothing. */
function appendLedger(tree, row) {
  if (!tree) return false;
  let gitDir = git(tree, ["rev-parse", "--git-common-dir"]);
  if (!gitDir) return false;
  if (!isAbsolute(gitDir)) gitDir = join(tree, gitDir);
  const dir = join(gitDir, "redcell");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "ledger.jsonl"), JSON.stringify(row) + "\n");
  return true;
}

/** A manual run row: `ledger-stop --manual <role> <purpose> <tokens> <ms> [--model <m>]`. */
export function manualRunRow(args, now = new Date()) {
  const rest = [...args];
  let model = "inherit";
  const mi = rest.indexOf("--model");
  if (mi >= 0) { model = rest[mi + 1] || "inherit"; rest.splice(mi, 2); }
  const [role, purpose, tokens, ms] = rest;
  if (!role || !purpose) return null;
  const t = Number(tokens), m = Number(ms);
  return {
    id: `manual-${randomBytes(6).toString("hex")}`,
    ts: now.toISOString(),
    session: "manual",
    role,
    description: purpose,
    model,
    manual: true,
    ...(Number.isFinite(t) && t > 0 && { tokens: Math.round(t) }),
    ...(Number.isFinite(m) && m > 0 && { minutes: Math.round(m / 6000) / 10 }),
  };
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function repoRoot(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]) || "";
}

/** The model a HarteBurn role's charter names (`model:` in agents/<role>.md), or "". */
export function agentModel(subagentType) {
  const m = /^(?:redcell|harteburn):([a-z-]+)$/.exec(subagentType || "");
  if (!m) return "";
  try {
    const head = readFileSync(join(PLUGIN_ROOT, "agents", m[1] + ".md"), "utf8").split("---")[1] || "";
    return (/^model:\s*(\S+)/m.exec(head) || [])[1] || "";
  } catch {
    return "";
  }
}

/** The conversation's current context size: the newest assistant turn's input + cache tokens, read
 * from the transcript's tail. 0 when unknown (never an error). */
/** Tokens and minutes from an Agent result, if it carries them; {} otherwise. */
export function agentUsage(resp) {
  const text = typeof resp === "string" ? resp : JSON.stringify(resp ?? "");
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  const tokens = num(/"?total_?[tT]okens"?\s*[:=]\s*(\d+)/) ?? num(/subagent_tokens:\s*(\d+)/);
  const ms = num(/"?total_?[dD]uration_?[mM]s"?\s*[:=]\s*(\d+)/) ?? num(/duration_ms:\s*(\d+)/);
  return { ...(tokens != null && { tokens }), ...(ms != null && { minutes: Math.round(ms / 6000) / 10 }) };
}

/** A finished subagent's own minutes and tokens, read from its transcript (one JSON object per line):
 * minutes from its first to its last timestamp. Retro 2026-10-23 (jg ratified Change 2): KIT-001's 81
 * role runs left no duration in the ledger, because a background run's usage arrives after the dispatch row.
 * Tokens as the task notification counts them (retro 2026-10-28, jg ratified Change 3): the final
 * reply's input + output + cache-creation + cache-read tokens, i.e. its whole context plus its output.
 * Within ~0.3% of 18 runs' notifications (2026-10-28; the notification also counts the hand-back's
 * result), not exactly; summing every reply re-counts the cached prompt once
 * per call (29 M against 258 k), and dropping the final cache read leaves only the last reply (~2 k). */
export function transcriptUsage(text) {
  let first = null, last = null, final = null;
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const t = Date.parse(o.timestamp ?? "");
    if (Number.isFinite(t)) { if (first == null || t < first) first = t; if (last == null || t > last) last = t; }
    if (o.message?.usage) final = o.message.usage;
  }
  const u = final || {};
  return {
    ...(first != null && last != null && { minutes: Math.round((last - first) / 6000) / 10 }),
    ...(final && { tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) }),
  };
}

/** The subagent's id in an Agent call's result (`agentId`), so its SubagentStop row (`agent_id`) joins it. */
export function responseAgentId(resp) {
  if (resp && typeof resp === "object" && typeof resp.agentId === "string") return resp.agentId;
  const m = (typeof resp === "string" ? resp : JSON.stringify(resp ?? "")).match(/"?agentId"?\s*[:=]\s*"?([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
}

/** The dispatch (`tool_use_id`) of a subagent, from the `<agent>.meta.json` Claude Code writes beside
 * its transcript (`toolUseId`); "" when there is none. */
export function transcriptDispatch(transcriptPath) {
  try {
    return String(JSON.parse(readFileSync(String(transcriptPath).replace(/\.jsonl$/, ".meta.json"), "utf8")).toolUseId || "");
  } catch { return ""; }
}

/**
 * A subagent's final reply, from its transcript's tail (rc-security piece 3): the last assistant
 * line's SubagentHandback message, else its last text block. Every finished transcript ends in a
 * SubagentHandback call with no text block (checked 2026-10-28). `*` and leading `#` are stripped,
 * and a leading "Verdict…:" label, so the first line starts with the verdict word. "" when none.
 */
export function finalReply(transcriptPath, tailBytes = 262144) {
  let text = "";
  try {
    const fd = openSync(String(transcriptPath), "r");
    try {
      const size = statSync(String(transcriptPath)).size;
      const len = Math.min(size, tailBytes);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      text = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
  const rows = text.split("\n");
  for (let i = rows.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(rows[i]); } catch { continue; }
    if (o?.message?.role !== "assistant" || !Array.isArray(o.message.content)) continue;
    const c = o.message.content;
    const back = c.find((b) => b?.type === "tool_use" && b.name === "SubagentHandback" && typeof b.input?.message === "string");
    const said = back ? back.input.message : [...c].reverse().find((b) => b?.type === "text" && String(b.text || "").trim())?.text;
    if (!said) continue;
    return String(said).replace(/\*/g, "").split("\n").map((l) => l.replace(/^\s*#+\s*/, "")).join("\n").trim()
      .replace(/^verdict[^:\n]{0,40}:\s*/i, "");
  }
  return "";
}

/**
 * One ledger row per "accept: <text>" line the owner typed (UserPromptSubmit), with the session's
 * transcript, where Claude Code marks a typed message `origin: human`. The board counts the row only
 * when that transcript agrees (scripts/board-security.mjs acceptances).
 */
export function recordAccepts(input, root) {
  // "accept piece <n>: <the finding>": an acceptance names its piece, so it answers no other
  // (Security's tenth verdict on rc-security piece 3).
  // Only a message that is that one line: a pasted handoff can carry an agent's line (round 11).
  const prompt = String(input?.prompt || "").trim();
  const lines = /[\n\r\u2028\u2029\u0085]/.test(prompt) ? [] : [/^accept\s+piece\s+(\d+)\s*:\s*(\S.*?)$/i.exec(prompt)].filter(Boolean);
  if (!lines.length || !root) return;
  let gitDir = git(root, ["rev-parse", "--git-common-dir"]);
  if (!gitDir) return;
  if (!isAbsolute(gitDir)) gitDir = join(root, gitDir);
  const dir = join(gitDir, "redcell");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();
  const rows = lines.map((m) => JSON.stringify({
    event: "accept", id: randomBytes(6).toString("hex"), ts, session: input.session_id || "",
    transcript: String(input.transcript_path || ""), piece: Number(m[1]), text: m[2], ...boardId(root),
  }));
  appendFileSync(join(dir, "ledger.jsonl"), rows.join("\n") + "\n");
}

/** "the board refuses its record (N problems)" when the last render of board.md refused it, else "".
 * Only the header line counts, from the start of a line: a Done line may quote it (Prover, 2026-10-21). */
export function boardRefusal(root) {
  try {
    const head = readFileSync(join(root, ".redcell", "board.md"), "utf8").slice(0, 4000);
    const m = head.match(/^⛔ \*\*The board refuses this record: (\d+) problems?/m);
    return m ? `the board refuses its record (${m[1]} problem${m[1] === "1" ? "" : "s"})` : "";
  } catch {
    return "";
  }
}

/** The common git dir of the repo `dir` is in, absolute, or "". */
function commonDir(dir) {
  const g = git(dir, ["rev-parse", "--git-common-dir"]);
  return g ? (isAbsolute(g) ? g : join(dir, g)) : "";
}

/**
 * The session's own tree (Lead ruling, 2026-10-21). Claude Code resets a session's shell to the
 * project root when a `cd` leaves the project, so one event's cwd is not the session's tree: a kits
 * session working in a worktree logged a dispatch against the main checkout's record that way. A
 * main-thread event (UserPromptSubmit, the Agent PostToolUse) whose cwd is inside another tree of
 * this repo holding an open record keeps that tree in `<common git dir>/redcell/session-<id>.json`;
 * an event at the project root then uses the kept tree. ExitWorktree clears it (`session-clear`).
 * Accepted limit: a session that worked in such a tree stays on it until ExitWorktree.
 */
export function sessionTree(input, projectDir) {
  const proj = repoRoot(projectDir) || projectDir;
  const top = repoRoot(input?.cwd || projectDir) || proj;
  const sid = String(input?.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
  const common = commonDir(top) || commonDir(proj);
  const file = sid && common ? join(common, "redcell", `session-${sid}.json`) : "";
  if (top !== proj) {
    if (file && boardId(top).board && commonDir(top) === commonDir(proj)) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ tree: top, at: new Date().toISOString() }) + "\n");
      } catch {}
    }
    return top;
  }
  try {
    const kept = JSON.parse(readFileSync(file, "utf8")).tree;
    if (kept && existsSync(kept) && boardId(kept).board) return kept;
  } catch {}
  return top;
}

/** `{ board: <id> }` of the open objective in `<root>/.redcell/board.json`, or nothing. */
export function boardId(root) {
  try {
    const rec = JSON.parse(readFileSync(join(root, ".redcell", "board.json"), "utf8"));
    return rec?.id && rec.status !== "closed" ? { board: String(rec.id) } : {};
  } catch {
    return {};
  }
}

export function contextTokens(transcriptPath) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return 0;
    const size = statSync(transcriptPath).size;
    const len = Math.min(size, 2_000_000);
    const fd = openSync(transcriptPath, "r");
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    const lines = buf.toString("utf8").split("\n").reverse();
    for (const line of lines) {
      if (!line.includes('"assistant"') || !line.includes("usage")) continue;
      try {
        const u = JSON.parse(line)?.message?.usage;
        if (u) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      } catch {}
    }
  } catch {}
  return 0;
}

/** Past this many tokens of context, the Tech Lead hands off at the next checkpoint (0.7.0).
 * Cost, not the compaction limit: every call re-reads the whole conversation. */
export const HANDOFF_TOKENS_DEFAULT = 500000; // jg 2026-10-15: 150k cut objectives off mid-flight

/** The repo's HarteBurn mode, from `.redcell/settings.json` ("mode"): "bookends" (jg 2026-10-23: roles
 * only at a piece's start and end) or "full", the default for anything else, a missing or unreadable file too. */
export function redcellMode(root) {
  try {
    const mode = JSON.parse(readFileSync(join(root, ".redcell", "settings.json"), "utf8")).mode;
    return mode === "bookends" ? "bookends" : "full";
  } catch {
    return "full";
  }
}

export const REMINDER_FULL = "HarteBurn: first checklist line names convened and excused roles, with the reason.";
export const REMINDER_BOOKENDS = "HarteBurn bookends: roles only at a piece's start and end (name them there; the Designer on visible pieces, Security on security-domain pieces); mid-piece, fix in-scope finds and log one board line each; batch live loops (fix every failure, rebuild once, rerun only failed checks); a fix is proven live by a targeted run of the flows it touches, the full suite only at the piece end or before the gate; no convened/excused line.";

/** Inside VS Code (the Claude Code extension, or its terminal)? */
export function inIde(env = process.env) {
  return /vscode/i.test(env.CLAUDE_CODE_ENTRYPOINT || "") || Boolean(env.VSCODE_PID) || env.TERM_PROGRAM === "vscode";
}

/** The repo's live board: the claude.ai page (`.redcell/board.url`) and, in the IDE, its Markdown
 * mirror (`.redcell/board.md`, kept open as a preview). One record feeds both. */
export function boardLine(root, ide = inIde()) {
  const f = root ? join(root, ".redcell", "board.url") : "";
  const url = f && existsSync(f) ? readFileSync(f, "utf8").trim() : "";
  const update = `UPDATE (every beat change, dispatch/return, gate, scope change; never >10 min): edit ONLY the changed lines of .redcell/board.json (Edit; write it whole only at /frame; done_when = the Done checklist), run \`node "${join(PLUGIN_ROOT, "scripts", "board-md.mjs")}" <repo root>\` (moves done items to the log), then ArtifactData set objectives/<id> file_path .redcell/board.json.`;
  if (!url) {
    return `BOARD: none for this repo yet; /frame creates it (page, .redcell/board.url, IDE preview). ${update}`;
  }
  return ide
    ? `BOARD: ${url} (claude.ai) — in this IDE the hook opens .redcell/board.md as a live preview tab; no need to open the page. ${update}`
    : `BOARD: ${url} — the live checklist page. Your FIRST tool call this session: Artifact action "open" on it. ${update}`;
}

/** Whether the board for `id` was already opened in the IDE from this repo, and marks it opened.
 * Retro 2026-10-23 (jg): `code -r` always focuses the tab it opens, so opening the board at every
 * session start took focus from the chat box in each new conversation. Once per objective: the tab
 * stays open (the owner pins it), and a new objective's board opens once. */
export function boardOpenedBefore(root, id) {
  const common = root ? commonDir(root) : "";
  if (!common || !id) return false;
  const f = join(common, "redcell", "ide-board-opened");
  let last = "";
  try { last = readFileSync(f, "utf8").trim(); } catch {}
  if (last === id) return true;
  try { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, id + "\n"); } catch {}
  return false;
}

/** In the IDE, open the board's Markdown mirror as a tab (VS Code shows it as a live preview), once per objective. */
export function openIdeBoard(root) {
  const md = root ? join(root, ".redcell", "board.md") : "";
  if (!md || !existsSync(md) || !inIde()) return false;
  if (boardOpenedBefore(root, boardId(root)?.board)) return false;
  try {
    spawn("code", ["-r", md], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

// "2 of 3" → [2, 3]; a bare "2" (hooks.json before 0.13.0) → [2, OLD_CONFIG_PARTS].
export function partArgs(args) {
  const part = Number(args[0] || 1);
  const sent = args[1] === "of" ? Math.trunc(Number(args[2])) : OLD_CONFIG_PARTS;
  return [part, sent >= 1 ? sent : OLD_CONFIG_PARTS];
}

export function fitToCap(text, label) {
  if (text.length < CAP) return text;
  const note = `\n[HarteBurn: ${label} is ${text.length} characters, over the ${CAP} cap; cut here. Recompile it with /brief.]`;
  return text.slice(0, CAP - note.length - 1) + note;
}

// briefHead and briefParts must stay identical to the copies in templates/scripts/brief-stamp.mjs.
export const HOOK_HEAD =
  `ARCHITECTURE BRIEF for this repo (${BRIEF_PATH}, compiled from the architecture pages; ` +
  `the pages win over the brief, the code wins over the pages). Honour it in every answer and change.\n\n`;
export function briefHead(i, n) {
  return n === 1 ? HOOK_HEAD : HOOK_HEAD.replace("BRIEF.md,", `BRIEF.md, part ${i} of ${n},`);
}
// The fewest parts any split could use (hard cuts waste nothing, so ⌈length ÷ room⌉ is always
// reachable); within that count each part ends at its last "## " heading that still lets the rest fit
// the parts left, else at its last such line break (every rule is one line, so no rule is split), else
// where it is full; a heading or line break counts only if it leaves the part at least half full. So
// a brief within the limit always fits, and no part but the last is under half (the Prover, 2026-10-19:
// cutting only at headings, then budget alone, left connector-cloud's part 1 with 477 characters).
export function briefParts(body) {
  if ((briefHead(1, 1) + body).length < CAP - 100) return [body];
  const room = CAP - 101 - briefHead(1, 2).length; // a part's most characters (every multi-part head is this long)
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

// Part `part` (1-based) of the repo's brief with its header, or "" if the repo has no brief or no such
// part. `sent` is how many parts the session's hook entries ask for; the last of them carries the rest.
export function briefContext(root, part = 1, sent = MAX_PARTS) {
  if (!root) return "";
  const p = join(root, BRIEF_PATH);
  if (!existsSync(p)) return "";
  const parts = briefParts(readFileSync(p, "utf8"));
  const n = Math.min(parts.length, sent);
  if (!(part >= 1 && part <= n)) return "";
  // A brief needing more parts than the session asks for (the gate refuses more than MAX_PARTS; an old
  // session asks for two) is never dropped silently: the last part carries the rest, cut loudly at the cap.
  const body = part === n ? parts.slice(n - 1).join("") : parts[part - 1];
  return fitToCap(briefHead(part, n) + body, `part ${part} of the architecture brief`);
}

// ── The disk steward (retro 2026-10-18, Change 2, jg): on 2026-10-18 the disk fell to 0.6 GB free
// mid-objective. A repo that has an executable scripts/disk-sweep.sh gets it run with --steward after
// every Prover pass and before every gate; then, in every repo, HarteBurn's scripts/steward.mjs --stamp
// records the sweep's result (rc-disk 2026-10-28). Its contract (the repo's side): exits 0, fast when free
// space is 40 GB or more, deletes only rebuildable or ephemeral things. This side never blocks, denies
// or fails a tool call: it prints nothing on stdout, always exits 0, and logs a failure to stderr only.

export const STEWARD_TIMEOUT_MS = 120000;
/** A background run is skipped if another started this recently: three Provers in one message would
 * otherwise start three sweeps at once. */
export const STEWARD_QUIET_MS = 60000;

/** The repo's steward script, if it has an executable one; "" otherwise. */
export function stewardScript(root) {
  if (!root) return "";
  const p = join(root, "scripts", "disk-sweep.sh");
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile() ? p : "";
  } catch {
    return "";
  }
}

/** Whether this hook call should run the steward: "prover" after a Prover dispatch or stop,
 * "gate" before a Bash command that runs verify.sh. */
export function stewardWanted(trigger, input) {
  const ti = (input && input.tool_input) || {};
  if (trigger === "gate") return typeof ti.command === "string" && ti.command.includes("verify.sh");
  const who = ti.subagent_type || input.agent_type || "";
  if (trigger === "prover") return who === "redcell:prover" || who === "harteburn:prover";
  return false;
}

const STEWARD = join(PLUGIN_ROOT, "scripts", "steward.mjs");

function steward(trigger, input, cwd) {
  if (!stewardWanted(trigger, input)) return;
  const root = repoRoot(cwd);
  if (!root) return;
  const script = stewardScript(root);
  if (trigger === "gate") {
    const timeout = Number(process.env.REDCELL_STEWARD_TIMEOUT_MS) || STEWARD_TIMEOUT_MS;
    const before = [];
    if (script) {
      try {
        const f = statfsSync(root);
        before.push("--free-before", String(f.bavail * f.bsize));
      } catch {}
      try {
        execFileSync(script, ["--steward"], { cwd: root, stdio: "ignore", timeout, killSignal: "SIGKILL" });
      } catch (e) {
        process.stderr.write(`harteburn steward: ${script} --steward ${e.code === "ETIMEDOUT" || e.signal ? `stopped after ${timeout / 1000} s` : `exited ${e.status ?? e.message}`}; the command goes ahead\n`);
      }
    }
    // Every repo, script or none (rc-disk, jg 2026-10-28): HarteBurn's sweep records its result.
    try {
      execFileSync(process.execPath, [STEWARD, root, "--stamp", ...before], { cwd: root, stdio: "ignore", timeout, killSignal: "SIGKILL" });
    } catch {}
    stampTouched(root);
    return;
  }
  // After a Prover: in the background, so the session never waits for it. steward.last's time is the
  // quiet window; the sweep then writes its result into it.
  let gitDir = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (gitDir && !isAbsolute(gitDir)) gitDir = join(cwd, gitDir);
  const last = gitDir ? join(gitDir, "redcell", "steward.last") : "";
  if (last) {
    try {
      if (existsSync(last) && Date.now() - statSync(last).mtimeMs < (Number(process.env.REDCELL_STEWARD_QUIET_MS) || STEWARD_QUIET_MS)) return;
      mkdirSync(dirname(last), { recursive: true });
      const now = new Date();
      if (existsSync(last)) utimesSync(last, now, now);
      else writeFileSync(last, JSON.stringify({ at: now.toISOString(), started: true }) + "\n");
    } catch {}
  }
  const child = spawn(process.execPath, [STEWARD, root, "--stamp", "--with-script"], { cwd: root, detached: true, stdio: "ignore" });
  child.on("error", (e) => process.stderr.write(`harteburn steward: ${STEWARD} could not start (${e.message})\n`));
  child.unref();
  stampTouched(root);
}

// ── Other repos an objective changed (rc-disk piece 4, jg 2026-10-28: "if we make changes in other repos
// from one project, we should also clean up in the other project"). An Edit, Write or NotebookEdit in
// another repo, or a Bash command that starts with `cd <path>` or `git -C <path>`, adds one touch row
// per (repo, objective) to this repo's ledger; the steward then stamps those repos too.

/** The absolute path a tool call works in, or "". */
export function touchedPath(input) {
  const ti = (input && input.tool_input) || {};
  if (input?.tool_name === "Bash") {
    const m = String(ti.command || "").match(/^\s*(?:cd|git\s+-C)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
    let p = m ? m[1] || m[2] || m[3] : "";
    // A shell resolves `~` and a relative path; so does this (Prover, piece 4: `cd ../x` went unrecorded).
    if (p === "~" || p.startsWith("~/")) p = join(process.env.HOME || "", p.slice(1));
    else if (p && !isAbsolute(p) && input.cwd) p = join(input.cwd, p);
    return p;
  }
  const p = ti.file_path || ti.notebook_path || "";
  return typeof p === "string" ? p : "";
}

/** The main top level of the repo holding `p` (a worktree counts as its repo), or "". */
function repoOf(p) {
  if (!p || !isAbsolute(p)) return "";
  let d = p;
  while (d !== dirname(d) && !existsSync(d)) d = dirname(d);
  try {
    if (!statSync(d).isDirectory()) d = dirname(d);
  } catch {
    return "";
  }
  const first = (git(d, ["worktree", "list", "--porcelain"]) || "").split("\n")[0] || "";
  return first.startsWith("worktree ") ? first.slice(9) : "";
}

function touch(input, cwd) {
  const own = sessionTree(input, cwd);
  if (!own) return;
  const ownCommon = commonDir(own);
  const root = repoOf(touchedPath(input));
  if (!ownCommon || !root) return;
  const real = (q) => { try { return realpathSync(q); } catch { return q; } };
  if (real(commonDir(root)) === real(ownCommon)) return;
  const board = boardId(own).board ?? null;
  const ledger = join(ownCommon, "redcell", "ledger.jsonl");
  try {
    const seen = existsSync(ledger) && readFileSync(ledger, "utf8").split("\n").some((l) => {
      try { const r = JSON.parse(l); return r.event === "touch" && r.root === root && r.board === board; } catch { return false; }
    });
    if (seen) return;
    mkdirSync(dirname(ledger), { recursive: true });
    appendFileSync(ledger, JSON.stringify({ event: "touch", root, board, at: new Date().toISOString() }) + "\n");
  } catch {}
}

/** The open record's touched repos that still exist, and the record's start, for the steward. */
function touchedRoots(gitDir) {
  try {
    const open = JSON.parse(readFileSync(join(gitDir, "redcell", "open-record.json"), "utf8"));
    const roots = new Set();
    for (const l of readFileSync(join(gitDir, "redcell", "ledger.jsonl"), "utf8").split("\n")) {
      try {
        const r = JSON.parse(l);
        // Only a repo HarteBurn already works in (its own .git/redcell): a `cd` into a cloned repo must
        // never run that repo's script (security review of 0.22.5).
        if (r.event === "touch" && r.board && r.board === open.id && existsSync(join(r.root, ".git", "redcell"))) roots.add(r.root);
      } catch {}
    }
    return { roots: [...roots], since: open.at };
  } catch {
    return { roots: [], since: null };
  }
}

function stampTouched(cwd) {
  let gitDir = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (!gitDir) return;
  if (!isAbsolute(gitDir)) gitDir = join(cwd, gitDir);
  const { roots, since } = touchedRoots(gitDir);
  for (const r of roots) {
    try {
      spawn(process.execPath, [STEWARD, r, "--stamp", "--touched", "--since", String(since)], { cwd: r, detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } catch {}
  }
}

function emit(event, context, extra = {}) {
  if (!context) return;
  process.stdout.write(JSON.stringify({ ...extra, hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}

/** HarteBurn's version from its plugin.json, or "" when it cannot be read (never a failed session). */
export function pluginVersion(pluginRoot = PLUGIN_ROOT) {
  try {
    const v = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
    return typeof v === "string" && v ? v : "";
  } catch {
    return "";
  }
}

function main(mode) {
  const input = readStdin();
  const cwd = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const root = repoRoot(cwd);

  switch (mode) {
    case "ethos": {
      // The version, in the context and to the person at a fresh session (jg 2026-10-28).
      const v = pluginVersion(), mode = redcellMode(root);
      let ethos = readFileSync(join(PLUGIN_ROOT, "ethos.md"), "utf8");
      if (v) ethos = ethos.replace("HARTEBURN is on", `HARTEBURN ${v} is on`).replace('"HarteBurn on"', `"HarteBurn ${v} on"`);
      if (mode === "bookends") ethos += "\n" + readFileSync(join(PLUGIN_ROOT, "bookends.md"), "utf8");
      const fresh = ["startup", "clear"].includes(input.source) ? { systemMessage: `HarteBurn ${v ? v + " " : ""}on (${mode} mode)` } : {};
      const notice = behindNotice(v);
      emit("SessionStart", fitToCap(ethos + "\n" + boardLine(root) + (notice ? "\n" + notice : ""), "the HarteBurn ethos"), fresh);
      try {
        // The license folder is never the environment's: a project's settings can set HOME and REDCELL_HOME.
        if (existsSync(licensePath())) {
          spawn(process.execPath, [join(PLUGIN_ROOT, "scripts", "rules-fetch.mjs")], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
        }
      } catch {}
      openIdeBoard(root);
      // Retro 2026-10-28 (a 2026-10-28 product retro, ch ratified Change 1): that objective ran where the hooks never
      // loaded, and the ledger stayed empty with nobody told. This row is how the board knows they run.
      try {
        const tree = sessionTree(input, cwd) || root;
        appendLedger(tree, { event: "session", ts: new Date().toISOString(), session: input.session_id || "", plugin: pluginVersion(), ...boardId(tree) });
      } catch {}
      return;
    }
    case "brief-session":
      emit("SessionStart", briefContext(root, ...partArgs(process.argv.slice(3))));
      return;
    case "brief-subagent":
      emit("SubagentStart", briefContext(root, ...partArgs(process.argv.slice(3))));
      return;
    case "reminder": {
      // The session's own tree, not the project's: a worktree has its own record (Lead ruling, 2026-10-21).
      const here = sessionTree(input, cwd);
      let line = redcellMode(here || root) === "bookends" ? REMINDER_BOOKENDS : REMINDER_FULL;
      const limit = Number(process.env.REDCELL_HANDOFF_TOKENS) || HANDOFF_TOKENS_DEFAULT;
      const ctx = contextTokens(input.transcript_path);
      if (ctx > limit) {
        line += ` HarteBurn: context ~${Math.round(ctx / 1000)}k tokens (threshold ${Math.round(limit / 1000)}k) — every call re-reads it all. Run /handoff at the next checkpoint (slice committed, board current); never compact.`;
      }
      const refused = here ? boardRefusal(here) : "";
      if (refused) line += ` HarteBurn: ${refused} — put the record right before anything else (.redcell/board.md lists each).`;
      // The owner's own "accept: <finding>" (rc-security piece 3, jg 2026-10-28): only a message the
      // owner types accepts a Security risk, so the hook records it with the transcript that shows it.
      try { recordAccepts(input, here || root); } catch {}
      // The steward's ask, and what ran under always (rc-disk piece 6).
      try {
        const asked = reminderLines(here || root);
        if (asked) line += " " + asked;
      } catch {}
      process.stdout.write(line);
      return;
    }
    case "handoff": {
      // A handoff written by /handoff loads once into the next session: after /clear (the default, jg 2026-10-30), a new window, or a resume.
      const f = root ? join(root, ".redcell", "handoff.md") : "";
      if (!f || !existsSync(f)) return;
      const text = readFileSync(f, "utf8").trim();
      renameSync(f, join(root, ".redcell", "handoff.loaded.md"));
      if (!text) return;
      emit("SessionStart", fitToCap(`HANDOFF waiting (from the previous conversation; resume it when the owner says go, after opening the board):\n${text}`, "the handoff"));
      return;
    }
    case "ledger": {
      // The session's own tree (sessionTree): CLAUDE_PROJECT_DIR names the main checkout even when the
      // session works in a worktree, whose branch and record are its own.
      const own = sessionTree(input, cwd);
      const here = own;
      if (!own) return;
      let gitDir = git(here, ["rev-parse", "--git-common-dir"]);
      if (!gitDir) return;
      if (!isAbsolute(gitDir)) gitDir = join(here, gitDir);
      const ti = input.tool_input || {};
      const prompt = typeof ti.prompt === "string" ? ti.prompt : "";
      const row = {
        // Each dispatch's own id: parallel dispatches share a millisecond, so time never tells runs apart.
        id: input.tool_use_id || randomBytes(6).toString("hex"),
        // The subagent's id, which its SubagentStop row carries: the board joins the two (retro 2026-10-28, Change 3).
        ...(responseAgentId(input.tool_response) && { agent_id: responseAgentId(input.tool_response) }),
        ts: new Date().toISOString(),
        session: input.session_id || "",
        role: ti.subagent_type || "general-purpose",
        description: ti.description || "",
        branch: git(here, ["rev-parse", "--abbrev-ref", "HEAD"]),
        head: git(here, ["rev-parse", "--short", "HEAD"]),
        prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
        // A Security prompt's hash without its local-files list: a lost run still matches its piece
        // after those files change (board-security.mjs, Prover on e23c569).
        ...((ti.subagent_type === "redcell:security" || ti.subagent_type === "harteburn:security") && { plain_sha256: createHash("sha256").update(prompt.split(LOCAL_FILES_HEAD)[0]).digest("hex") }),
        // And its --base, the run's stored identity: the board matches a lost run by it, never by a hash
        // recomputed from HEAD or the session files (Lead's ruling on the second dispel of step 16).
        ...((ti.subagent_type === "redcell:security" || ti.subagent_type === "harteburn:security") && /--base\s+([0-9a-f]{40}(?:[0-9a-f]{24})?)\b/.test(prompt) && { base: /--base\s+([0-9a-f]{40}(?:[0-9a-f]{24})?)\b/.exec(prompt)[1] }),
        prompt_chars: prompt.length,
        // Retro 2026-10-15 (jg): the model each run used, to tune models per role over time.
        model: ti.model || agentModel(ti.subagent_type) || "inherit",
        // Retro 2026-10-17 (R1): tokens and minutes when the run returns them (a foreground run
        // does; a background run's arrive later, in its notification), so retros measure.
        ...agentUsage(input.tool_response),
        // Retro 2026-10-21 (Change 7, jg): the objective this run belongs to, so board-md.mjs adds it
        // to that record's runs; 43% of FEA-CC-452's dispatches never reached its record by hand.
        ...boardId(own),
      };
      const dir = join(gitDir, "redcell");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "ledger.jsonl"), JSON.stringify(row) + "\n");
      return;
    }
    case "ledger-stop": {
      if (process.argv[3] === "--manual") {
        // By hand, where the hooks don't run: one run row, tagged with the open record like a dispatch.
        const tree = repoRoot(cwd) || sessionTree(input, cwd);
        const row = manualRunRow(process.argv.slice(4));
        if (row && appendLedger(tree, { ...row, ...boardId(tree) })) process.stdout.write(`HarteBurn: run recorded (${row.role}, ${row.description})\n`);
        else process.stderr.write("usage: redcell-hook.mjs ledger-stop --manual <role> <purpose> <tokens> <ms> [--model <m>]\n");
        return;
      }
      // SubagentStop: the run's end, with its own minutes and tokens, beside its dispatch row.
      const own = sessionTree(input, cwd);
      if (!own) return;
      let gitDir = git(own, ["rev-parse", "--git-common-dir"]);
      if (!gitDir) return;
      if (!isAbsolute(gitDir)) gitDir = join(own, gitDir);
      let text = "";
      try { text = readFileSync(String(input.agent_transcript_path || ""), "utf8"); } catch {}
      const row = {
        event: "stop",
        agent_id: input.agent_id || "",
        // The dispatch row's id (its tool_use_id), so the board fills that run's tokens and minutes.
        ...(transcriptDispatch(input.agent_transcript_path) && { dispatch: transcriptDispatch(input.agent_transcript_path) }),
        // Where the run's transcript is, so the board reads a Security verdict from it (rc-security piece 3).
        ...(typeof input.agent_transcript_path === "string" && input.agent_transcript_path && { transcript: input.agent_transcript_path }),
        ts: new Date().toISOString(),
        session: input.session_id || "",
        role: input.agent_type || "",
        ...transcriptUsage(text),
        ...boardId(own),
      };
      const dir = join(gitDir, "redcell");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "ledger.jsonl"), JSON.stringify(row) + "\n");
      return;
    }
    case "session-clear": {
      // PostToolUse(ExitWorktree): the session has left its worktree.
      const sid = String(input.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
      const common = commonDir(input.cwd || cwd) || commonDir(cwd);
      if (sid && common) rmSync(join(common, "redcell", `session-${sid}.json`), { force: true });
      return;
    }
    case "steward":
      steward(process.argv[3] || "", input, cwd);
      return;
    case "touch":
      touch(input, cwd);
      return;
    default:
      return;
  }
}

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
  try {
    main(process.argv[2]);
  } catch {
    // never fail a session
  }
  process.exit(0);
}
