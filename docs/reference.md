# Reference

## Commands

Plugin commands are namespaced: `/harteburn:<name>` always works, and `/<name>` works when no other plugin uses the name.

| Command | Does |
|---|---|
| `/harteburn:brief` | Recompiles the repo's brief if a rule changed, re-stamps if none did, runs the gate test, scores against the answer key. Never commits |
| `/harteburn:brief score` | Scores only: with the brief, without it, and a separate judge. Pass is 19+ with, 5 or fewer without |
| `/harteburn:prd-panel <prd or id>` | Product, Architect and Prover in parallel and blind, then the Architecture Lead. Writes `docs/reviews/<id>-<date>-{product,architect,prover,reconciled}.md`, records cost, and puts the panel table at the top of the PRD |
| `/harteburn:prove <prd> [before\|after]` | Builds the Prover's brief from the walkthrough (and, after, the diff and the builder's mutation log) and dispatches `harteburn:prover` with only "Read <file> and follow it". After a build: the Architect in the same message when the diff touches a load-bearing path; a walkthrough of 4+ steps gets a swarm of 2–3 Provers, one of which builds |

## Agents

| Agent | Tools | Model |
|---|---|---|
| `harteburn:prover` | all, including the browser when available | opus |
| `harteburn:architect` | Read, Grep, Glob, Bash, Write | opus |
| `harteburn:product` | Read, Grep, Glob, Bash, Write | opus |
| `harteburn:designer` | Read, Grep, Glob, Bash, Write | opus |
| `harteburn:security` | Read, Grep, Glob, Bash, Write | opus |
| `harteburn:architecture-lead` | Read, Grep, Glob, Bash, Write | opus |
| `harteburn:brief-compiler` | Read, Grep, Glob, Bash, Write, Edit | opus |

Charters: [`agents/`](../agents/). Roles explained: [The roles](roles.md). The roles have **no per-agent memory**: Claude Code keeps it in a folder inside each repo, which would leave untracked files in every working tree.

## Hooks

[`hooks/hooks.json`](../hooks/hooks.json) is the list; one script runs them all, [`hooks/redcell-hook.mjs`](../hooks/redcell-hook.mjs), whose header names each mode. The main ones:

| Event | Mode | Adds |
|---|---|---|
| SessionStart (startup, resume, clear, compact) | `ethos` | the way of working, [`ethos.md`](../ethos.md) (its limit is held by `tests/plugin.test.mjs`) |
| SessionStart | `brief-session 1 of 3`, `2 of 3`, `3 of 3` | the repo's brief, in up to three parts; nothing if the repo has none. A bare part number (hooks registered before 0.13.0) sends two, the second carrying the rest |
| SubagentStart | `brief-subagent 1 of 3`, `2 of 3`, `3 of 3` | the same brief, in every agent |
| UserPromptSubmit | `reminder` | one line: name convened and excused roles; the handoff threshold when context is past it; that the board refuses its record, when the last `board.md` did |
| PostToolUse, matcher `Agent` | `ledger` | one JSON line in `<repo>/.git/redcell/ledger.jsonl`, with its own `id` and tagged `board: <id>` with the open objective of the session's own tree (`sessionTree` in the hook: a worktree the session worked in is kept until ExitWorktree) |
| PostToolUse, matcher `ExitWorktree` | `session-clear` | forgets the worktree the session kept |
| PostToolUse, matcher `Agent`; SubagentStop | `steward prover` | after a `harteburn:prover` run, the repo's `scripts/disk-sweep.sh --steward`, if it is executable, in the background (at most one start a minute). SubagentStop because a background Prover's PostToolUse fires when it is launched |
| PreToolUse, matcher `Bash` | `steward gate` | before a command containing `verify.sh`, the same script, waited for up to 120 s. About 50 ms on every other Bash call |

Every hook exits 0 on any error. A broken hook adds nothing; it never stops a session. The steward never blocks, denies or fails a tool call: it prints nothing, and a failing or slow script is logged to stderr and the call goes ahead. Strings are cut at the 10,000-character limit by the hook itself, with a note, rather than silently by Claude Code.

**Ledger line:** the fields of the ledger hook's `row` (in `hooks/redcell-hook.mjs`, mode `ledger`); a run's end (mode `ledger-stop`) adds `event: "stop"`, `agent_id`, `dispatch`, its minutes and tokens, and `transcript`, the path of the run's transcript, which the board reads a Security verdict from. An owner's typed `accept: <text>` (mode `reminder`, on UserPromptSubmit) writes `event: "accept"`, `id`, `ts`, `session`, `transcript`, `text` and `board`. It lives inside `.git`, so it is never committed and never dirties the tree.

