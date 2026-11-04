# Limitations: where HarteBurn works, and what you lose elsewhere

**Short version.** Full HarteBurn: Claude Code with the plugin, in the terminal, the desktop app's Code tab (local sessions), VS Code or JetBrains. Most of it: Cursor, GitHub Copilot and Codex, through the export. Knowledge only: a claude.ai Project, or any other tool that reads AGENTS.md. Build it from the product repo with `scripts/export.mjs`. The export to other tools is built and tested as files, but has not yet been run inside those tools.

Read this before choosing how to use HarteBurn. **The full HarteBurn needs Claude Code.** Everywhere else you get a reduced version, and this page says exactly what is reduced.

## What makes the full HarteBurn work

Four things, each provided by Claude Code itself:

| Mechanism | What it gives you | Needs |
|---|---|---|
| **Hooks** | The way of working and the repo's architecture brief are put into every session and every agent automatically, every time | Claude Code plugin hooks |
| **Independent agents** | The Prover, Architect and Product reviewer (and the Designer, on anything a person sees) run as separate agents that never see each other's work or the builder's summary, in parallel | Claude Code subagents |
| **Commands** | `/frame`, `/prd-panel`, `/prove`, `/done`, `/retro`, `/handoff`, `/brief` run the workflows the same way every time | Claude Code plugin skills |
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
- **Known issue: the exported `/prove` does not run.** The export copies `scripts/harteburn/prove-prompt.mjs` and `walkthrough.mjs`, but `prove-prompt.mjs` also imports `board-security.mjs` and `paths.mjs`, which it does not copy, so Node stops before writing a brief. Until that is fixed, run `node <harteburn>/scripts/prove-prompt.mjs` from a HarteBurn checkout.
- **Exported files go stale with the brief.** `node <harteburn>/scripts/export.mjs tools --check` names them; wire it next to the brief gate.

## Known limits of the full HarteBurn

- **The ethos and the convene rule are guidance.** Hooks put them in front of every session, but a session can still skip a role. The checklist's first line and the ledger make a skip visible. An agent's push is refused without a covering Prover proven and Security holds (the push gate), where the repo has a security-domain table. Git's own pre-push hook checks the same in your terminal too, however the push was typed. A commit is not refused. Your way past the check is `git push --no-verify`, typed by you; an agent's is refused. Still open, for rc-security piece 8 (the sandbox): an agent that hides `--no-verify` inside a script the Bash gate cannot read skips both checks, and so do tools whose own code pushes without git's hooks (`npx lerna publish`, `nx release`, `jj git push`, libgit2 apps). A `package.json` script that pushes, run through npm, pnpm, yarn or bun, is read and refused like a script file. In a held repo an agent cannot run any script, interpreter file or package script whose text pushes: the gate cannot tell where it lands, so it refuses. A script that names a file whose text pushes (a README, say) is refused the same way, even if it only reads it ([The push gate](reference.md#the-push-gate)).
- **A broken held repo limits every session.** While a held repo's check cannot be kept (hooks moved, its folder gone, or git that cannot run), sessions in other repos may run only file readers typed by their full path (`/bin/ls`, `/bin/cat`, `/usr/bin/grep`).
- **The push gate needs `/usr/bin/git` and a remote that answers without a prompt.** On a Mac without the developer tools, a held repo allows only file readers until you run `xcode-select --install`. Each git call has 15 s and the check 45 s; a Keychain prompt left unanswered, or a slow remote, refuses the push ([install](install.md#the-first-gated-push-on-a-mac)).
- **Team seats are not active yet.** Until the production signing key ships, no seat verifies: on a Team license the board refuses every Done-line, scope or architecture-doc change and every risk accept, and an accept cannot clear a "does not hold" at the push gate ([Team seats](roles.md#team-seats)).
- **The brief's limit is 38,000 characters** (29,000 in three parts until 2026-10-30; 19,400 in two until 2026-10-19), sent as up to four parts, because Claude Code cuts any one hook string at 10,000.
- **At the full limit, the exported `AGENTS.md` passes Codex's default 32 KiB read cap** (connector-cloud's is 23.5 KB at a 19,400-character brief). Raise Codex's `project_doc_max_bytes` (unverified) or keep the brief under about 26,000 characters for Codex.
- **Ready's live write to a new provider is checked after it happens.** The board refuses a write row whose account the owner did not name (`test account <provider>: <account>`, sent alone), but it cannot stop the call itself: until a sandbox does (rc-security piece 8), what keeps the write off a real account is the instruction to ask first.
- **A newly installed or updated plugin loads only in new sessions.** Restart, or run `/reload-plugins`.
- **An install is a copy pinned to a commit.** A change to this repo reaches you only after `claude plugin update harteburn@ngentix`.
- **The roles have no memory between sessions**, because Claude Code would keep it as untracked files inside each repo.
- **Cost:** about 4,400 extra input tokens per session (cached), and about 250,000 tokens per PRD panel.
- **A folder you trust can run code.** Once you trust a folder in Claude Code, its `.claude/settings.json` can define its own hooks and environment. HarteBurn never takes its license folder or address from the environment, but no plugin check stops a trusted folder's own hooks; open folders you did not write with care (piece 8's sandbox is the planned answer).
