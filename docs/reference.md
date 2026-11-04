# Reference

## Commands

Plugin commands are namespaced: `/harteburn:<name>` always works, and `/<name>` works when no other plugin uses the name.

| Command | Does |
|---|---|
| `/harteburn:brief` | Recompiles the repo's brief if a rule changed, re-stamps if none did, runs the gate test, scores against the answer key. Never commits |
| `/harteburn:brief score` | Scores only: with the brief, without it, and a separate judge. Pass is 19+ with, 5 or fewer without |
| `/harteburn:prd-panel <prd or id>` | Product, Architect and Prover in parallel and blind, then the Architecture Lead. Writes `docs/reviews/<id>-<date>-{product,architect,prover,reconciled}.md`, records cost, and puts the panel table at the top of the PRD |
| `/harteburn:prove <prd> [before\|after]` | Builds the Prover's brief from the walkthrough (and, after, the diff and the builder's mutation log) and dispatches `harteburn:prover`. Before a build the whole prompt is "Read <brief> and follow it."; after, it is the whole text of `<brief>.prompt`, which names the commits and each changed file's hash. A Prover run dispatched any other way never counts for a push. After a build: the Architect in the same message when the diff touches a load-bearing path; a walkthrough of 4+ steps gets a swarm of 2–3 Provers, one of which builds |
| `/harteburn:frame <objective>` | Frame and Ready: Product states the objective with numbers, the Tech Lead gathers what a guess would miss and cuts the slices. Opens the live checklist page |
| `/harteburn:done <objective>` | Product's Done review in production, against the Frame's numbers: done, or not done and why |
| `/harteburn:retro <project> <objective>` | The retro: numbers, what was found late, each role's runs, Keep/Change; the owner ratifies each Change |
| `/harteburn:handoff` | Brings the board and memory current and writes `.harteburn/handoff.md` (shown in chat too); type `/clear`, then `go`, and the next session loads it |

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

[`hooks/hooks.json`](../hooks/hooks.json) is the list; one script runs them all, [`hooks/harteburn-hook.mjs`](../hooks/harteburn-hook.mjs), whose header names each mode. The main ones:

| Event | Mode | Adds |
|---|---|---|
| SessionStart (startup, resume, clear, compact) | `ethos` | the way of working, [`ethos.md`](../ethos.md) (its limit is held by `tests/plugin.test.mjs`) |
| SessionStart | `handoff` | the handoff `/handoff` wrote (`.harteburn/handoff.md`), once: the file is renamed `.harteburn/handoff.loaded.md` as it loads |
| SessionStart | `brief-session 1 of 4` … `4 of 4` | the repo's brief, in up to four parts; nothing if the repo has none. A bare part number (hooks registered before 0.13.0) sends two, the second carrying the rest |
| SubagentStart | `brief-subagent 1 of 4` … `4 of 4` | the same brief, in every agent |
| UserPromptSubmit | `reminder` | one line: name convened and excused roles; the handoff threshold when context is past it; that the board refuses its record, when the last `board.md` did |
| PostToolUse, matcher `Agent` | `ledger` | one JSON line in `<repo>/.git/harteburn/ledger.jsonl`, with its own `id` and tagged `board: <id>` with the open objective of the session's own tree (`sessionTree` in the hook: a worktree the session worked in is kept until ExitWorktree) |
| SubagentStop | `ledger-stop` | the run's end beside its dispatch row: `event: "stop"`, its minutes and tokens, its transcript |
| PostToolUse, matcher `ExitWorktree` | `session-clear` | forgets the worktree the session kept |
| PostToolUse, matcher `Edit\|Write\|NotebookEdit\|Bash` | `touch` | one `touch` ledger row the first time the session edits, or `cd`s or `git -C`s into, another repo, so the steward sweeps that repo too |
| PreToolUse, matcher `ArtifactData` | (inline) | always allowed: the board page is written at every beat |
| PostToolUse, matcher `Agent`; SubagentStop | `steward prover` | after a `harteburn:prover` run, the repo's `scripts/disk-sweep.sh --steward`, if it is executable, in the background (at most one start a minute). SubagentStop because a background Prover's PostToolUse fires when it is launched |
| PreToolUse, matcher `Bash` | `steward gate` | before a command containing `verify.sh`, the same script, waited for up to 120 s. About 50 ms on every other Bash call |
| PreToolUse, matcher `Bash` | `push` | the push gate (`scripts/push-gate.mjs`), on every Bash command, in a held repo (house rules with a `## Security-domain paths` table, or the hook installed there once): denies the push unless every commit on the table in the pushed range (the remote's tip, read from git's own dry-run push, to the pushed commit) is inside a Security `holds` run's range, and one Prover `proven` run, from at or before the remote's tip, lists every pushed table file with its sha256 as it is in the pushed commit. Before that, it keeps the pre-push hook in place in every held repo. What it reads and refuses: [The push gate](#the-push-gate) |
| SessionStart | `prepush-install` | in a repo with the table only: git's own `pre-push` hook (`scripts/pre-push.sh`, the same bytes in every version) in `<git dir>/hooks`, and `<git dir>/harteburn/plugin-root`: line 1 the plugin, line 2 the folder whose transcripts the hook reads, both from that session (the Bash gate refuses a push while either differs from its own session's). A repo's own `pre-push` becomes `pre-push.local` once. The repo joins `held-repos`. Hooks run from another folder (a global or committed `core.hooksPath`, husky): nothing written; the session prints the shim to add there, whose last line is `CLAUDE_CONFIG_DIR="<config>" exec node "<plugin>/hooks/harteburn-hook.mjs" pre-push "$0" "$@"`. It names this version's folder: redo it after each update |
| git's pre-push hook | `pre-push` | the same check on each ref git sends, in any terminal: exit 1 refuses, with the sentence on stderr; then `pre-push.local`. Any error refuses. `git push --no-verify` skips it |

