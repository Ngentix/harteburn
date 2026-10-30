# HarteBurn in a claude.ai Project

For people who work in **claude.ai** or the **Claude desktop app's chat**, not in Claude Code. A Project gives every chat the product's architecture and the owner's rules, and gives you the roles as conversations you start. Read [limitations](limitations.md) first: this is **knowledge only**.

## What you get, and what you don't

| You get | You don't get |
|---|---|
| The product's architecture brief and house rules in every chat in the Project | Anything automatic. It works because the Project's instructions and knowledge are always loaded, not because of hooks |
| The way of working: outcomes, who decides, definition of done, the checklist | Independent agents running for you. Each role is a separate chat you start |
| The roles, as charters adapted for chat, plus an opener for each | Tests, the diff, the running app. Every proof is "unproven until run" unless you paste the output |
| Copy-paste openers that keep each role independent | The gate. Nothing tells you the Project's brief is stale |

**Use it for** reading, deciding and reviewing away from a checkout: discussing a PRD, checking a design against the architecture, preparing questions for the owner. **Build and prove** in Claude Code with the plugin.

## The assets

Build them from the product repo's root: `node ~/ngentix/harteburn/scripts/export.mjs project --out <folder>`. HarteBurn keeps no per-product copies.

| File | Where it goes | What it is |
|---|---|---|
| `PROJECT-INSTRUCTIONS.md` | paste into the Project's **instructions** | the way of working adapted to chat, plus the Project's limits |
| `knowledge/BRIEF.md` | upload to the Project's **knowledge** | the product's architecture, compiled |
| `knowledge/_house-rules.md` | upload to knowledge | the owner's settled rules |
| `knowledge/role-*.md`, one per role | upload to knowledge | the role charters, unchanged except for one rule on top: in chat, say what to run instead of running it |
| `openers/<role>.md` | keep handy; paste as a chat's first message | starts a chat as that role |
| `README.md` | read it | these steps |

To build a fresh kit from any repo that has a brief:

```
node ~/ngentix/harteburn/scripts/export.mjs project --repo ~/ngentix/connector-cloud --out ~/Desktop/cc-harteburn-project
```

## Set it up (once, about five minutes)

1. In claude.ai or the Claude desktop app, open **Projects** → **Create project**. Name it, for example, "Connector Cloud · HarteBurn".
2. Open the Project's **instructions**. Paste the whole of `PROJECT-INSTRUCTIONS.md`.
3. Open the Project's **knowledge**. Upload every file in `knowledge/`.
4. Keep the `openers/` folder somewhere handy.

Check it: start a chat in the Project and ask "Which rule applies when a customer would have to type a setting?" It should quote the house rule that the customer just signs in, with its date.

## Use it

**Ordinary questions and changes.** Start a chat and ask. Answers stay within the architecture and rules. The checklist opens with the roles it would convene.

**A PRD panel, the chat way.** Independence comes from separate conversations, so keep them separate:

1. New chat → paste `openers/product.md` → paste the PRD → save the reply.
2. New chat → `openers/architect.md` → the PRD → save the reply.
3. New chat → `openers/prover.md` → the PRD's walkthrough → save the reply.
4. If the PRD changes anything a person sees: new chat → `openers/designer.md` → the PRD → save the reply.
5. New chat → `openers/architecture-lead.md` → paste the PRD and the replies. This is your decision table.

Never paste a role's reply into any chat except the Lead's.

**Proving a change.** New chat → `openers/prover.md` → paste the walkthrough and the diff, never the builder's summary. The Prover says what to run and what result would prove it. Its verdict stays **unproven until run** unless you paste the test output.

## Keep it current

When the product's brief or house rules change in its repo, rebuild the kit, then **replace** `BRIEF.md` and `_house-rules.md` in the Project's knowledge. Delete the old copies; don't add a second one. Nothing warns you when the Project is out of date: rebuild the kit whenever the brief or house rules change.

## Why not upload the plugin to claude.ai?

claude.ai has its own plugin system (Customize → Plugins). In chat it loads skills and commands but ignores agents and hooks. Uploading HarteBurn there would give you the command text without the team and without the brief. The Project gives you more.
