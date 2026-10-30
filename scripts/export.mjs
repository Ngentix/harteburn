#!/usr/bin/env node
// HarteBurn export: the same team, written in other tools' own files. No cloud, no Claude Code needed
// to USE the result (Claude Code is still what compiles the brief, or any tool that runs the compiler).
//
//   node export.mjs <target> [--repo <path>] [--out <dir>] [--check]
//
// Targets
//   tools     everything below except `project`, written into the repo:
//               AGENTS.md   (managed block) the way of working + the architecture brief, read by Cursor,
//                           GitHub Copilot, Codex, Windsurf/Devin, Gemini (via GEMINI.md), Zed, Aider, ...
//               cursor      .cursor/agents/harteburn-*.md, .cursor/commands/harteburn-*.md
//               copilot     .github/agents/harteburn-*.agent.md, .github/prompts/harteburn-*.prompt.md
//               codex       .codex/agents/harteburn-*.toml
//               gemini      GEMINI.md (managed block, includes AGENTS.md), .gemini/agents/harteburn-*.md
//               scripts     scripts/harteburn/prove-prompt.mjs (builds the Prover's brief from files only)
//   agents-md | cursor | copilot | codex | gemini     one of the above (cursor/copilot/codex/gemini also write AGENTS.md)
//   project   a claude.ai Project kit in --out (default ./harteburn-project): instructions to paste,
//             knowledge files, one opener per role, a README. Nothing is written into the repo.
//
// --check   write nothing; exit 1 listing every generated file that is missing or out of date.
//           Wire it next to the brief gate so a recompiled brief cannot leave the exports behind.
//
// Sources: this plugin's ethos.md and agents/*.md; the repo's docs/architecture/BRIEF.md and
// docs/_house-rules.md. Generated files say so on their first lines. Edit the sources, not the output.

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROLES = ["prover", "architect", "product", "designer", "security", "architecture-lead", "brief-compiler"];
const START = "<!-- harteburn:start -->";
const END = "<!-- harteburn:end -->";

// ---------- sources ----------

export function parseCharter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("charter has no front matter");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { ...fm, body: m[2].trim() };
}

export function loadSources(repo) {
  const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const charters = {};
  for (const r of ROLES) charters[r] = parseCharter(readFileSync(join(PLUGIN, "agents", `${r}.md`), "utf8"));
  return {
    ethos: readFileSync(join(PLUGIN, "ethos.md"), "utf8").trim(),
    charters,
    brief: read(join(repo, "docs/architecture/BRIEF.md")),
    rules: read(join(repo, "docs/_house-rules.md")),
    proveScript: readFileSync(join(PLUGIN, "scripts/prove-prompt.mjs"), "utf8"),
    walkthroughScript: readFileSync(join(PLUGIN, "scripts/walkthrough.mjs"), "utf8"),
    version: JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin/plugin.json"), "utf8")).version,
  };
}

// The ethos names Claude Code's plugin mechanics; elsewhere the roles are each tool's own subagents.
export function genericEthos(ethos, how) {
  return ethos
    .replace(/ROLES `harteburn:<role>`([.;])/, (_, end) => `ROLES (${how})${end}`);
}

const PRELUDE =
  "Before anything else, read `docs/architecture/BRIEF.md` (this product's architecture, compiled) and " +
  "`docs/_house-rules.md` (the owner's settled rules) if they exist, and honour them. Code beats the " +
  "architecture pages, and the pages beat the brief.";

