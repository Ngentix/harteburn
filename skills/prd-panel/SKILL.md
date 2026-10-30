---
name: prd-panel
description: Run HarteBurn's PRD panel - Product, Architect and Prover review a PRD in parallel, blind to each other, then the Architecture Lead reconciles them into one decision table for the owner. Use on every PRD before the owner approves it, or when asked to review a PRD. Argument - the PRD path or id.
argument-hint: <prd.md or id>
---

Run the panel on one PRD.

1. **Find the PRD** from the argument (a path, or its id to search for under `docs/`). Read only its front matter and status lines yourself.
2. **List its dated decisions** from the PRD's own status and decision lines. Write them as short quoted lines. These are fixed: the reviewers may challenge one only with a `Reopens <date>: <decision>` line.
3. **Name the files**: `docs/reviews/<id>-<YYYY-MM-DD>-product.md`, `-architect.md`, `-prover.md`, `-reconciled.md`, where `<id>` is the PRD's roadmap id. Create `docs/reviews/` if missing.
4. **Dispatch three agents in one message, in parallel**: `harteburn:product`, `harteburn:architect`, `harteburn:prover`, each with `model: "fable"` on the Agent call. If Fable is refused or unavailable, run on the roles' own model and say so in the report, never silently. Each gets the same prompt and nothing more:
   > Review the PRD at `<path>` as a PRD panel member (your charter's "On a PRD panel" section; the Frame's write-end table and each Done line's proven-where are in scope). Read the repo's PRD standards and walkthrough standard if it has them. Its dated decisions are fixed: <the list from step 2>. At most 8 findings, most severe first, each: severity (blocker / should-fix / nit), the claim, the evidence (section + quoted phrase; file:line for code), the fix in one sentence (the Architect: the fixes its charter asks). Write them to `<your review file>`; never edit the PRD or commit.
   Never include your own view of the PRD, or another reviewer's output.
   **When the PRD changes anything a person sees**, dispatch the Designer (`harteburn:designer`) in the same message
   with the same prompt.
5. **When all return**, dispatch `harteburn:architecture-lead`, also with `model: "fable"`, with:
   > Reconcile the PRD panel for `<path>`. The reviews are `<the review paths>`. The PRD's dated decisions are fixed: <list>. Write the reconciliation to `<reconciled path>`.
6. **Record cost** at the end of the reconciliation file: a table of each agent's model, tokens and duration, taken from the Agent results, not estimated.
7. **Put the panel table at the top of the PRD**, as a `## Panel table` section after its status lines, copied from the reconciliation's part D, with a link to the reconciliation file. Add nothing of your own to it.
8. **Report to the owner** in the HarteBurn checklist: the decisions from part B, each as one question with its example; then a count of fixes in A and rejections in C. Do not apply the part A fixes until the owner has seen the decisions, unless they are plain errors (broken links, wrong file names).
