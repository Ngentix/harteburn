# Changelog

## 0.24.2 — 2026-10-30

**A cloned repo can no longer send your license key, board or ledger anywhere, and the hosted service is harder to abuse (rc-security piece 10, jg 2026-10-30).** Fixes the security findings in the HarteBurn plugin and service merged in 0.24.0, and what four Security rounds found behind them.
- **Your key goes only to the address you typed at login.** `node scripts/login.mjs --key sy_… --url <address>` stores the address with the key; every later send goes there. `HARTEBURN_URL` is no longer read, so a repo's settings cannot redirect it. If you set `HARTEBURN_URL`, run `node scripts/login.mjs --url <address>` once; it keeps your saved key.
- **The license file always lives in `~/.claude/redcell`.** Its folder comes from your account, never from `HOME` or `REDCELL_HOME`, which a repo's settings can set. Change: `REDCELL_HOME` no longer moves the license or the rules cache (it still moves the steward's and the Change layers' files). Scripts take `--home <absolute folder>` for tests.
- **Nothing leaves a repo until you turn sync on.** Run `node scripts/login.mjs --sync-here` inside a repo to send its board and ledger; nothing committed in a repo can turn it on. **If you synced under 0.24.0, sync is now off: run `node scripts/login.mjs --sync-here` once in each repo you want synced.** A ledger row leaves with only `ts`, `event`, `role`, `board`, `tokens`, `minutes` and `model`, and each row once, after the first sync sends the existing ledger.
- **The service counts each visitor for its rate limit.** Behind Cloud Run (`TRUST_PROXY=1`, set by the deploy) the visitor is the last `X-Forwarded-For` hop; an IPv6 visitor counts by its /64. Stripe's signed webhooks are never limited.
- **The service caps what one license stores:** 200 boards, 100,000 ledger rows and 1,000 Changes (429 past that), checked and written in one locked step. It keeps only the 7 ledger fields whatever a client sends, refuses a row over 1 KB, and a board over 256 KB.
- **Stripe events and checkout:** a failed event is handled when Stripe retries it; with no webhook secret the webhook answers 503, and a server given a Stripe key but no webhook secret refuses to start. Every refused promotion code gets the same answer, every new code needs a redemption cap, and the copy of a new license key kept for the success page is deleted after an hour (the license itself stays active).
- **The pages are served as pages again** (they were sent as encoded data), with security headers and a content policy that allows only their own scripts and styles.
- **The deploy runs the service as its own account**, reading only the secrets it uses, and checks the Cloud SQL proxy download against its published checksum.
- `login.mjs` no longer hangs after checking a key, and `piece-pack.mjs`'s git calls run no repo hooks.
- **Enterprise adds a per-user price to its $500 account price** (team seats, Christian Hammer, merged here): checkout charges the account price once and the per-user price set in `STRIPE_PRICE_ENTERPRISE_SEAT` for each seat (1 to 500). **If you sell Enterprise today, it stops** (button hidden, checkout and new Enterprise codes refused) until you set `STRIPE_PRICE_ENTERPRISE_SEAT`. A code minted for Enterprise from this release covers both prices; a code minted before covers only the account price.
- **Every purchase now gives two keys** (Security's finding on the team-seats merge). The **seat key** is what every developer logs in with. The **owner key** stays with whoever runs the account: it replaces the seat key if that leaks (`POST /v1/license/rotate`; the hosted board and ledger stay, and everyone logs in again with the new key), replaces itself if the owner key leaks (the same call with body `{ "key": "owner" }`; the old owner key stops at once), and, on Team or Enterprise, changes org rules (`PUT /v1/org-rules`); the success page shows both commands. The seat key can no longer change org rules or open billing, and the plugin refuses to log in with the owner key. Billing and cancelling go through Stripe's own login link, which emails a one-time code to the billing address (`STRIPE_PORTAL_LOGIN_URL`; the service's portal route is gone). This changes the team-seats checkout merged above (#5): checkout now writes two license rows, and org rules and billing no longer take the seat key.
- **`scripts/publish.mjs --out <public checkout>` prepares the public release** from an allow-list of this repo's last commit (never its history or uncommitted files). Retros, specs, reviews, the service and tests are always left out. It writes nothing if any file holds a name on the private deny list, an artifact link, or a Stripe, GitHub, Anthropic, AWS, Slack or private key, or if the deny list is missing; each refusal names the file and line. It replaces the checkout's files, commits there, and never pushes: pushing is yours. `--check` shows what it would write.
- **Install from the public repo:** `claude plugin marketplace add Ngentix/harteburn`, no GitHub login (`docs/install.md`). It carries a release once it is published there; check `claude plugin list` shows 0.24.2 before relying on this release's fixes.
- Not covered: a folder you trust in Claude Code can run its own hooks and set proxy variables. Open folders you did not write with care (`docs/limitations.md`; piece 8 plans the answer).

## 0.24.1 — 2026-10-30

**The board's security check runs none of a repo's hooks, fsmonitor or filters, and sees what git hides (rc-security piece 9, jg 2026-10-28).** Fixes three findings an automated security review made on 0.23.2, and what five Security rounds found behind them.
- **No repo config runs code while the board reads it.** Every git command the board runs, in this repo, nested repos and committed checkouts, turns off fsmonitor and hooks, turns off every filter driver the repo's config names, and allows no transport, so a partial clone never fetches a missing file. A git older than 2.31, which ignores these overrides, makes the board refuse rather than pass. A git failure other than "no repo" or "no commit yet" refuses too; it no longer reads as nothing to check.
- **A stored value reaches git only as a checked commit id.** A piece's start and the record's opening commit must be full ids of real commits; anything else (a branch name, a short id, a value starting with `-`) refuses Done and names the stamp. Every revision git is given sits after `--end-of-options`.
- **Files git does not show count when the table matches them.** Ignored files the security table matches are hashed at each piece's start and end, like Claude Code's session files, except the board's own `.redcell/` and the top `node_modules/`. In nested repos and committed checkouts, table files count whether they are ignored or untracked. In a nested repo the top repo does not track, they count when tracked too. An edit inside a committed checkout the table reaches counts at its path. A checkout with no git of its own, or whose work tree is set elsewhere, refuses.
- Cost: the board needs git 2.31 or later. A file on the table that a filter driver handles (Git LFS) reads as changed and refuses. In a partial clone, a table file not yet downloaded reads as unreadable and refuses. More than 200 such files refuses (narrow the table).
- **The hosted rules bundle needs a license.** The service handed its rules bundle, a paid feature, to anyone who asked; it now checks the license like the routes beside it.

## 0.24.0 — 2026-10-29

**The two 2026-10-28 product retros retros land** (ch ratified each Change 1–3 on 2026-10-28; merged onto 0.23.2).
- **Runs are recorded where the hooks don't run.** The session-start hook appends a `session` row. `redcell-hook.mjs ledger-stop --manual <role> <purpose> <tokens> <ms> [--model <m>]` records a run by hand, and the board counts it. A record opened from 2026-10-29 is refused while its ledger shows neither a live session row nor a manual run. `/frame` checks for the session row and, without it, records each run and renders the board by hand.
- **The usage limit is planned for.** Record key `budget_tokens` (set at Frame; default 2,000,000); the board shows tokens used against it. A role prompt names the piece pack and the files to cite; a re-pass or spot check is dispatched with `model: "sonnet"`.
- **Each new screen is ruled before it is built.** At Ready, one line per new screen: its links and the credential each needs, its help topic, and what ends its session. Product's state table has a row for each negative outcome the walkthrough names, on every page that lists a read or a charge. Template `templates/scripts/link-crawl.mjs`.
- **The screen checklist is red before Build.** `prove-prompt.mjs --mode before` adds four rows (links, help, session, failure) for each screen the steps name, and refuses steps that name none unless `--no-screens "<why>"`.
- **One piece pack per beat.** `scripts/piece-pack.mjs` writes `<git dir>/redcell/pack-<a>-<b>.md` (the brief, the piece's steps, its Ready, a diff stat), refused over 120 KB. The walkthrough helpers live in `scripts/walkthrough.mjs`, copied beside `prove-prompt.mjs` on export.
- **Done evidence has one section per Done line.** `scripts/done-evidence.mjs init|check`; `/done` dispatches Product only after `check` passes.

## 0.23.2 — 2026-10-28

**The board refuses Done without a Security verdict (rc-security piece 3, jg 2026-10-28, D4).**
- **The table.** Each project lists its security-domain paths in its house rules (`## Security-domain paths`, `| code path | what crosses |`, globs as in the page map). HarteBurn's own table lists `hooks/**`, `scripts/**`, `templates/scripts/**`, `.claude-plugin/**`, `agents/**`, `skills/**`, `ethos.md`, `bookends.md` and `.github/**`. With no table, the board warns and holds nothing.
- **The refusal.** When a piece starts, the board stamps the commit it started from. A piece marked done whose diff changes a path on the table is refused until a `harteburn:security` verdict covers it: committed, uncommitted and untracked changes all count. The refusal names the paths and how to dispatch Security (`--base <the piece's start> --head <HEAD>`).
- **The verdict is never typed.** The ledger's stop row now carries `transcript`. The board joins the dispatch row and the stop row, and counts a verdict only when Claude Code's transcript and its `.meta.json` agree: agent `harteburn:security`, the same dispatch id, and a first message that hashes to the dispatch row's `prompt_sha256` and names the range. The word is read from the run's final reply (`finalReply`). A ledger row typed by hand does not count. The latest verdict counts. A table-path change after its `--head` reopens the refusal.
- **Does not hold** is refused, quoting the finding, until it is fixed and re-run, or the owner accepts it by sending `accept piece <n>: <the finding>` alone in one message (it answers only that piece; a line pasted inside a longer message or an IDE selection never counts); the prompt hook records it, and the board counts it only when the session transcript shows the owner typed it after the verdict, quoting the whole finding (whitespace and case aside), so accepting one finding of a two-finding verdict accepts neither. A field an agent can type never counts (jg 2026-10-28).
- The board keeps the verdict it saw in its stamps, so a transcript cleaned up later never reopens a passed piece. Pieces started before 0.23.2 are not held.
- Paths are read from git with `-z` and `--no-renames`, so a path with unusual characters, or a file moved off the table, is still held. A verdict stored in the board's stamps counts only while the ledger still has its Security run. A verdict counts only from the one canonical prompt, printed by `node scripts/board-security.mjs --prompt <start> HEAD`, so a real run told to judge part of the piece does not clear it (Security's own verdicts on this piece, 2026-10-28).
- A Security run counts only if, after its prompt, it holds nothing but tool results and Claude Code's own notices: a message sent mid-way voids it. A verdict's time is its transcript's own. A piece is held to the table it started under, too. A "does not hold" on unchanged code stands: re-running Security until one run says "holds" never clears it. A stored pass needs its transcript unless the board read the evidence after /done.
- Each piece's range splits the record's history: from where the previous piece ended (or where the board first saw the record) to where the next one starts, so no commit escapes and a later piece never refuses an earlier one.
- Files git does not show but Claude Code or git loads count too: untracked or ignored `.claude/**` (worktrees aside), `CLAUDE*.md` and `.mcp.json` anywhere in the repo, plus git's hooks, config (and what it includes) and info files, in nested repos and committed checkouts too; a symlink counts by its target, a symlinked folder by its files (links inside it followed), and a file git tracks counts only while it differs from HEAD. A tracked file git is told not to look at (`skip-worktree`, `assume-unchanged`) always counts as changed, on the table too; a tracked session file is compared with HEAD by its mode, its real path and its raw bytes, hashed by the board itself, so a clean filter, fsmonitor or a swapped folder cannot hide an edit; in a nested repo every tracked session file counts by content, since a commit there is shown by no diff the board reads. The latest piece counts changes against HEAD as well as the working tree, so a commit the working tree puts back is still held. A Security prompt's commits must be full ids: a short one is never a verdict. The board hashes them at each piece's start and end. A change needs a Security run whose prompt names the files and their hashes (`--prompt <start> HEAD <record> <piece>` prints it), and a later edit voids that run. More than 200 such files, one over 1 MB or unreadable, or nesting past 8 refuses. The ledger keeps each Security dispatch's `--base`, and a lost run is matched by it, so an amend, a reset or a file change made before the board renders never hides a run that said "does not hold". A store from before this gets an empty baseline, so each of its session files needs one verdict (Architect ruling on Security round 17; automated review of the first cut).
- A "does not hold" stays until the code really changes after it **and** a later "holds" is given the prompt that names it: while one stands, `--prompt <start> HEAD <record> <piece>` (the refusal prints it) lists each open refusal and asks Security whether each is fixed, and a run on the plain prompt no longer counts. So a commit to an unrelated file plus a fresh run never clears a refusal. A cleared refusal stays in the board's stamps, marked with the holds that cleared it; the board works the mark out again from Security's readable runs at every render, so a typed mark never counts, a revert to the refused code reopens it, and a prompt naming any refusal the board did not store is no verdict (automated review of 167f38c). A clearing "holds" must cover the current code, and a mark stands alone only under the board's validated close witness; while a refusal's run is readable, its stored fields are rebuilt from the run (automated review of f83ef99; Prover round 6). A change staged in git's index counts even when its working copy is put back (Architect ruling on Security round 20; Prover round 5).
- Shared globs: `scripts/globs.mjs`. `templates/scripts/brief-stamp.mjs` keeps its copy, and a test holds the two equal.

## 0.23.1 — 2026-10-28

**Abuse cases at Frame (rc-security piece 2, jg 2026-10-28).** When an objective touches the security domain, `/frame` dispatches the Security role in the same message as Product.
- The Security role returns the objective's abuse cases as Done lines, one per case: the attacker's steps first, then what stops them. Each joins `done_when` as an outcome line, proven by an attack test that is red on HEAD. Product owns the wording.
- In Mode 1, the Prover writes an attack test for each abuse case first. It runs the attacker's steps from outside and is red on HEAD because the defence is missing.
- Word budgets raised: the frame skill to 1,226 and the Prover's charter to 1,350 (jg 2026-10-28).

## 0.23.0 — 2026-10-28

**A Security role joins the team (rc-security piece 1, jg 2026-10-28).** "Design a security role in the HarteBurn team… what this is really targeting is the current massive attacks going on by agents against sites, applications, etc. - this is the proactive step to always take a defensive stance."
- `harteburn:security` (`agents/security.md`) is the security voice of whatever product the team builds. Its stance: every public surface is probed by an automated attacker within minutes of shipping, and a published vulnerability in a dependency is exploited within hours.
- Its duties: abuse cases as Done lines at Frame; a blind verdict on each security-domain diff before the gate; keeping current with published vulnerabilities and attacks; our own attacker agent, run only against targets the owner has authorized with a date. Where claude-security is installed it is a tool, never the judge. Only the owner accepts a risk. Verdict: **holds** / **does not hold**.
- It is convened by a new row in the convene table (login, permissions, customer data, a public endpoint, secrets, a dependency, outbound calls, an AI feature's inputs), and it appears in the always-loaded note, in bookends at piece start and piece end, in `docs/roles.md`, in every tool's export and in the plugin description.
- Each project adds a threat-model page (assets, attackers, entry points, trust boundaries, sinks), and the brief carries it under "tenancy and security" (`docs/adding-a-product.md`, `agents/brief-compiler.md`).
- Bookends' note cap rises from 4,700 to 4,850 characters for the new role (jg 2026-10-28). The full-mode cap stays at 3,700.
- `tests/export.test.mjs` now takes the role list from `ROLES` instead of keeping its own copy.
- Next pieces: abuse cases at Frame, the board refusing Done without a security verdict, the gate's endpoint and dependency checks, keeping current, the attacker agent, and a blind canary.

## 0.22.12 — 2026-10-28

**Each HarteBurn release is announced in #dev (rc-slack piece 2, jg 2026-10-28).** "in connector cloud we are using an already-built slack notification for when new releases occur in the #dev channel. I want that for harteburn as well."
- `.github/workflows/release-notes.yml`: a push to main that changes `plugin.json`'s version runs `scripts/release-notes.mjs --since <before>`, which posts each version the push released, oldest first: "HarteBurn 0.x.y released", that version's CHANGELOG section, and the update line for Hammer. A push with no version change posts nothing; a refused post never turns the run red.
- Owner decisions at Frame: a version bump is the release (no tags), the CHANGELOG is the notes, HarteBurn keeps its own script (from connector-cloud's), one post per version.
- Needs the repo secret `CI_SLACK_WEBHOOK` on Ngentix/redcell; until it is set, the run logs "SLACK_WEBHOOK is not set; nothing posted".
- `docs/reference.md` "Where releases are announced".

## 0.22.11 — 2026-10-28

**A fresh session shows HarteBurn is on, with its version (rc-slack piece 1, jg 2026-10-28).** "when HarteBurn is invoked in a fresh session, we should display that in the chat message along with the HarteBurn version."
- The session hook adds a `systemMessage`, "HarteBurn 0.22.11 on (full mode)", at startup and `/clear` (not on resume or compact), with the version read from `plugin.json`; an unreadable `plugin.json` gives "HarteBurn on", never a failed session.
- The ethos's first line names the version, and the first reply opens with "HarteBurn <version> on". Kept inside its 473-word budget: "(plugin `harteburn`)" and "(a new window + go)" are gone.
- `docs/reference.md` "What a fresh session shows".

## 0.22.10 — 2026-10-28

**The Prover leaves its warm worktree clean (jg 2026-10-28).** Provers stashed an earlier pass's leftovers four times on rc-disk and left a pass applied, because they were dispatched without the `/prove` brief that says to reset.
- `agents/prover.md` (loaded by every Prover run): "Discard an earlier pass's leftovers there, never `git stash` them; end each pass reset." Its word budget is raised to 1,325 for this one rule (dated, approved by jg).
- `/prove`'s brief, "Where you build": anything left in the worktree is an earlier pass's, discarded with its checkout and clean, never stashed; the pass ends the same way.
- Prover: proven, no survivors.

## 0.22.9 — 2026-10-28

**The steward's numbers are honest, and its ask is explained (rc-disk Done review).** Product's Done review found the stamp counting other writers' disk activity as removed, and a trim attempt recorded at 75–92 GB free.
- `removed_bytes` is only what the steward itself removed. What a repo's own script frees is `script_freed_approx`, recorded only when `trim_attempted`, which is true only when that script ran under the threshold (40 GB).
- The reminder names each kind in plain words, singular for one ("dir: 1 old scratch folder").
- `docs/reference.md` "The steward": what each sweep records, the four answers, the always line and "ask again".
- An empty `REDCELL_SWEEP_BELOW_GB` or `REDCELL_TRIM_CAP_GB` means the default, not 0.
- Prover: proven; three survivors pinned (the approximate figure above the threshold, free space exactly at it, the help's anchors).

## 0.22.8 — 2026-10-28

**The build-output trim, asked like everything else (rc-disk piece 5).** Under 40 GB free (`REDCELL_SWEEP_BELOW_GB`), a Rust repo with no `scripts/disk-sweep.sh` of its own is asked about **build: target**; a yes (or build on always) runs `cargo sweep --maxsize 20GB <top>` (`REDCELL_TRIM_CAP_GB`) from the repo top, which removes the oldest build pieces only. Never `cargo clean`, never an rm of `target/`, never inside a worktree (the warm Prover's among them), never in another repo the objective changed. With no cargo-sweep installed, the reminder says so once: `cargo install cargo-sweep`.
- Production dry run, forced threshold: a 26.4 GB `target/` proposed; real cargo-sweep 0.8.0 would free 4.69 GiB at the 20 GB cap; a repo with its own script gets no build ask.
- Every test file runs with `REDCELL_HOME` set to a temp folder: the owner's real answers reached older tests and removed their fixtures.
- Prover: proven; two survivors pinned.

## 0.22.7 — 2026-10-28

**The steward asks before it removes anything (rc-disk piece 6, jg 2026-10-28).** "Rather than doing it automatically, the steward should ASK, with the option to change it to 'always do it' on each ask."
- Each sweep groups what is past its objective by kind (scratch files, folders, worktrees) into `.git/redcell/steward-ask.json`, and the per-prompt reminder names each kind with its count, size and examples, and the four answers: yes, no, always here, always in every repo.
- `node scripts/steward.mjs <repo> --answer <kind> <yes|no|always-here|always-everywhere|ask-again>`: yes removes now; no keeps them and stays quiet until a new one appears; always here (`.git/redcell/steward-always.json`) or in every repo (`~/.claude/redcell/steward-always.json`) removes now and at every sweep; ask-again takes a kind off always wherever it was set (`--here-only` for this repo only, and it says when an every-repo always still applies).
- A sweep that removed anything under always says so in the reminder: what, how much, where the always was set, and "ask again: <kind>".
- Removal reads the proposals fresh at that moment: a stale ask or a hand-edited file never names what goes; a worktree goes through `git worktree remove` (which refuses unsaved work or a lock); links, kept names and the warm Prover worktree never go.

**Security: another repo's code never runs (second review).** For a repo the objective changed, the steward runs neither its `scripts/disk-sweep.sh` nor `git status` (a git filter driver would run); its worktrees are listed "other repo: not checked". Every git command the hooks run carries `core.fsmonitor=false` and `core.hooksPath=/dev/null`. Prover: 14 traps planted in a hostile repo, none fired.

Prover: piece 6 round 1 defect (ask-again left an every-repo always on; an always sweep ignored `--since`), fixed; round 2 proven; its guards pinned.

## 0.22.6 — 2026-10-28

**Security: a `cd` into a repo HarteBurn has never worked in runs none of its code (review of 0.22.5).** 0.22.5 swept every repo a session touched and ran its `scripts/disk-sweep.sh`, so a cloned repo's script, or its git config, could run.
- Only a touched repo with its own `.git/redcell` is swept; that repo is trusted as the session's own (written in `docs/reference.md`, "Trust").
- Every git command the steward runs, and the touch hook's repo lookup, carries `-c core.fsmonitor=false -c core.hooksPath=/dev/null`.
- Prover: proven; a git filter driver in a trusted repo still runs under `git status` (no flag stops it), so the trust boundary is the rule.

## 0.22.5 — 2026-10-28

**Other repos an objective changed are swept too (rc-disk piece 4, jg 2026-10-28).** Working in one repo and editing another left the other's leftovers behind.
- A new `touch` hook (PostToolUse on Edit, Write, NotebookEdit, Bash) adds one row per (repo, objective) to this repo's ledger when a call works in another repo: a file path, or a Bash command that starts with `cd <path>` or `git -C <path>` (relative and `~` paths resolved). A worktree counts as its repo; merely naming a path records nothing.
- After a Prover pass and before a gate, the steward also sweeps each repo the open objective touched, with that repo's own script, and `--since` the objective's start: nothing newer is proposed there, even in a repo with no open record of its own.
- The board never counts a touch row as a run.
- Prover: proven; finds fixed (relative `cd`, the touched repo's own script); the exists-check survivor is equivalent (a sweep in a missing folder cannot start), its behaviour pinned. A piece-3 test's margin was widened after one failure under parallel load.

## 0.22.4 — 2026-10-28

**Every repo is swept, and each sweep records its result (rc-disk piece 3).** Until now a repo with no `scripts/disk-sweep.sh` was skipped, and `steward.last` only said when the hook fired.
- After a Prover pass (in the background) and before a gate (waited for), `scripts/steward.mjs --stamp` runs in every repo, after the repo's own script when it has one.
- `steward.last` holds the latest sweep's result and `steward.jsonl` keeps every one: `free_gb` (decimal GB, as `df -H`), `proposed_bytes`, `proposed`, `listed`, `removed_bytes` (what the repo's own script freed, approximate), `repo_script`, `trim_attempted`. Nothing is removed by HarteBurn's sweep.
- `steward.jsonl` is on the keep list.
- Prover: defect (what a repo's script removed was never recorded) fixed and pinned; the throttle keeps the last result while the next sweep runs (pinned).

## 0.22.3 — 2026-10-28

**The steward proposes, and removes nothing (rc-disk piece 2).** `node scripts/steward.mjs <repo> --dry-run` lists what under `.git/redcell` is past its objective, with its size on disk, and what is only listed.
- Past: older than the oldest open record (this repo's and each worktree's); with none, untouched for 24 h. A folder is past only when its newest file is.
- A folder's proposal shows its file count and up to 3 names, so a folder holding uncommitted code is seen before anyone says yes.
- Only listed, never proposed: a link (never followed), a worktree with uncommitted work, unpushed commits or no upstream, and a worktree HarteBurn did not create. The kept names (0.22.2), the warm Prover worktree among them, never appear.
- Production dry run, 2026-10-28: 5 repos, under 0.1 s each.

## 0.22.2 — 2026-10-28

**Every file HarteBurn writes under `.git/redcell` has a retention rule (rc-disk piece 1).** The steward will propose removals from this list, and ask first.
- `scripts/retention.mjs`: `KEEP` (11 kept names, the warm Prover worktree among them, each with its reason) and `classify()`: any other file is scratch, any other worktree or directory is proposed once its objective is past, and a symbolic link is only ever listed.
- `docs/reference.md`: the files table gains a Retention column showing the same list.
- `docs/_house-rules.md`: HarteBurn's own `Personas:` (the owner and Hammer, each on their own machine) and `Release cadence: per slice` (jg 2026-10-28).
- The agnostic test checks the steward's new code from the start.

## 0.22.1 — 2026-10-28

**HarteBurn keeps no per-product builds (jg 2026-10-28).** `distro/` held connector-cloud's copy of HarteBurn for other tools, built from that repo's brief, so a commit in connector-cloud turned HarteBurn's gate red (it did, on 931f5937).
- Removed `distro/`, `scripts/distro.mjs` and its test. A product builds its own copy from its repo: `node ~/ngentix/redcell/scripts/export.mjs tools` (or `cursor`, `copilot`, `codex`, `gemini`, `agents-md`), or `project --out <folder>` for a claude.ai Project kit. Docs point there.
- The Designer's export checks now build each tool's files from a fixture repo instead of reading `distro/`. The RC-DESIGNER retro's Change 2 (`distro.mjs`'s usage) is dropped with the script.

## 0.22.0 — 2026-10-27

**HarteBurn names no project (jg 2026-10-27: project agnostic, non-negotiable).** Every file a run loads, and every template copied into a repo, was written in connector-cloud's words; on other projects Product was told to sort findings into "vendor" and "provider".
- **Personas come from the project:** Product names each finding's persona from the house rules' `Personas:` line (none: it asks the owner once and adds it); the Lead's owner questions name one too. `docs/adding-a-product.md` asks a new repo for the line. HarteBurn names no personas of its own.
- **Neutral words:** "a connector path" → "an outside service's path"; "an Engine contract" → "a shared contract"; "canary" defined as "a live run on a real test account"; example ticket ids, the connector-cloud help paths and "Partner readiness" removed; template fixtures and comments cleaned; `score-brief.mjs`'s no-brief control names the repo being scored.
- **`tests/agnostic.test.mjs` refuses** a project name, a ticket id (FEA-CC-426, OPS-469) or connector-cloud's terms in any loaded file or template, naming file:line. Loaded corpus 9,857 → 9,826 words.
- **Connector-cloud** still needs its own `Personas:` line (its repo; the owner's go).

## 0.21.2 — 2026-10-27

**HarteBurn carries only its own Changes (jg 2026-10-27: HarteBurn is project agnostic, non-negotiable).**
- `scripts/open-changes.mjs` lists the retro Changes still open: those whose status does not end `worked`, `dropped` or `moved to <repo>`; a never-ratified one prints PROPOSED. `/frame` step 0 and `/retro` step 6 run it instead of reading the retros by hand.
- A Change to one project's code, tests or setup is written in that project's repo and marked `moved to <repo>` (retro template, `/retro` step 6 and the tidy pass). Three connector-cloud Changes moved: 452 interim #3, KIT-001 #4, CI speed #1; 12 HarteBurn Changes stay open.

## 0.21.1 — 2026-10-28

**The rc-steward retro (lean; jg ratified Changes 1–3 the same day).** Retro: `retros/2026-10-28-retro-harteburn-steward.md`.
- **Change 1 — a beat past 2× its timebox stops for a replan**, as a piece does: the board refuses an open beat past 2× until it carries a dated `replans` entry (`{at, timebox, why}`); records opened from 2026-10-29.
- **Change 2 — `/prove after` refuses a brief missing what the Prover needs:** a guard log with no `escapes` (or "none, because …"); a new test fixture with no `fixture: production <read>` / `fixture: made up, because …` tag, each file its own; lines removed from a loaded file without `--removed <ledger>` (one row per removed sentence and where its rule still lives). The brief prints the worktree commands, escapes and fixture sources.
- **Change 3 — run tokens and minutes fill themselves:** the `SubagentStop` row carries its dispatch id (from the agent's `meta.json`) and counts tokens as the task notification does (within ~0.3%, not cumulative with cache); the dispatch row carries `agent_id`; the board fills each run's tokens and minutes, never over a typed value.

## 0.21.0 — 2026-10-28

**The Steward (rc-steward): the instructions shrink, and stop growing without a reason.** Owner decisions 2026-10-28: budgets at −25% now; the Steward is a mode of `/retro`, not a role; a tidy pass on a budget trip or every 3rd retro. Notes: `docs/superpowers/specs/2026-10-27-steward-role-notes.md`. Why: in 13 days `/frame` grew 426 → 2,238 words and the Prover's charter 557 → 2,080, and nobody owned subtraction.
- **Word budgets** (`budgets.json`, `scripts/budgets.mjs`, `tests/budgets.test.mjs`): every file a run loads (agents, skills, ethos, bookends) has a budget. Over budget is red until the file is trimmed or a raise is recorded with a real date, words, why and a named approver; a base above the committed one is red; the check never edits a file. It replaces the Designer's separate 800-word cap. `node scripts/budgets.mjs` prints the counts.
- **No origin stories in loaded files:** each rule's story moved to `docs/history.md` (49 tagged lines); a test refuses a new one.
- **`/retro`:** the Actions table carries up to 3 **Removes**; a Change that adds words names what it removes, or the dated raise; step 10, the **tidy pass**: a fresh agent proposes at most 15 cuts with their words saved and names the waste that repeats across retros; the owner ratifies in one sitting.
- **The first tidy pass** (`retros/2026-10-28-tidy.md`, all 15 ratified by jg in ~2 min): the loaded corpus 12,939 → 9,881 words (−23.6%); `/frame` 2,261 → 1,172, the Prover 2,077 → 1,312. The Prover's worktree commands and swarm rules now print in its brief (`prove-prompt.mjs`); the panel's finding format lives once, in `/prd-panel` and the export; the board's first-time setup moved to `docs/reference.md`. 34 earlier retro Changes closed (worked / dropped / moved), leaving 12 open.
- **The Designer has two verdicts:** the board refuses "ships with fixes" (`FIDELITY` anchored); the charter says a needed fix is **does not ship**.
- **The board (`board.md`):** each screen's verdict on its own line, design fields off the piece line, the mockup link clickable, "⚠ no fidelity yet" and **does not ship** in bold, one "Found:" label, "← here" once, "N of ? min", no dangling separator.
- **Fixed:** two test fixtures went red at 2026-10-28 00:00Z (they crossed `WAITS_RULES_FROM`); `distro`'s staleness test silently skipped in the Prover's worktree (a relative product repo now resolves from the main checkout).


- **A Done line's `earliest` is optional** (jg 2026-10-27). Set it only when the proof needs time after release (a day of runs, a nightly job), with `waits_for` saying what it waits for; records opened from 2026-10-28 refuse an `earliest` without it. A proof that exists at release has no date. Why: every line got a guessed future date, and RC-DESIGNER's five lines, all proven on release day, could not close.
- **RC-DESIGNER retro (lean) Changes:** the Prover's text tests assert each new sentence, red on HEAD; `distro.mjs --help` (or any unknown flag) writes nothing; no page states a count of roles, and lists of roles are built from `ROLES` (the Project kit row had left out the Designer).

## 0.20.0 — 2026-10-27

**The Designer joins the team (RC-DESIGNER; design jg approved 2026-10-27).** Design: `docs/superpowers/specs/2026-10-27-designer-role-design.md`. Why: a website overhaul met every requirement and used the design system, and still could not ship: it looked like every other AI-generated site.
- **`harteburn:designer`** (`agents/designer.md`): defends taste and usability on anything a person sees, admin screens included; champions the design system (each change the owner's dated decision). A **consult** (10 min) on a changed screen; a **full pass** (30 min, before that piece's Build) for a new screen, a new visible feature or a design-system change: one recommendation plus two alternatives as mockups, then the owner's blend. A fidelity check at Done. Verdict **ships** / **does not ship**.
- **The board** (records opened from 2026-10-28): a piece with `"design": "full"` is refused once started without the owner's dated `mockup`; a done record is refused while a piece's `screens` lack a `fidelity` verdict. New piece keys `design`, `mockup`, `screens`.
- **Charters:** the Prover is HarteBurn's QA, with the boundary (the Prover checks the step happened on the page; the Designer checks it looks like the approved design); Product owns information architecture; a Product–Designer split defaults to Product (about 70/30), reconciled by the Lead.
- **The note:** the ROLES line names the Designer; bookends mode runs it at piece start and piece end on visible pieces. Caps raised by the owner's dated go: full mode 3,500 → 3,700, bookends 4,500 → 4,700.
- **Skills:** `/frame` marks each visible piece consult or full; `/prd-panel` adds the Designer on visible PRDs; `/done` asks its fidelity verdicts; `/retro` asks "would the owner ship the visible work as it is?" and tallies Product–Designer disagreements.
- **Fixed:** the export's filter for the Claude-only ROLES text never matched (the ethos ends that span with ";"), so it leaked into every tool's copy; distro rebuilt.

## 0.19.0 — 2026-10-26

**The OPS-CC-469 retro (connector-cloud, lean; jg ratified Changes 1–2 the same day).** Retro: `retros/2026-10-26-retro-connector-cloud-ci-speed.md`.
- **Change 2 — a Done number is measured on its own case.** A Done line whose text carries a time or cost ("≤ 8 min", "≤ 85 billed", "$40") says, by the end of Slices, which run measured exactly that case (`"measured": "run: <id>, <the case>"`) or is marked `"measured": "estimate — reset after the first measured run (owner's go)"`; the board refuses neither (records opened from 2026-10-27) and shows "⚠ estimate" until the line is done. `/frame` Ready says so. OPS-CC-469's docker target moved 5 → 8 → 9 min, each value from a run that was not the case the line named.
- (Change 1, a fixed sleep in a test refused at push, is connector-cloud's own gate: `scripts/fixed-sleeps.mjs`.)
- 1 new test file (6 tests, the rule broken red); 162 tests.

## 0.18.0 — 2026-10-25

**The KIT-001 second retro (connector-cloud, full; jg ratified Changes 1–3 the same day, Change 2 without its branch-run rehearsal).** Retro: `retros/2026-10-25-retro-connector-cloud-kit-001-build-2.md`, five role files written blind.
- **Change 1 — a started piece keeps its scope; each 2× stops it.** The board stamps a piece's text when it starts and refuses a later change unless a dated `replans` entry carries the new text and price (a new go opens its own numbered piece). One dated `owner_call` "continue" carries a piece to 4× its timebox at most; past that, or past 2× a replan's price, only a new dated replan clears it (piece 12 ran 2,208 of 240 min on one "continue"). `kind: "prod-fix"`: a production fix is its own piece, its check read in production. An open record framed before the Done rules gets them on its next write: found/mistake rows move from Done to items, and it can't close with more than 8 outcome lines (dropped lines not counted, for every record).
- **Change 2 — an owner act reaches Yours.** An open item with `owner_act` is refused until a Yours line contains that text. New `scripts/ci-after-release.mjs <root> <released commit>`: reads the commit's CI runs (`gh`), adds each failed job as a found item with its `owner_act` and a Yours line with both sides, records the release in `<git dir>/redcell/ci-releases.jsonl`, and marks a job red at 2 releases in a row for Product's triage; exit 2 while a run is still going. `/done` confirms it; the release's post-deploy step runs it. (Part (c), a branch run before a workflow change reaches main: not ratified.)
- **Change 3 — a proof runs the tests the gate will run.** `prove-prompt.mjs --mode after` adds "Readers and callers": every test file that names a function or a 12+ character string the diff adds or removes in code, each with the gate's command (`cargo test -p <crate> --test <name>`, pytest, node --test); the Prover runs that list once, one process per binary, besides nextest. `--ruling <the Architect's design>` refuses a ruling with no `Stored values changed:` line, or a stored change with no `Readers:` line. Architect and Prover charters say so.
- Two stale test fixtures fixed (dated "now" since the 10-24 Done rules, they lacked `read_by`/`earliest`); distro rebuilt. 1 new test file (10 tests, each guard broken red); 155 tests.
## 0.17.0 — 2026-10-23

**The KIT-001 retro (connector-cloud, full; jg ratified Changes 1–3 and item 16 the same day, after "we are at a point with RedCell of diminishing returns without some of these revisions").** Retro: `retros/2026-10-23-retro-connector-cloud-kit-001-build.md`, five role files written blind.
- **Change 2 — one Prover pass, three verdicts, its cost measured.** The Prover's verdict is **proven**, **defect** (the only one that blocks) or **proven, gaps to pin** (the builder pins, a ≤ 5 min spot check, no re-pass): 7 KIT-001 re-passes found 0 code defects. `prove-prompt.mjs --mode after` refuses a first pass until `mutations.jsonl` names a code file in the diff (`--no-guards "<why>"`). On a connector path the targeted canary run comes first. A new `SubagentStop` hook (`ledger-stop`) appends each run's end with its minutes and tokens from its own transcript (KIT-001's 81 runs left none); the board never counts that row as a run. A piece marked done that never started on the board is refused (records from 2026-10-24), so every piece's minutes meet its price.
- **Change 3 — Done is ≤ 8 outcome lines, readable by a known date** (records opened from 2026-10-24): `found`/`mistake` rows are refused in Done; more than 8 outcome lines are refused; each line carries `read_by` (`claude` | `owner`) and `earliest`; an owner-read line must be on Yours; a record can't close before a line's earliest read time. `/frame` and Product's charter say so.
- **Change 1 (HarteBurn's half) — a production setup is rehearsed against production.** The Architect's charter: a local run is the build's test, never the setup's rehearsal; a ruling opens with its smallest complete cut and price. (Connector Cloud's half, `kit-setup.mjs --export` and a production dry run that refuses a missing customer or id, is built in that repo.)
- **The board tab no longer steals focus**: the IDE board opens once per objective (`boardOpenedBefore`), not at every session start.
- Kits-PRD retro Change 1 (trace a decision's ripple) **dropped** (never ran: 0 of 14 scope changes carried it). 3 new test files; 145 tests.

## 0.16.0 — 2026-10-23

**Bookends mode (jg decided 2026-10-23, after "days for what used to take hours").** The cost was the serial fix → rebuild → restart → rerun loop (about 6 cycles in one session), with a role called on many finds, not the board. A repo opts in with `.redcell/settings.json` `{"mode": "bookends"}`; anything else is the full loop.
- **Roles at a piece's two ends only.** Start: the Architect designs when a load-bearing path is touched; the Prover writes failing tests. End: one round, Prover + Architect on the piece's whole diff (`--base <piece start>`), logged finds included; Product triages them in one pass. In between: in-scope finds fixed and logged as one board line each; live loops batched (fix every failure a run shows, rebuild once, rerun only the failed checks). A blocking design find mid-piece convenes the Architect only for an Engine contract or a load-bearing path.
- The session hook adds `bookends.md` to the ethos and the per-prompt reminder drops the "name convened and excused roles" line for the bookends rules. The owner's decisions, the full gate before a merge and Done in production are unchanged.
- **`scripts/leg.mjs`** measures each leg: `start <root> <label>` at the owner's go, `note <root> intervention|escape <what>`, `end <root>` at deployed, `report <root>`. Wall-clock, the weekly usage % before and after (`~/.claude.json` `cachedUsageUtilization`), owner interventions during the leg, escapes after it. Rows in `<git dir>/redcell/legs.jsonl`.
- **Targeted live runs, the full suite once** (jg 2026-10-23, the same day: "why are we running the full suite when we could run targeted runs for fixes as we go, and then run the full suite at the end of the larger unit of work"). The builder ran a whole QuickBooks suite (~10 min before either changed flow ran) to prove a fix that touched two flows. Now a fix's live proof is a run of only the flows and checks it touches; the full suite runs once, at the piece's end or before the gate. In `bookends.md` and the reminder; tested.
- Housekeeping: the board test still expected the layout 642889e replaced; distro/ rebuilt (connector-cloud's brief had moved). 5 guard breaks, all red. 131 tests.

## 0.15.0 — 2026-10-21

**From connector-cloud's FEA-CC-452 full retro (jg ratified 2026-10-21, all three Changes and four smaller ones):** five team members wrote their own evaluations blind and all five found the same root cause: nobody checked, before Build, that each Done line could be completed and proven in production. Build ran 3 days 8 hours with no numbered list, through 8 releases; about 104 finds became work inside the objective; recipes fell from 6 to 1, the last two after the final release; two guards went 6 and 5 Prover rounds; the board reached 55 open rows and hid six updates in a key no view showed. The retro: `retros/2026-10-21-retro-connector-cloud-graphql-providers.md`, with each role's evaluation beside it.

- **Every Done line is completable and says where it is proven** (Change 1). Product's Frame lists each line's items, a write-end row for each item that moves data (every field the destination requires, and its source, cited) and where the line is proven (production, a local canary run, or a stub) with the production read that will show it. The Architect checks the table first on the PRD panel. The Prover's new Mode 0 at Slices returns any line that "cannot pass in this objective". The Lead checks a fallen target's siblings within the hour. The board refuses an outcome Done line with no `proven`.
- **Numbered pieces, frozen at Slices; the board refuses drift** (Change 2). `pieces` (1..N, each with its production check, a price in build minutes and a timebox) and `pieces_at_slices`; the board shows "piece n of N". A find gets one of Product's three answers: a fix inside the piece it blocks, a new piece with the owner's dated go, or a row on a named objective's priced list; never an automatic deferral. `board-md.mjs` now **exits 1** and lists each problem at the board's top and on stderr, and the reminder hook repeats it every prompt, for: any unknown key, state or beat; more than 12 open rows; and, for a record opened from 2026-10-22, the Done-line and piece rules above, a piece added after Slices without a dated `go`, and an open piece past 2× its timebox without a dated `owner_call`. A price is the real build, never a sum of role estimates.
- **A second dispel ends the loop** (Change 3). The Prover sweeps every guard in one pass and lists every survivor, naming the class when two share a cause; a find outside its steps never makes a step dispelled. The Architect gives each finding its class (and the command that lists every member), the smallest complete fix and the structural guard, each sized; never a hand-listed denylist where a compiler or permission boundary exists. The builder lists a guard's escapes before the Prover. `prove-prompt.mjs`: every brief says its `Round:`; `--repass <brief> --verdict <file>` carries the earlier verdict and diffs only from the commit it tested; round 3 is refused (exit 3) without `--lead-ruling <file>`, which the Lead writes in ≤ 5 min.
- **Smaller, ratified the same day:** stand-ins answer only what the call asked (Prover; a generous stub hid "selected only `id`" twice, once in production); Product's first words review is a state table, at most 2 passes per slice, and a help verdict quotes the served bundle (production served no help from 2026-08-17 to 2026-10-21); the Architect's rules-hold check at Ready (15 min); the runs come from the dispatch ledger: the hook tags each dispatch with the open record's id and `board-md.mjs` adds it once (by its identity, `ledgerId`), for records opened from 2026-10-22 (43% of FEA-CC-452's dispatches never reached its record).
- **`/retro`**: a full retro starts from each role's own evaluation, written blind (jg 2026-10-21); a Change is ratified with its story: problem, cause, change, how we'll know.
- The board page shows the pieces and each line's proven-where, so the two views stay equal. The ethos's loop lines say it in brief.
- 43 of the builder's own guard breaks, each seen red (one survivor, an unknown key on a piece, now tested).
- **The Prover's first pass (a three-member swarm) dispelled steps 3–7; every find fixed in one round:** runs from parallel dispatches share a millisecond, so time alone lost 28 of connector-cloud's 478 ledger rows: each row now has its own id (the dispatch's tool-use id), older rows are told apart by time, session, role and prompt together, and a production-ledger fixture replays 478 in, 478 out. A session in a worktree tagged its runs to the main checkout's record (the hook read the project folder first): the ledger and reminder read the session's own tree. The board trusted typed numbers: it now stamps a piece's start and end and freezes N itself, refusing a typed change. "piece n of N" counts dropped pieces. An older record is never refused for having no Done checklist. `proven` must read "production: <the read>" (or canary, stub). An unreadable record is refused on the board too. A re-pass refuses `--base` and a brief already re-passed. Four restatements of changed rules (the ethos, a doc, a skill, a refusal message) were brought in line, and `tests/ratified-words.test.mjs` now holds each ratified rule's wording in every file that restates it and refuses the wording it replaced. 22 more guard breaks, all red. 105 tests.
- **The Prover's second pass dispelled all three members again; the Lead ruled (≤ 5 min was the charter's limit, ~20 min used because a production read reversed a fix), no scope change, no owner question** (`.git/redcell/ruling-1792639200.md`): the board keeps **its own stamps** (`<git dir>/redcell/stamps-<id>.json`, written only by `board-md.mjs`): N as the piece count when Slices first reads done, each piece's first start and its finish, and the record's first-seen opened date; it rewrites the record's copies from them and refuses a typed N or date that differs (a typed 99 had been frozen as N). A malformed opened date is held to the rules; a record with keys but no `title` is refused; the reminder reads only the refusal header line. **A session's own tree**: Claude Code resets a session's shell to the project root when a `cd` leaves the project, so the hook keeps the worktree a session worked in (with an open record) per session, and an `ExitWorktree` hook clears it (**`hooks.json` changed: restart open sessions**); replayed on session 8e20d940's real sequence. Two cuts by the Lead's ruling, priced 0: every after-mode brief is a row in `rounds.jsonl` (a fresh restart shows there, not refused), and the walkthrough's promise that a test holds every restatement was the builder's own over-promise, dropped: /frame and `docs/roles.md` now cite the code and charters instead of restating them. 31 more guard breaks, all red. 114 tests.
- **Round 3 dispelled all three members once more; the Lead ruled on what the board defends against: the Tech Lead's lapses** (`.git/redcell/ruling-1792640700.md`). A lapse is an ordinary, good-faith edit that silently switches a rule off; a deliberate edit is shown, not stopped (no file can stop one). So: a frozen piece removed or renumbered is refused ("mark it dropped"); one open record per tree (a pointer in the tree's own git dir), so a changed id is refused until the open one is closed; a typed opened date or N is named once and put back from the board's stamps, so no reader sees it (a typed newer date had imported runs into an older record for good); an exempt older record says so on the board; a table-driven test covers every piece state × typed stamps × record age over two renders, and the ExitWorktree wiring and a closed kept tree are tested. /frame's template lists only what the Tech Lead writes, and /frame, `docs/roles.md` and `docs/reference.md` cite the code and charters. Owner question B1 (guard against deliberate edits too, ~2 h more) put to jg. 19 more guard breaks, all red. 120 tests.
- **Round 4 (the last, bounded):** steps 5–6 proven; steps 1–4 and 7 dispelled on small finds, each fixed the same hour: a refused render (a changed id) wrote board.json, the log and a stamp store under the refused id, so its finished item was lost when the id was put back; the open-record check now runs first and a refused render writes only board.md. `docs/reference.md` cites the code instead of listing it (the ledger line, the git-dir files, the hooks, the ethos limit). The pointer is per worktree, and any status but open clears it (tested). 4 more guard breaks, all red. 122 tests. The Lead closed the proof (`.git/redcell/ruling-closeout.md`): f8cab66's fixes accepted, no round 5. From it: a run with no `id` on a record held to the rules is refused (a typed run sat beside the ledger's copy and counted twice; 0.14.0's /frame had told the Tech Lead to type runs), proven in its own single pass; the added-piece refusal says an added piece takes the next number. 124 tests.
- **After updating:** `claude plugin update harteburn@ngentix`, then `/reload-plugins` in open sessions (or a new window) for the charters, skills and ethos; the scripts and the hook script take effect at once. Republish an objective's board page from `templates/board/board.html` to show the pieces.

## 0.14.0 — 2026-10-21

**From connector-cloud's FEA-CC-452 interim retro (jg ratified 2026-10-21):** that objective ran ≈ 58 h over 18 sessions and 3 releases; a live run found 18 defects the tests had missed; the owner was waited on 14% of audited time; the Build beat had no timebox. The owner's aim: make the next objective as fast as possible.

- **`/frame` asks for everything once, at Frame** (Change 1): every owner step (test accounts, app registrations, dashboard settings, each with the provider's cited steps) and every go the objective will need (another repo's edit, the release, Terraform, production data) goes to `yours`, numbered, asked in one message. Ready proves each new account with one live read, and the Architect names the one load-bearing design: only that part takes the full PRD panel. Build gets a timebox per slice, with a cut offered past 2×. Frame through an approved PRD ≤ 30 min when the design reuses existing mechanisms.
- **The Prover, when a project releases once per objective** (Change 2): narrow tests on the touched path, the gate-only checks whose inputs a slice touches, a local canary run of the connector against its real test account named in the verdict, and one pass on the batch diff before the one gate.

## 0.13.0 — 2026-10-19

- **⛔ The brief test never touches the repository a git hook names (incident, 2026-10-19).** A pre-push run from a worktree runs `brief.test.mjs` with `GIT_DIR` set; every child git inherited it, so the test's throwaway repos were the product's own. On connector-cloud it set `core.bare = true` in the shared config (the main tree and every worktree broke, for every session), made fixture commits on the pushed branch, moved `origin/main` and created a branch. Nothing reached GitHub. Now the test deletes every `GIT_*` variable before anything runs, and proves it: it re-runs itself with `GIT_DIR` naming a decoy repository and asserts the decoy's refs, HEAD and config are unchanged (red without the guard). **Products that copied the template must copy `__tests__/brief.test.mjs` again before their next push from a worktree.**
- **The brief may be up to 29,000 characters, sent in up to three parts (was 19,400 in two; jg, 2026-10-19: "raise the brief. we will visit it later to see if we can consolidate, but not now").** connector-cloud's brief stood at 19,400 of 19,400 with nine pages changed and waiting; 19,400 was already 26 characters over two parts' room (2 × 9,686), and only the per-part check held it.
  - **The split** (`briefParts`, the hook's and the template's copies, still compared by test) takes the fewest parts the length needs, ⌈length ÷ 9,686⌉: hard cuts waste nothing, so that count is always reachable. Within it, each part ends at its last `## ` heading that still lets the rest fit the parts left and leaves the part at least half full, else at its last such line break, likewise (one rule per line, so no rule is split), else where it is full. A brief within the limit therefore always fits three parts, wherever its headings fall, and no part but the last is under half full. The first cut ended parts only at headings: the Prover replayed connector-cloud's real brief and found part 1 left with 477 characters and four parts needed once each rules section grew by 300. The Prover's re-pass then found the fewest-parts rule alone still ended part 1 at that 477-character heading wherever the budget had slack (19,450–20,900 characters), costing a session that asks for two parts about 9,300 characters; hence the half-full condition. A test now replays that brief (`tests/fixtures/cc-brief-2026-10-19.md`) at 20,000, 27,000 and 29,000, and sweeps it from 19,400 to the limit three ways, every 25 characters.
  - **The gate**: the length is the one check; the per-part check is gone, because the limit is pinned by test to three parts' room (whole thousands: 29,000), and within it the split always fits. The compiler's limit, its `wc -m` check and `docs/reference.md` are held to `MAX_BRIEF_CHARS` by test (in 0.12.0 the compiler aimed at 18,000 while the gate said 19,400).
  - **The hook**: `hooks/hooks.json` sends three parts to sessions and to agents, each entry naming its part and the count (`brief-session 2 of 3`); a test checks each event's entries. ⚠ A running session reads `hooks.json` once, at its start, but runs the hook script as it is now. The first cut sent bare numbers, so a session started before it asked for parts 1 and 2 of what was now a three-part split, and lost the third silently in every agent it started (the Prover saw it live: "## Words" never arrived). Now a bare number means an old two-entry session, and its part 2 carries the rest, cut loudly at the cap if it must be. A brief over the limit that reaches the hook anyway is treated the same way in its last part. A part number of 0, or not a number, sends nothing (it sent "undefined").
  - Every guard was broken once and seen red: 13 in the first cut, 15 after the Prover's pass (one survivor, the hook's one-part boundary, now in the agreement test's samples). Changed in the compiler (`agents/brief-compiler.md`), the template `brief-stamp.mjs` and its test, the docs and `distro/`.
  - **After updating:** products that copied the template should copy `brief-stamp.mjs` and `__tests__/brief.test.mjs` again. Run `claude plugin update harteburn@ngentix`, then **restart open sessions** (or `/reload-plugins`): until then a session asks for two parts, and its second carries the rest, cut at 10,000.

## 0.12.0 — 2026-10-19

**The board is the Done checklist; the work log leaves it** (jg 2026-10-19: "open items on top; the frame should be the checklist of items that define Done, not a log of work done; keep the log for retros, in a better form than markdown"; Product and the Architect convened blind, both picked this; jg chose it). On connector-cloud's FEA-CC-452 board the first open row for the work left was at line 168 of 216. 129 of 142 items were done, S4 and S5 had no rows, and the record was 50 KB, resent whole on every update.

- **`done_when`**: the checklist that defines Done, 15 lines or fewer, by outcome, each line `{text, state, kind, evidence}`. It leads both views, open lines first (in progress, blocked, to do), then done, with gates last. Its `kind` marks a `found` row (a discovery the spec never listed) or a `mistake` row (a defect our own change made). `/done` sets each line from Product's verdict, with its evidence. An old record with no checklist still shows its `frame`.
- **The work log**: `board-md.mjs` moves every `done` or `dropped` item from `board.json` into `<git dir>/redcell/log-<id>.jsonl`, append-only, one JSON object per line, never markdown, each item once by its id. An id is random, given once and written to the record before anything is logged, so a crash between the log and the record logs nothing twice, and two items with the same text stay two (a hashed id lost the second: the Prover, 2026-10-19). A log row keeps every key its item had. Items finished before the log carry `ts: null, migrated: true`. The board shows a count; `/retro` reads the log (section 7 gets the `found` and `mistake` rows). connector-cloud's record went from 50 KB to 15 KB, 137 items in the log.
- **One schema**: `scripts/board-schema.mjs` names every key, state, beat and kind. The record had drifted from both views, with each unknown value falling back to a default in silence: the checkpoint's `waits_on`/`ship_now` were never shown, the `open`/`here` states lost their marks, five `prd` items never rendered, and the page showed 0 minutes for every beat. Earlier spellings are now rewritten in place. Anything else is named at the board's top and kept, never dropped. The page keeps a copy of the schema, held equal by a test that runs the page itself against a record in a sandbox.
- The runs table folds to one line on `board.md` and a folded panel on the page; the record keeps every run for the retro. `prd` is a beat (its row shows only when the record has it).
- 66 guards, each broken once and seen red. The builder's first 17 left one survivor (the "each item once" check; a test now replays a crash between the log and the record). The Prover's two-member pass dispelled the first cut: same-text items lost, unknown keys dropped from log rows, 13 guards with no test, and the hook's words, the kept frame and an old page on a new record untested. Its probes are kept as `tests/board-migration.test.mjs`, on connector-cloud's real record of 2026-10-19 (`tests/fixtures/prod-board-2026-10-19.json`, 144 items), and an old page is tested against a settled record (`tests/fixtures/board-0.11.0.html`). The roles line follows the checklist, and roles read as a list. `/done`'s Product reads one verdict per Done line. A second pass found more, all fixed: a record from before 0.12.0 gets its `id` from its title, saved before anything is logged, so its log keeps one name; a copied line reusing a logged id gets a new one, saved before it is logged; `/frame` republishes an existing page from the template; every "unknown" warning has a test (`tests/board-drift.test.mjs`), and so do the skills' and template's words; the ethos limit is measured at an installed plugin's path length. A third pass proved steps 1–4; its fixes: an unknown Done-line state sorts last in both views; an item reopened and finished again is logged again (any key differing from its logged row renews its id); a found item reads its beat first; `/frame`'s record is born with `log_count: 0`; the runs fold into a closed panel, tested; the found/mistake wording of /retro and the template, tested.
- **A published board page keeps its old code**: republish it from `templates/board/board.html` to the same URL. Until then it shows the frame and the open items.

Also in 0.12.0 (committed before it, listed as unreleased until 0.13.0):

- **The scripts run when started through a symlinked path (macOS too).** The Windows fix below compared `fileURLToPath(import.meta.url)`, which Node reports as the module's real path, with `resolve(argv[1])`, the path as typed. On macOS the temp folder is `/var/…` → `/private/var/…`, so `tests/main-guard.test.mjs` failed on main: `brief-stamp.mjs --check` printed nothing and exited 0, the very failure the fix was for. Any symlinked checkout did the same. All five guards (`hooks/redcell-hook.mjs`, `scripts/board-md.mjs`, `scripts/distro.mjs`, `scripts/export.mjs`, `templates/scripts/brief-stamp.mjs`) now compare `realpathSync` of both sides. Found raising the brief limit (jg, 2026-10-18).
- **The brief may be up to 19,400 characters (was 18,000; jg, 2026-10-18).** Two hook parts of 10,000 less their heads; the hook already sends each part fitted under Claude Code's cap. connector-cloud's brief had reached 18,471 against its own check of 19,400 (raised 2026-10-14) while the compiler still aimed at 18,000. Changed in the compiler (`agents/brief-compiler.md`: limit, check, and "aim under 18,000"), the template `brief-stamp.mjs` (`MAX_BRIEF_CHARS`) and its test, and the docs. Products that copied the template should copy `brief-stamp.mjs` again.
- **The brief and board scripts run on Windows (#1).** `templates/scripts/brief-stamp.mjs` and `scripts/board-md.mjs` decided "am I the script being run?" by comparing a hand-built `file://${argv[1]}` (or argv's last `/`-segment) with `import.meta.url`. On Windows, argv has backslashes and a drive letter, so neither matched: the scripts printed nothing, wrote nothing and exited 0, so a stale brief looked current. Both now compare `fileURLToPath(import.meta.url)` with `resolve(argv[1])`, as the hook, distro and export scripts already did. `tests/main-guard.test.mjs` spawns each script by its path and checks it did its job, and fails on any `.mjs` that brings the string form back. Found onboarding Hartev2 (ratified by Christian, 2026-10-18). Products that copied the template should copy it again.

## 0.11.0 — 2026-10-18

Ratified 2026-10-18 by jg, retro 2026-10-18-retro-connector-cloud-canary-runs-release (Changes 1–3). Five Prover passes took 20.1, 6.4, 17.6, 12.7 and 8.6 minutes (mean 13.1): each made a fresh `git archive` copy with its own build folder, so each built the whole Rust workspace cold (minutes, ~20 GB of disk); twice it had none of the builder's mutation results and ran them again; the Architect usually ran after the Prover, not beside it; the disk fell to 0.6 GB free. So:

- **A Prover pass in 8 minutes or less (Change 1).** The Prover keeps one warm worktree, `<git dir>/redcell/prover-wt`: made once (`git worktree add --detach`), moved each pass (`checkout --detach --force <sha>`, `clean -fd` without `-x`, so its `target/` stays warm), every mutation built there and undone with `checkout -- .`. Never in the main working tree (other sessions share it), never `cargo clean`. Its verdict's first line carries the minutes used.
- **The builder's mutations reach the Prover.** `prove-prompt.mjs` puts `<git dir>/redcell/mutations.jsonl` (one `{guard, file, break, test, result}` per line) in the after-mode brief under "The builder's own mutations", or "none recorded"; a row whose file is not in the diff is marked. The Prover re-runs a listed break only when its result looks wrong and spends its time on guards the log does not cover. The brief also names the commit under test and warns when the tree holds more than it. `/prove` moves the log aside after a proven verdict.
- **A reading swarm.** `--steps <a-b>` keeps only those walkthrough steps (setup, parts and limits stay; left-out steps are named), `--role builds|reads` marks the member, `--list-steps` counts the steps. `/prove`: with 4+ steps, 2–3 Provers in one message, exactly one `--role builds` (only it runs tests and mutations); proven only if every member says proven. Without the flags the brief is as before.
- **The Architect beside the Prover.** When the diff touches a load-bearing path the brief names, `/prove` dispatches `harteburn:architect` on the same diff in the same message, never after. Each Prover's minutes go on the board's runs.
- **Production's shape before a release (Change 3, HarteBurn's half).** In "before" mode, when the PRD or diff touches how runs or records are stored, merged, counted or compared, at least one test replays a real production record set (fetched read-only, committed as `prod-<what>-<date>.json`) and asserts that counts and identities survive. On 2026-10-18 every test used one check per name; production files 14 per name; v0.53.0 kept 1 of 14 and cost a second release (~2.5 h). "Prod-snapshot fixtures" was already a 2026-10-15 retro rule and did not hold, because nothing triggered it; this trigger is the mechanism.
- **The disk steward hook (Change 2, HarteBurn's half).** `steward` runs the repo's `scripts/disk-sweep.sh --steward` if it is executable: after a `harteburn:prover` run (PostToolUse on Agent, and SubagentStop, since a background Prover's PostToolUse fires at its launch), in the background, at most one start a minute; and before a Bash command containing `verify.sh`, waited for up to 120 s. It never blocks, denies or fails a tool call: nothing on stdout, always exit 0, failures to stderr. About 50 ms on every other Bash call. The repo's side (connector-cloud's `disk-sweep.sh --steward`) is built there.
- 26 new guards (16 in the brief builder, 10 in the steward) and 4 wiring checks, each broken once and seen red. One stayed green at first: the quiet minute hid a run by another role; that test now turns the quiet time off.

## 0.10.1 — 2026-10-17

- **A push is judged by what it pushes.** 0.10.0 ran the brief test on every push, and the test read the working tree, so in a shared tree one session's half-finished architecture edit blocked every push another session made (jg: "yes do it"). Given the pushed range, `brief.test.mjs` now checks, at each pushed tip: the brief (`repoBrief`, `briefAt`), and the page map and whether its pages exist (`tipView`), range by range. `brief-stamp.mjs --check <a>..<b>` does the same by hand and names the commit. The full gate, with no range, still checks the working tree. A tip git cannot read fails.
- **The env glue is tested end to end**: the test file and the CLI are spawned in a throwaway repo with and without a pushed range (the child's `NODE_TEST_CONTEXT` is removed, or node:test silently skips nested files). The Prover's third pass dispelled the first cut (the map still read from the tree; four pieces of glue removable with every test green); each finding is now a guard. Ten new guards, each mutated and seen red; the fourth pass proved it. Also from that pass: a push of two branches is judged range by range (tested), and the tests remove every throwaway repo they make (about 22 a run had been left behind).
- Connector Cloud's table check reads the pushed tip the same way, including its own list and pin from the pushed copy of the test file, so a half-finished rename in the tree cannot block a push; its pre-push gate now gets the range.

## 0.10.0 — 2026-10-17

Documentation, ratified by jg 2026-10-17 ("ratify all 5"). The question was a tech-writer agent or a devops agent; Product and the Architect, blind to each other, both said neither. Surfaces with something forcing an update stayed current (architecture pages under the brief gate); surfaces without one drifted (Connector Cloud: 59 migration commits since 10-01 touched the data-model page twice; 63 of 114 tables named on no page; troubleshooting untouched since 09-28 through three production incidents; six doc lines still giving the old database tier). A writer would need the same trigger a gate needs, so the trigger is what was built:

- **Pages follow the code.** `brief-stamp.mjs --pages`, run by `brief.test.mjs`: a repo's page map (`docs/architecture/README.md`, "When you change code, update the page") pairs code globs with pages; a push changing mapped code with none of its pages fails. A commit saying `Pages-unchanged: <why>` excuses the files that commit changed, never the rest of the push, and never uncommitted work. Pre-push passes the pushed range (`REDCELL_PAGES_RANGE`) and runs it on every push, with the spec reporter so a failure's lines land in the hook's tail; a range git cannot read fails ("git fetch, then push"), never skips. The full gate checks the branch since `origin/main`, uncommitted work included. Sixteen guards, each mutated and seen red; the Prover's first pass dispelled the build (hidden failure lines, a fail-open, one escape silencing a whole push) and each finding became a guard.
- **The Architect's pages include the runbook.** For a deploy, release or infrastructure path, the release runbook and the deployment page are pages; a one-time runbook step the release used up is removed; a load-bearing path missing from the map gets a row.
- **Product owns the help.** On a change to a screen a vendor or their customer sees, Product names that screen's help topics and reads them; a false or missing sentence is **does not deliver** until the help changes in the same change. `/done`'s evidence quotes the help as production serves it; a false sentence there is a not-done line.
- **Incidents land in the repo.** `/retro` files each production incident as a troubleshooting entry (symptom → proven cause → fix), at the path a `Troubleshooting:` house-rule line names. `/handoff` puts ops facts in the runbook, not memory alone: roles and other developers never read memory.
- **No devops or writer role** (both roles' verdict). Revisit a writer if two Done reviews in a row find stale help; devops when the first vendor's flows run in production, or two incidents in 30 days come from deploy config that passed review. Measured at the ~10-31 re-measure.
- Connector Cloud also gained a table check: every table a migration creates named on 08, in backticks. The 61 missing when it landed are listed, and the test holds the list to shrinking: a newer table can't join it, a listed table now named must leave it, and its size is pinned. A static test there also holds the hook wiring (the brief test on every push, with the pushed range and the spec reporter), since the Prover showed a docs-only condition put back would pass every other test. That one is repo-specific, so it lives there.

## 0.9.1 — 2026-10-17

- **The PRD panel runs on Fable** (jg: adversarial PRD reviews are Fable's job). `/prd-panel` asks for `model: "fable"` on each of its four dispatches; the roles keep `model: opus` for their everyday work (diff reviews, Frame, Done, proof passes). If Fable is refused, the panel runs on the roles' own model and the report says so. The reconciliation's cost table records each agent's model.
- **The brief compiler runs at `effort: medium`** — a mechanical job, 6% of a day's usage on 10-17.

## 0.9.0 — 2026-10-17

From reading all four Connector Cloud retros (jg: "find what would have made progressive improvements"). Changes that became a mechanism held; changes left as prose or "open" came back (Ready's outcome snapshot, priced scope, unchecked UI steps, the builder's own mutations — each recurred). So:

- **Retros ratify, then build** (jg: "there should be a ratification step where we decide what to implement, and if ratified, we implement right away"). `/retro` shows each Change as what · where it lives · the exact edit; the owner says yes / no / modify; every yes is built in the same session as a mechanism (skill, charter, hook, rule, board field), committed, and marked done; work needing its own build heads the handoff. Never a ratified Change as prose only.
- **Open Changes carry forward from every retro**, not only the last: `/frame` puts each not-yet-`worked` or `dropped` Change on the checklist; retros answer them all (the 10-16 Changes fell off after one retro and recurred twice).
- **Measured, not estimated:** beats carry `started_at`/`ended_at` and the board computes their minutes; the ledger records a run's tokens and minutes when its result carries them.
- **Scope changes carry a price** (board field; the board flags an unpriced one).
- **Ready snapshots the production outcome** each slice must change, and a defect's cause is proven from production (history + record attribution) before any role is convened on a fix.
- **The builder mutates its own guards** before calling the Prover; the Prover says so when the results are missing.
- **Roles state the stage they assume** (Product, Lead) — two owner overrides on 10-17 were stage, not substance.
- **HarteBurn lite** (jg, 10-17): the loop's Frame/Ready/Slices are for objectives (a fix skips them); lean retro by default; the board updates at beat changes. Ethos: steps in another company's UI cite a source or say "unverified"; read memory/docs before a status answer. The ethos is shorter (3,076 → ~2,900 characters) with more rules.

## 0.8.0 — 2026-10-16

- **Release cadence, per project** (jg: "it should be an option that HarteBurn implements or offers
  for all projects"): a `Release cadence:` line in the house rules picks **train** (the default:
  fixes and quick wins at once, nothing proven waits more than 3 h, each train takes everything
  proven), **per slice**, or **bundle** (every hold priced). `/frame` asks once if it is missing.
  The ethos, the Lead's and Product's charters and `docs/reference.md` follow it. From the
  Connector Cloud retro of 2026-10-16: a proven fix waited ~9 h to save one ~$0.30 release.
- **Prior art at Frame** (jg: "making sure that prior art is taken into consideration during the
  framing"): Product's Frame now opens with what already exists (our shipped features, earlier
  PRDs, dated decisions, retros) and how others solve it, each with a path or link and reuse /
  extend / why not. "None found" names what was searched.

## 0.7.3 — 2026-10-16

- **ArtifactData always proceeds** (jg: "Set the Claude rules to ALWAYS proceed with ArtifactData"): a
  `PreToolUse` hook allows it, so updating the live board at every beat never stops for an approval.
  A bare `ArtifactData` allow rule did not stop the prompt.

## 0.7.2 — 2026-10-15

- A handoff now goes to a **new conversation window**, never `/clear` (jg: "I do NOT want to use
  clear. I want to open a new window, so that I can see the old one if I need it"). The handoff
  loads once into whichever session starts next, as before; the old window stays readable and does
  no more work.

## 0.7.1 — 2026-10-15

- The handoff threshold rises from 150k to **500k** tokens (jg: "we need to up the size limit
  substantially"). At 150k a session handed off in the middle of a production incident.
  `REDCELL_HANDOFF_TOKENS` still overrides it.

## 0.7.0 — 2026-10-15

The handoff beat (jg: detect long conversations and restart fresh, rather than compact):

- The reminder hook reads the conversation's current context size from the transcript. Past
  `REDCELL_HANDOFF_TOKENS` (default 150k), it tells the Tech Lead to run `/handoff` at the next
  checkpoint.
- `/handoff`:
  - bring the board and memory current;
  - write a short continuation prompt to `.redcell/handoff.md` and show it in chat;
  - the owner types `/clear` + `go`.
- A new SessionStart mode loads a waiting handoff into the next session once (then moves it to
  `handoff.loaded.md`).
- The ethos: one objective per conversation; never compact.

## 0.6.2 — 2026-10-15

- Measured on BUG-CC-442's transcript: three status asks cost about 386k input-token equivalents;
  30 board updates cost about 45k. And conversation length drives cost (each call re-reads it all).
- So:
  - a board edit rides in the same response as other tool calls, never its own round trip;
  - one objective per conversation.
- The retro gains section 9, "What status updates cost".

## 0.6.1 — 2026-10-15

- Running updates without spending tokens on them (jg):
  - **chat shows only what changed + anything that is the owner's**; the full checklist lives on
    the board;
  - **board updates edit only the changed lines** of `.redcell/board.json` (it is written whole
    once, at `/frame`).

## 0.6.0 — 2026-10-15

The live board (jg: "as automated as possible… they should not have to remember to open it"):

- **`templates/board/board.html`**: the claude.ai page. It shows the objective and its numbers,
  the beats against their timeboxes, the work (dropped items struck through, never deleted), scope
  changes (what, why, who, when), what is yours, the last checkpoint, and agent runs (role, model,
  tokens, minutes). It is backed by its own data store: one record per objective, updated live.
- **In the IDE**: `scripts/board-md.mjs` renders the same record as `.redcell/board.md`. At session
  start, the SessionStart hook opens it in VS Code as a live preview, by itself.
- **The BOARD line**: the hook gives every session the board's link (`.redcell/board.url`,
  committed) and its update routine. `/frame` creates the board when a repo has none.
- **Model metadata**: the dispatch ledger records each run's model, and the board and retros carry
  model, tokens and time per run.
- **Retros capture the checklist** (sections 7–8, from the board record), kept even in a lean retro.
- The ethos plus board line budget is now 3,500 characters (it was 3,000).

## 0.5.2 — 2026-10-15

- The retro's form is the owner's call (jg), asked at `/done`; Product may decide it on the owner's
  behalf:
  - **full**: the whole template;
  - **lean**: actions/changes plus the numbers;
  - **dismissed**: a one-line file, so the next `/frame` knows there is nothing to check.

## 0.5.1 — 2026-10-15

- The retro is part of the process, not an afterthought:
  - an objective is **closed only when its Done verdict and its retro are filed**;
  - `/frame` reads the last retro and puts its Changes on the new checklist, so each is checked;
  - `/done` hands off to `/retro`.
- Docs: `how-the-team-works.md` describes the loop and the Definition of Done; the README links
  `retros/`.

## 0.5.0 — 2026-10-15

The first retro (`retros/2026-10-15-retro-connector-cloud-bug-cc-442.md`): BUG-CC-442 took ~12 h, two
releases and 3 production defects, all knowable before building. HarteBurn becomes a timeboxed agile loop
without the bookkeeping.

- **The loop** (ethos): Frame → Ready → Slices → Build+prove → Done review → retro. Each beat is
  timeboxed; the Tech Lead owns flow (three checkpoint questions; a replan past 2×). The checklist is
  organised by beat, on a live page, never more than 10 minutes without one.
- `/frame`: Product states the objective in production terms, with numbers. Ready brings a full
  production snapshot, production-latency numbers and an infrastructure rehearsal plan. Slices put the
  quick win first; any bundle is priced.
- `/done`: Product's Definition of Done review, in production. A green gate is not done.
- `/retro` + `retros/TEMPLATE-retro.md`: one page, actions first, a narrative, numbers, what was found
  late, roles, last retro's changes, the discussion.
- **Product**: product owner at Frame, at every strategic decision and at Done; never excused as
  "staff-only".
- **Prover**: one proof pass per slice on one build; guard removal on named guards only, in a scratch
  copy, with a timeout; bug fixtures from a production snapshot.
- **Architect**: new infrastructure gets a rehearsal; production cost (round trips at production
  latency) is checked.
- **Architecture Lead**: slices, and the price of bundling.

## 0.4.0 — 2026-10-14

HarteBurn beyond Claude Code, and docs for every surface.

- `scripts/export.mjs`: writes HarteBurn into other tools' own files from the same sources: `AGENTS.md` (the open standard read by Cursor, Copilot, Codex, Windsurf/Devin, Zed, Aider and others) with the way of working and the full brief; role subagents for Cursor, GitHub Copilot, Codex and Gemini; workflow commands; the Prover's brief builder. `project` builds a claude.ai Project kit. `--check` names stale output. A team's own AGENTS.md text is kept.
- `scripts/distro.mjs` and `distro/`: ready-made per product and platform, with an index and install steps each, stamped with the commit and brief they were built from. First product: Connector Cloud.
- Docs: limitations (read first), step-by-step desktop Code tab install, claude.ai Projects, other tools.
- Fixed while building: a pattern rewrite garbled the chat Prover's steps (charters are now never rewritten; chat gets one rule on top); a test skip guard of `0` silently skipped the distro check.
- Not yet tried inside Cursor, Copilot, Codex, Gemini or Cowork; formats follow their documentation as of 2026-10-14.

## 0.3.1 — 2026-10-14

- Product and Architecture Lead must name the party in every finding and decision: the provider, the vendor, or the vendor's customer; never a bare "customer" (jg could not tell which one a 426 decision meant).

## 0.3.0 — 2026-10-14

Phase 3 of FEA-CC-439: the roles.

- Agents: `harteburn:prover`, `harteburn:architect`, `harteburn:product`, `harteburn:architecture-lead`.
- `/prd-panel`: Product, Architect and Prover in parallel and blind, then the Lead's one table; dated decisions passed as fixed; cost recorded from the Agent results.
- `/prove` + `scripts/prove-prompt.mjs`: the Prover's brief is built from the PRD's walkthrough and the git diff only, written inside `.git`; a summary in the repo never reaches it unless it is part of the change, and the charter says to flag one that does.
- Roles ship without per-agent memory: its folder would be untracked files in each repo, dirtying the tree.

## 0.2.0 — 2026-10-14

Phase 2 of FEA-CC-439, and jg's call that size is not a cost ("larger is fine", Max plan).

- The brief may be up to 18,000 characters, sent as two context strings split at a `## ` heading (each under Claude Code's 10,000-character cap). The compiler never drops a real rule for space.
- Every rule must read on its own: no bare labels, no fragments.
- `scripts/score-brief.mjs` and `/brief score`: twenty questions from the repo's answer key, asked of a headless session that sees only the brief and of a no-brief control, marked by a separate judge. Pass: 19 of 20 with, at most 5 without.
- Connector Cloud: 20 of 20 with the brief, 0 of 20 without (75 rules, 14,850 characters). First compile scored 17; the misses were rules compressed into labels.

## 0.1.0 — 2026-10-14

Phase 1 of FEA-CC-439 (jg's go, 2026-10-14).

- Ethos at session start; architecture brief at session and subagent start; one-line reminder per prompt; dispatch ledger inside `.git`.
- `harteburn:brief-compiler` and `/brief`.
- Brief toolkit for each repo: `brief-stamp.mjs` (check, stamp, list rules) and its test. A rule is a line marked ⛔ or ⭐; a new or edited rule cannot be stamped, only recompiled.
- Measured in Connector Cloud: the plugin adds about 4,440 input tokens to a session (ethos and listing about 900, brief about 3,530).
