#!/usr/bin/env node
// HarteBurn login. Stores a license key in ~/.claude/redcell and re-checks it.
// A failed check still passes while grace_until is in the future (24 hours from the last good verify).
// A good check also caches the rules bundle. Other scripts send only when this file exists.
// The address is the one the owner typed with --url at login (stored as `url`), never the
// environment: a cloned repo's settings could set it and send the key elsewhere.
// --sync-here, run in a repo, lists that repo in `sync`; nothing else turns its sync on.
// The folder comes from the account record (os.userInfo), never from HOME or REDCELL_HOME: a project's
// settings can set both (jg 2026-10-30, the Architect's ruling-1793393000). Tests pass --home <absolute>.
// rules-fetch is imported statically: a dynamic import here deadlocked the top-level await
// (login -> rules-fetch -> phone -> login).

import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { refreshRules } from "./rules-fetch.mjs";

export const DEFAULT_URL = "https://harteburn.ngentix.ai";

export const licenseHome = () => join(userInfo().homedir, ".claude", "redcell");

/** A script's --home <absolute> (tests only: a project's settings cannot add arguments), else licenseHome(). */
export function homeFlag(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--home");
  if (i < 0) return licenseHome();
  const dir = argv[i + 1] || "";
  if (!isAbsolute(dir)) {
    console.error("--home takes an absolute folder.");
    process.exit(2);
  }
  return dir;
}

export function licensePath(home = licenseHome()) {
  return join(home, "harteburn.json");
}

export function readLicense(home = licenseHome()) {
  const path = licensePath(home);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeLicense(record, home = licenseHome()) {
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

export async function login({ key, url, home = licenseHome(), fetchImpl = globalThis.fetch, now = Date.now() }) {
  const saved = readLicense(home);
  url = url || saved?.url || DEFAULT_URL;
  const useKey = key || saved?.key || "";
  if (!useKey) {
    return { code: 2, message: `No license key. Subscribe at ${url.replace(/\/$/, "")}/` };
  }
  try {
    const result = await verifyLicense({ url, key: useKey, fetchImpl });
    if (!result.ok) return { code: 1, message: result.body.reason || "the license is not active" };
    writeLicense({ ...saved, key: useKey, url, tier: result.body.tier, grace_until: result.body.grace_until, org_id: result.body.org_id }, home);
    try {
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

/** Turn sync on for the repo holding cwd: its real path joins `sync` once. */
export function syncHere({ cwd = process.cwd(), home = licenseHome() } = {}) {
  const saved = readLicense(home);
  if (!saved?.key) return { code: 2, message: "No license key. Run login.mjs --key first." };
  let root;
  try {
    root = realpathSync(execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return { code: 2, message: "Not in a git repo. Run --sync-here inside the repo to sync." };
  }
  const listed = (Array.isArray(saved.sync) ? saved.sync : []).filter((p) => typeof p === "string");
  const same = (p) => { try { return realpathSync(p) === root; } catch { return false; } };
  if (!listed.some(same)) writeLicense({ ...saved, sync: [...listed, root] }, home);
  return { code: 0, message: `Sync is on for ${root}.` };
}

function urlFlag(raw) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" || u.protocol === "http:") return raw;
  } catch {}
  return null;
}

const invoked = process.argv[1] && process.argv[1].endsWith("login.mjs");
if (invoked) {
  const args = process.argv.slice(2);
  const flag = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || "" : "");
  const home = homeFlag(args);
  if (args.includes("--sync-here")) {
    const result = syncHere({ home });
    console.log(result.message);
    process.exit(result.code);
  }
  const url = urlFlag(flag("--url"));
  if (url === null) {
    console.log("--url takes an http or https address.");
    process.exit(2);
  }
  const result = await login({ key: flag("--key"), url: url || undefined, home });
  console.log(result.message);
  process.exit(result.code);
}
