#!/usr/bin/env node
// Scores a repo's architecture brief against its answer key.
//
//   node score-brief.mjs [repo]        default: the git root of the current directory
//
// Two arms, each one headless Claude call from an empty scratch directory (no repo, no
// CLAUDE.md of the project, no memory, no tools, no connectors, HarteBurn's own hooks off):
//   brief    the questions plus docs/architecture/BRIEF.md as the only reference
//   control  the same questions with no reference
// A third call, the judge, marks each answer against docs/architecture/BRIEF-questions.md.
// Pass: brief >= 19 of 20 and control <= 5 of 20. Result: stdout, and <git dir>/redcell/brief-score.json.

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, isAbsolute, basename } from "node:path";

const MODEL = process.env.REDCELL_MODEL || "claude-opus-5-5";
const PASS_WITH = 19;
const MAX_CONTROL = 5;

const repo = process.argv[2] || execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const brief = readFileSync(join(repo, "docs/architecture/BRIEF.md"), "utf8");
const key = parseKey(readFileSync(join(repo, "docs/architecture/BRIEF-questions.md"), "utf8"));
if (key.length < 5) throw new Error(`only ${key.length} questions parsed from BRIEF-questions.md`);

export function parseKey(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    const c = line.split("|").slice(1, -1).map((s) => s.trim());
    if (c.length >= 4 && /^\d+$/.test(c[0])) rows.push({ n: +c[0], q: c[1], expect: c[2], page: c[3] });
  }
  return rows;
}

const scratch = mkdtempSync(join(tmpdir(), "harteburn-score-"));
// HarteBurn's own hooks would add its ethos to these runs; they test the brief, so turn the plugin off.
const settings = JSON.stringify({ enabledPlugins: { "harteburn@ngentix": false } });

function ask(prompt) {
  const r = spawnSync(
    "claude",
    ["-p", "--model", MODEL, "--strict-mcp-config", "--tools", "", "--settings", settings, "--output-format", "json", prompt],
    { cwd: scratch, encoding: "utf8", input: "", maxBuffer: 32 * 1024 * 1024, timeout: 600000 },
  );
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${(r.stderr || "").slice(0, 400)}`);
  const out = JSON.parse(r.stdout);
  const text = out.result || "";
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b < a) throw new Error(`no JSON array in reply: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(a, b + 1));
}

const questions = key.map((k) => `${k.n}. ${k.q}`).join("\n");
const fmt = 'Reply with ONLY a JSON array, no prose: [{"n": 1, "answer": "one sentence"}, ...], one entry per question.';

const withBrief = ask(
  `You are being tested on a reference document. Answer each question in one sentence using ONLY the reference below. ` +
    `If the reference does not answer it, answer exactly "NOT IN REFERENCE". ${fmt}\n\n<reference>\n${brief}\n</reference>\n\nQuestions:\n${questions}`,
);
const control = ask(
  `Answer each question about a software product called ${basename(repo)} in one sentence from your own knowledge. ` +
    `If you do not know, answer exactly "NOT KNOWN". ${fmt}\n\nQuestions:\n${questions}`,
);

function judge(answers) {
  const rows = key
    .map((k) => {
      const a = answers.find((x) => +x.n === k.n);
      return `${k.n}. Q: ${k.q}\n   KEY: ${k.expect}\n   ANSWER: ${a ? a.answer : "(none)"}`;
    })
    .join("\n");
  return ask(
    `You are a strict grader. For each item, mark correct only if the ANSWER states the substance of the KEY ` +
      `(the same rule, not merely compatible with it). An answer of NOT IN REFERENCE or NOT KNOWN is incorrect. A generic or hedged answer is incorrect. ` +
      `Reply with ONLY a JSON array: [{"n": 1, "correct": true, "why": "five words"}, ...].\n\n${rows}`,
  );
}

const marksWith = judge(withBrief);
const marksControl = judge(control);
const score = (m) => m.filter((x) => x.correct === true).length;
const result = {
  ts: new Date().toISOString(),
  model: MODEL,
  questions: key.length,
  with_brief: score(marksWith),
  control: score(marksControl),
  pass: score(marksWith) >= PASS_WITH && score(marksControl) <= MAX_CONTROL,
  misses_with_brief: marksWith
    .filter((m) => m.correct !== true)
    .map((m) => ({ n: m.n, why: m.why, answer: withBrief.find((x) => +x.n === +m.n)?.answer })),
  control_correct: marksControl.filter((m) => m.correct === true).map((m) => m.n),
};

let gitDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repo, encoding: "utf8" }).trim();
if (!isAbsolute(gitDir)) gitDir = join(repo, gitDir);
mkdirSync(join(gitDir, "redcell"), { recursive: true });
writeFileSync(join(gitDir, "harteburn/brief-score.json"), JSON.stringify({ ...result, withBrief, control, marksWith, marksControl }, null, 1));

console.log(`brief score: ${result.with_brief}/${result.questions} with the brief (pass >= ${PASS_WITH}), ${result.control}/${result.questions} without (pass <= ${MAX_CONTROL}) — ${result.pass ? "PASS" : "FAIL"}`);
for (const m of result.misses_with_brief) console.log(`  miss ${m.n}: ${m.why} — "${(m.answer || "").slice(0, 140)}"`);
if (result.control_correct.length) console.log(`  control got right without the brief: ${result.control_correct.join(", ")}`);
process.exit(result.pass ? 0 : 1);
