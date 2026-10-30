# Limitations: where HarteBurn works, and what you lose elsewhere

**Short version.** Full HarteBurn: Claude Code with the plugin, in the terminal, the desktop app's Code tab (local sessions), VS Code or JetBrains. Most of it: Cursor, GitHub Copilot and Codex, through the export. Knowledge only: a claude.ai Project, or any other tool that reads AGENTS.md. Build it from the product repo with `scripts/export.mjs`. The export to other tools is built and tested as files, but has not yet been run inside those tools.

Read this before choosing how to use HarteBurn. **The full HarteBurn needs Claude Code.** Everywhere else you get a reduced version, and this page says exactly what is reduced.

## What makes the full HarteBurn work

Four things, each provided by Claude Code itself:

| Mechanism | What it gives you | Needs |
|---|---|---|
| **Hooks** | The way of working and the repo's architecture brief are put into every session and every agent automatically, every time | Claude Code plugin hooks |
| **Independent agents** | The Prover, Architect and Product reviewer (and the Designer, on anything a person sees) run as separate agents that never see each other's work or the builder's summary, in parallel | Claude Code subagents |
| **Commands** | `/prd-panel`, `/prove`, `/brief` run the workflows the same way every time | Claude Code plugin skills |
| **The repo itself** | The Prover runs tests and reads the diff; the gate refuses a push with a stale brief | A local checkout and a terminal |

## Where each mechanism works

| Surface | Hooks | Independent agents | Commands | Repo + tests | Result |
|---|---|---|---|---|---|
| Claude Code in the terminal | ✅ | ✅ | ✅ | ✅ | **Full HarteBurn** |
| Claude desktop app, **Code tab, local session** | ✅ | ✅ | ✅ | ✅ | **Full HarteBurn** |
| VS Code extension | ✅ | ✅ | ✅ | ✅ | **Full HarteBurn** |
| JetBrains (Claude Code in its terminal) | ✅ | ✅ | ✅ | ✅ | **Full HarteBurn** |
| Agent SDK (`plugins: [{type:"local"}]`) | ✅ | ✅ | ✅ | ✅ | Full, for programs you write |
| Claude Code on the web, cloud sessions | only via organization managed settings | ✅ | ✅ | ✅ (a cloud copy) | Full **only** if an Owner enables it org-wide |
| Desktop app Code tab, **cloud** session | ❌ local installs don't reach it | | | | Use a local session |
| Desktop app Code tab in **WSL** | ❌ plugins not available | | | | Not supported |
| **Cowork** (desktop app) | ✅ per Anthropic's docs | ✅ per docs | ✅ per docs | local files | **Possibly full; not yet tried by us** |
| claude.ai chat or desktop chat, with the **Project** kit | ❌ | ❌ (separate chats instead) | ❌ (copy-paste prompts instead) | ❌ | **Knowledge only**, see [Projects](projects.md) |
| **Cursor** (2.4+), with the export | ❌ (AGENTS.md instead) | ✅ subagents | ✅ commands | ✅ | **Most**, see [Other tools](other-tools.md) |
| **GitHub Copilot** in VS Code, with the export | ❌ (AGENTS.md instead) | ✅ custom agents as subagents | ✅ prompt files | ✅ | **Most** |
| **Codex CLI**, with the export | ❌ (AGENTS.md instead) | ✅ subagents, when asked | in AGENTS.md | ✅ | **Most** |
| **Gemini CLI**, with the export | ❌ (GEMINI.md instead) | ⚠ experimental | in AGENTS.md | ✅ | **Partial** |
| **Windsurf/Devin, Zed, Aider, others** (AGENTS.md) | ❌ | ❌ | ❌ | ✅ | **Knowledge only** |

## What you lose outside Claude Code

- **"Automatic" becomes "remembered".** Without hooks, the brief and the way of working are present only if the tool loads them, through a Project's instructions or a tool's always-on rules file. Most tools do load them every time. None of them refuses to start when they're missing.
- **Independence becomes discipline.** Without independent agents, the roles are separate conversations you start yourself. They stay independent only if you never paste one role's conclusion into another's chat.
- **The gate still works**, because it's a script in the repo. A stale brief still blocks the push, whatever tool wrote the change.
- **The ledger is gone.** Nothing records which roles actually ran.
- **The brief is still per repo, and compiled best by Claude Code.** Other tools read the compiled brief. The exported `harteburn-brief-compiler` can recompile it in a tool with subagents (not yet tried). With no AI at all, `node scripts/brief-stamp.mjs --no-rule-change` re-stamps when no rule changed.
- **Exported files go stale with the brief.** `node <harteburn>/scripts/export.mjs tools --check` names them; wire it next to the brief gate.

## Known limits of the full HarteBurn

- **The ethos and the convene rule are guidance.** Hooks put them in front of every session, but a session can still skip a role. The checklist's first line and the ledger make a skip visible; nothing yet refuses a commit without the Prover.
- **The brief's limit is 29,000 characters** (19,400 in two parts until 2026-10-19), sent as up to three parts, because Claude Code cuts any one hook string at 10,000.
- **At the full limit, the exported `AGENTS.md` passes Codex's default 32 KiB read cap** (connector-cloud's is 23.5 KB at a 19,400-character brief). Raise Codex's `project_doc_max_bytes` (unverified) or keep the brief under about 26,000 characters for Codex.
- **A newly installed or updated plugin loads only in new sessions.** Restart, or run `/reload-plugins`.
- **An install is a copy pinned to a commit.** A change to this repo reaches you only after `claude plugin update harteburn@ngentix`.
- **The roles have no memory between sessions**, because Claude Code would keep it as untracked files inside each repo.
- **Cost:** about 4,400 extra input tokens per session (cached), and about 250,000 tokens per PRD panel.
