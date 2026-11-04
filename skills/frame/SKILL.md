---
name: frame
description: Start every objective with HarteBurn's Frame and Ready beats - Product states the objective in production terms with numbers (time, cost, what the persona sees), then the Tech Lead gathers what a guess would miss (a full production snapshot, a production-latency number, a rehearsal plan for new infrastructure) and cuts thin slices, quick win first. Opens the live checklist page. Use at the start of any new objective or PRD, before any build. A fix skips it (build and prove directly). Argument - the objective in the owner's words.
argument-hint: <the objective>
---

Frame the objective, make it Ready, and slice it. **Timebox: Frame 10 min · Ready 15 min · Slices 5 min;
Frame through an approved PRD ≤ 30 min when the design reuses existing mechanisms**.

0. **Carry the open Changes forward.** Put each Change that `node scripts/open-changes.mjs` prints,
   run in the HarteBurn plugin repo, on the new checklist as a check ("did it hold this time?"); a `PROPOSED` one goes to the owner first.
0b. **Check that the hooks run here.** Read `<git dir>/harteburn/ledger.jsonl` for a `session` row
   from this session (the session-start hook writes one). None: the plugin's hooks are not running
   (a cloud session, HarteBurn run from its files), so nothing records the runs and nothing stamps
   the board. Say so in chat and on the board, then after **every** Agent result run
   `node <plugin>/hooks/harteburn-hook.mjs ledger-stop --manual <role> "<purpose>" <tokens> <ms>
   [--model <m>]` (the numbers in the result), and run `board-md.mjs` yourself after every record
   edit, so its stamps, not typed times, set the beats. The board refuses a record opened from
   2026-10-29 whose ledger shows neither.
   **Set the objective's token budget** (`budget_tokens`, the owner's number; ask once at Frame,
   else 2,000,000): the board shows tokens used against it, and an over-budget line is the signal
   to narrow the next briefs or ask the owner.
1. **Open the live checklist page.** If `harteburn.json` is present, `board-md.mjs` also stores the record on the hosted board. If the repo has `.harteburn/board.url`, republish the plugin's
   `templates/board/board.html` to that URL (read it first, then publish with `url`). If not, create
   it once, as the plugin's `docs/reference.md` "The board, first time" says.

   Start the objective as one record, `objectives/<id>` (ArtifactData `set`). Every key, state and
   beat is `KEYS` and its neighbours in the plugin's `scripts/board-schema.mjs`; the board names
   anything else at its top. What you write (the board writes the rest: `runs`, `pieces_at_slices`,
   each piece's `started_at`/`ended_at`, never typed):
   `{id, title, project, status:"open", opened_at, done_when:[{text,state,kind,evidence,proven}], roles,
   beats:[{key,timebox,state,started_at,ended_at}], items:[{beat,text,state,note,kind}],
   pieces:[{n,text,check,price,timebox,state,go,owner_call,note,kind,replans,design,mockup,screens}],
   scope:[{at,change,what,why,who,price}], yours:[], checkpoint:{on_objective,waiting,can_ship},
   session_model, budget_tokens, updated_at, log_count:0}`.
   - **The board refuses**: `board-md.mjs` names each problem and its reason at the board's top and
     on stderr, exits 1, and the reminder repeats it each prompt until the record is put right.
   - **`done_when` is the board**: the checklist of what defines Done, 15 lines or
     fewer, grouped by outcome, never by file. ⭐ **At most 8 outcome lines, what the persona sees;
     never a fixed bug**. A find and its fix live in `items`. Product's Frame numbers go into its
     lines. Each outcome line's `proven` says where it is proven and how (`production:`, `canary:` or
     `stub:`, with its read); its `read_by`, `earliest` and `waits_for` follow Product's charter ("who
     reads it, and when"). `kind`: `outcome` (default) or `gate` (shown last). Each line's state
     changes as the work moves; `/done` judges each one against production and writes its `evidence`.
   - **`items` is the open work** (`todo`, `doing`, `blocked`). Mark one `done` or `dropped` and
     the renderer moves it to the append-only log, `<git dir>/harteburn/log-<id>.jsonl` (one JSON
     object per line, never markdown), which `/retro` reads. The board shows only its count.

   Write `.harteburn/board.json` whole once, here. Afterwards **edit only the lines that changed**
   (and `updated_at`), never resend the record. A scope change
   after Frame is never a silent edit: add a `scope` entry (added / dropped / changed, what, why, who decided) **with its price**:
   what it costs the objective (delivery time, money, or what it holds back), from Product. A decision that changes a Done line edits that line
   and adds its priced scope entry. **The runs come from the dispatch ledger**: the hook tags each
   dispatch with this record's id and `board-md.mjs` adds it to `runs` once, so none is written by
   hand. When a background
   run's notification brings its tokens and minutes, add them to its row. Record the Tech Lead's own
   model.

   Stamp each beat's `started_at` / `ended_at` (the board computes the minutes from them). Show the
   same checklist in chat.
