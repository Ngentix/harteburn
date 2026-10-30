#!/usr/bin/env node
// Keep Problem, Cause, Change and How we'll know. Strip identifiers before anything leaves the machine.
// The owner reads the stripped list. Nothing here sends.

import { readFileSync } from "node:fs";

const RULES = [
  ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ["url", /https?:\/\/\S+/gi],
  ["ticket", /\b[A-Z]{2,}(?:-[A-Z]{2,})?-\d+\b/g],
  ["secret", /\b(?:sy_|sk_|rk_|whsec_)[A-Za-z0-9_-]{8,}\b/g],
  ["hex", /\b[a-f0-9]{16,}\b/gi],
];

export function redactText(text) {
  const removed = [];
  let out = String(text ?? "");
  for (const [kind, re] of RULES) {
    out = out.replace(re, (sample) => {
      removed.push({ kind, sample: sample.slice(0, 32) });
      return "[removed]";
    });
  }
  return { text: out, removed };
}

/** The four fields a fleet Change may carry, plus every identifier that was stripped. */
export function redactChange(fields = {}) {
  const out = {};
  const removed = [];
  for (const key of ["problem", "cause", "change", "how"]) {
    const part = redactText(fields[key] || "");
    out[key] = part.text;
    for (const hit of part.removed) removed.push({ ...hit, field: key });
  }
  return { fields: out, removed };
}

const invoked = process.argv[1] && process.argv[1].endsWith("redact.mjs");
if (invoked) {
  const file = process.argv[2];
  const raw = file ? JSON.parse(readFileSync(file, "utf8")) : JSON.parse(readFileSync(0, "utf8"));
  const result = redactChange(raw);
  console.log(JSON.stringify(result, null, 2));
}
