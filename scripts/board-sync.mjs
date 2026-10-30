// Push the local board when a license file is present. No license, no network.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { phone } from "./phone.mjs";
import { readLicense, harteburnHome } from "./login.mjs";

const BOARD_ID = /[^A-Za-z0-9._-]/g;

export async function pushBoard(root, opts = {}) {
  const lic = readLicense(opts.home || harteburnHome());
  if (!lic?.key) return { sent: false, reason: "no license" };
  const src = join(root, ".redcell", "board.json");
  if (!existsSync(src)) return { sent: false, reason: "no board" };
  const record = JSON.parse(readFileSync(src, "utf8"));
  const id = String(record.id || "board").replace(BOARD_ID, "").slice(0, 80) || "board";
  return phone("board", { id, record }, opts);
}

export async function pushLedger(root, opts = {}) {
  const lic = readLicense(opts.home || harteburnHome());
  if (!lic?.key) return { sent: false, reason: "no license" };
  const file = join(root, ".git", "redcell", "ledger.jsonl");
  if (!existsSync(file)) return { sent: false, reason: "no ledger" };
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-20).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  if (!rows.length) return { sent: false, reason: "no rows" };
  return phone("ledger", rows, opts);
}