2. **Frame (Product).** Dispatch `harteburn:product` with only this:
   > Frame this objective (your charter's "At Frame" section): "<the owner's words>". Repo: <path>.
   > Read the repo's PRD standards and product docs if present. Return each item of your "At Frame"
   > section, in under 15 lines, and each decision that is the owner's, with an example per side.

   Ask the owner each decision, with its example.

   **Security, same message as Product**, when the objective touches the security domain (the convene
   table's row): dispatch `harteburn:security` with "Write this objective's abuse cases as Done lines
   (your charter's Frame duty): "<the owner's words>". Repo: <path>." Each abuse case joins `done_when`
   as an outcome line, the attacker's steps then what must stop them, its `proven` an attack test
   red on HEAD; Product owns its words.

   **Every ask, once, now**: add each step of the owner's the
   objective needs — a test account, an app registration, a provider dashboard setting, each with
   the provider's cited steps (or "unverified") — and every go it will need (another repo's edit,
   the release, Terraform, production data, a price) to `yours`, numbered, and ask the gos in one
   message at Frame. Check: nothing new asked of the owner after Ready.
3. **Ready (Tech Lead, Architect if there is new infrastructure — a provider capability a Done line
   depends on counts, not "no new infrastructure").** Write down, in the checklist:
   - **Production snapshot**: the full, unfiltered rows the change touches, read from production
     (read-only).
   - **Production outcome**: for each slice, what production shows now that the slice must change
     (the blocked list, the failing check, the count), read now. Done re-reads the same thing.
   - **Production numbers**: for anything performance-related, the time of each step at
     production's latency (database, network, the other service), measured, not assumed.
   - **Every provider setting a Done line depends on, read live**: list each third-party capability a Done line needs
     (form handling, an updater endpoint, an analytics account, a webhook, a DNS record) with one
     read-only production read of its setting, before Build, and each new account's one record read
     with its real sign-in (the canary's, or the test account's) before any slice depends on it. A
     setting that is off is a found row, its fix an owner act on Yours.
   - **A new provider** (the record's `providers`, set at Frame) widens Ready to 60 min: one real sign-in, list and write per Done-line resource, through the project's own local client, each reply's shape in `live_reads`, before Slices prices a piece (the board refuses Slices without them). The write goes only to a test or sandbox account the owner names, before the write, in a message of their own: `test account <provider>: <account>` (ask on Yours); never a customer's or production account.
   - **The load-bearing design**: the Architect names the one part that is (a new mechanism, a
     changed contract). Only that part goes through the full PRD panel; the rest goes to the owner
     with the Prover's derived tests.
   - **Each Done number, measured on its own case**: a time or cost line cites the run that measured
     exactly its case, or is marked an estimate (`measured`; the board refuses neither by Slices' end).
   - **Rules hold**: the Architect's charter, "At Ready" (15 min).
4. **Slices (Tech Lead, the Lead's pricing if bundled).** **Number the pieces** 1..N in `pieces`,
   quick win first, each with its production `check`, its `price` (build minutes: the Lead's "A
   price is the build") and its `timebox`. **The Prover's Mode 0** runs on the Done lines now: any line
   it returns as "cannot pass in this objective" is cut or reshaped with Product and the owner
   before Build. **A find while building** gets Product's triage, one of three answers: a fix inside
   the piece it blocks, a new numbered piece (the owner's go), or a row on a named objective's
   priced list; never an automatic deferral. Product's triage list (`docs/triage.md`) has a `regression of this diff?` column, the Prover's y or n: a y is fixed inside its piece and never goes on the list (the board refuses a y row on the list, and a y item dropped or blocked). A piece added after Slices carries `holds_back` ("<what> by ~N h") for the owner. Each slice rides the project's **release cadence** (the
   Lead's charter); with no `Release cadence:` line in its house rules, ask the owner once and add it.
   **Design**: mark each piece that changes anything a person sees `"design": "consult"` or `"full"`
   (the Designer's "Two depths"). A full pass: `harteburn:designer` makes mockups (30 min), the Tech
   Lead publishes them, and the owner's blend is approved before that piece's Build, as its `mockup`.
   Each visible screen a piece changes goes in its `screens` for the fidelity check at Done.
   **Give Build a timebox per slice** (the build beat's `timebox`, from the slices' sizes) and,
   past 2×, offer the owner a cut.
5. Report: the checklist, the Frame's numbers and the slices. Then start the first slice. **A started
   piece keeps its scope; each 2× of its price stops it**; a production fix is its own piece, `kind:
   "prod-fix"`; an item that waits on an owner act sets `owner_act`. The board names each format.
