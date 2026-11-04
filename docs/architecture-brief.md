# The architecture brief

Every repo under HarteBurn has a **brief**: its architecture pages and house rules, compiled into the fewest tokens that still carry every rule. It is put into every session and every agent at start. The brief is how a single Architect charter becomes an expert in each product: it doesn't know the product, it knows how to read that product's brief, pages and code.

## The pieces, per repo

| File | What | Edited by |
|---|---|---|
| `docs/architecture/*.md` | the architecture pages, the source of truth | people |
| `docs/_house-rules.md` | the owner's settled rules, one line each, dated, marked ⛔ or ⭐ | people, on the owner's dated word |
| `docs/architecture/BRIEF.md` | the compiled brief, up to 38,000 characters | **only** the compiler |
| `docs/architecture/BRIEF-coverage.md` | the map: every rule line in the sources, and where it went | the compiler, then the stamp |
| `docs/architecture/BRIEF-questions.md` | twenty questions with an answer key, written from the pages | people; a key is corrected only against a newer dated decision, and logged |
| `scripts/brief-stamp.mjs` | check, stamp, list rules | copied from this repo's `templates/` |
| `scripts/__tests__/brief.test.mjs` | the gate test | copied from this repo's `templates/` |

## What counts as a rule

A **rule line** is any line in a source that carries ⛔ (never / must) or ⭐ (the decided way to do it). Its identity is a hash of its file and its text, so an edited rule counts as a new rule. Connector Cloud has 250.

**Sources** are `docs/architecture/*.md`, except the `BRIEF*` files, plus `docs/_house-rules.md`.

## The brief's shape

1. One line: what the product is.
2. **Boundaries and ownership**: who owns what.
3. **Rules**, each with an anchor such as `[B7]` and the page that settles it: `[B7] Never X; do Y instead. (07)`. Every rule must stand alone for a reader who has never seen the page. No bare labels like "CSV formula guard", no fragments like "can't pay out".
4. **When you change X, update page Y.**
5. **Words:** the locked vocabulary.
6. **Page map:** one line per page.

Kept: invariants, ownership, every "never" and "always", dated decisions, vocabulary. Dropped: history, rationale, examples, measurements, status. **A real rule is never dropped for space** (owner, 2026-10-14).

## The coverage map

The sources hold more rule lines than any summary repeats verbatim, so every one is accounted for in `BRIEF-coverage.md`:

| `where` | Meaning |
|---|---|
| `B7` | carried by that anchor |
| `folded: B7 <why>` | merged into a broader rule |
| `dropped: <why>` | not a rule: history, status, a measurement, an example, a legend, a duplicate |

## Kept current: the gate

`node --test scripts/__tests__/brief.test.mjs` runs in the pre-push hook on any docs change and in the full gate. It fails, naming the cause, when:

- **a source changed** since the brief was compiled (each source has its own sha256 in the map; a `last_verified:` date bump doesn't count)
- **a rule line is unmapped**, meaning new or edited
- a map entry points at an anchor the brief lacks, or is dropped without a reason
- the brief is over 38,000 characters (within it, the split always fits the hook's four parts)

**To fix:**

| The check says | Do |
|---|---|
| `stale — <page> changed`, and you changed no rule | `node scripts/brief-stamp.mjs --no-rule-change` |
| `unmapped rule …`, a rule was added or edited | `/brief` |

The re-stamp **refuses** if any rule line is unmapped. "No rule changed" is checked mechanically, not taken on trust. Anyone can run the re-stamp without the plugin. A rule change needs someone with the plugin to run `/brief`.

## Delivered in up to four parts

Claude Code cuts any one hook's context string at 10,000 characters, and does so silently. A brief longer than one string's room is therefore sent as **up to four strings** (three until 2026-10-30, two until 2026-10-19). A part holds about 9,700 characters, and a brief takes the fewest parts its length needs. Each part ends at its last `## ` heading that still lets the rest fit the parts left and leaves the part at least half full, else at its last such line break (one rule per line, so no rule is split), else where it is full; so a brief within the limit fits four parts wherever its headings fall, and no part but the last is under half full. The hook and the gate use the same split function, and HarteBurn's own tests prove the two copies agree, including at the boundary. Each part is labelled "part 1 of 4" and so on. Each `hooks.json` entry names its part and how many are sent (`brief-session 2 of 4`). A running session reads `hooks.json` once, at its start, so one started before 0.13.0 asks for two parts by bare number; its second part then carries the rest, cut loudly at the cap if it must be, never dropped silently. A brief over the limit that reaches the hook anyway is treated the same way in the last part.

## Proven faithful: the score

`/brief score` runs `scripts/score-brief.mjs`:

1. **With the brief.** A headless session in an empty directory, with no repo, no tools, no connectors and HarteBurn's own hooks off, answers the twenty questions using only the brief.
2. **Without the brief, as a control.** The same questions, with no reference at all.
3. **A separate judge** marks each answer against the key: correct only if it states the rule's substance.

**Pass:** at least 19 of 20 with the brief, and at most 5 of 20 without. The control proves the answers come from the brief, not from general knowledge. The result goes to `.git/harteburn/brief-score.json`.

A miss is fixed in the **compiler**, never by editing a question. Connector Cloud's history:

| Compile | With | Without | Lesson |
|---|---|---|---|
| First: 46 rules, 8,653 characters | 17 | 0 | rules compressed into labels; one key wrong against a newer decision |
| Every rule standalone | 19 | 0 | readable, but eight real rules cut to fit 9,000 characters |
| 18,000 characters in two parts | **20** | **0** | 75 rules, nothing real dropped |

## `/brief`

1. Copies the toolkit into the repo if it's missing.
2. Runs the check. If only page hashes changed and no rule did, it re-stamps and stops.
3. Otherwise it dispatches `harteburn:brief-compiler` with only the check's output.
4. It runs the gate test and reports the size, the counts and the compiler's least-certain drops.
5. It scores the brief if the repo has an answer key, and sends the compiler back once on a miss.

It never commits. The brief is committed with the change that made it stale.
