---
name: done
description: HarteBurn's Definition of Done ceremony - Product reviews what was delivered, in production, against the Frame's numbers and the product's goals, and says done or not done. A green gate is not done. Use after every release of an objective's last slice (or when the owner asks "is it done?"). Argument - the objective (or the PRD path).
argument-hint: <objective or prd.md>
---

Run the Done review. **Timebox: 10 min.**

1. Gather the evidence from **production**, not from the gate:
   - the running version, and **CI for the released commit**:
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/ci-after-release.mjs" <repo root> <released commit>` (the
     release's post-deploy step runs it first; here it only confirms). A red job is a found item and
     a Yours line from the day of the release, never first found here;
   - the logs and numbers that measure the Frame's objective (times, counts, errors);
   - what the persona's screen shows;
   - the help for each screen the objective changed, quoted as production serves it.

   Read-only. Put it in one evidence file (`docs/reviews/<id>-<date>-done-evidence.md`), facts only,
   with no conclusions. **Start it from the skeleton and check it before dispatch**:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/done-evidence.mjs" init .harteburn/board.json <evidence file>`
   writes one `## D<n>` section per Done line; fill each with what production showed; `… check …`
   exits 1 naming every outcome line still empty, and the review is not dispatched until it passes.
2. Dispatch `harteburn:product` with only this:
   > Run the Done review (your charter's "At the Done review" section) for "<objective>". The
   > Done lines: <the board record's `done_when`, each line with its state>. The evidence:
   > <evidence file path>. Write your verdict to `docs/reviews/<id>-<date>-done.md`, one verdict
   > per Done line.
   With more than 8 outcome lines the board refuses the record's close: merge them into the outcomes the persona sees first.
   Then set each `done_when` line's state from the verdict, with its `evidence` (what production
   showed). A line production did not show stays `todo` (or `doing`).
   **The fidelity check**: when any piece has `screens`, dispatch the Designer
   (`harteburn:designer`) beside Product: `Run the fidelity check (your charter's "At Done") for <each piece's screens and
   its approved mockup>. Production: <the URLs or reads>.` Put its verdict on each screen as
   `"fidelity": "ships"` or `"does not ship: <why>"`.
3. Report to the owner on the checklist's Done line:
   - **done**, or **not done** + what is missing + the next step;
   - each Done line against production, one line each.
4. Ask the owner, in one line: **retro: full, lean, or dismiss?** It is the owner's call (Product may
   make it on the owner's behalf); `/retro` defines each form.
5. Run `/retro` in the chosen form. ⛔ The objective is **closed only when the Done verdict and the
   retro (or its dismissal) are filed**. Until then the checklist shows it open.
