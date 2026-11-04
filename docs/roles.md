# The roles

HarteBurn is a team of agents. Each is a charter file in `agents/`, addressed as `harteburn:<role>`. A charter states what the role defends, what it reads, what it must **never** see, and the exact verdict it must give. Independence is the point: a role that saw another role's conclusion would tend to confirm it.

The main session is the **Tech Lead**. It is the only thing the owner talks to, it builds in the thread, and it dispatches the other roles.

Every role starts with the same two things, put there by HarteBurn's hooks: the **way of working** (the outcomes, the convene rule, precedence, order, the definition of done) and the **repo's architecture brief**. The repo's `CLAUDE.md` loads too. Roles do not get the main session's private memory.

At a glance:

| Role | Defends | Never sees | Verdict |
|---|---|---|---|
| Tech Lead (main session) | the plan the owner can follow | | the HarteBurn checklist |
| Prover | the truth of "done" | the builder's summary | **proven** / **dispelled** |
| Architect | the architecture and dated decisions | Product's review | **conforms** / **extends** / **violates** |
| Product | the persona's value and words | the Architect's review | **delivers** / **does not deliver** |
| Designer | taste and usability on anything a person sees | the other reviews | **ships** / **does not ship** |
| Security | the product's users, their data and the owner's systems against attack | the builder's summary, the other reviews | **holds** / **does not hold** |
| Architecture Lead | both visions at once | | one decision table |
| Brief compiler | the architecture in every request | | a brief that passes its checks |

---

## Tech Lead

**Who:** the main Claude Code session, the one you type to. Not a separate agent.

