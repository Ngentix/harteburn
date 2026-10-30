# Retro: <project> <objective id> (<dates>)

File as `retros/<YYYY-MM-DD>-retro-<project>-<topic>.md`. HarteBurn's process only; the project's
own retro lives in that project's repo, and so does a Change to its code, tests or setup:
write it there and mark it `moved to <repo>`. **Every line must change what we do next time, or it is
cut.** The owner (or Product) chooses at `/done`: **full** (all sections), **lean** ("Actions and
changes" + "2. Numbers" + "7. The checklist" + "8. Runs") or **dismissed** (one line:
"dismissed by <who>, <date>"). Sections 7 and 8 are data, copied from the board record. Keep them
even in a lean retro: they are how HarteBurn learns over time.

## Actions and changes (read this first)
| # | Change | Owner | How we'll know next time | Status |
|---|---|---|---|---|
| 1 | | | | proposed → ratified (owner, date) → done in <version or commit> / ratified — queued in <where> / dropped — <who>, <date> / moved to <repo> (owner, date) → worked |

**Keep (≤ 3):** …

**Removes (≤ 3):** <each rule, step or sentence this retro removes or merges, and why its reason
no longer holds; or "none, because …">

## Narrative summary
<5–10 sentences: what we set out to do, what happened, where the time went, what we found late
and why, and what the owner decided. Written so someone who was not there understands it in one
read.>

## 1. Objective met in production?
<yes / no>: <the Frame's number vs what production shows; the gap, if any>

## 2. Numbers
| Time to delivery | Time per beat vs timebox (Frame / Ready / Slices / Build+prove / Done) | Production defects | Tokens | Est. waste (time / tokens) |
|---|---|---|---|---|
| | | | | |

## 3. Found late that could have been early
| What | Cost | The beat that should have caught it |
|---|---|---|
| | | |

## 4. Roles
| Role | Runs | Findings adopted | Missed |
|---|---|---|---|
| Product | | | |
| Architect | | | |
| Prover | | | |
| Architecture Lead | | | |
| Tech Lead (flow) | | | |

## 5. Earlier retros' changes (every one not yet `worked` or `dropped`)
| Change | Worked? | Keep / drop |
|---|---|---|

## 6. The retro discussion
<The owner's points and the decisions reached, in order, each dated. The record of why the
Changes above exist.>

## 7. The checklist, as it ended (the board record and its log)
| Beat | Timebox | Used |
|---|---|---|

**Done lines:** <each `done_when` line, its state, its evidence>

**From the log** (`<git dir>/redcell/log-<id>.jsonl`): <N finished items; each `found` and
`mistake` row, with its cost>

**Scope changes:** <each: added / dropped / changed — what — why — who — when>

## 8. Runs: model, tokens, time
| Role | Model | Purpose | Tokens | Minutes |
|---|---|---|---|---|
| Tech Lead (main session) | | | | |
