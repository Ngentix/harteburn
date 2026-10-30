// The retro Changes HarteBurn still carries (jg 2026-10-27: HarteBurn is project agnostic). A Change
// is closed when its status ends `worked`, `dropped` or `moved to <repo>`: a Change to one project's
// code, tests or setup lives in that project's repo, never on HarteBurn's carry list.
//   node scripts/open-changes.mjs [retros dir]   prints each open Change; `proposed` ones go to the owner first
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RETROS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "retros");
const HEADER = /^\|\s*#\s*\|\s*Change\s*\|/;
const CLOSED = /^(worked|dropped|moved to\b)/i;

const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** The last step of a status chain ("ratified → done in 0.21.1 → worked"), bold marks left out. */
export const lastStep = (status) => status.split("→").pop().replace(/\*\*/g, "").trim();

/** Every Change row in a retro's Actions tables: {n, change, status}. */
export function changesIn(text) {
  const out = [];
  let inTable = false;
  for (const line of text.split("\n")) {
    if (HEADER.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (!line.startsWith("|")) { inTable = false; continue; }
    const c = cells(line);
    if (/^-+$/.test(c[0]) || !c[0]) continue;
    out.push({ n: c[0], change: c[1], status: c[c.length - 1] });
  }
  return out;
}

/** Open Changes across `retros/*-retro-*.md`: {file, n, title, status, proposed}. */
export function openChanges(dir = RETROS) {
  return readdirSync(dir).filter((f) => /-retro-.*\.md$/.test(f)).sort().flatMap((file) =>
    changesIn(readFileSync(join(dir, file), "utf8"))
      .filter((c) => !CLOSED.test(lastStep(c.status)))
      .map((c) => ({
        file, n: c.n,
        title: (c.change.match(/\*\*(.+?)\*\*/)?.[1] || c.change).slice(0, 140),
        status: lastStep(c.status),
        proposed: /^proposed\b/i.test(c.status.replace(/\*\*/g, "")) && !/ratified/i.test(c.status),
      })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const list = openChanges(process.argv[2] ? resolve(process.argv[2]) : RETROS);
  for (const c of list) console.log(`${c.proposed ? "PROPOSED (owner first) " : ""}${c.file} #${c.n}: ${c.title} [${c.status.slice(0, 60)}]`);
  console.log(`${list.length} open`);
}
