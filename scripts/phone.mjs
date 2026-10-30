#!/usr/bin/env node
// Phone-home for the scripts, never the hooks. No license file, no send.
// A Change is sent only after redact.mjs and an explicit --yes, so the owner has seen the stripped text.
// The address is the one stored at login, never the environment.

import { readFileSync } from "node:fs";
import { readLicense, licenseHome, DEFAULT_URL } from "./login.mjs";
import { redactChange } from "./redact.mjs";

export async function phone(kind, payload, { home, url, fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  const lic = readLicense(home || licenseHome());
  if (!lic?.key) return { sent: false, reason: "no license" };
  const base = (url || lic.url || DEFAULT_URL).replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${lic.key}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = ctrl.signal;
  try {
    let res;
    if (kind === "ledger") {
      res = await fetchImpl(base + "/v1/ledger", { method: "POST", headers, body: JSON.stringify({ rows: payload }), signal });
    } else if (kind === "board") {
      res = await fetchImpl(`${base}/v1/boards/${encodeURIComponent(payload.id)}`, { method: "PUT", headers, body: JSON.stringify(payload.record), signal });
    } else if (kind === "change") {
      res = await fetchImpl(base + "/v1/changes", { method: "POST", headers, body: JSON.stringify(payload), signal });
    } else if (kind === "rules") {
      res = await fetchImpl(base + "/v1/rules", { headers, signal });
    } else if (kind === "version") {
      res = await fetchImpl(base + "/v1/version", { signal });
    } else return { sent: false, reason: "unknown" };
    const body = await res.json().catch(() => ({}));
    return { sent: res.ok, status: res.status, body };
  } catch (err) {
    return { sent: false, reason: err.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

const invoked = process.argv[1] && process.argv[1].endsWith("phone.mjs");
if (invoked) {
  const kind = process.argv[2];
  const file = process.argv[3];
  const yes = process.argv.includes("--yes");
  if (kind === "change") {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const redacted = redactChange(raw);
    if (!yes) {
      console.log(JSON.stringify(redacted, null, 2));
      console.error("Not sent. Re-run with --yes after the owner has read this.");
      process.exit(2);
    }
    const result = await phone("change", redacted.fields);
    console.log(result.sent ? "sent" : result.reason);
    process.exit(result.sent ? 0 : 1);
  }
  console.error("usage: phone.mjs change <file.json> [--yes]");
  process.exit(2);
}