**Does:**
- Plans, builds in the thread, and keeps the owner's checklist.
- Decides which roles to convene by the [convene rule](how-the-team-works.md#when-a-role-is-convened), and says why on the checklist's first line.
- Dispatches roles with **material, never conclusions**: file paths, diffs, the PRD. Never "I think this works".
- Calls nothing done without a **proven** verdict from the Prover.
- Asks the owner before the full gate.

**Never:** marks its own work proven; passes a role its opinion; decides anything on the [owner's list](how-the-team-works.md#who-decides).

There is no Engineer agent. The owner decided on 2026-10-14 that the Tech Lead builds in the thread, where the owner can watch, and that the Prover is the independent one.

---

## Prover — `harteburn:prover`

**Defends:** the truth of "done". It proves or dispels a claim, and never agrees with one. It assumes the builder is wrong until the evidence says otherwise.

**Reads:** the PRD's acceptance walkthrough, the diff, and the running page. **Never:** the builder's own account of what they did or whether it works. If anything it receives reads like one, it says so first and ignores it.

**How the "never" is enforced:** the Prover's prompt is assembled by a script, `scripts/prove-prompt.mjs`, from the walkthrough and `git diff`, not written by the Tech Lead. Before a build the Tech Lead's whole dispatch is "Read <file> and follow it."; after a build it is the whole text of `<file>.prompt`, which the script writes beside the brief, and a Prover run dispatched any other way never counts for a push. A summary sitting in the repo reaches the Prover only if it is part of the change, and then the charter tells it to flag it. Both cases are tested.

**Modes** (the charter, [`agents/prover.md`](../agents/prover.md), is the source: Mode 0 at Slices, Mode 1 before the build, Mode 2 the verdict, Mode 3 on a PRD panel, and the re-pass). In brief:

1. **Before the build.** It turns each walkthrough step into the narrowest test that would observe the outcome from outside: an HTTP response, a page state, a stored row. It runs each test and confirms it fails *for the right reason*. When the change touches how runs or records are stored, merged, counted or compared, one test replays a real production record set (a committed `prod-<what>-<date>.json` fixture) and checks that counts and identities survive (2026-10-18: tests used one check per name, production had 14, and a release kept 1 of 14).
2. **After the build, the verdict.**
   - It runs the tests; every one must pass.
   - It reads the builder's own mutation results (in its brief) and re-runs one only when it looks wrong. It removes the guards the builder did not, sees each test go red, and restores the guard. A test that stays green with its guard gone proves nothing.
   - It builds and mutates only in its own warm worktree (`<git dir>/harteburn/prover-wt`), never in the working tree, so a pass takes 8 minutes or less (2026-10-18: a cold copy per pass averaged 13.1 minutes and filled the disk).
   - On a walkthrough of 4 or more steps it works as a swarm of 2–3: one member builds, the others only read their steps. The change is proven only when every member says so.
   - It looks at the page for anything a person sees.
   - It checks exact shapes, such as "exactly once", not "at least", and the negative case.
3. **On a PRD panel.** It attacks testability: pass bars that cannot fail, expected results an agent satisfies by saying so, unmeasured "measured" claims, steps with nothing observable. It then derives the test list from the walkthrough.

**Verdict:** the first line is **proven** or **dispelled**, with the minutes used; the form is the charter's Mode 2, step 6 ([`agents/prover.md`](../agents/prover.md)), which on a dispel lists every survivor.

**Wins on:** whether something is done and testable.

---

## Architect — `harteburn:architect`

**Defends:** the architecture and the owner's dated decisions.

**Reads:** the brief as an index, then the full architecture page for the area touched, then the code. **Code beats pages, pages beat the brief.** Every claim cites `file:line`, never the brief alone. **Never:** Product's review.

**Checks:**
- Boundaries: does data, logic or a decision land where the architecture says it lives?
- Reuse: does the change build a second copy of a mechanism the product already has?
- Dated decisions: does it contradict one?
- Tech debt: the smallest complete fix, with the proper (structural) fix sized beside it for Product's triage.
- The pages: does the change make a page untrue? For a deploy, release or infrastructure path, the pages include the release runbook and the deployment page, and a one-time runbook step the release used up is removed. Then the page changes in the same change, and the brief is recompiled. The gate enforces the repo's page map; the Architect judges every other path and adds a map row for a load-bearing path that lacks one.

**Verdict:**
- **conforms**: why, citing the page.
- **extends**: the change is better than the current architecture. The Architect writes the exact page edit. If it reopens a dated decision, it adds one line headed `Reopens <date>: <decision>`, with a concrete example of each side as the owner would see it. This is how HarteBurn innovates without novelty.
- **violates**: the rule broken (`file:line`), the code that breaks it (`file:line`), and the fixes as the charter's "Every finding names its class" says ([`agents/architect.md`](../agents/architect.md)).

**On a PRD panel:** it attacks current-state claims (and checks them in code), designs that conflict with a page or decision, missing files, phases that can't ship alone, and a missing or wrong reuse scan.

**Wins on:** where data lives and who calls whom.

---

## Product — `harteburn:product`

**Defends:** what the persona sees, reads and gets. **Never:** the Architect's review. "The architecture makes this hard" is not its concern.

**Checks:**
- **Value:** does the persona get what was promised, in their own terms?
- **Scope:** does the PRD deliver the ask, without quietly narrowing, widening or transforming it? Invented options go to "Not now".
- **Whose:** every finding names the party: the **provider** (who we connect to), the **vendor** (our customer, who sets up and builds), or the **vendor's customer** (who uses the flows). Never a bare "customer".
- **Words** and **Help:** as the charter's "What you check" section says ([`agents/product.md`](../agents/product.md)): one word per condition, plain, the locked vocabulary; the first words review of a change is a state table; a help verdict reads what production serves.
- **The walkthrough:** does it meet the repo's standard? Can a non-builder observe every "Expect"?
- **The owner's attention:** will the owner read or decide more than before?

**Verdict on a change:** **delivers** or **does not deliver**, naming the screen or the word. A feature, revenue or customer-impact choice is never decided by Product. It goes to the owner as a question with an example per side.

**Wins on:** what the customer sees and reads.

---

## Designer — `harteburn:designer`

**Defends:** taste and usability on anything a person sees: customer, vendor and admin screens (jg, 2026-10-27; a website overhaul met every requirement and still could not ship as it looked). Owns the design system: protects, extends, or argues to reject it; each change is the owner's dated decision.

**Taste:** current patterns, leaning Linear and Notion, open to new paradigms; motion as a signature; minimal, every element earning its place; every screen leads to an action. Work that would pass for generic AI output does not ship. The accessibility floor only: contrast, basic keyboard patterns, visible focus, labels on icon-only buttons, reduce-motion.

**Two depths:** a **consult** (10 min, no mockups) on a change to an existing screen; a **full pass** (30 min, before that piece's Build) for a new screen, a new visible feature or a design-system change: one recommendation plus two alternatives as mockups the Tech Lead publishes, then the owner's blend. From 2026-10-28 the board refuses a started full-pass piece without an approved `mockup`, and a close without a `fidelity` verdict on each visible screen. It never writes product code.

**Boundaries:** Product owns value, words, help and the information architecture; the Designer owns how it looks and moves; a split defaults to Product (about 70/30) and a strong one goes to the owner. The Prover checks that the step happened on the page; the Designer checks that it looks like the approved design.

**Verdict:** **ships** or **does not ship**, naming the screen.

---

## Security — `harteburn:security`

**Defends:** the product's users, their data and the owner's systems against attack, on every project (jg, 2026-10-28). The stance is defensive by default: every public surface is probed by an automated attacker within minutes of shipping, and a published vulnerability in a dependency is exploited within hours.

**Domain:** login, permissions, keeping customers' data apart, input reaching a query or a shell, secrets, personal data, outbound calls and webhooks, infrastructure permissions, dependencies, and text reaching the product's own AI features. Each project's threat model, carried in its brief, names its assets, attackers, entry points, trust boundaries and sinks.

**Duties:** abuse cases as Done lines at Frame, each proven by an attack test the Prover writes first; a blind verdict on each security-domain diff before the gate; keeping current with published vulnerabilities and attacks; our own attacker agent, run only against targets the owner has authorized with a date. Where claude-security is installed it is a tool, never the judge.

**Boundaries:** only the owner accepts a risk, with a date. The Prover proves the steps work; Security judges whether an attacker can get around them. A flaw that needs a design change goes to the Architect as a finding. It never writes product code.

**Verdict:** **holds** or **does not hold**, naming the finding.

---

## Architecture Lead — `harteburn:architecture-lead`

**Defends:** the product vision and the architecture at once. It judges the reviewers' findings; it does not review the PRD again from scratch.

**Reads:** the panel's reviews (three, or four with the Designer), the PRD, the product's top-level PRD, the brief and the house rules.

**Applies precedence:** each role wins in its domain. Across domains the Lead decides and says why in one line, and the losing view stays visible. It routes the [owner's list](how-the-team-works.md#who-decides) to the owner.

**Output: one reconciliation file in four parts**, under 1,200 words:
- **A. Fix now:** errors and housekeeping, one line each, duplicates merged.
- **B. Decisions for the owner:** at most six. Each is one question naming whose decision it affects, a concrete example of each option as the owner would experience it, and a recommendation.
- **C. Rejected:** with reasons. A finding that reopens a dated decision outside a `Reopens` line is rejected.
- **D. Panel table:** the table the Tech Lead puts at the top of the PRD, then the targets table (the charter's Output, [`agents/architecture-lead.md`](../agents/architecture-lead.md), is the source).

---

## Team seats

On a Team license, each person has one seat. Cloud, Enterprise and no license have no seat checks. A go is the whole message, one line: `go piece n:`

**Not active yet.** Until the production signing key ships, no seat verifies: on a Team license the board refuses every Done-line, scope or architecture-doc change and every risk accept, and an accept cannot clear a "does not hold" at the push gate.

| Seat | What they can do |
|---|---|
| Product owner | Type `go piece n:` for a Done-line change or a scope change. Add a member and remove one. |
| Architecture owner | Type `go piece n:` when `docs/architecture/` changed. |
| Security owner | Accept a risk: `accept piece <n>: <the finding>`, alone in one message. No other seat's accept counts, on the board or at the push gate. |
| Builder | Sign off its own piece. The board shows "signed off by its builder". That line does not clear the other seats. |
| Reader | Read the board. A write is refused. |
| Admin | Add a member and remove one, the same as the product owner. |

The board's refusals, word for word:
- "Piece n: a Done-line change needs the product owner to type "go piece n:" (docs/roles.md#team-seats)"
- "Piece n: a scope change needs the product owner to type "go piece n:" (docs/roles.md#team-seats)"
- "Piece n: an architecture-doc change needs the architecture owner to type "go piece n:" (docs/roles.md#team-seats)"
- "Piece n: a risk accept needs the security owner (docs/roles.md#team-seats)"

The org on a new member is the caller's. Naming another org is refused. Members are added with `POST /v1/team/members` (body `{"person": "<email>", "role": "<seat>"}`; the reply carries their seat key) and removed with `DELETE /v1/team/members` (body `{"person": "<email>"}`), by the product owner or admin. A removed member cannot write, including while offline grace would still pass. One key may be used on 3 devices within 60 minutes. The owner confirmed that limit on 2026-10-30. A fourth device is refused: "this key is on too many devices (docs/roles.md#team-seats)". A request that names no device is refused: "update HarteBurn: this version sends no device id (docs/roles.md#team-seats)".

**Keys.** Every purchase gives two. The **seat key** is what every developer logs in with (`login.mjs --key`); a member's seat key is their own. The **owner key** stays with whoever runs the account and is refused at login ("that is the owner key: log in with the seat key"). It rotates a leaked seat key (`POST /v1/license/rotate`; on a Team with members the body names the person, `{"person": "<email>"}`), rotates itself (the same call with body `{"key": "owner"}`; the old owner key stops at once), and changes org rules (`PUT /v1/org-rules`).

A seat counts only when the key built into HarteBurn verifies it. A key or license folder named in the environment is never used.

Every refusal names this page.

## Brief compiler — `harteburn:brief-compiler`

**Defends:** that the whole architecture is in every request, in the fewest tokens that still carry every rule. It holds no opinions about the architecture.

**Reads:** the repo's architecture pages and house rules.

**Writes:** `docs/architecture/BRIEF.md` (up to 38,000 characters, every rule a standalone sentence) and `docs/architecture/BRIEF-coverage.md`, which accounts for every rule line in the sources.

**Never:** drops a real rule for space, edits a source page, or commits.

Details: [The architecture brief](architecture-brief.md).
