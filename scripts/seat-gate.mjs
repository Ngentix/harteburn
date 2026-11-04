// The board's seat check (hb-seats-1 piece 4). On a Team license, a done piece whose Done lines,
// scope or docs/architecture changed since it started needs the right seat's typed go. A risk
// accept counts only from the security owner. Cloud, and a machine with no license, is unchanged.
// A go or an accept counts only when the transcript shows the owner typed that one line, and the
// seats copied onto the row still verify.

import { execFileSync } from "node:child_process";
import { readLicense } from "./login.mjs";
import { licenseHome } from "./paths.mjs";
import { acceptances, ownerTypedLines } from "./board-security.mjs";
import { SEAT_PUBLIC_KEY, seatRefusal, seatVerdict, verifiedSeats } from "./seats.mjs";

const git = (cwd, args) =>
  execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function architectureChanged(root, from) {
  if (!/^[0-9a-f]{40}$/i.test(String(from || ""))) return false;
  try {
    const named = git(root, ["diff", "--name-only", "--end-of-options", from, "--", "docs/architecture"]);
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "--", "docs/architecture"]);
    return [named, untracked].join("\n").split("\n").some((l) => l === "docs/architecture" || l.startsWith("docs/architecture/"));
  } catch {
    return true;
  }
}

function trustedGos(root, id, ledger, env) {
  const said = new Map();
  const out = [];
  for (const row of ledger || []) {
    if (row?.event !== "go" || row.board !== id || !Number.isInteger(row.piece)) continue;
    if (!said.has(row.transcript)) said.set(row.transcript, ownerTypedLines(root, row.transcript, env));
    const re = new RegExp(`^go\\s+piece\\s+${row.piece}\\s*:\\s*$`, "i");
    if (said.get(row.transcript).some((t) => re.test(t.text))) out.push(row);
  }
  return out;
}

/**
 * Seat refusals for this render. `ledger` is the one Security should read: a Team accept that is
 * not the security owner's is taken out, so it cannot clear a verdict. The license is read from the
 * account's home and the key is the pinned one, never the environment's (F1, F2); tests pass both.
 */
export function seatGate(root, rec, stamps, ledger, { env = process.env, now = Date.now(), home = licenseHome(), publicKey = SEAT_PUBLIC_KEY } = {}) {
  const none = { problems: [], shown: {}, ledger };
  if (!root || !rec?.id) return none;
  let license = null;
  try { license = readLicense(home); } catch { license = null; }
  if (license?.tier !== "team") return none;
  const orgId = license.org_id || "";
  const problems = [];
  const shown = {};
  const drop = new Set();
  const gos = trustedGos(root, rec.id, ledger, env);
  for (const a of acceptances(root, rec.id, ledger, { env })) {
    const row = (ledger || []).find((r) => r?.id === a.id);
    const ok = verifiedSeats({ org_id: orgId, seats: row?.seats }, publicKey, now).some((s) => s.role === "security-owner");
    if (!ok) {
      drop.add(a.id);
      problems.push(seatRefusal(`Piece ${a.piece}: a risk accept needs the security owner`));
    }
  }
  for (const p of rec.pieces || []) {
    const finished = ["done", "dropped"].includes(p.state);
    const open = p.state === "doing";
    if (!finished && !open) continue;
    const base = stamps?.pieces?.[p.n]?.seat;
    if (!base) continue;
    // A hand edit to Done lines is refused while the piece is still open. Scope and
    // architecture are held when the piece is stamped done.
    const changes = {
      doneLines: JSON.stringify(rec.done_when ?? []) !== base.done,
      scope: finished && JSON.stringify(rec.scope ?? []) !== base.scope,
      architecture: finished && architectureChanged(root, base.arch),
    };
    if (open && !changes.doneLines) continue;
    const rows = gos.filter((g) => g.piece === p.n);
    const go = rows.length ? { seats: rows.flatMap((g) => g.seats || []) } : null;
    const verdict = seatVerdict({ license, publicKey, now, piece: p.n, changes, go });
    problems.push(...verdict.problems);
    if (verdict.shown) shown[p.n] = verdict.shown;
  }
  return {
    problems,
    shown,
    ledger: drop.size ? (ledger || []).filter((r) => !(r?.event === "accept" && drop.has(r.id))) : ledger,
  };
}