## Scripts

| Script | Where it runs | Does |
|---|---|---|
| `templates/scripts/brief-stamp.mjs` | copied into each repo's `scripts/` | `--check [<a>..<b> ...]` (default; with ranges, the brief as committed at each tip), `--stamp` / `--no-rule-change`, `--list-rules`, `--pages [<a>..<b> ...]` (code on the page map changed → one of its pages changed too; a commit saying `Pages-unchanged: <why>` excuses only its own files; an unreadable range fails) |
| `templates/scripts/__tests__/brief.test.mjs` | copied into each repo | the gate test (brief current; pages follow the code, over `REDCELL_PAGES_RANGE` or the branch since `origin/main`), plus checks on throwaway repos that prove the checks bite |
| `scripts/score-brief.mjs` | the plugin, via `/brief score` | the faithfulness score; `REDCELL_MODEL` overrides the model |
| `scripts/board-md.mjs` | the plugin, after every board edit | renders `.redcell/board.md` from `board.json`: the Done checklist first (open lines first, each with where it is proven), the numbered pieces ("piece n of N"), Yours, beats, open work; moves `done`/`dropped` items to the log; keeps the board's own stamps (`<git dir>/redcell/stamps-<id>.json`) and one open record per tree; adds the ledger's runs tagged with this record's id; rewrites earlier spellings. **Refuses** (exit 1, each problem at the board's top and on stderr) every problem that `normalize()`, `refusals()` and `applyStamps()` in `scripts/board-schema.mjs`, `securityCheck()` in `scripts/board-security.mjs` (a done piece that changed a security-domain path with no Security verdict covering it, or a **does not hold** the owner has not accepted), and `openRecordPointer()` and the unreadable or untitled record in this script, name |
| `scripts/board-security.mjs` | the plugin, imported by `board-md.mjs`; `--prompt <start> <head>` by hand | the Security verdict check (`securityCheck`), and the one Security prompt a verdict is counted from |
| `scripts/prove-prompt.mjs` | the plugin, via `/prove` | builds the Prover's brief inside `.git/redcell/`; refuses a PRD with no walkthrough. `--steps <a-b>` keeps only those steps, `--role builds\|reads` marks a swarm member, `--list-steps` counts the steps. Every brief says its `Round:`; `--repass <earlier brief> --verdict <file>` makes the next round, carrying that verdict and diffing only from the commit it tested; round 3 is refused (exit 3) without `--lead-ruling <file>` |
| `scripts/export.mjs` | anywhere, `node` only | writes HarteBurn into other tools' files (`tools`, `cursor`, `copilot`, `codex`, `gemini`, `agents-md`) or a claude.ai Project kit (`project`); `--check` names stale output. See [Other tools](other-tools.md), [Projects](projects.md) |
| `scripts/login.mjs` | the plugin, by hand | `node scripts/login.mjs --key sy_…` stores a harteburn license in `~/.claude/redcell` (the account's home, never `HOME` or `REDCELL_HOME`, which a repo's settings could set; `--home <absolute>` is for tests) and checks it at the address typed with `--url` (default `https://harteburn.ngentix.ai`), stored as `url`; no environment variable sets it. Run with no `--key` to re-check the saved key. `--sync-here`, run inside a repo, turns that repo's board and ledger sync on (off until then). A failed check still passes for 24 hours after the last good one. A good check caches the rules bundle |
| `scripts/layers.mjs` | the plugin, via `/retro` | `--route "<where>"` prints `core`, `project` or `user`. `--place <file>` writes the Change to that layer. A core Change is an override on this machine |
| `scripts/redact.mjs` | the plugin, via `/retro` | prints Problem, Cause, Change and How we'll know, and every identifier it stripped. It does not send |
| `scripts/phone.mjs` | the plugin, by hand | `change <file> --yes` sends the redacted Change. Without `--yes`, or without a license file, it sends nothing |
| `scripts/rules-fetch.mjs` | the plugin, at session start when a license file exists | caches the rules bundle and the newest version. The session hook only reads the cache and, when the cached version is newer, adds one line |

## Files HarteBurn writes in a repo

