// The acceptance walkthrough helpers, shared by prove-prompt.mjs and piece-pack.mjs (0.19.0).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export function walkthrough(md, mdPath) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^## (0\.\s*)?Acceptance Walkthrough/i.test(l) || /^## 0\./.test(l));
  if (start >= 0) {
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) end = lines.length;
    const section = lines.slice(start, end).join("\n");
    const linked = section.match(/\(\.?\/?(ACCEPTANCE-[^)#]+\.md)\)/);
    if (section.split("\n").length < 6 && linked) {
      const p = join(dirname(mdPath), linked[1]);
      if (existsSync(p)) return { source: p, text: readFileSync(p, "utf8") };
    }
    return { source: mdPath + " §0", text: section };
  }
  const linked = md.match(/\(\.?\/?(ACCEPTANCE-[^)#]+\.md)\)/);
  if (linked) {
    const p = join(dirname(mdPath), linked[1]);
    if (existsSync(p)) return { source: p, text: readFileSync(p, "utf8") };
  }
  return null;
}

/** The walkthrough's steps, in order, as line ranges [start, end). A step is a numbered subheading
 * (`### 0.1 — …`, `### W2 …`, `### Step 3`), or else a numbered item at the line's start (`1. …`,
 * `**1. …**`). A heading step runs to the next heading at its level or above; an item runs to the
 * next item or the next heading. */
export function stepRanges(text) {
  const lines = text.split("\n");
  const level = (l) => (/^(#{1,6})\s/.exec(l) || [, ""])[1].length;
  const headed = lines.map((l, i) => (/^#{3,6}\s+(\d+(\.\d+)*|W\d+|Step\s+\d+)\b/i.test(l) ? i : -1)).filter((i) => i >= 0);
  const items = lines.map((l, i) => (/^(\*\*)?\d+\.\s/.test(l) ? i : -1)).filter((i) => i >= 0);
  const starts = headed.length ? headed : items;
  return starts.map((s, k) => {
    let e = s + 1;
    for (; e < lines.length; e++) {
      if (starts[k + 1] === e) break;
      const lv = level(lines[e]);
      if (lv && (headed.length ? lv <= level(lines[s]) : true)) break;
    }
    return [s, e];
  });
}

/** The walkthrough with only steps a..b (1-based) kept; every other line (setup, parts, limits)
 * stays. Each run of left-out steps becomes one line saying so. */
export function keepSteps(text, a, b) {
  const lines = text.split("\n");
  const ranges = stepRanges(text);
  const drop = new Map(); // line -> step number, for lines of left-out steps
  ranges.forEach(([s, e], k) => {
    if (k + 1 < a || k + 1 > b) for (let i = s; i < e; i++) drop.set(i, k + 1);
  });
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!drop.has(i)) {
      out.push(lines[i]);
      continue;
    }
    const first = drop.get(i);
    let last = first;
    while (i + 1 < lines.length && drop.has(i + 1)) last = drop.get(++i);
    out.push(`_(step${first === last ? ` ${first}` : `s ${first}–${last}`} of ${ranges.length}: another member of the swarm proves ${first === last ? "it" : "them"})_`, "");
  }
  return out.join("\n");
}

/** The screens a walkthrough names: each local page path (`/buyer/keys`, `GET /partner`) that is not
 * an API route (`/v1/…`), a POST endpoint or a file, deduplicated, with `:param`/`<id>` segments kept. Retro 2026-10-28
 * (a 2026-10-28 product retro, ch ratified Change 1): every piece still had link, help, session or failure-state
 * finds after Build although Ready named them; the rows below make them red tests before it. */
export function screensOf(text) {
  const found = new Set();
  for (const m of text.matchAll(/(?:^|[\s`(\["'])(?:(GET|POST)\s+)?(\/[a-z][a-z0-9_-]*(?:\/(?::?[a-z0-9_-]+|<[a-z_]+>|\{[a-z_]+\}))*)/gi)) {
    if (/^POST$/i.test(m[1] ?? "")) continue; // a form's endpoint, not a screen a person sees
    const p = m[2].replace(/[.,;:]+$/, "");
    if (/^\/(v\d+|api|static|assets|tmp|home|users|usr|etc|var|dev|mnt)(\/|$)/i.test(p)) continue;
    if (/\.[a-z0-9]{1,5}$/i.test(p)) continue;
    found.add(p);
  }
  return [...found];
}

export const SCREEN_ROWS = [
  "links: every local link on it opens (not 401/403/404/5xx) under the cookie that page is reached with, in each state the walkthrough shows it",
  "help: the help it serves equals its help file, and says nothing the page does not do",
  "session: sign-out and expiry (and revoke, where the walkthrough has one) each end the session that reaches it; after them it redirects to its sign-in",
  "failure: each refusal, source failure, crash or repeat the walkthrough or the Ready ruling names for it shows its own sentence and the money it really moved",
];

