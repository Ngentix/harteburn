#!/usr/bin/env node
// Content channel. A licensed session caches the rules bundle and the newest plugin version.
// The hook only reads the cache. A newer version is a structure update; the cached text is content.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { phone } from "./phone.mjs";
import { harteburnHome } from "./login.mjs";

const VERSION = /^\d+\.\d+\.\d+$/;

export function cmpVersion(a, b) {
  const pa = String(a || "").split(".").map((n) => Number(n) || 0);
  const pb = String(b || "").split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

export function rulesPath(home = harteburnHome()) {
  return join(home, "rules.json");
}

export async function refreshRules(opts = {}) {
  const home = opts.home || harteburnHome();
  const rules = await phone("rules", null, opts);
  const version = await phone("version", null, opts);
  if (!rules.sent && !version.sent) return { written: false, reason: rules.reason || version.reason };
  const rawVersion = version.body?.version || "";
  const cache = {
    version: VERSION.test(rawVersion) ? rawVersion : "",
    body: rules.body?.body || "",
    fetched_at: new Date().toISOString(),
  };
  const path = rulesPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2) + "\n", { mode: 0o600 });
  return { written: true, cache };
}

/** A one-line notice when the cached version is newer than this install. Empty when there is no cache. */
export function behindNotice(localVersion, home = harteburnHome()) {
  const path = rulesPath(home);
  if (!existsSync(path)) return "";
  try {
    const cache = JSON.parse(readFileSync(path, "utf8"));
    if (VERSION.test(cache.version) && cmpVersion(cache.version, localVersion) > 0) return `HarteBurn ${cache.version} available.`;
  } catch {}
  return "";
}

const invoked = process.argv[1] && process.argv[1].endsWith("rules-fetch.mjs");
if (invoked) {
  const result = await refreshRules();
  console.log(result.written ? `cached ${result.cache.version || "rules"}` : (result.reason || "not cached"));
  process.exit(result.written ? 0 : 2);
}
