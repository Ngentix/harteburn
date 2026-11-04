// HarteBurn's paths and names, in one place (hb-seats-1 piece 3, 2026-10-30).
//
// Every script, hook and template imports these; nothing else in the tree spells a folder, an environment
// variable or a role prefix. The LEGACY names are the ones the plugin used before 0.25.0; the first read of
// each folder moves it to its new name (see `migrate`), and the old environment variables and role prefix
// are still honoured, so a product set up before 0.25.0 keeps every record and every CI setting.
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/** The repo folder: board.json, board.md, board.url, handoff.md, settings.json, walk/, changes.json. */
export const BOARD_DIR = ".harteburn";
/** The folder under the git common dir: ledger.jsonl, stamps-*.json, log-*.jsonl, rounds.jsonl, prove-*.md, … */
export const STATE_DIR = "harteburn";
/** Where the plugin keeps what is true for every repo (the license, the steward's standing answers). */
export const HOME_DEFAULT = join(homedir(), ".claude", "harteburn");
export const HOME_ENV = "HARTEBURN_HOME";
export const ENV_PREFIX = "HARTEBURN_";
export const ROLE_PREFIX = "harteburn:";
export const HOOK = "harteburn-hook.mjs";

/** The names before 0.25.0. Read by the migration and the fallbacks; written nowhere. */
export const LEGACY = Object.freeze({
  boardDir: ".redcell",
  stateDir: "redcell",
  homeDir: join(homedir(), ".claude", "redcell"),
  homeEnv: "REDCELL_HOME",
  envPrefix: "REDCELL_",
  rolePrefix: "redcell:",
  hook: "redcell-hook.mjs",
});

/** `HARTEBURN_<name>`, else the old `REDCELL_<name>` (a product's CI may still set it), else undefined. */
export const env = (name, e = process.env) => e[ENV_PREFIX + name] ?? e[LEGACY.envPrefix + name];

/** `<role>` from `harteburn:<role>` or the old `redcell:<role>`, else "". */
export const roleOf = (who) => { const m = /^(?:harteburn|redcell):([a-z-]+)$/.exec(String(who || "")); return m ? m[1] : ""; };
/** True when `who` names `role` under the current or the old prefix (old ledger rows and transcripts keep theirs). */
export const isRole = (who, role) => who === ROLE_PREFIX + role || who === LEGACY.rolePrefix + role;

/** Move `from` to `to` when `to` is absent and `from` is a real folder (never a link); report, never throw. */
function move(from, to, out) {
  try {
    if (existsSync(to)) {
      if (existsSync(from)) out.skipped.push(`${from}: ${to} already exists; nothing moved, nothing merged`);
      return;
    }
    let st;
    try { st = lstatSync(from); } catch { return; } // nothing old to move
    if (st.isSymbolicLink()) { out.skipped.push(`${from}: is a symbolic link; not followed, not moved`); return; }
    renameSync(from, to);
    out.moved.push(`${from} → ${to}`);
  } catch (e) {
    out.skipped.push(`${from}: ${e?.message || e}`);
  }
}

/** Every `.redcell/…` line in the repo's .gitignore becomes `.harteburn/…`; a link or a missing file is left alone. */
function ignoreLines(file, out) {
  try {
    if (!existsSync(file) || lstatSync(file).isSymbolicLink()) return;
    const text = readFileSync(file, "utf8");
    const next = text.split("\n").map((l) => l.replace(new RegExp(`^(\\s*!?/?)${LEGACY.boardDir.replace(".", "\\.")}(?=/|$)`), `$1${BOARD_DIR}`)).join("\n");
    if (next !== text) { writeFileSync(file, next); out.moved.push(`${file}: ignore lines now name ${BOARD_DIR}/`); }
  } catch (e) {
    out.skipped.push(`${file}: ${e?.message || e}`);
  }
}

/** Move the old folders to their new names, once each: the repo's board folder, the state folder under the
 * git common dir, and (with neither home variable set) the home folder. Idempotent; never throws. */
export function migrate(root, gitCommonDir, e = process.env) {
  const out = { moved: [], skipped: [] };
  if (root) {
    const before = out.moved.length;
    move(join(root, LEGACY.boardDir), join(root, BOARD_DIR), out);
    // The repo ignores its board, handoff and rendered page by the old folder name; moved and still ignored
    // by the old name, the next `git add -A` would commit them (Security, piece 3). The ignore lines move too.
    if (out.moved.length > before) ignoreLines(join(root, ".gitignore"), out);
  }
  if (gitCommonDir) move(join(gitCommonDir, LEGACY.stateDir), join(gitCommonDir, STATE_DIR), out);
  if (!e[HOME_ENV] && !e[LEGACY.homeEnv]) move(LEGACY.homeDir, HOME_DEFAULT, out);
  return out;
}

/** `<root>/.harteburn`, after the migration. */
export function boardDir(root) {
  migrate(root, null, { [HOME_ENV]: "x" });
  return join(root, BOARD_DIR);
}
/** `<git common dir>/harteburn`, after the migration. */
export function stateDir(gitCommonDir) {
  migrate(null, gitCommonDir, { [HOME_ENV]: "x" });
  return join(gitCommonDir, STATE_DIR);
}
/** The license folder. The account's home, never `HOME` or a home variable a repo's settings can set.
 * Tests pass `--home`. The old folder is moved once, the same way `migrate` moves it. */
export function licenseHome() {
  let base = homedir();
  try { base = userInfo().homedir || base; } catch {}
  const next = join(base, ".claude", STATE_DIR);
  move(join(base, ".claude", LEGACY.stateDir), next, { moved: [], skipped: [] });
  return next;
}

/** `$HARTEBURN_HOME`, else `$REDCELL_HOME`, else `~/.claude/harteburn` (moved from `~/.claude/redcell` on first read). */
export function homeDir(e = process.env) {
  if (e[HOME_ENV]) return e[HOME_ENV];
  if (e[LEGACY.homeEnv]) return e[LEGACY.homeEnv];
  migrate(null, null, e);
  return HOME_DEFAULT;
}
