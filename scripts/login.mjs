#!/usr/bin/env node
// HarteBurn login. Stores a license key under REDCELL_HOME and re-checks it.
// A failed check still passes while grace_until is in the future (24 hours from the last good verify).
// A good check also caches the rules bundle. Other scripts send only when this file exists.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_URL = "https://harteburn.ngentix.ai";

export function harteburnHome(env = process.env) {
  return env.REDCELL_HOME || join(homedir(), ".claude", "redcell");
}

export function licensePath(home = harteburnHome()) {
  return join(home, "harteburn.json");
}

export function readLicense(home = harteburnHome()) {
  const path = licensePath(home);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeLicense(record, home = harteburnHome()) {
  const path = licensePath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  return path;
}

export function graceStillGood(record, now = Date.now()) {
  if (!record?.grace_until || !record?.key) return false;
  const until = Date.parse(record.grace_until);
  return Number.isFinite(until) && until > now;
}

export async function verifyLicense({ url = DEFAULT_URL, key, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(url.replace(/\/$/, "") + "/v1/license/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const body = await res.json();
  return { ok: res.ok && body.ok === true, status: res.status, body };
}

export async function login({ key, url = DEFAULT_URL, home = harteburnHome(), fetchImpl = globalThis.fetch, now = Date.now() }) {
  const saved = readLicense(home);
  const useKey = key || saved?.key || "";
  if (!useKey) {
    return { code: 2, message: `No license key. Subscribe at ${url.replace(/\/$/, "")}/` };
  }
  try {
    const result = await verifyLicense({ url, key: useKey, fetchImpl });
    if (!result.ok) return { code: 1, message: result.body.reason || "the license is not active" };
    writeLicense({ key: useKey, tier: result.body.tier, grace_until: result.body.grace_until, org_id: result.body.org_id }, home);
    try {
      const { refreshRules } = await import("./rules-fetch.mjs");
      await refreshRules({ url, home, fetchImpl });
    } catch {}
    return { code: 0, message: `HarteBurn ${result.body.tier}. Offline grace until ${result.body.grace_until}.` };
  } catch {
    if (graceStillGood(saved, now) && (!key || key === saved.key)) {
      return { code: 0, message: `Offline grace until ${saved.grace_until}.` };
    }
    return { code: 1, message: "HarteBurn did not answer, and there is no offline grace." };
  }
}

const invoked = process.argv[1] && process.argv[1].endsWith("login.mjs");
if (invoked) {
  const args = process.argv.slice(2);
  const keyFlag = args.indexOf("--key");
  const key = keyFlag >= 0 ? args[keyFlag + 1] : "";
  const url = process.env.HARTEBURN_URL || DEFAULT_URL;
  const result = await login({ key, url });
  console.log(result.message);
  process.exit(result.code);
}
