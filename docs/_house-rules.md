# HarteBurn's house rules

The owner's settled rules for this repo. HarteBurn's own rules for every project are in `ethos.md` and `agents/`.

- Personas: the owner and Hammer, each building their own products with HarteBurn on their own machine (jg 2026-10-28).
- Release cadence: per slice: each proven piece is a version, pushed when proven (jg 2026-10-28).

## Security-domain paths

A done piece whose diff changes one of these paths needs a `harteburn:security` verdict the board can read (jg 2026-10-28).

| code path | what crosses |
|---|---|
| `**` | everything in this repo: HarteBurn is code and instructions the owner's machine and every session run or read, so no file is outside the lock (Security round 16; jg 2026-10-28) |
| `hooks/**` | code that runs on the owner's machine in every session |
| `scripts/**`, `templates/scripts/**` | code the board, the gate and each repo run |
| `.claude-plugin/**` | what the plugin installs and runs |
| `agents/**`, `skills/**` | text every session's model reads and acts on |
| `ethos.md`, `bookends.md` | the note pasted into every session, which its model follows (jg 2026-10-28) |
| `.github/**` | CI that runs with the repo's secrets (jg 2026-10-28) |
| `.claude/**`, `CLAUDE.md`, `**/CLAUDE.md` | what Claude Code loads in every session here: its hooks, permissions and instructions (Security round 15; jg 2026-10-28) |

The board's Done lock is held to stopping a rushed or tricked agent (a skipped, narrowed, re-rolled or mis-ranged review, a pasted or typed acceptance). A deliberately hostile agent that forges the board's own records (its stamps, the ledger, Claude Code's transcripts) is stopped by piece 8's sandbox, not by the lock (jg 2026-10-28).
