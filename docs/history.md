# Why the rules exist

The charters and skills state each rule once, without its story; the story lives here, so the
files every run loads stay short (rc-steward, jg 2026-10-28). Grouped by the file the rule lives in.

## skills/retro/SKILL.md

- **The Product–Designer disagreement tally**: so the owner can recalibrate the default lean (about 70/30).
- **Each role's own evaluation, written blind first** (jg 2026-10-21, rejecting a one-voice draft):
  *"retro is all about learning from what happened (what went well, what went poorly, what are we
  going to change). where is that evaluation from each agent/team member?"*
- **Would the owner ship the visible work as it is?** (jg 2026-10-27): a website overhaul's retro never
  said it could not.
- **A Change is shown with its story** (jg 2026-10-21): the owner could not judge mechanisms with no
  story.
- **Dismissed retros leave a one-line file** so the next `/frame` knows there are no Changes to check.
- **An incident that lives only in a retro or in memory is invisible to the next developer**, hence
  the troubleshooting entry in the same commit.
- **Removes, and the tidy pass** (rc-steward, jg 2026-10-28): the instructions only grew. In 13 days
  `skills/frame/SKILL.md` went 426 → 2,238 words and `agents/prover.md` 557 → 2,080; nobody owned
  subtraction. Budgets are a judgment call: trim first, raise with a dated, owner-approved reason.

## agents/architect.md

- **New infrastructure: name its rehearsal** (2026-10-15): a new Cloud Run job's args replaced the image's CMD and it failed in production in 9 s; nobody had run it.
- **Tech debt: the smallest complete fix, with the proper fix sized beside it** (retro 2026-10-21): a should-fix with no size or smaller option became a committed helper with a SQL denylist, 5 Prover rounds and the gate 40 min late, where a SELECT-only database user was the guard.
- **Every finding names its class** (retro 2026-10-21, jg ratified): FEA-CC-452's recipe hand-out guard went 6 rounds and the prod-read helper 5, each round finding one more instance.
- **A ruling names its readers, not only its writers** (retro 2026-10-25, jg ratified): the KIT-001 401 fix's class listed the 2 writers of `last_error`; gate 4 then found 2 real defects in tests that read the stored sentence the fix rewrote, after the end review had passed it.
- **At Ready, rules hold** (retro 2026-10-21): at least 4 of one live run's 18 defects broke a rule already on the brief, and help was missing from the image for two months while the deployment page described that stage.
- **The write-end table first** (retro 2026-10-21, jg ratified): FEA-CC-452's panel had none, and 3 of its 6 recipes could never complete.
- **A production setup is rehearsed against production** (retro 2026-10-23, jg ratified): KIT-001's production setup went to a customer that never existed (`canary-quickbooks`), used a local id that was a deleted canary leftover, and missed two recipe tests' staff keys that lived only in the local database; the first production kit run failed. **A design ruling opens with its smallest complete cut**: piece 7 was first designed at 615 min and re-cut to fit jg's 30 min.

## agents/product.md

- **Each Done line can be completed, and says where it is proven** (retro 2026-10-21, jg ratified): FEA-CC-452 framed "6 recipes pass Test" by resource name; 5 fell, the last two after the final release, because QuickBooks needs an item type and an invoice needs ids that Shopify never has; 2 of 11 lines could only ever pass on a stub.
- **Who reads each Done line, and when** (retro 2026-10-23, jg ratified); `earliest` only with `waits_for`, never a guessed date (jg 2026-10-27).
- **A find gets exactly one of three answers** (retro 2026-10-21, jg ratified): FEA-CC-452's ~104 finds nearly all became work inside it, open rows reached 55, and Build ran 3 days 8 hours.
- **Information architecture is Product's; how it looks and moves is the Designer's** (jg 2026-10-27).
- **A help verdict on a release quotes what production serves**: production served no help article from 2026-08-17 to 2026-10-21 while help verdicts were given from the repo.
- **The first words review is a state table** (retro 2026-10-21): S4's words took 4 rounds, 21 of 34 Product runs were words rounds, each finding a state the last fix had made visible.

## agents/designer.md

- **Why the Designer exists** (jg, 2026-10-27): a website overhaul met every requirement and used the design system, and still could not ship: it looked like every other AI-generated site.

## agents/architecture-lead.md

