---
name: prove
description: Dispatch HarteBurn's Prover on a change, with a prompt built from files only (the PRD's acceptance walkthrough and the git diff), so the builder's summary never reaches it. Use before building a slice (to get failing tests first) and after (for the proven/dispelled verdict; the Architect runs beside it on a load-bearing diff, and a walkthrough of 4+ steps gets a reading swarm). Arguments - the PRD path, and "before" or "after" (default after).
argument-hint: <prd.md> [before|after]
---

Run the Prover on the current change.

**Bookends mode** (the repo's `.redcell/settings.json` says `"mode": "bookends"`): the Prover runs as BOOKENDS MODE says. At piece start, `before` once; note the piece's start commit on its board item. During the build, each find's guard is broken by you and logged as in step 2. At piece end, one `after` round with `--base <piece start>`; a dispel is fixed and spot-checked by you, with no second review round unless the Lead rules it (step 6).

1. Find the PRD from the arguments (a path, or its id to search for under `docs/`). If none is given, ask which PRD this change implements.
2. **After a build**, first:
   - Commit the slice on its branch: the Prover tests a commit.
   - Record each of your own guard removals as one line in `<git dir>/redcell/mutations.jsonl` (`<git dir>`: `git rev-parse --git-common-dir`): `{"guard":"…","file":"…","break":"…","test":"…","result":"red"}`.
   - **At least one guard lists each ordinary way around it** in its `"escapes"`, each shown red by a test, or `"none, because <why>"`.
3. Build the Prover's brief mechanically:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/prove-prompt.mjs" <prd path> --mode <before|after>`
   After a build, add `--ruling <the Architect's design file>` when the piece had one.
   Before mode adds "Required screen rows" (links, help, session, failure) for each screen the steps name, and refuses steps that name none unless `--no-screens "<why>"` (a staff command, a migration).
   It prints the path of the brief it wrote. If it exits non-zero, report its message and stop.
4. **The reading swarm (after a build).** `prove-prompt.mjs <prd path> --list-steps` counts the walkthrough's steps. With 4 or more, split them into 2–3 groups of consecutive steps and build one brief per group instead of step 3's single brief: `--mode after --steps 1-3 --role builds`, `--mode after --steps 4-6 --role reads`, and so on. Exactly one member is `--role builds`: only it runs tests and mutations, in the warm worktree. With fewer than 4 steps, one Prover and one brief.
5. **Dispatch everything in ONE message**:
   - each Prover (`harteburn:prover`) with exactly this prompt and nothing else: `Read <its brief path> and follow it.`;
   - when the diff touches a load-bearing path the architecture brief names (its "When you change X, update page Y" areas, or a path on the page map in `docs/architecture/README.md`), `harteburn:architect` on the same diff: `Judge the change in <a brief path> against the architecture pages and house rules. Its Task line is the Prover's, not yours.` Same message as the Provers, never after.
6. When they return, the verdict is **proven** only if every Prover says proven. Put it on the board as one line of open work (the slice's item note, not a Done line), `Prover: <verdict> — <tests> · red-on-removal <yes/no> · screen <what it saw> · <minutes> min`. Each Prover's row in the board's `runs` comes from the dispatch ledger; set its `minutes` from its verdict's first line and its `purpose` (e.g. `after: S2 · steps 1–3 · builds`). If the verdict is **dispelled** and you, the builder, disagree, that goes to the owner as one question with the Prover's evidence and yours.
   **A dispelled verdict:** save it word for word to `<git dir>/redcell/verdict-<timestamp>.md`.
   - **The re-pass** (round 2): `prove-prompt.mjs <prd path> --mode after --repass <the round's brief> --verdict <that file>` (keep `--steps`/`--role` as before). Its brief carries the verdict and diffs only from the commit that round tested. A re-pass on dispelled steps always uses `--repass`, never a fresh brief (`rounds.jsonl` shows a fresh round 1 as a restart).
   - **The second dispel of one step: no third automatic round.** Dispatch `harteburn:architecture-lead`: `Rule on the second dispel (your charter's "When a target falls, and the second dispel"). Verdicts: <file 1>, <file 2>. Briefs: <brief 1>, <brief 2>. Write the ruling to <git dir>/redcell/ruling-<timestamp>.md.` Round 3 takes `--lead-ruling <that file>`.
6a0. **One pack per piece.** At each beat build `node "${CLAUDE_PLUGIN_ROOT}/scripts/piece-pack.mjs" <prd> --steps <a-b> [--base <piece start>] [--ready <ruling>]` (the brief, the piece's §0 steps, its Ready, a diff stat; refused over 120 KB) and name only that pack plus the files to cite in every role prompt of the piece: Architect, Product and the Prover alongside its own brief. Never "read BRIEF, house rules, the PRD and earlier reviews".
6a. **What each run reads, and on which model.** The brief names the files to read; a re-pass or spot check is dispatched with `model: "sonnet"` and reads only the fix diff and its own earlier verdict.
6b. On **proven, gaps to pin**, pin each listed gap yourself; the Prover spot-checks in ≤ 5 min; no re-pass. `prove-prompt.mjs --mode after` refuses a first pass until `mutations.jsonl` names a code file in the diff. It also refuses a guard log with no `escapes`, a new test fixture with no `fixture:` source comment, and lines removed from a loaded file without `--removed <ledger>`.
7. After a **proven** verdict, move the mutation log aside (`mv <git dir>/redcell/mutations.jsonl <git dir>/redcell/mutations-<timestamp>.jsonl`).
8. Never mark a slice done without a **proven** verdict from step 6.