Every hook exits 0 on any error, except two that refuse a push: the push gate once it knows the repo is held, and git's pre-push hook, which refuses on any error. A broken hook adds nothing; it never stops a session. Only the push gate denies a tool call: a push it cannot clear, and, while a held repo's check is broken, other commands too ([The push gate](#the-push-gate)). The steward never blocks, denies or fails a tool call: it prints nothing, and a failing or slow script is logged to stderr and the call goes ahead. Strings are cut at the 10,000-character limit by the hook itself, with a note, rather than silently by Claude Code.

**Ledger line:** the fields of the ledger hook's `row` (in `hooks/harteburn-hook.mjs`, mode `ledger`); a run's end (mode `ledger-stop`) adds `event: "stop"`, `agent_id`, `dispatch`, its minutes and tokens, and `transcript`, the path of the run's transcript, which the board reads a Security verdict from. Three lines the owner types, each alone as the whole message, are recorded by mode `reminder` (UserPromptSubmit) with `id`, `ts`, `session`, `transcript` and `board`:

| Typed | Row |
|---|---|
| `accept piece <n>: <the finding>` | `event: "accept"`, `piece`, `text`, and on a license with seats, `seats` |
| `test account <provider>: <account>` | `event: "account"`, `provider`, `account` |
| `go piece <n>:` | `event: "go"`, `piece`, `seats` (the seats the license verified) |

A row counts only when that transcript shows the owner typed the line; an agent's words never count. The ledger lives inside `.git`, so it is never committed and never dirties the tree.

A Prover or Security run counts only when nothing but its own prompt reached it. A Monitor event, another agent's result or any other message mid-run voids it. Claude Code's notice that the run's own background command finished still counts.

### The push gate

**Where it holds.** A repo is held when its house rules carry a `## Security-domain paths` table (in the working tree, at HEAD, or on a branch), and once the session hook has installed its pre-push check there it stays held, even if every branch later loses the table. The install adds the repo to `held-repos` (see the files table); remove its line by hand to let a repo go.

**What every Bash command costs.** The hook loads the gate on every Bash call and first keeps each held repo's pre-push check in place. Then a command with no `git`, no `push`, no `$`, backtick or glob, and no shell, interpreter (`node`, `python` and the like), package runner (`npm`, `pnpm`, `yarn`, `bun`) or program typed by its path is let through unread. Every other command is read.

**A push it can read:** `git push`, `git push origin main`, `git -C <repo> push origin main` or `cd <repo> && git push`. Anything else that may push is refused with:

> Push gate: cannot tell which repo or branch this pushes. Push one branch, as git -C <repo> push <remote> <branch>.

That covers `--tags`, `--all`, `--mirror`, `--delete`, `--prune`, a branch or folder in a variable, a command substitution or here-doc naming git, a push inside `bash -c`, `eval` or `xargs`, a git alias whose text pushes, `push.recurseSubmodules` (or `submodule.recurse`) set on. In a held repo it also covers a command where the word `push` sits under any program but `git`, `cd` or a plain reader (`cat`, `grep`, `head`, `echo` and the like, not piped and not writing a file), and a script, interpreter file or `package.json` script the command runs whose text pushes. A script that names a file whose text pushes (a README, say) is refused the same way, even if it only reads it. A program given such a file is refused too: read one with `cat` or `grep`, not `sed` or `awk`.

**The gate's own scripts are exempt**, typed alone in their plain form: `node <plugin>/scripts/board-security.mjs …`, `node <plugin>/scripts/prove-prompt.mjs …` or `node <plugin>/scripts/board-md.mjs …`, at the running plugin's own path (in a plugin run from its source tree, that tree). Nothing before `node`, no option before the file, no `$` word, no symlink to the file, no `NODE_OPTIONS` in the environment, and nothing else in the command. A copy in a project is read like any script.

**Refused before it judges the range:**
- an agent's `--no-verify`: "Push gate: --no-verify skips the pre-push check, which only the owner may do, typed in their own terminal. Push without it."
- a git variable in the environment (`GIT_CONFIG*`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_NAMESPACE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE*`): "Push gate: the environment sets <names>, which changes what this push reads. Push from your own terminal, without it."
- the repo's own (local or worktree) git config setting `core.sshCommand`, `core.gitProxy`, `core.askPass`, `credential.*`, `remote.<name>.uploadpack`, `receivepack`, `vcs`, `proxy`, `push`, `pushurl` or `mirror`, `url.*`, `protocol.*`, `include.*`, `includeIf.*`, `push.default`, `push.recurseSubmodules`, `submodule.*`, `http.proxy` or `http.<url>.proxy`: "Push gate: <repo>'s own git config sets <keys>, which would run or redirect before the push is judged. Push from your own terminal, or move the setting to your global git config; do not delete it." The same keys in your global config are not refused.
- a remote tip this clone lacks: "… which this clone does not have. Fetch, then push."

**How it asks the remote.** The gate runs only a git that root owns, `/usr/bin/git` or `/bin/git` (file and every folder above it), never PATH's, and drops `DEVELOPER_DIR` and `GIT_EXEC_PATH`. Each call has `GIT_TERMINAL_PROMPT=0`, no repo hooks or fsmonitor, and a 15 s limit; the whole check has 45 s. It reads where a push goes, and the tip it overwrites, from git's own `push --dry-run`, and a new branch's start from `ls-remote` of the remote's HEAD. So the remote must answer with no prompt. On a Mac, the first gated push can raise a Keychain prompt for `git-credential-osxkeychain`: choose **Always Allow**, then push again; an unanswered prompt times out. When it cannot check a held repo:

> Push gate: could not check <repo> (<why>), so this push is refused. Try the push again; if it fails the same way, the owner can push from their own terminal with git push --no-verify.

Before it knows the repo is held, an error lets the push through with "Push gate: could not run (<why>); this push is not checked."

**The range.** Security: each commit on the table must be inside a `holds` run's `--base..--head`, from a base on its head's first-parent line; the newest covering run wins. A newest `does not hold` refuses, quoting the finding: "Fix it, re-run Security, then push. Or the owner accepts the risk by sending, alone in one message, "accept piece <n>: <the finding>"." That accept clears it only for the piece the board stamped as starting at the run's base, typed after the verdict; on a Team license only the security owner's accept counts. No covering run: the refusal names the files and the exact command, `node <plugin>/scripts/board-security.mjs --prompt <the remote tip> <the pushed commit>`; dispatch `harteburn:security` with what it prints. Prover: one `proven` run (or a swarm, every step proven) from at or before the remote tip must list each pushed table file with its hash at the pushed commit, with no newer `defect`; else "Run /prove after --base <the remote tip> (or an earlier commit), then push."

**Keeping the check in place.** Before every Bash command, in the session's repo and every repo in `held-repos`:
- the pre-push hook, or the `plugin-root` file beside it, removed, changed or made unrunnable is put back before the command runs. Only when that fails is the command refused, with why.
- hooks moved elsewhere (`core.hooksPath`): every command in that repo is refused but the undo, `git -C <repo> config --unset core.hooksPath`.
- while any held repo is broken (hooks moved, the check not put back, its folder or `.git` gone, or git that cannot run), a session in another repo may run only file readers typed by their full path (`/bin/ls`, `/bin/cat`, `/usr/bin/grep`, `head`, `tail`, `wc`, `diff`, `stat` and the like), with no `$`, backtick or `>`, and `cd`, `echo`, `pwd`. Git that cannot run says: "Push gate: git (/usr/bin/git) cannot run, so <repo>'s pre-push check cannot be kept. Install it (on a Mac: xcode-select --install), then push." A folder gone for good: remove its line from `held-repos` in your own terminal.

Git's own pre-push hook runs the same range check on each ref git sends, however the push was typed, in any terminal; `git push --no-verify`, typed by you, is the owner's way past.

## Scripts

| Script | Where it runs | Does |
|---|---|---|
| `templates/scripts/brief-stamp.mjs` | copied into each repo's `scripts/` | `--check [<a>..<b> ...]` (default; with ranges, the brief as committed at each tip), `--stamp` / `--no-rule-change`, `--list-rules`, `--pages [<a>..<b> ...]` (code on the page map changed → one of its pages changed too; a commit saying `Pages-unchanged: <why>` excuses only its own files; an unreadable range fails) |
| `templates/scripts/__tests__/brief.test.mjs` | copied into each repo | the gate test (brief current; pages follow the code, over `HARTEBURN_PAGES_RANGE` or the branch since `origin/main`), plus checks on throwaway repos that prove the checks bite |
| `scripts/score-brief.mjs` | the plugin, via `/brief score` | the faithfulness score; `HARTEBURN_MODEL` overrides the model |
| `scripts/board-md.mjs` | the plugin, after every board edit | renders `.harteburn/board.md` from `board.json`: the Done checklist first (open lines first, each with where it is proven), the numbered pieces ("piece n of N"), Yours, beats, open work; moves `done`/`dropped` items to the log, except a dropped regression of this diff (`regression: "y"` or a `mistake`), which stays on the record, refused, from records opened 2026-10-31; from then also refuses `docs/triage.md` without the `regression of this diff?` column or with a `y` row; keeps the board's own stamps (`<git dir>/harteburn/stamps-<id>.json`) and one open record per tree; adds the ledger's runs tagged with this record's id; rewrites earlier spellings. **Refuses** (exit 1, each problem at the board's top and on stderr) every problem that `normalize()`, `refusals()` and `applyStamps()` in `scripts/board-schema.mjs`, `securityCheck()` in `scripts/board-security.mjs` (a done piece that changed a security-domain path with no Security verdict covering it, or a **does not hold** the owner has not accepted), `seatGate()` in `scripts/seat-gate.mjs` (Team only, below), and `openRecordPointer()` and the unreadable or untitled record in this script, name. On a Team license `seatGate()` refuses "Piece n: a Done-line change needs the product owner to type "go piece n:" (docs/roles.md#team-seats)" (a scope change the same; an architecture-doc change needs the architecture owner), and "Piece n: a risk accept needs the security owner (docs/roles.md#team-seats)"; a builder's go is shown as "signed off by its builder" and clears neither |
| `scripts/board-security.mjs` | the plugin, imported by `board-md.mjs` and the push gate; `--prompt` by hand | the Security verdict check (`securityCheck`), and the one Security prompt a verdict is counted from: `node <plugin>/scripts/board-security.mjs --prompt <the piece's start commit> <HEAD> [<record id> <piece>]` (both commits in this repo; with the record and piece, the prompt names that piece's open refusals). The board's refusal prints the exact command; so does the push gate's, with the remote tip as the start. Copy it as printed |
| `scripts/prove-prompt.mjs` | the plugin, via `/prove` | builds the Prover's brief, `.git/harteburn/prove-<ts>.md`, and after a build its dispatch prompt `<brief>.prompt`. `--mode before\|after` (default after). `--base <ref>` sets the diff's base (default the merge-base with `origin/main`, else `HEAD~1`). Refuses a PRD with no walkthrough; before a build, steps that name no screen without `--no-screens "<why>"`; a first after-pass with neither or both of `--readers <file>` (one row per view that counts or shows a new outcome) and `--no-new-outcome "<why>"`, or with no guard break logged in `mutations.jsonl` for the diff's code without `--no-guards "<why>"`; lines removed from a loaded file without `--removed <ledger>`; a `--ruling <file>` (the Architect's design) with no "Stored values changed:" line, or a stored value with no "Readers:" line. `--steps <a-b>` keeps only those steps, `--role builds\|reads` marks a swarm member, `--list-steps` counts the steps. Every brief says its `Round:`; `--repass <earlier brief> --verdict <file>` makes the next round, carrying that verdict and diffing only from the commit it tested (it refuses `--base`); round 3 is refused (exit 3) without `--lead-ruling <file>` |
| `scripts/piece-pack.mjs` | the plugin, via `/prove` | `<prd> --steps <a-b> [--base <ref>] [--ready <file>]... [--max-kb <n>]`: one pack per piece (the brief, those steps, the Ready ruling, a diff stat), refused over 120 KB; every role prompt of the piece names only it and the files to cite |
| `scripts/done-evidence.mjs` | the plugin, via `/done` | `init <board.json> <evidence.md>` writes one `## D<n>` section per Done line; `check` exits 1 naming each line with no evidence, before Product is dispatched |
| `scripts/export.mjs` | anywhere, `node` only | writes HarteBurn into other tools' files (`tools`, `cursor`, `copilot`, `codex`, `gemini`, `agents-md`) or a claude.ai Project kit (`project`); `--check` names stale output. See [Other tools](other-tools.md), [Projects](projects.md) |
| `scripts/login.mjs` | the plugin, by hand | `node scripts/login.mjs --key sy_…` stores a harteburn license in `~/.claude/harteburn` (the account's home, never `HOME` or a home variable, which a repo's settings could set; `--home <absolute>` is for tests) and checks it at the address typed with `--url` (default `https://harteburn.ngentix.ai`; https only, plain http only to localhost, 127.0.0.1 or [::1]), stored as `url`; no environment variable sets it. Run with no `--key` to re-check the saved key. `--sync-here`, run inside a repo, turns that repo's board and ledger sync on (off until then). A failed check still passes for 24 hours after the last good one, never for a Team write. A good check caches the rules bundle. Each check sends this machine's `device-id`. A refusal prints the service's reason, such as "that is the owner key: log in with the seat key", "this key is on too many devices (docs/roles.md#team-seats)" or "update HarteBurn: this version sends no device id (docs/roles.md#team-seats)" |
| `scripts/publish.mjs` | the private repo, by hand | `--out <dir> [--check]`: builds the public tree from the allow-list of HEAD as one commit in `<dir>`, never pushing; `--check` writes nothing and prints every refusal (exit 1 on any) |
| `scripts/layers.mjs` | the plugin, via `/retro` | `--route "<where>"` prints `core`, `project` or `user`. `--place <file>` writes the Change to that layer. A core Change is an override on this machine |
| `scripts/redact.mjs` | the plugin, via `/retro` | prints Problem, Cause, Change and How we'll know, and every identifier it stripped. It does not send |
| `scripts/phone.mjs` | the plugin, by hand | `change <file> --yes` sends the redacted Change. Without `--yes`, or without a license file, it sends nothing |
| `scripts/rules-fetch.mjs` | the plugin, at session start when a license file exists | caches the rules bundle and the newest version. The session hook only reads the cache and, when the cached version is newer, adds one line |

## Files HarteBurn writes in a repo

**Names (0.25.0).** `scripts/paths.mjs` owns every path and name: the repo folder `.harteburn/`, the state folder `<git common dir>/harteburn/`, the home `$HARTEBURN_HOME` (else `~/.claude/harteburn`), the variables `HARTEBURN_*` and the role prefix `harteburn:`. A repo set up before 0.25.0 keeps every record: the first read of each folder (any script, the session-start hook) moves the old folders to the new names as they are, byte for byte, and the hook prints one `HarteBurn: moved <old> → <new>` line per folder; when both names exist nothing moves and nothing merges; a symbolic link is never followed or moved. The old variables and the old role prefix in old ledger rows are still read; `paths.mjs` (`LEGACY`) is the one file that spells the old names. A product's tracked `.harteburn/board.url` moves with the folder, so its next commit records the rename; its `.gitignore` lines naming the old folder are rewritten to `.harteburn/…` in the same move, so the board and handoff files stay ignored. The template `templates/scripts/brief-stamp.mjs` reads only `HARTEBURN_PAGES_RANGE`: a product that copies the new template renames that variable in its CI at the same time.

| Path | Committed | Written by | Retention |
|---|---|---|---|
| `docs/_house-rules.md` | yes | people | kept (git) |
| `docs/architecture/BRIEF.md`, `BRIEF-coverage.md` | yes | the compiler, the stamp | kept (git) |
| `docs/architecture/BRIEF-questions.md` | yes | people | kept (git) |
| `docs/reviews/<id>-<date>-*.md` | yes | `/prd-panel` | kept (git) |
| `<git dir>/hooks/pre-push` | no | `prepush-install` (SessionStart), in a repo with the table only: `scripts/pre-push.sh` | kept until removed by hand (`docs/install.md`, Turn it off) |
| `<git dir>/hooks/pre-push.local` | no | `prepush-install`: the repo's own pre-push, renamed once, never edited | kept |
| `<git dir>/harteburn/plugin-root` | no | `prepush-install`: the plugin and the transcripts folder, rewritten by each session | kept until removed by hand |
| `.harteburn/board.json`, `board.md`, `board.url` | `board.url` only | the Tech Lead writes `board.json` (the record; its keys in `scripts/board-schema.mjs`); `board-md.mjs` renders `board.md` and moves finished items out | kept, overwritten at the next `/frame` |
| `.git/harteburn/log-<id>.jsonl` | never | `board-md.mjs`: each finished work item, once, as `{ts, id, beat, state, text, note, kind, regression}` (`ts: null, migrated: true` for items finished before the log); read by `/retro` | kept (`log-*.jsonl`) |
| `.git/harteburn/ledger.jsonl` | never | the ledger hook | kept (`ledger.jsonl`) |
| `.git/harteburn/stamps-<id>.json`, `open-record.json` | never | `board-md.mjs`: the board's stamps (each piece's start and end commit and time, the commit its range starts from, and the hashes of the files Claude Code and git load that git ignores, and of ignored files the security table matches (except `.harteburn/` and `node_modules/`) (`opened_local`, `from_local`, `end_local`), the Security verdicts it saw, and the commit HEAD was at when the board first saw the record), and this tree's open record | kept (`stamps-*.json`, `open-record.json`) |
| `.git/harteburn/rounds.jsonl`, `ci-releases.jsonl`, `legs.jsonl` | never | the Prover's round chain, the gate's released versions, a run's measured legs | kept |
| `.git/harteburn/prove-<ts>.md`, `prove-<ts>.md.prompt` | never | `/prove`: the Prover's brief, and after a build its whole dispatch prompt (the commits and each changed file's hash, which the push gate reads) | scratch: proposed for removal once its objective is past |
| `.harteburn/settings.json` | your choice | people: `{"mode": "bookends"}` turns on bookends mode (below); any other value, or no file, is full mode | kept |
| `.harteburn/handoff.md`, `handoff.loaded.md` | no (ignored) | `/handoff` writes `handoff.md`; the next session's `handoff` hook loads it once and renames it `handoff.loaded.md` | overwritten at the next handoff |
| `~/.claude/harteburn/held-repos` (`$CLAUDE_CONFIG_DIR/harteburn/held-repos` when that is set) | never (outside every repo) | `prepush-install`: one line per repo the pre-push check was installed in; every session keeps each one's check in place | kept: remove a repo's line by hand to let it go |
| `~/.claude/harteburn/device-id` | never (outside every repo) | `scripts/login.mjs`: this machine's id, sent with each license check (3 devices per key in 60 minutes) | kept, mode 0600 |
| `.git/harteburn/mutations.jsonl` | never | the builder, one line per guard it broke (`guard`, `file`, `break`, `test`, `result`); `/prove` moves it aside after a proven verdict | scratch: proposed for removal once its objective is past |
| `.git/harteburn/prover-wt/` | never | the Prover: its warm worktree, created once and reused (never `cargo clean` it) | kept: never proposed, its build folder never touched |
| `.git/harteburn/steward.last`, `steward.jsonl` | never | `scripts/steward.mjs --stamp`: the latest sweep's result (`at`, `free_gb` in decimal GB as `df -H`, `proposed_bytes`, `proposed`, `listed`, `removed_bytes`: free space the repo's own script freed, approximate; `repo_script`, `trim_attempted`), and every sweep's, one line each | kept (`steward.last`, `steward.jsonl`) |
| `.git/harteburn/steward-ask.json`, `.git/harteburn/steward-always.json` | never | `scripts/steward.mjs`: what is asked (each kind's count, bytes, a sample) and declined; the owner's "always here" answers | kept |
| `~/.claude/harteburn/steward-always.json` | never (outside every repo) | `scripts/steward.mjs --answer <kind> always-everywhere`: the owner's answers for every repo (a home variable moves it) | kept |
| `~/.claude/harteburn/harteburn.json` | never (outside every repo) | `scripts/login.mjs`: the license key, its address, the last good check (`grace_until`), `tier`, `org_id`, on Team the `person` and the signed `seats`, and the repos with sync on (nothing moves it) | kept, mode 0600 |
| `~/.claude/harteburn/changes.json` | never (outside every repo) | `scripts/layers.mjs`: user-layer Changes (a home variable moves it) | kept |
| `~/.claude/harteburn/overrides.json` | never (outside every repo) | `scripts/layers.mjs`: a core Change built on this machine until it is submitted | kept |
| `~/.claude/harteburn/rules.json` | never (outside every repo) | `scripts/rules-fetch.mjs`: cached rules and the newest version (nothing moves it) | kept |
| `.harteburn/changes.json` | the repo | `scripts/layers.mjs`: project-layer Changes | kept |
| `.git/harteburn/brief-score.json`, `ide-board-opened` | never | `/brief score`; the board preview hook | kept |
| any other file under `.git/harteburn/` | never | each is named by the script or skill that writes it (a session's kept tree in the hook, verdicts and rulings in `/prove`, notes and walkthroughs) | scratch: proposed for removal once its objective is past (newer than the oldest open record: kept) |
| any other worktree under `.git/harteburn/` | never | a builder or a role, for one objective | proposed for removal once its objective is past; listed, never removed, while it has uncommitted or unpushed work |
| any other directory under `.git/harteburn/` | never | a role's scratch | proposed for removal once its objective is past |
| a symbolic link under `.git/harteburn/` | never | a person or a role | listed, never followed or removed (it may point at another repo) |

**Other repos (security review, 2026-10-28):** the steward sweeps another repo an objective changed only when it has its own `.git/harteburn` folder, and there it runs none of that repo's code: never its `scripts/disk-sweep.sh`, never `git status` (a filter driver would run), so its worktrees are listed "other repo: not checked", not proposed; its loose scratch is proposed as usual. Every git command the steward runs carries `core.fsmonitor=false` and `core.hooksPath=/dev/null`. Every git command the board's security check runs carries the same two settings and turns off every filter driver the repo's config names; a filtered file on the table (Git LFS) then reads as changed, so it refuses.

The steward asks before it removes anything. `scripts/retention.mjs` holds the kept names (`KEEP`) and sorts every other entry (`classify`); this table shows the same list.

## The steward

After every Prover pass and before every gate, the steward sweeps each repo HarteBurn works in (and each repo the objective changed) and records the result in `.git/harteburn/steward.last` and `steward.jsonl`: free space (`free_gb`, as `df -H`), what it proposes, what it removed (`removed_bytes`, its own removals only) and, under 40 GB, the repo's own trim (`trim_attempted`, `script_freed_approx`).

**It removes nothing without your answer.** What is past its objective is grouped by kind: `scratch` (old scratch files), `dir` (old scratch folders), `worktree` (old worktrees HarteBurn made), `build` (a Rust repo's build output, only under 40 GB). The per-prompt reminder names each kind with its count, size and examples, and asks:

- **yes**: remove these now; ask again next time.
- **no**: keep them; not asked again until a new one of that kind appears.
- **always here**: remove now, and at every sweep in this repo without asking.
- **always in every repo**: the same in every repo on this machine (`~/.claude/harteburn/steward-always.json`).

When a sweep removes something under always, the reminder says "Steward removed under always: <kind> (always in this repo / every repo) <size>". Say **ask again: <kind>** to take it off always (wherever it was set) and be asked again. Never removed, whatever the answer: kept files, the warm Prover worktree, a link, a worktree with uncommitted or unpushed work.

## Where releases are announced

Each HarteBurn version that reaches `main` is announced in the **#dev** Slack channel: a push that bumps the version (`.claude-plugin/plugin.json`) runs `.github/workflows/release-notes.yml`, which posts that version's `CHANGELOG.md` section ("HarteBurn 0.x.y released", the headline, its items) and how to update (`claude plugin update harteburn@ngentix`, then reload). One post per version; a push that changes no version posts nothing. The webhook is the repo secret `CI_SLACK_WEBHOOK`; a refused post shows in the run's log only. `node scripts/release-notes.mjs <version> --dry-run` prints the post.

## What a fresh session shows

A new session (and `/clear`) shows **HarteBurn <version> on (full mode)** (or `bookends mode`), from the session hook's `systemMessage`, with the version read from `.claude-plugin/plugin.json`; the first reply opens with the same "HarteBurn <version> on". A resumed or compacted session shows nothing new. If `plugin.json` cannot be read, the line says "HarteBurn on" and the session carries on.

**Bookends mode.** A repo whose `.harteburn/settings.json` is `{"mode": "bookends"}` runs roles only at a piece's start and end: the session hook adds `bookends.md` to the way of working, the per-prompt reminder uses its bookends line, and the session line says `bookends mode`. Any other value, an unreadable file or none is full mode. Change it, then start a new session.

## The board, first time (`/frame` step 1)

When the repo has no `.harteburn/board.url`, `/frame` creates the live checklist page once:

- copy the plugin's `templates/board/board.html` to your scratchpad;
- publish it with `capabilities: {db: {}}`, `icon: "checklist"` and `pin: true`;
- write its URL to `.harteburn/board.url` in the repo and commit it, so every user and session
  finds it;
- add `.harteburn/board.json`, `.harteburn/board.md` and `.harteburn/handoff*.md` to `.gitignore`
  (local files);
- in `.vscode/settings.json`, map `"workbench.editorAssociations": {"**/.harteburn/board.md":
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
| Brief size | 38,000 characters | four hook strings under Claude Code's 10,000-character cap |
| Way of working | the limit `tests/plugin.test.mjs` holds (the ethos plus the board line) | it rides every session |
| Session cost | about 4,400 input tokens | measured on Connector Cloud; cached after the first turn |
| PRD panel | about 250,000 tokens, about 5 minutes | the first run, on FEA-CC-426 |
| Surfaces | terminal, desktop Code tab, VS Code, JetBrains, Agent SDK | not plain claude.ai chat; the web only through managed settings |
| A newly installed or updated plugin | loads in new sessions | restart, or `/reload-plugins` |
| Session files the board hashes | 200 files, 1 MB each | every ignored file a security-table row covers counts, except `.harteburn/` and the top `node_modules/`; an installed nested package folder (`service/node_modules/`, found 2026-10-30) refuses every render until it is removed or the table narrows |

**Recording a run by hand.** `node <plugin>/hooks/harteburn-hook.mjs ledger-stop --manual <role> "<purpose>" <tokens> <ms> [--model <m>]` waits on stdin while stdin is open and not a terminal: run it with `</dev/null` from a script or an agent shell (found 2026-10-30). A Security verdict counts for the board only from a Claude Code transcript (a dispatch row joined to its stop row); a run recorded by hand is counted as a run, never as the verdict.

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

This repository is the release. A version published here is what `claude plugin update harteburn@ngentix` installs. Development and the tests stay in the private repo. To try a checkout of this release without installing: `claude --plugin-dir ~/ngentix/harteburn`.

Two traps, found 2026-11-01:
- **A directory marketplace runs hook code from the folder it points at, live.** Sessions took the hook list from the cached install and each hook's code from the clone, so an uncommitted edit ran in every session at once. Point the `ngentix` marketplace at a clean checkout that moves only on a release (for example `git worktree add a separate clean release checkout origin/main`), never at the clone you edit.
- **Mutate guards in a worktree, never in the clone the marketplace runs.** A mutation script that rewrites `hooks/harteburn-hook.mjs` in place puts the broken guard live for every session until it is restored.

## Repository layout

```
.claude-plugin/plugin.json        the plugin: name, version
.claude-plugin/marketplace.json   this repo as the "ngentix" marketplace
ethos.md                          the way of working, put into every session
hooks/hooks.json                  the hook entries
hooks/harteburn-hook.mjs            the one hook script
agents/*.md                       the role charters
skills/{brief,done,frame,handoff,prd-panel,prove,retro}/   the commands
scripts/                          the push gate and pre-push shim, the seat check, the board, the steward,
                                  the Prover's brief builder, the scorer, login, the export, publish
templates/scripts/                what each product repo copies
docs/                             this documentation
```