- **A Product–Designer split defaults to Product, about 70/30** (jg 2026-10-27).
- **Any hold beyond the release cadence is a priced bundle** (2026-10-15/16): bundling held a proven refresh fix back ~9 h to save one release, about $0.30 of Actions.
- **When a target falls, and the second dispel** (retro 2026-10-21, jg ratified): FEA-CC-452's recipe target fell from 6 to 1 one recipe at a time over three days; two guards went 6 and 5 Prover rounds while every role agreed, so a charter that fires only on disagreement never fired.

## agents/prover.md

- **One warm worktree; a pass takes 8 minutes or less** (retro 2026-10-18, jg): five passes on 2026-10-18 took 20.1, 6.4, 17.6, 12.7 and 8.6 minutes (mean 13.1): each made a fresh `git archive` copy with its own build folder, so every pass built the whole workspace cold (minutes, ~20 GB of disk), and the disk fell to 0.6 GB free.
- **Mode 0: each Done line's failing test or live check, at Slices** (retro 2026-10-21, jg ratified): 4 of FEA-CC-452's 11 Done lines could not pass inside it; two the Prover had flagged at the panel stood as live bars for 3 days, and two recipes were found impossible after the last release.
- **On a change to text, one assertion per new sentence, red on HEAD** (retro 2026-10-27, jg ratified): 12 survivors on RC-DESIGNER were text tests matching words the old file already had.
- **One pass per slice, never per change** (retro 2026-10-15): proving after every change, one recompile per guard, was the biggest drag.
- **Run the readers and callers with the gate's own command** (retro 2026-10-25, jg ratified): gate 4 found 2 real defects in the KIT-001 401 fix after "proven", both in tests that read the text the fix rewrote; and 2 of 5 gates went red on races between tests that nextest's one process per test cannot show.
- **Read the builder's mutations first** (retro 2026-10-16): 5 rounds re-proving hollow tests; 2026-10-18: twice the Prover had none and re-ran them all.
- **Sweep every guard in one pass and list every survivor** (retro 2026-10-21): 9 rounds on two guards, one survivor reported per round, 1 round in 9 found a code defect.
- **Three verdicts: proven, defect, proven with gaps to pin** (retro 2026-10-23, jg ratified): on KIT-001, 7 re-passes found 0 code defects, all test strength, and "dispelled" was the first verdict 10 times in 11, 6 with no product defect.
- **With one release per objective, "proven" means proven live before the gate** (retro 2026-10-21, jg ratified): with one release at the end, nothing reaches production until then.
- **On a release, look at the page in a build with the release's own layout**: dev servers read files the image never copied.
- **Live first on a connector path, then narrow** (retro 2026-10-23, jg ratified): local runs found ~7 KIT-001 defects no Prover test predicted; a fake with an attribute the real object lacks made piece 5's check vacuous.

