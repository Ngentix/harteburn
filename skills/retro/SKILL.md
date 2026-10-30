---
name: retro
description: Write HarteBurn's retro after an objective (one page when lean; a full one starts from each role's own evaluation) - numbers, what was found late and which beat should have caught it, each role's runs and contribution, Keep/Change (each change with an owner and a check), the owner's ratification of each Change and its build in the same session, and whether every earlier open Change worked. Files it in the harteburn repo's retros/ folder. Use after /done, or when the owner asks for a retro. Argument - the project and objective.
argument-hint: <project> <objective>
---

Write the retro in the form the owner chose at `/done` (Product may choose for them; **lean unless
they say full**). Why each rule exists: `docs/history.md`.
- **full**: the whole template, built from **each role's own evaluation, written blind first**.
  Dispatch Product, the Architect, the Prover, the Lead and (when the objective changed anything a
  person sees) the Designer in one message, each with the same brief (the facts with numbers, the
  owner's points in their words, the sources) and its own file; write the Tech Lead's yourself, before
  reading theirs. Each answers: went well, went poorly (cost, cause), its own misses, each owner's point, and
  what it would change (Problem · Cause · Change · How we'd know). Keep a section per role in its own
  words; answer each owner's point with where roles agree and differ; merge the proposals into ≤ 3
  Changes, naming each disagreement and how it was merged; keep the role files beside the retro;
- **lean**: only "Actions and changes" plus "2. Numbers";
- **dismissed**: a one-line file `retros/<date>-retro-<project>-<topic>.md` saying "dismissed by
  <who>, <date>".

**A lean retro is one page at most. Every line must change what we do next time, or it is cut.**

1. Copy `retros/TEMPLATE-retro.md` from the HarteBurn plugin repo to
   `retros/<YYYY-MM-DD>-retro-<project>-<topic>.md`.
2. **Capture the checklist** from the local files, not the page: the record
   (`.redcell/board.json`: Done lines, beats, scope changes, runs), the work log
   (`<git dir>/redcell/log-<id>.jsonl`, one finished item per line; `ts: null` marks items finished before the log existed; count it, don't paste it) and
   the dispatch ledger (`<git dir>/redcell/ledger.jsonl`). Section 7 gets the Done lines as they
   ended, time per beat, and the `found` and `mistake` rows, each with its cost; section 8 the runs.
3. Fill the rest from the record, not memory: time per beat against its timebox, each run's tokens
   and minutes, releases and production defects, Product's Done verdict.
4. Section 3 (found late): each defect or rework, its cost, and **the beat that should have caught
   it**. When the objective changed anything a person sees, ask: **would the owner ship the visible
   work as it is?** And give the Product–Designer disagreement tally ("4: Product 3, Designer 1",
   one line each with how it ended) against the default lean (about 70/30).
5. The Actions table: at most 3 Keep, 3 Change and 3 Removes. Each Change has an owner and a measurable check for next
   time. A Change that adds words names what it removes, or the dated raise in `budgets.json`. Write no line that has no action.
6. Section 5: each Change `open-changes.mjs` prints: did it hold this time? Mark it `worked` (held in
   two objectives), `keep`, `dropped`, or `moved to <repo>` (project code).
7. The project's own retro goes in its repo, `docs/retros/<date>-retro-<topic>.md`. In the same
   commit, **each production incident** gets one entry in the troubleshooting doc (the house rules'
   `Troubleshooting: <path>` line; if there is none, ask the owner once and add the line): symptom as an operator sees it → proven cause →
   fix or command.
8. **Ratify.** Show the owner each Change with its story, never the mechanism alone: **Problem** (as it happened, with numbers) · **Cause** · **Change** (where it will live: skill, charter, hook, house rule, board
   field — a mechanism; memory or prose only when nothing can enforce it) · **How we'll know**. The owner
   answers yes / no / modify per Change.
8b. **Where it lives.** `node scripts/layers.mjs --route "<where>"` prints `core`, `project` or `user`.
   `project` writes `.redcell/changes.json`. `user` writes `changes.json` under `REDCELL_HOME`.
   `core` writes `overrides.json` there: built on this machine, not carried by a plugin update, submitted
   only after 8c.
8c. **Nothing leaves until the owner sees it.** `node scripts/redact.mjs <file>` prints Problem, Cause,
   Change and How we'll know, and every identifier it stripped. The owner reads that. Only then
   `node scripts/phone.mjs change <file> --yes`. No license file, no send.
9. **Implement at once.** Build every ratified Change in this session, in the place named, with a
   test where the repo has them; commit (ratification is the owner's go for the HarteBurn repo). Status `done in <version or
   commit>`; refused: `dropped — <who>, <date>`. One that needs its own build (another repo, a
   feature) is the handoff's first item, `ratified — <where it is queued>`. Never prose only.
10. **Tidy pass** when `node scripts/budgets.mjs` exits 1, or this is the 3rd retro since the last `retros/*-tidy.md`.
   Brief a fresh `general-purpose` agent, which wrote none of the rules, with the files' counts, every
   retro's sections 3 and 5, and `docs/history.md`. It writes `retros/<date>-tidy.md`: at most 15 proposals, each with the words it saves
   (merge two rules, drop one whose reason no longer holds, mark a Change `worked`, `dropped` or `moved to <repo>`), and
   names each waste that repeats across retros, with their paths. The owner ratifies each in one
   sitting, like a Change; ratified ones are built at once, and each file's budget lowered to its new count.
