---
name: brief
description: Recompile this repo's architecture brief (docs/architecture/BRIEF.md) and its rule map from the architecture pages and house rules, then prove it is current. Use when the gate or pre-push says "brief: stale" or "unmapped rule", after adding or changing an architecture rule, or when asked to compile the brief.
---

Recompile the architecture brief for the repo in the current working directory.

1. Check the toolkit exists: `scripts/brief-stamp.mjs` and `scripts/__tests__/brief.test.mjs`. If missing, copy them from the plugin's `templates/scripts/` (path: `${CLAUDE_PLUGIN_ROOT}/templates/scripts/`) and say so.
2. Run `node scripts/brief-stamp.mjs --check` and note what it reports.
3. If the only problems are "changed since the brief was compiled" with no unmapped rule, no rule changed: run `node scripts/brief-stamp.mjs --no-rule-change` and stop. Say "re-stamped, no rule changed".
4. Otherwise dispatch the `harteburn:brief-compiler` agent with only this prompt: "Compile the brief for the repo at <absolute repo path>. Problems reported by the check: <the check output>." Pass no other context and none of your own conclusions.
5. When it returns, run `node --test scripts/__tests__/brief.test.mjs` yourself. Report: pass/fail, the brief's character count, and the compiler's short report. Show `git diff --stat docs/architecture/BRIEF.md docs/architecture/BRIEF-coverage.md`.
6. If `docs/architecture/BRIEF-questions.md` exists, score the brief: `node "${CLAUDE_PLUGIN_ROOT}/scripts/score-brief.mjs"` (a few minutes; it runs headless sessions that see only the brief, plus a no-brief control, and a separate judge). Pass is 19 of 20 with the brief and at most 5 without. On a miss, send the compiler back once with the miss lines (question, the expected rule, the answer given); never edit a question to pass. If it still fails, report the misses to the owner.
7. `/brief score` runs step 6 alone.
6. Do not commit. The owner or the Tech Lead commits with the change that triggered the recompile.
