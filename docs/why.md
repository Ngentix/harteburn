# Why HarteBurn

## The problem

Before HarteBurn, one Claude session wrote the PRD, designed it, built it, tested it and reported it. The reviewer was the author. That is a structural flaw, not an occasional one: an agent handed its own conclusion tends to confirm it. The owner was the first independent reader of every PRD and the first independent tester of every page. On 2026-09-18, ten defects were found on the running page that 2,116 unit tests and 356 browser tests had passed.

Two more gaps sat underneath:

- **Settled decisions lived in one agent's private memory.** Every other agent, every subagent, and every teammate's session started without them, and broke them.
- **The architecture was read only when someone remembered to.** Connector Cloud's 19 architecture files are 280 KB. Nothing put them in front of a question, so agents built second copies of mechanisms the product already had.

## What HarteBurn changes

| Before | With HarteBurn |
|---|---|
| The builder decides it is done | A Prover who never saw the builder's account proves it: tests written first, a guard removed to watch the test fail, the page looked at |
| The owner is the first independent reader of a PRD | Blind reviewers (Product, the Architect, the Prover, and the Designer on anything a person sees) and a reconciler read it first; the owner gets one table of decisions |
| The architecture is in the room when remembered | A compiled brief of each product's architecture is in every session and every agent, kept current by a gate |
| Settled decisions live in one agent's memory | They live in each repo's `docs/_house-rules.md`, dated, readable by everyone and every agent |
| Every disagreement reaches the owner, or none does | Each role wins in its own domain; only critical decisions reach the owner, each as one question with an example per side |
| A different way of working per project | One plugin, the same team everywhere; each project supplies only its own rules and architecture |

## Evidence so far

- **The brief is faithful.** A session that sees only Connector Cloud's brief answers 20 of 20 questions drawn from the architecture pages. A session without it answers 0. The first compile scored 17, and the scorer found why: rules had been compressed into labels a reader couldn't use.
- **The panel finds real defects.** Its first run, on the Microsoft 365 PRD (FEA-CC-426), which the owner had already approved, found a blocker. One shared Microsoft app would have asked every customer for every product's permissions, because the sign-in scope is read from the stored app row (`oauth.rs:1681`). That was caught before a line of code, in about five minutes. The reconciler rejected four reviewer suggestions because each would have reopened a dated decision.
- **The compiler finds contradictions.** Compiling the first brief surfaced four places where architecture pages disagreed with each other, including pricing.

## What it costs

- **Tokens.** About 4,400 extra input tokens per session for the way of working and a full brief, cached after the first turn. A PRD panel is about 250,000 tokens and five minutes. On the Claude Max plan, inside Claude Code, this is not a constraint (owner's call, 2026-10-14), and HarteBurn never trades a rule or a proof for tokens.
- **Discipline.** An architecture page edited without recompiling the brief blocks the push until `/brief` runs, or until the re-stamp confirms no rule changed.

## What it is not

- Not a replacement for the owner looking at the page. The Prover looks first, so the owner finds less.
- Not a committee on every change. A one-line bug gets the Prover and nobody else. See [How the team works](how-the-team-works.md).
- Not a scorecard. Verdicts are words with evidence.
- Not available in plain claude.ai chat, where hooks and agents don't run. See [Install](install.md).