| Path | Committed | Written by | Retention |
|---|---|---|---|
| `docs/_house-rules.md` | yes | people | kept (git) |
| `docs/architecture/BRIEF.md`, `BRIEF-coverage.md` | yes | the compiler, the stamp | kept (git) |
| `docs/architecture/BRIEF-questions.md` | yes | people | kept (git) |
| `docs/reviews/<id>-<date>-*.md` | yes | `/prd-panel` | kept (git) |
| `.redcell/board.json`, `board.md`, `board.url` | `board.url` only | the Tech Lead writes `board.json` (the record; its keys in `scripts/board-schema.mjs`); `board-md.mjs` renders `board.md` and moves finished items out | kept, overwritten at the next `/frame` |
| `.git/redcell/log-<id>.jsonl` | never | `board-md.mjs`: each finished work item, once, as `{ts, id, beat, state, text, note, kind}` (`ts: null, migrated: true` for items finished before the log); read by `/retro` | kept (`log-*.jsonl`) |
| `.git/redcell/ledger.jsonl` | never | the ledger hook | kept (`ledger.jsonl`) |
| `.git/redcell/stamps-<id>.json`, `open-record.json` | never | `board-md.mjs`: the board's stamps (each piece's start and end commit and time, the commit its range starts from, and the hashes of the files Claude Code and git load that git ignores, and of ignored files the security table matches (except `.redcell/` and `node_modules/`) (`opened_local`, `from_local`, `end_local`), the Security verdicts it saw, and the commit HEAD was at when the board first saw the record), and this tree's open record | kept (`stamps-*.json`, `open-record.json`) |
| `.git/redcell/rounds.jsonl`, `ci-releases.jsonl`, `legs.jsonl` | never | the Prover's round chain, the gate's released versions, a run's measured legs | kept |
| `.git/redcell/prove-<ts>.md` | never | `/prove` | scratch: proposed for removal once its objective is past |
| `.git/redcell/mutations.jsonl` | never | the builder, one line per guard it broke (`guard`, `file`, `break`, `test`, `result`); `/prove` moves it aside after a proven verdict | scratch: proposed for removal once its objective is past |
| `.git/redcell/prover-wt/` | never | the Prover: its warm worktree, created once and reused (never `cargo clean` it) | kept: never proposed, its build folder never touched |
| `.git/redcell/steward.last`, `steward.jsonl` | never | `scripts/steward.mjs --stamp`: the latest sweep's result (`at`, `free_gb` in decimal GB as `df -H`, `proposed_bytes`, `proposed`, `listed`, `removed_bytes`: free space the repo's own script freed, approximate; `repo_script`, `trim_attempted`), and every sweep's, one line each | kept (`steward.last`, `steward.jsonl`) |
| `.git/redcell/steward-ask.json`, `.git/redcell/steward-always.json` | never | `scripts/steward.mjs`: what is asked (each kind's count, bytes, a sample) and declined; the owner's "always here" answers | kept |
| `~/.claude/redcell/steward-always.json` | never (outside every repo) | `scripts/steward.mjs --answer <kind> always-everywhere`: the owner's answers for every repo (`REDCELL_HOME` moves it) | kept |
| `~/.claude/redcell/harteburn.json` | never (outside every repo) | `scripts/login.mjs`: the license key, its address, the last good check and the repos with sync on (nothing moves it) | kept, mode 0600 |
| `~/.claude/redcell/changes.json` | never (outside every repo) | `scripts/layers.mjs`: user-layer Changes (`REDCELL_HOME` moves it) | kept |
| `~/.claude/redcell/overrides.json` | never (outside every repo) | `scripts/layers.mjs`: a core Change built on this machine until it is submitted | kept |
| `~/.claude/redcell/rules.json` | never (outside every repo) | `scripts/rules-fetch.mjs`: cached rules and the newest version (nothing moves it) | kept |
| `.redcell/changes.json` | the repo | `scripts/layers.mjs`: project-layer Changes | kept |
| `.git/redcell/brief-score.json`, `ide-board-opened` | never | `/brief score`; the board preview hook | kept |
| any other file under `.git/redcell/` | never | each is named by the script or skill that writes it (a session's kept tree in the hook, verdicts and rulings in `/prove`, notes and walkthroughs) | scratch: proposed for removal once its objective is past (newer than the oldest open record: kept) |
| any other worktree under `.git/redcell/` | never | a builder or a role, for one objective | proposed for removal once its objective is past; listed, never removed, while it has uncommitted or unpushed work |
| any other directory under `.git/redcell/` | never | a role's scratch | proposed for removal once its objective is past |
| a symbolic link under `.git/redcell/` | never | a person or a role | listed, never followed or removed (it may point at another repo) |

**Other repos (security review, 2026-10-28):** the steward sweeps another repo an objective changed only when it has its own `.git/redcell` folder, and there it runs none of that repo's code: never its `scripts/disk-sweep.sh`, never `git status` (a filter driver would run), so its worktrees are listed "other repo: not checked", not proposed; its loose scratch is proposed as usual. Every git command the steward runs carries `core.fsmonitor=false` and `core.hooksPath=/dev/null`. Every git command the board's security check runs carries the same two settings and turns off every filter driver the repo's config names; a filtered file on the table (Git LFS) then reads as changed, so it refuses.

The steward asks before it removes anything. `scripts/retention.mjs` holds the kept names (`KEEP`) and sorts every other entry (`classify`); this table shows the same list.

## The steward

After every Prover pass and before every gate, the steward sweeps each repo HarteBurn works in (and each repo the objective changed) and records the result in `.git/redcell/steward.last` and `steward.jsonl`: free space (`free_gb`, as `df -H`), what it proposes, what it removed (`removed_bytes`, its own removals only) and, under 40 GB, the repo's own trim (`trim_attempted`, `script_freed_approx`).

**It removes nothing without your answer.** What is past its objective is grouped by kind: `scratch` (old scratch files), `dir` (old scratch folders), `worktree` (old worktrees HarteBurn made), `build` (a Rust repo's build output, only under 40 GB). The per-prompt reminder names each kind with its count, size and examples, and asks:

- **yes**: remove these now; ask again next time.
- **no**: keep them; not asked again until a new one of that kind appears.
- **always here**: remove now, and at every sweep in this repo without asking.
- **always in every repo**: the same in every repo on this machine (`~/.claude/redcell/steward-always.json`).

When a sweep removes something under always, the reminder says "Steward removed under always: <kind> (always in this repo / every repo) <size>". Say **ask again: <kind>** to take it off always (wherever it was set) and be asked again. Never removed, whatever the answer: kept files, the warm Prover worktree, a link, a worktree with uncommitted or unpushed work.

## Where releases are announced

Each HarteBurn version that reaches `main` is announced in the **#dev** Slack channel: a push that bumps the version (`.claude-plugin/plugin.json`) runs `.github/workflows/release-notes.yml`, which posts that version's `CHANGELOG.md` section ("HarteBurn 0.x.y released", the headline, its items) and how to update (`claude plugin update harteburn@ngentix`, then reload). One post per version; a push that changes no version posts nothing. The webhook is the repo secret `CI_SLACK_WEBHOOK`; a refused post shows in the run's log only. `node scripts/release-notes.mjs <version> --dry-run` prints the post.

## What a fresh session shows

A new session (and `/clear`) shows **HarteBurn <version> on (full mode)** (or `bookends mode`), from the session hook's `systemMessage`, with the version read from `.claude-plugin/plugin.json`; the first reply opens with the same "HarteBurn <version> on". A resumed or compacted session shows nothing new. If `plugin.json` cannot be read, the line says "HarteBurn on" and the session carries on.

## The board, first time (`/frame` step 1)

When the repo has no `.redcell/board.url`, `/frame` creates the live checklist page once:

- copy the plugin's `templates/board/board.html` to your scratchpad;
- publish it with `capabilities: {db: {}}`, `icon: "checklist"` and `pin: true`;
- write its URL to `.redcell/board.url` in the repo and commit it, so every user and session
  finds it;
- add `.redcell/board.json`, `.redcell/board.md` and `.redcell/handoff*.md` to `.gitignore`
  (local files);
- in `.vscode/settings.json`, map `"workbench.editorAssociations": {"**/.redcell/board.md":
  "vscode.markdown.preview.editor"}`, so the board opens as a live preview in VS Code (the
  session hook opens it at every start).

What the board refuses, each with its reason, is in `normalize()`, `refusals()` and `applyStamps()`
in `scripts/board-schema.mjs`, and `openRecordPointer()` and the unreadable or untitled record in
`scripts/board-md.mjs`. The board keeps its own stamps (N, each piece's start and finish, the opened
date): for these it never trusts a value an ordinary edit can change; a deliberate edit is shown,
not stopped. A new objective takes a new `id`, after the last one is closed. Each run's identity is
`ledgerId` in `scripts/board-schema.mjs`. The board shows an unpriced scope entry as unpriced.

`/frame` republishes the page on every objective because the page holds no data, its db does, so a
page from an older plugin shows the record's keys. A record's `log_count: 0` marks it born with the
log, so an item finished before its first render keeps its time. The board shows the Done checklist
first, open lines first, then Yours, the beats (time used against the timebox, `← here`) and the open
work.

## Limits

| Limit | Value | Why |
|---|---|---|
| Brief size | 29,000 characters | three hook strings under Claude Code's 10,000-character cap |
| Way of working | the limit `tests/plugin.test.mjs` holds (the ethos plus the board line) | it rides every session |
| Session cost | about 4,400 input tokens | measured on Connector Cloud; cached after the first turn |
| PRD panel | about 250,000 tokens, about 5 minutes | the first run, on FEA-CC-426 |
| Surfaces | terminal, desktop Code tab, VS Code, JetBrains, Agent SDK | not plain claude.ai chat; the web only through managed settings |
| A newly installed or updated plugin | loads in new sessions | restart, or `/reload-plugins` |

## Word budgets and the tidy pass

Every file a run loads (`agents/*.md`, `skills/*/SKILL.md`, `ethos.md`, `bookends.md`) has a word budget in `budgets.json`; `node scripts/budgets.mjs` prints each count against it, and `tests/budgets.test.mjs` is red when a file is over. The first answer is a trim; when an addition is worth its words, record a raise: `{"date": "YYYY-MM-DD", "words": N, "why": "…", "approved": "<owner>"}`. A rule's story (where it came from, the numbers that justified it) lives in `docs/history.md`, never in the loaded file. `/retro` step 10 runs the tidy pass when a budget trips or every 3rd retro.

## Release cadence

Each project picks one, as a line in its house rules: `Release cadence: train 3h` (the default),
`per slice`, or `bundle`. `/frame` asks once if the line is missing.

- **Train** (default): a production fix or a quick win leaves at once. Otherwise nothing proven
  waits longer than the limit (default 3 h): when the oldest proven slice reaches it, the train
  leaves with everything proven at that moment, and unfinished work never holds it. About 3 trains
  a day at most. While the gate runs, the Tech Lead does non-code work (PRD, docs, the next plan).
- **Per slice**: each proven slice releases alone. Fastest to production, most release waits.
- **Bundle**: release when the owner says. Every hold is priced ("holds <fix> back ~N h").

Why (Connector Cloud, 2026-10-16): a proven fix waited ~9 h for a bundle to save one release, about
10 minutes of gate and $0.30 of Actions. A train would have shipped it 8.5 h sooner for 2 extra
releases (~20 min, ~$0.60).

## Changing HarteBurn

The test for where a change belongs: **would it be true in every product?** If yes, it goes here. If it's one product's rule, it goes in that repo's house rules or architecture pages.

1. Edit in your clone of this repo.
2. Try it without installing: `claude --plugin-dir ~/ngentix/redcell`, or `/reload-plugins` in a session started that way.
3. Run the tests: `node --test tests/*.test.mjs templates/scripts/__tests__/*.test.mjs`. They cover the hook and gate agreeing on the brief split, the hooks never failing a session, the Prover's brief never carrying a summary, and the checks on throwaway repos. Each guard has been mutated once to prove it bites.
4. Validate: `claude plugin validate .`
5. Bump `version` in `.claude-plugin/plugin.json`, and add a dated entry to [`CHANGELOG.md`](../CHANGELOG.md).
6. Commit and push to `main`.
7. Update your install: `claude plugin marketplace update ngentix && claude plugin update harteburn@ngentix`, then restart.
8. If a template changed, copy it into each product repo.

## Repository layout

```
.claude-plugin/plugin.json        the plugin: name, version
.claude-plugin/marketplace.json   this repo as the "ngentix" marketplace
ethos.md                          the way of working, put into every session
hooks/hooks.json                  the hook entries
hooks/redcell-hook.mjs            the one hook script
agents/*.md                       the role charters
skills/{brief,prd-panel,prove}/   the commands
scripts/                          the scorer, the Prover's brief builder, the export
templates/scripts/                what each product repo copies
tests/                            the plugin's own tests
docs/                             this documentation
```
