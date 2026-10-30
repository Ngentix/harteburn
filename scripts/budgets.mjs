// Word budgets for every file a HarteBurn run loads (rc-steward, jg 2026-10-28). A file over its
// budget is a problem until it is trimmed, or a raise is recorded in budgets.json with its date,
// words, why and who approved it. This file only reads: it never edits or deletes a rule.
//   node scripts/budgets.mjs [root]   prints each file's words against its budget, and the total
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Words in a page, its frontmatter left out (the count designer.test.mjs used for its 800 cap). */
export const words = (text) => text.replace(/^---\n[\s\S]*?\n---/, "").split(/\s+/).filter(Boolean).length;

/** agents/*.md, skills/<name>/SKILL.md, ethos.md and bookends.md: what every run or session loads. */
export function loadedFiles(root = ROOT) {
  const list = (d) => (existsSync(join(root, d)) ? readdirSync(join(root, d), { withFileTypes: true }) : []);
  return [
    ...list("agents").filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => `agents/${e.name}`),
    ...list("skills").filter((e) => e.isDirectory() && existsSync(join(root, "skills", e.name, "SKILL.md"))).map((e) => `skills/${e.name}/SKILL.md`),
    ...["ethos.md", "bookends.md"].filter((f) => existsSync(join(root, f))),
  ].sort();
}

const realDate = (d) => DATE.test(String(d)) && !isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
/** A raise counts with a real date, a number, a reason and a named approver. */
const validRaise = (r) => realDate(r?.date) && Number.isFinite(r?.words) && String(r?.why || "").trim() && /\w{2}/.test(String(r?.approved || ""));

/** The budget in force: the latest-dated valid raise, else the base; not a number = no budget. */
export function budgetOf(entry) {
  const valid = (entry?.raises || []).filter(validRaise).sort((a, b) => a.date.localeCompare(b.date));
  const n = valid.length ? valid[valid.length - 1].words : entry?.words;
  return Number.isFinite(n) ? n : undefined;
}

/** A base above the committed one is a raise nobody recorded: bases are only ever lowered. */
export function baseRaises(head, now) {
  const before = head?.files || {};
  return Object.entries(now?.files || {}).filter(([f, e]) => Number.isFinite(before[f]?.words) && e?.words > before[f].words)
    .map(([f, e]) => `${f}: base ${before[f].words} → ${e.words} without a raise (lower it back, or record a raise)`);
}

export function budgetProblems(root = ROOT) {
  const record = JSON.parse(readFileSync(join(root, "budgets.json"), "utf8")).files || {};
  const out = [];
  for (const f of loadedFiles(root)) {
    if (budgetOf(record[f]) === undefined) { out.push(`${f}: no budget (add it to budgets.json)`); continue; }
    const n = words(readFileSync(join(root, f), "utf8")), max = budgetOf(record[f]);
    if (n > max) out.push(`${f}: ${n} words, budget ${max} (trim it, or add a dated raise the owner approved)`);
  }
  return out;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = process.argv[2] ? resolve(process.argv[2]) : ROOT;
  const record = JSON.parse(readFileSync(join(root, "budgets.json"), "utf8")).files || {};
  let total = 0;
  for (const f of loadedFiles(root)) {
    const n = words(readFileSync(join(root, f), "utf8"));
    total += n;
    console.log(`${String(n).padStart(6)} / ${String(budgetOf(record[f]) ?? "—").padStart(5)}  ${f}`);
  }
  console.log(`${String(total).padStart(6)}  total`);
  const problems = budgetProblems(root);
  for (const p of problems) console.error(`over: ${p}`);
  process.exit(problems.length ? 1 : 0);
}
