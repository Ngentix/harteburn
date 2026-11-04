# Ngentix HarteBurn

**An independent team inside every Claude Code session at Ngentix.** Install with `harteburn@ngentix`. The hosted board and subscriptions live at [harteburn.ngentix.ai](https://harteburn.ngentix.ai). The plugin stays free and works offline.

HarteBurn gives every Claude Code session a team of independent reviewers and a working knowledge of the product being built. Every PRD, build and bug is checked against that project's architecture and our settled decisions. Someone other than the builder proves it before it reaches the owner. The owner reviews finished, verified work and answers only the decisions that matter. We ship higher-quality work faster, with less rework and no new tech debt, in every product we build.

- **Independent proof.** A Prover writes the tests first and judges every change from the code alone, so "done" means proven.
- **An architecture summary per project.** Each repo's architecture pages and house rules are compiled into a brief. The brief is present in every session and every agent, and kept current by a gate.
- **Expert roles on demand.** An Architect, a Product voice, a Designer, a Security role and an Architecture Lead step in only where their judgement changes the outcome.
- **Fast, clear decisions.** Roles settle their own domains. Only feature, revenue, customer-impact and other critical calls reach the owner, each as one question with an example.
- **One install, every product.** The same way of working across all our repos; each project adds only its own rules and architecture.

## Documentation

| Read | For |
|---|---|
| **[Limitations](docs/limitations.md)** | **Read first:** where HarteBurn is complete, and what you lose on each other surface |
| [Why HarteBurn](docs/why.md) | What problem it solves, what changes for you, what it costs |
| [Install](docs/install.md) | Claude Code: the terminal, the desktop app's Code tab (step by step), VS Code, JetBrains, the web, the Agent SDK, Claude Team/Enterprise managed settings; the HarteBurn license; updating and removing |
| [claude.ai Projects](docs/projects.md) | HarteBurn's knowledge and roles in claude.ai chat: the kit, setup, the chat way to run a panel |
| [Other tools](docs/other-tools.md) | Cursor, GitHub Copilot, Codex, Gemini and any AGENTS.md tool, through the export; no cloud needed |
| [The roles](docs/roles.md) | Each role's mandate, what it reads, what it must never see, and the verdict it gives |
| [How the team works](docs/how-the-team-works.md) | The outcomes, when each role is convened, the order of operations, who decides, the definition of done, the checklist |
| [The architecture brief](docs/architecture-brief.md) | How a repo's architecture becomes a summary in every session, and how we prove it is faithful and current |
| [Adding a product](docs/adding-a-product.md) | Bringing a new repo under HarteBurn, step by step |
| [Retro template](retros/TEMPLATE-retro.md) | One retro per objective (a page when lean): actions first, a narrative, numbers, what was found late, each role's contribution. How HarteBurn tunes itself |
| [Reference](docs/reference.md) | Commands, hooks, agents, scripts, files, limits, and how to change and release the plugin |


## Thirty-second install

Prerequisite: Claude Code. The release repository is public.

```
claude plugin marketplace add Ngentix/harteburn
claude plugin install harteburn@ngentix
```

Start a new session. It opens with HarteBurn's way of working, and, in a repo that has a brief, that product's architecture. Details for every surface: [Install](docs/install.md). Not on Claude Code? Build your product's version from its repo with `scripts/export.mjs` ([other tools](docs/other-tools.md)).

## Where it stands

| Phase | State |
|---|---|
| 1. House rules, brief, gate, hooks | Built 2026-10-14 |
| 2. Brief proven against an answer key | Built. Connector Cloud scores 20 of 20 with the brief, 0 of 20 without |
| 3. Roles, `/prd-panel`, `/prove` | Built. The first panel ran on an already-approved PRD and caught a blocker before any code |
| 4. The Prover on a real slice | Built 2026-10-15. That PRD had no walkthrough, so `/prove` refused it. The first real slice was a production bug: tests written before the build, an after-pass, and the checklist line. [Prove](skills/prove/SKILL.md) |
| 5. Bugs under the convene rule | Built. The checklist's first line names who ran and who was excused, and the ledger records each dispatch. [The checklist](docs/how-the-team-works.md#what-the-owner-sees-the-harteburn-checklist). The first bug run was phase 4's slice; a session that skipped the Architect and a later canary run were each recorded in a retro |
| 6. A second product | Built. Connector Cloud was first. A second product has its own house rules, a compiled brief, and the brief gate. The steps are [Adding a product](docs/adding-a-product.md). It does not yet have the twenty-question answer key; Connector Cloud's is the one that has been scored |
| 7. The saved workflow | Built. `/harteburn:prd-panel` is the one command: Product, Architect and Prover in parallel and blind, then the Architecture Lead's one table. [The command](skills/prd-panel/SKILL.md) |
| 8. The push gate | Built 0.26.0. In a repo with a security-domain table, an agent's push needs a covering Security "holds" and Prover "proven"; git's own pre-push hook checks the same in your terminal. [The push gate](docs/reference.md#the-push-gate) |
| 9. Team seats | Built 0.26.0, not active yet: no seat verifies until the production signing key ships. On a Team license the board checks each seat's typed `go piece n:` and accept, and the push gate counts only the security owner's accept. [Team seats](docs/roles.md#team-seats) |


Changes: [CHANGELOG](CHANGELOG.md).