// A charter as another tool's subagent: no Claude-only references, the brief read explicitly.
export function portableBody(charter, tool) {
  const b = charter.body
    .replace(/The repo's architecture brief and house rules are already in your context[^.]*\.\s*/g, "")
    .replace(/The repo's `CLAUDE\.md`/g, "The repo's `CLAUDE.md` or `AGENTS.md`")
    .replace(/harteburn:([a-z-]+)/g, "harteburn-$1")
    .replace(/`\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//g, "`scripts/harteburn/");
  // The charter itself is never rewritten by pattern (that garbled steps once); a chat gets one rule on top.
  const chat =
    tool === "chat"
      ? "**This is a claude.ai chat: you cannot run code, run tests, or open the app.** Wherever this charter says to run, remove a guard, or look at a page, write instead the exact command or step and the result that would prove or dispel the claim. Every such verdict is **unproven until run**, unless the owner pastes the output.\n\n"
      : "";
  return `${chat}${PRELUDE}\n\n${b.trim()}\n`;
}

// ---------- generated-file helpers ----------

const stamp = (what, version) =>
  `Generated by HarteBurn ${version} export (github.com/Ngentix/redcell) from ${what}. Do not edit by hand: change the sources and rerun the export.`;

function managedBlock(existing, block) {
  const body = `${START}\n${block.trim()}\n${END}`;
  if (existing && existing.includes(START) && existing.includes(END))
    return existing.replace(new RegExp(`${START}[\\s\\S]*?${END}`), body);
  return existing ? `${existing.trimEnd()}\n\n${body}\n` : `${body}\n`;
}

// ---------- targets ----------

function agentsMd(src, repo) {
  const how = "each is a subagent named `harteburn-<role>`; in a tool without subagents, a separate chat per role";
  const parts = [
    `<!-- ${stamp("ethos.md, docs/architecture/BRIEF.md", src.version)} -->`,
    "# HarteBurn",
    genericEthos(src.ethos, how),
    "## Workflows",
    "- **PRD panel:** run the subagents `harteburn-product`, `harteburn-architect` and `harteburn-prover` in parallel on the PRD, each told only the PRD path, its dated decisions (fixed), and the review file to write (`docs/reviews/<id>-<date>-<role>.md`), and this: " + PANEL_FINDINGS + " Never pass one role's output to another. When the PRD changes anything a person sees, `harteburn-designer` too. Then run `harteburn-architecture-lead` on the review files. Put its panel table at the top of the PRD.",
    "- **Prove a slice:** `node scripts/harteburn/prove-prompt.mjs <prd> --mode before|after` prints a file built from the walkthrough and the git diff only. Give `harteburn-prover` exactly: \"Read <that file> and follow it.\" Never add your own summary.",
    "- **Brief stale or a rule changed:** if no rule changed, `node scripts/brief-stamp.mjs --no-rule-change`; otherwise run `harteburn-brief-compiler`, then `node --test scripts/__tests__/brief.test.mjs`.",
  ];
  if (src.brief) {
    parts.push("## Architecture brief (compiled; the pages win over it, the code wins over the pages)", src.brief.trim());
  } else {
    parts.push("## Architecture brief", "This repo has no `docs/architecture/BRIEF.md` yet. See HarteBurn's docs/adding-a-product.md.");
  }
  const p = join(repo, "AGENTS.md");
  return { "AGENTS.md": managedBlock(existsSync(p) ? readFileSync(p, "utf8") : null, parts.join("\n\n")) };
}

const desc = (c) => c.description.replace(/"/g, "'");

function cursor(src) {
  const out = {};
  for (const r of ROLES) {
    const c = src.charters[r];
    out[`.cursor/agents/harteburn-${r}.md`] =
      `---\nname: harteburn-${r}\ndescription: "${desc(c)}"\nmodel: inherit\n---\n<!-- ${stamp(`agents/${r}.md`, src.version)} -->\n\n${portableBody(c, "cursor")}`;
  }
  for (const [name, text] of Object.entries(workflows())) out[`.cursor/commands/harteburn-${name}.md`] = `<!-- ${stamp("scripts/export.mjs", src.version)} -->\n\n${text}`;
  return out;
}

function copilot(src) {
  const out = {};
  for (const r of ROLES) {
    const c = src.charters[r];
    out[`.github/agents/harteburn-${r}.agent.md`] =
      `---\nname: harteburn-${r}\ndescription: "${desc(c)}"\n---\n<!-- ${stamp(`agents/${r}.md`, src.version)} -->\n\n${portableBody(c, "copilot")}`;
  }
  for (const [name, text] of Object.entries(workflows()))
    out[`.github/prompts/harteburn-${name}.prompt.md`] =
      `---\ndescription: "HarteBurn: ${name}"\nagent: agent\n---\n<!-- ${stamp("scripts/export.mjs", src.version)} -->\n\n${text}`;
  return out;
}

function codex(src) {
  const out = {};
  for (const r of ROLES) {
    const c = src.charters[r];
    const body = portableBody(c, "codex");
    if (body.includes("'''")) throw new Error(`${r}: charter contains ''' which TOML literal strings cannot hold`);
    out[`.codex/agents/harteburn-${r}.toml`] =
      `# ${stamp(`agents/${r}.md`, src.version)}\nname = "harteburn-${r}"\ndescription = "${desc(c)}"\ndeveloper_instructions = '''\n${body}'''\n`;
  }
  return out;
}

function gemini(src, repo) {
  const out = {};
  const p = join(repo, "GEMINI.md");
  out["GEMINI.md"] = managedBlock(existsSync(p) ? readFileSync(p, "utf8") : null, `<!-- ${stamp("AGENTS.md", src.version)} -->\n@./AGENTS.md`);
  for (const r of ROLES) {
    const c = src.charters[r];
    out[`.gemini/agents/harteburn-${r}.md`] =
      `---\nname: harteburn-${r}\ndescription: "${desc(c)}"\n---\n<!-- ${stamp(`agents/${r}.md`, src.version)} -->\n\n${portableBody(c, "gemini")}`;
  }
  return out;
}

// The panel's finding format, stated once in skills/prd-panel/SKILL.md's prompt (tidy pass 2026-10-28:
// no longer repeated in each charter), so every tool's panel gives it too.
const PANEL_FINDINGS = "At most 8 findings, most severe first, each: severity (blocker / should-fix / nit), the claim, the evidence (section + quoted phrase; file:line for code), the fix in one sentence; never edit the PRD or commit.";

function workflows() {
  return {
    "prd-panel":
      "Run the HarteBurn PRD panel on the PRD named in the arguments.\n\n1. Read only the PRD's status lines and list its dated decisions; they are fixed.\n2. Run the subagents `harteburn-product`, `harteburn-architect` and `harteburn-prover` **in parallel**, and `harteburn-designer` with them when the PRD changes anything a person sees. Give each only: the PRD path, the dated decisions, and its review file `docs/reviews/<id>-<YYYY-MM-DD>-<role>.md`, and this: " + PANEL_FINDINGS + " Never your own view, never another reviewer's output.\n3. When all finish, run `harteburn-architecture-lead` with the review paths; it writes `docs/reviews/<id>-<YYYY-MM-DD>-reconciled.md`.\n4. Copy its panel table (part D) to the top of the PRD under `## Panel table`.\n5. Report: the roles that ran, each decision for the owner with its example. Do not commit.\n",
    prove:
      "Run HarteBurn's Prover on the current change.\n\n1. Run `node scripts/harteburn/prove-prompt.mjs <the PRD> --mode <before|after>` (from the arguments; default after). It prints a file path.\n2. Run the subagent `harteburn-prover` with exactly: `Read <that path> and follow it.` Nothing else: no summary of the change, no opinion.\n3. Report its verdict on one line. Nothing is done without **proven**.\n",
    brief:
      "Bring the architecture brief up to date.\n\n1. Run `node scripts/brief-stamp.mjs --check`.\n2. If it reports only changed pages and no unmapped rule, run `node scripts/brief-stamp.mjs --no-rule-change` and stop.\n3. Otherwise run the subagent `harteburn-brief-compiler` with: `Compile the brief for this repo. The check reports: <its output>.`\n4. Run `node --test scripts/__tests__/brief.test.mjs` and report the result. Then rerun the HarteBurn export so AGENTS.md carries the new brief.\n",
  };
}

function scripts(src) {
  return {
    "scripts/harteburn/prove-prompt.mjs": src.proveScript,
    "scripts/harteburn/walkthrough.mjs": src.walkthroughScript,
  };
}

// ---------- the claude.ai Project kit ----------

function project(src, repo) {
  const name = repo.split("/").filter(Boolean).pop();
  const out = {};
  const how =
    "each role is a separate conversation in this Project, started with that role's opener from `openers/`; never paste one role's conclusion into another role's chat";
  out["PROJECT-INSTRUCTIONS.md"] = [
    `You are working on **${name}** inside a claude.ai Project set up for HarteBurn. ${stamp("ethos.md", src.version)}`,
    "",
    genericEthos(src.ethos, how)
      .replace(/Main session = Tech Lead, builds in the thread\./, "This chat is the Tech Lead unless an opener names another role.")
      .replace(/Pass roles files and diffs, never conclusions\./, "Give roles files and diffs, never conclusions."),
    "",
    "THIS PROJECT'S LIMITS: you cannot run code, run tests, open the app, or read the repo except what is attached here or pasted. Every verdict that needs a run says **unproven until run**, with the exact command and the result that would prove it. The knowledge files `BRIEF.md` and `_house-rules.md` are this product's architecture and the owner's settled rules: honour them in every answer, and say which rule applies.",
  ].join("\n");
  if (src.brief) out["knowledge/BRIEF.md"] = src.brief;
  if (src.rules) out["knowledge/_house-rules.md"] = src.rules;
  for (const r of ROLES.filter((x) => x !== "brief-compiler")) {
    const c = src.charters[r];
    out[`knowledge/role-${r}.md`] = `# HarteBurn role: ${r}\n\n${portableBody(c, "chat")}`;
    out[`openers/${r}.md`] =
      `Paste this as the first message of a NEW conversation in the ${name} HarteBurn Project, then attach or paste the material it asks for.\n\n---\n\nAct as HarteBurn's **${r}**, exactly as defined in the knowledge file \`role-${r}.md\`. Use \`BRIEF.md\` and \`_house-rules.md\` for this product's architecture and rules.\n\n` +
      (r === "architecture-lead"
        ? "I will paste the PRD and the reviews (product, architect, prover, and designer when the PRD changes anything a person sees). Reconcile them in the four parts your role defines.\n\n[paste the PRD, then the reviews]"
        : r === "prover"
          ? `I will paste the PRD's acceptance walkthrough and, after a build, the diff. I will not tell you what the builder thinks. Work in the mode that fits. On a PRD panel: ${PANEL_FINDINGS}\n\n[paste the walkthrough, and the diff if after the build]`
          : `I will paste the PRD. Review it as a PRD panel member. Its dated decisions are fixed: [list them]. ${PANEL_FINDINGS}\n\n[paste the PRD]`);
  }
  out["README.md"] = projectReadme(name, src.version);
  return out;
}

function projectReadme(name, version) {
  return `# HarteBurn for claude.ai: the ${name} Project kit

Generated by HarteBurn ${version}. This kit gives a claude.ai Project (web or desktop chat) HarteBurn's **knowledge and roles**. It does not give it Claude Code's **mechanics**: no hooks, no independent agents run for you, no tests run, no gate. Read HarteBurn's docs/limitations.md before relying on it.

## What is in the kit

| File | Goes where | What |
|---|---|---|
| \`PROJECT-INSTRUCTIONS.md\` | the Project's **instructions** box (paste the text) | the way of working, adapted to chat, and the Project's limits |
| \`knowledge/BRIEF.md\` | Project **knowledge** (upload) | this product's architecture, compiled |
| \`knowledge/_house-rules.md\` | Project knowledge | the owner's settled rules |
| \`knowledge/role-*.md\` | Project knowledge | the role charters, adapted to chat |
| \`openers/*.md\` | keep them; paste one to start a role's chat | the first message for each role |

## Set it up (once, about five minutes)

1. In claude.ai (or the Claude desktop app's chat), choose **Projects → Create project**. Name it "${name} · HarteBurn".
2. Open the project's **instructions** and paste the full text of \`PROJECT-INSTRUCTIONS.md\`.
3. In the project's **knowledge**, upload every file in \`knowledge/\`.
4. Keep \`openers/\` somewhere handy.

## Use it

**An ordinary question or a change:** start a chat in the Project and ask. It answers within the architecture and rules, and opens its checklist with which roles it would convene.

**A PRD panel, the chat way** (independence comes from separate conversations, so keep them separate):
1. New chat → paste \`openers/product.md\` → paste the PRD → save the reply.
2. New chat → \`openers/architect.md\` → the PRD → save the reply.
3. New chat → \`openers/prover.md\` → the PRD's walkthrough → save the reply.
4. If the PRD changes anything a person sees: new chat → \`openers/designer.md\` → the PRD → save the reply.
5. New chat → \`openers/architecture-lead.md\` → paste the PRD and the replies → this is your decision table.
Never paste a reply into a chat other than the Lead's.

**Proving a change:** new chat → \`openers/prover.md\` → paste the walkthrough and the diff, never the builder's summary. In chat the Prover can only say what to run and what would prove it; its verdict stays **unproven until run** unless you paste the test output.

## Keep it current

The brief and house rules change in the repo. When they do, rerun the export and re-upload \`knowledge/BRIEF.md\` and \`knowledge/_house-rules.md\` (replace, don't add). Nothing tells you the Project is stale; the repo's gate only guards the repo.

## Why use it at all

For reading, deciding and reviewing away from a checkout: discussing a PRD, checking a design against the architecture, preparing questions for the owner. For building and proving, use Claude Code with the plugin.
`;
}

// ---------- main ----------

const TARGETS = {
  "agents-md": (s, r) => agentsMd(s, r),
  cursor: (s, r) => ({ ...agentsMd(s, r), ...cursor(s), ...scripts(s) }),
  copilot: (s, r) => ({ ...agentsMd(s, r), ...copilot(s), ...scripts(s) }),
  codex: (s, r) => ({ ...agentsMd(s, r), ...codex(s), ...scripts(s) }),
  gemini: (s, r) => ({ ...agentsMd(s, r), ...gemini(s, r), ...scripts(s) }),
  tools: (s, r) => ({ ...agentsMd(s, r), ...cursor(s), ...copilot(s), ...codex(s), ...gemini(s, r), ...scripts(s) }),
  project: (s, r) => project(s, r),
};

export function build(target, repo) {
  if (!TARGETS[target]) throw new Error(`unknown target "${target}"; one of: ${Object.keys(TARGETS).join(", ")}`);
  return TARGETS[target](loadSources(repo), repo);
}

function main() {
  const a = process.argv.slice(2);
  const target = a[0];
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  let repo = opt("--repo");
  if (!repo) {
    try {
      repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    } catch {
      repo = process.cwd();
    }
  }
  repo = resolve(repo);
  const files = build(target, repo);
  const base = target === "project" ? resolve(opt("--out") || "harteburn-project") : repo;
  if (a.includes("--check")) {
    const stale = Object.entries(files).filter(([p, c]) => !existsSync(join(base, p)) || readFileSync(join(base, p), "utf8") !== c);
    stale.forEach(([p]) => console.log(`harteburn export: stale — ${p} (rerun: node <harteburn>/scripts/export.mjs ${target})`));
    if (!stale.length) console.log(`harteburn export: ${Object.keys(files).length} files current`);
    return stale.length ? 1 : 0;
  }
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(base, p)), { recursive: true });
    writeFileSync(join(base, p), c);
  }
  console.log(`harteburn export ${target}: wrote ${Object.keys(files).length} files under ${base}`);
  Object.keys(files).sort().forEach((p) => console.log("  " + p));
  return 0;
}

// Started by its own path? Real paths on both sides: Node reports this module's real path, while
// argv[1] is the path as typed — on macOS a temp folder (/var → /private/var) or any symlinked
// checkout differs, and the script silently did nothing (found 2026-10-18, tests/main-guard).
function startedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (process.argv[1] && startedDirectly()) process.exit(main());