- **Stand-ins answer only what was asked** (FEA-CC-452): a generous stub hid "selected only `id`" twice, the second time in production (Shopify's canary 34 of 53).
- **For a bug, the fixture comes from the full production snapshot** (2026-10-15): a test modelled one sign-in with flows; production had two, and the fix failed live.
- **A change to how runs or records are stored, merged, counted or compared replays a real production record set** (2026-10-18): every test used one check per name; production files 14 per name; v0.53.0 kept 1 of 14 and cost a second release (~2.5 h). "Prod-snapshot fixtures" was already a rule from the 2026-10-15 retro and did not hold, because nothing triggered it; this trigger is the mechanism.
- **The checks only the gate runs, run when the slice touches their inputs** (FEA-CC-452): it lost 2 of its 5 gate reruns to checks the narrow loop never ran.

## agents/brief-compiler.md

- **The compiler never drops a rule**: its output is an artifact that every session and every agent in the repo receives at start, so a dropped rule there means every agent works without it.
- **Hard limit 29,000 characters** (jg, 2026-10-19): raised from 19,400 in two parts.
- **Size is not a cost to minimise; never drop a real rule for space** (jg, 2026-10-14).

## skills/prove/SKILL.md

- **Bookends mode** (jg 2026-10-23): the Prover runs twice per piece, never mid-piece.
- **The Architect in the same message as the Provers, never after** (2026-10-18): the Architect usually ran after the Prover, adding its minutes to every round.
- **A pass takes 8 minutes or less** (retro 2026-10-18, jg): five passes averaged 13.1.
- **Each ordinary way around a guard, shown red** (retro 2026-10-21): escapes found one per Prover round cost 9 rounds on two guards.
- **`--ruling` refuses a ruling with no stored values or readers** (retro 2026-10-25, jg ratified Change 3).
- **The second dispel of one step: no third automatic round** (retro 2026-10-21, jg ratified): FEA-CC-452's guards went 6 and 5 rounds.
- **Three verdicts** (retro 2026-10-23, jg ratified).

## skills/handoff/SKILL.md

- **Hand off to a fresh conversation, never compact** (retro 2026-10-15): every call re-reads the whole conversation, so a long one costs the most.
- **A fresh window resumes from files**: a fresh conversation that resumes from files is cheaper and loses nothing; a compacted summary is lossy and stays in the context that every later call re-reads.
- **Never tell the owner to `/clear`** (jg, 2026-10-15): the old window stays readable; the new one starts small. The owner's words: "I do NOT want to use clear. I want to open a new window, so that I can see the old one if I need it".
- **Reopened: `/clear` then `go` is the default handoff** (jg, 2026-10-30): "I can't really create a new session from my phone when we are working, and I want you to be able to continue here while I answer questions remotely." The old conversation stays reachable with `/resume`; a new window still works.

## skills/done/SKILL.md

- **CI for the released commit is read at release, never first found at /done** (retro 2026-10-25, jg ratified): CI's docker job was red at every v0.60.x release and reached jg only when /done blocked.
- **More than 8 outcome lines: the board refuses the close** (retro 2026-10-25).
- **The fidelity check at Done** (jg 2026-10-27).

## skills/prd-panel/SKILL.md

- **The panel runs on Fable** (jg 2026-10-17): adversarial PRD review is Fable's job; the roles' own `model: opus` serves their everyday work.
- **The Designer sits on the panel when the PRD changes anything a person sees** (jg 2026-10-27).
- The dated-decision example read "Approved by jg 2026-10-13: ..."; it now names the owner, not jg.

## bookends.md

- **Bookends mode** (jg 2026-10-23): roles only at a piece's start and end, overriding BUILD+PROVE and ROLES inside a piece.
- **Targeted runs for fixes; the full suite once, at the piece end or before the gate** (jg 10-23).

## skills/frame/SKILL.md

- **Frame through an approved PRD ≤ 30 min when the design reuses existing mechanisms** (retro 2026-10-21): FEA-CC-452's took 59.
- **The board refuses** (retro 2026-10-21, jg ratified): FEA-CC-452 kept six updates in a key no view showed, and reached 55 open rows.
- **The runs come from the dispatch ledger** (retro 2026-10-21): FEA-CC-452's record missed 43% of its dispatches.
- **`done_when` is the board** (jg 2026-10-19).
- **At most 8 outcome lines; never a fixed bug** (retro 2026-10-23, jg ratified): KIT-001's Done grew to 24 lines, 11 of them fixes, and 6 were "never looked" at /done.
- **`earliest` only when the proof needs time to pass** (jg 2026-10-27: never a guessed date).
- **Every ask, once, now** (retro 2026-10-21, jg ratified): FEA-CC-452 waited on the owner 180 of 1,300 audited minutes (14%; one dashboard question took 66), and a go given in one session was refused by the permission classifier in the next, three times.
- **Every provider setting a Done line depends on, read live** (retro 2026-10-26, jg ratified): a website's waitlist shipped dropping every sign-up because Netlify form detection was off, found only at /done ~3 h after Ready.
- **Each new account, proven live** (2026-10-18): R2 found Shopify's app had no distribution chosen, so customer data was refused.
- **Each Done number, measured on its own case** (retro 2026-10-26, jg ratified): OPS-CC-469's docker target moved 5 → 8 → 9 min: a run on unchanged code stood in for "a stamped push that changes code".
- **A find while building gets one of three answers; never an automatic deferral** (retro 2026-10-21, jg ratified): FEA-CC-452 had no list; ~104 finds became work, open rows reached 55, Build ran 3 days 8 hours.
- **Design: each visible piece marked consult or full** (jg 2026-10-27).
- **A timebox per slice; past 2×, offer the owner a cut** (retro 2026-10-21): FEA-CC-452's Build had none and ran ≈ 57 h; the cut came from the owner, "inordinately long".
- **A started piece keeps its scope; each 2× of its price stops it** (retro 2026-10-25, jg ratified): KIT-001's piece 12 ran 2,208 of 120 min after three owner-approved items joined its card.
- **An item that waits on an owner act is refused until a Yours line names it** (retro 2026-10-25).
