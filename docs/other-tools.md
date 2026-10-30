# HarteBurn in other tools: Cursor, GitHub Copilot, Codex, Gemini and others

HarteBurn can run without Claude Code and without any cloud. **The export** writes it into each tool's own files, from the same sources the plugin uses: the way of working, the role charters, and the product's brief. It's all local files committed to the product's repo.

Read [limitations](limitations.md) first. What survives depends on the tool.

## Why this works

- **AGENTS.md is an open standard** (stewarded by the Agentic AI Foundation under the Linux Foundation) that Cursor, GitHub Copilot, Codex, Windsurf/Devin, Zed, Aider, Jules, Junie, Amp, opencode, Warp and others read at the start of every session. HarteBurn writes the way of working and the full brief into it.
- **Independent subagents now exist** in Cursor (2.4 and later), Copilot in VS Code, Codex and, experimentally, Gemini CLI. Each runs in its own clean context, so the roles stay as blind to each other as they are in Claude Code.
- **The gate and the Prover's prompt builder are plain Node scripts in the repo.** They work no matter which tool wrote the code.

## What each tool gets

| | Always-on brief + way of working | Roles as independent subagents | Workflow commands | Dispatch ledger | Level |
|---|---|---|---|---|---|
| **Claude Code + plugin** | ✅ hooks | ✅ | ✅ | ✅ | Full |
| **Cursor** | ✅ AGENTS.md | ✅ `.cursor/agents/`, parallel | ✅ `.cursor/commands/` | ❌ | Most |
| **GitHub Copilot (VS Code)** | ✅ AGENTS.md | ✅ `.github/agents/`, called as subagents | ✅ `.github/prompts/` (local VS Code only) | ❌ | Most |
| **Codex CLI** | ✅ AGENTS.md (32 KiB cap) | ✅ `.codex/agents/*.toml`, parallel, when asked | in AGENTS.md | ❌ | Most |
| **Gemini CLI** | ✅ GEMINI.md includes AGENTS.md | ⚠ `.gemini/agents/`, experimental, run without confirmation by default | in AGENTS.md | ❌ | Partial |
| **Windsurf/Devin, Zed, Aider, others** | ✅ AGENTS.md (Windsurf: size cap not confirmed for AGENTS.md) | ❌ separate conversations | in AGENTS.md | ❌ | Knowledge only |
| **claude.ai chat** | via a Project | ❌ separate chats | ❌ | ❌ | Knowledge only ([Projects](projects.md)) |

**Lost everywhere outside Claude Code:**
- **The ledger.** Nothing records which roles ran.
- **Automatic brief injection into subagents.** Each exported role's file tells it to read the brief first; that's an instruction, not a guarantee.
- **The guarantee** that the session started with the brief at all, beyond the tool reading AGENTS.md as it promises to.

Cursor, Copilot and Codex do have session-start and subagent hooks, so these could be added later as per-tool adapters. They are not built yet.

## Install for a product

**Generated in place**, in the product repo (HarteBurn keeps no per-product copies), merging with anything the repo already has. From the product repo's root:

```
node ~/ngentix/harteburn/scripts/export.mjs cursor     # or copilot, codex, gemini, agents-md
node ~/ngentix/harteburn/scripts/export.mjs tools      # every tool at once
```

What it writes:

| Path | For |
|---|---|
| `AGENTS.md` | every tool. HarteBurn's part sits between `<!-- harteburn:start -->` and `<!-- harteburn:end -->`; your own text is kept, and reruns change nothing |
| `.cursor/agents/harteburn-*.md`, `.cursor/commands/harteburn-*.md` | Cursor |
| `.github/agents/harteburn-*.agent.md`, `.github/prompts/harteburn-*.prompt.md` | GitHub Copilot |
| `.codex/agents/harteburn-*.toml` | Codex |
| `GEMINI.md`, `.gemini/agents/harteburn-*.md` | Gemini CLI |
| `scripts/harteburn/prove-prompt.mjs` | `/prove` in every tool: builds the Prover's brief from the walkthrough and the diff only |

The product repo also needs its own half, the same as for Claude Code: house rules, brief, gate. See [adding a product](adding-a-product.md).

## Keep it in step

The exported files carry a copy of the brief. When the brief changes, they go stale. Two guards:

- `node ~/ngentix/harteburn/scripts/export.mjs tools --check` exits 1 and names every stale file. Run it next to the brief gate in the product repo's pre-push hook, so a recompiled brief can't leave the exports behind.
- Every generated file says on its first lines that it's generated, and from what. Edit the sources, never the output.

## Recompiling the brief outside Claude Code

The `harteburn-brief-compiler` role is exported too. Any tool with subagents can run it, with the `/harteburn-brief` workflow. It needs only to read the pages, write two files and run Node. **Not yet tried outside Claude Code**, so check the result with `node --test scripts/__tests__/brief.test.mjs`. If no rule changed, `node scripts/brief-stamp.mjs --no-rule-change` is enough, and needs no AI at all.

## Status

The export is built and tested: every role reaches every tool word for word, no Claude-only text leaks through, a team's own AGENTS.md is preserved, and stale exports are caught. **Running them inside Cursor, Copilot, Codex and Gemini has not been tried yet.** The file formats follow each tool's documentation as of 2026-10-14. Try one, then report back here.
