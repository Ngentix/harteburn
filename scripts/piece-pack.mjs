#!/usr/bin/env node
// One pack per piece, so a role run reads one file instead of the whole record (retro 2026-10-28,
// a 2026-10-28 product retro, ch ratified Change 2: median role run 138k tokens against a 120k target; 21 of 27
// runs over it, each re-reading BRIEF, house rules, the whole PRD and earlier reviews).
//
//   node piece-pack.mjs <prd.md> --steps <a-b> [--base <git ref>] [--ready <file>]... [--max-kb <n>]
//
// Writes <git dir>/redcell/pack-<a>-<b>.md and prints its path and size. The pack holds, in order:
//   - the repo's docs/architecture/BRIEF.md (house rules compiled), verbatim;
//   - the PRD's §0 steps a..b only (prove-prompt.mjs's walkthrough and keepSteps);
//   - each --ready file (the Architect's Ready ruling for the piece), verbatim;
//   - with --base: `git diff --stat <base>` and the list of changed files (never the diff itself:
//     the role reads the files it must cite).
// A role's prompt then names only the pack and the files it must cite. Refused (exit 1) over
// --max-kb (default 120 KB, ~30k tokens), so a pack never becomes the whole record again.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, isAbsolute } from "node:path";
import { walkthrough, stepRanges, keepSteps } from "./walkthrough.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const all = (k) => args.flatMap((a, i) => (a === k && args[i + 1] ? [args[i + 1]] : []));
const VALUED = new Set(["--steps", "--base", "--ready", "--max-kb"]);
const prdArg = args.find((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
const fail = (m, c = 2) => {
  console.error(m);
  process.exit(c);
};
if (!prdArg || !opt("--steps")) fail("usage: piece-pack.mjs <prd.md> --steps <a-b> [--base <ref>] [--ready <file>]... [--max-kb <n>]");

const git = (a, cwd) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const root = git(["rev-parse", "--show-toplevel"], process.cwd());
let gitDir = git(["rev-parse", "--git-common-dir"], root);
if (!isAbsolute(gitDir)) gitDir = join(root, gitDir);

const prdPath = resolve(process.cwd(), prdArg);
const w = walkthrough(readFileSync(prdPath, "utf8"), prdPath);
if (!w) fail(`no acceptance walkthrough in ${prdPath}`, 1);
const m = /^(\d+)(?:-(\d+))?$/.exec(opt("--steps"));
if (!m) fail(`--steps takes a range such as 1-3, not "${opt("--steps")}"`);
const a = Number(m[1]), b = Number(m[2] ?? m[1]);
const n = stepRanges(w.text).length;
if (a < 1 || b < a || b > n) fail(`--steps ${a}-${b}: the walkthrough has steps 1-${n}`);

const briefPath = join(root, "docs/architecture/BRIEF.md");
const parts = [`# Piece pack — steps ${a === b ? a : `${a}–${b}`} of ${n}\n\nAssembled by harteburn/scripts/piece-pack.mjs from files only. Read this first; open other files only to cite them.\n\nRepo: ${root}\nPRD: ${prdPath}\nCommit: ${git(["rev-parse", "HEAD"], root)}\n`];
parts.push(existsSync(briefPath) ? `## The brief (docs/architecture/BRIEF.md)\n\n${readFileSync(briefPath, "utf8").trim()}\n` : `## The brief\n\nnone: ${briefPath} is missing\n`);
parts.push(`## The piece's steps (${w.source})\n\n${keepSteps(w.text, a, b).trim()}\n`);
for (const f of all("--ready")) {
  const p = resolve(process.cwd(), f);
  if (!existsSync(p)) fail(`--ready ${f}: no such file`);
  parts.push(`## Ready: ${f}\n\n${readFileSync(p, "utf8").trim()}\n`);
}
const base = opt("--base");
if (base) {
  const stat = git(["diff", "--stat", base], root);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], root);
  parts.push(`## The change since ${base.slice(0, 12)} (stat only; read the files you cite)\n\n\`\`\`\n${stat || "(no change)"}\n\`\`\`\n` + (untracked ? `\nUntracked:\n${untracked.split("\n").map((f) => "- " + f).join("\n")}\n` : ""));
}
const out = parts.join("\n");
const kb = Buffer.byteLength(out) / 1024;
const max = Number(opt("--max-kb") ?? 120);
if (kb > max) fail(`refused: the pack is ${kb.toFixed(0)} KB, over --max-kb ${max} (~${Math.round(max / 4)}k tokens). Narrow the steps or the Ready files.`, 1);
mkdirSync(join(gitDir, "redcell"), { recursive: true });
const file = join(gitDir, "redcell", `pack-${a}-${b}.md`);
writeFileSync(file, out);
console.log(`${file}\t${kb.toFixed(1)} KB (~${Math.round((kb * 1024) / 4 / 1000)}k tokens)`);
