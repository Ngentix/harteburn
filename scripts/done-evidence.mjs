#!/usr/bin/env node
// The Done evidence file has one section per Done line, or the Done review is not dispatched
// (retro 2026-10-28, a 2026-10-28 product retro, ch ratified Change 3: the first Done read came back "not done"
// on D3 and D4 only because the Lead's evidence never showed them; a second gather and run followed).
//
//   node done-evidence.mjs init  <board.json> <evidence.md>   writes the skeleton (refuses to overwrite)
//   node done-evidence.mjs check <board.json> <evidence.md>   exit 1 naming each line with no evidence
//
// A section is "## D<n> · <the line's text>". It is empty while it holds only the placeholder or
// whitespace. Lines of kind "gate" are listed too; only outcome lines (the default) are required.

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER = "_(no evidence yet: what production showed for this line, read-only, facts only)_";

const isOutcome = (d) => (d?.kind ?? "outcome") === "outcome";

export function skeleton(rec) {
  const lines = rec.done_when || [];
  const head = `# ${rec.id ?? "objective"} · Done evidence\n\nFacts only, no conclusions. One section per Done line; \`done-evidence.mjs check\` refuses an empty one before Product is dispatched.\n\nStage and version read: _(the running version, the environment, the clock)_\n`;
  return head + lines.map((d, i) => `\n## D${i + 1} · ${String(d.text ?? "").replace(/\s+/g, " ").trim()}\n\n${PLACEHOLDER}\n`).join("");
}

/** Done lines whose section is missing or empty, as "D<n>". */
export function missing(rec, md) {
  const sections = new Map();
  const re = /^## D(\d+)\b[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  for (const m of md.matchAll(re)) sections.set(Number(m[1]), m[2]);
  return (rec.done_when || []).flatMap((d, i) => {
    if (!isOutcome(d)) return [];
    const body = (sections.get(i + 1) ?? "").replace(PLACEHOLDER, "").trim();
    return body ? [] : [`D${i + 1}`];
  });
}

// Started by its own path? Real paths on both sides (tests/main-guard).
function startedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedDirectly()) {
  const [cmd, boardPath, evPath] = process.argv.slice(2);
  if (!["init", "check"].includes(cmd) || !boardPath || !evPath) {
    console.error("usage: done-evidence.mjs init|check <board.json> <evidence.md>");
    process.exit(2);
  }
  const rec = JSON.parse(readFileSync(boardPath, "utf8"));
  if (cmd === "init") {
    if (existsSync(evPath)) {
      console.error(`refused: ${evPath} exists; check it instead`);
      process.exit(1);
    }
    writeFileSync(evPath, skeleton(rec));
    console.log(`${evPath}: ${(rec.done_when || []).length} sections`);
  } else {
    if (!existsSync(evPath)) {
      console.error(`refused: ${evPath} does not exist; run init first`);
      process.exit(1);
    }
    const gaps = missing(rec, readFileSync(evPath, "utf8"));
    if (gaps.length) {
      console.error(`refused: no evidence for ${gaps.join(", ")}. Read each in production before dispatching the Done review.`);
      process.exit(1);
    }
    console.log(`evidence: every Done line has a section`);
  }
}
