// Push the local board when a license file is present and the owner turned sync on for this repo
// (login.mjs --sync-here lists it in harteburn.json's `sync`; nothing in the repo can). No license, no network.
// Ledger rows leave with only LEDGER_FIELDS, and only rows newer than the last one sent.

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { phone } from "./phone.mjs";
import { readLicense, licenseHome } from "./login.mjs";

const BOARD_ID = /[^A-Za-z0-9._-]/g;
export const LEDGER_FIELDS = ["ts", "event", "role", "board", "tokens", "minutes", "model"];
const BATCH = 100;

function syncedLicense(root, opts) {
  const lic = readLicense(opts.home || licenseHome());
  if (!lic?.key) return { reason: "no license" };
  let here;
  try { here = realpathSync(root); } catch { return { reason: "no repo" }; }
  const listed = Array.isArray(lic.sync) && lic.sync.some((p) => {
    try { return typeof p === "string" && isAbsolute(p) && realpathSync(p) === here; } catch { return false; }
  });
  return listed ? { lic } : { reason: "sync is off for this repo" };
}

export async function pushBoard(root, opts = {}) {
  const { lic, reason } = syncedLicense(root, opts);
  if (!lic) return { sent: false, reason };
  const src = join(root, ".redcell", "board.json");
  if (!existsSync(src)) return { sent: false, reason: "no board" };
  const record = JSON.parse(readFileSync(src, "utf8"));
  const id = String(record.id || "board").replace(BOARD_ID, "").slice(0, 80) || "board";
  return phone("board", { id, record }, opts);
}

function trimRow(row) {
  const out = {};
  for (const k of LEDGER_FIELDS) if (typeof row[k] === "string" || typeof row[k] === "number") out[k] = row[k];
  return out;
}

export async function pushLedger(root, opts = {}) {
  const { lic, reason } = syncedLicense(root, opts);
  if (!lic) return { sent: false, reason };
  const file = join(root, ".git", "redcell", "ledger.jsonl");
  if (!existsSync(file)) return { sent: false, reason: "no ledger" };
  const cursorFile = join(root, ".git", "redcell", "ledger.sent");
  const last = existsSync(cursorFile) ? readFileSync(cursorFile, "utf8").trim() : "";
  const fresh = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((r) => r && typeof r.ts === "string" && r.ts > last);
  if (!fresh.length) return { sent: false, reason: "nothing new" };
  // The cursor is a ts, so a batch never ends inside a run of rows sharing one ts: the rest would be skipped.
  let end = Math.min(BATCH, fresh.length);
  if (end < fresh.length) {
    const edge = fresh[end].ts;
    while (end > 0 && fresh[end - 1].ts === edge) end--;
    if (end === 0) end = BATCH; // 100+ rows in one millisecond: send a full batch
  }
  const rows = fresh.slice(0, end).map(trimRow);
  const result = await phone("ledger", rows, opts);
  if (result.sent) writeFileSync(cursorFile, rows[rows.length - 1].ts + "\n");
  return result;
}
