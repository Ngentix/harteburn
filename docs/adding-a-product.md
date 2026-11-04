# Adding a product

The plugin never holds a product fact. Bringing a repo under HarteBurn means giving it its own half. Connector Cloud is the worked example.

Before you start: the plugin is installed ([Install](install.md)), and the repo has architecture pages in `docs/architecture/`. If it has none, write them first. A brief compiled from nothing is nothing.

## 1. House rules

Create `docs/_house-rules.md`: the owner's settled rules for this product, one line each, dated (its one table is the security-domain paths, below), each marked ⛔ (never / must) or ⭐ (the decided way). Group them by topic: product and customer, architecture, screens and words, how we work, gates and releases. Front matter and a short preamble saying these beat any agent's memory.

Rules a page already settles belong on that page, not here. Keep temporary state out: "the canary is Stripe-only until further notice" is status, not a rule.

## 2. The toolkit

```
cp ~/ngentix/harteburn/templates/scripts/brief-stamp.mjs scripts/
cp ~/ngentix/harteburn/templates/scripts/__tests__/brief.test.mjs scripts/__tests__/
```

Copy, don't fork. When the template changes, copy it again.

## 3. Compile

In a session in that repo, run `/brief`. It writes `docs/architecture/BRIEF.md` and `BRIEF-coverage.md`, and runs the gate test. Read the brief yourself, and read the compiler's list of least-certain drops.

Expect it to surface contradictions between your pages. Connector Cloud's first compile found four, including pricing. Fix the stale page, then run `/brief` again.

## 4. The answer key

Write `docs/architecture/BRIEF-questions.md`: twenty questions whose answers are rules, **written from the pages, not from the brief**. Mix headline rules with the easy-to-lose ones, the ones a compiler might fold. Then:

```
/brief score
```

Pass is 19 of 20 with the brief, and at most 5 of 20 without. On a miss, fix the compiler, never the question.

## 5. Wire the gate

Run the test on every docs change in the pre-push hook, and in the full gate. Connector Cloud's pre-push hook:

```sh
if [ -f docs/architecture/BRIEF.md ] && { [ "$has_docs" = 1 ] || printf '%s\n' "$changed_files" | grep -qE '^scripts/(__tests__/)?brief'; }; then
  run_gate "architecture brief current" \
    "run /brief; or, if no rule changed: node scripts/brief-stamp.mjs --no-rule-change" \
    node --test scripts/__tests__/brief.test.mjs
fi
```

If the gate has a "docs only, nothing to verify" early exit, run the brief test **before** it. Architecture edits are usually docs-only.

In a repo with a security-domain table, HarteBurn's own check is `.git/hooks/pre-push`, and the repo's hook is kept as `.git/hooks/pre-push.local`, which runs after it with the same input: put your gate there. A removed or changed `.git/hooks/pre-push` is put back before the agent's next command; only if that fails is the command refused, saying why. Where git runs hooks from another folder (a global or committed `core.hooksPath`, husky), nothing is written there: the session prints the shim to add, whose last line is `CLAUDE_CONFIG_DIR="<config>" exec node "<plugin>/hooks/harteburn-hook.mjs" pre-push "$0" "$@"`. It names this version's folder, so redo it after each update.

**Pages follow the code.** Add a section to `docs/architecture/README.md` headed `## When you change code, update the page`, with a table `| code path | pages |`: each cell a comma-separated list of backticked entries, a path being a glob (`*` within a folder, `**` across), a page with no folder being in `docs/architecture/`, one starting with `/` at the repo root. Start with the paths whose pages are load-bearing: migrations → the data-model page, deploy and workflows → the deployment page and the runbook. Then run the brief test on **every** push, not only docs pushes, and give it the pushed range, since a code-only push is what leaves a page untrue. Connector Cloud's pre-push hook collects `pages_ranges` from the refs it is given (`case "$range" in *..*) pages_ranges+="$range " ;; esac`) and runs:

```sh
if [ -f docs/architecture/BRIEF.md ]; then
  run_gate "architecture brief current, pages follow the code" \
    "run /brief (or --no-rule-change); for a page the map names, update it, or add a commit saying 'Pages-unchanged: <why>'" \
    env HARTEBURN_PAGES_RANGE="$pages_ranges" node --test scripts/__tests__/brief.test.mjs
fi
```

Given the range, the test judges the brief, the page map and the pages' existence as committed at each pushed tip, so another session's uncommitted edit in a shared tree cannot fail these checks. (Other gates in a hook, such as a link check that reads the tree, still can.) With no range (the full gate before a merge) it checks the working tree, and the pages check covers the branch since `origin/main`, uncommitted work included. A commit saying `Pages-unchanged: <why>` excuses only the files that commit changed. Use `--test-reporter=spec` in a hook that shows only the last lines: it prints failures last.

Also add three lines to the house rules that the skills read: `Release cadence: <train 3h | per slice | bundle>`, `Troubleshooting: <path>` (where `/retro` files each production incident) and `Personas: <each person the product serves, one clause each>` (whom Product and the Lead name in every finding; HarteBurn names none of its own).

**The threat model.** Add one architecture page for it (any number, e.g. `docs/architecture/NN-threat-model.md`): the threat model names the product's assets (what an attacker wants), its attackers (an unauthenticated visitor, another customer, a low-privilege user, an automated scanner), its entry points (every public endpoint, form, webhook and file upload), its trust boundaries (where input crosses from one owner to another; their code paths go in the house rules' security-domain paths table, below) and its sinks (a query, a shell, a template, a file path, a model's tools). Mark its rules with ⛔ like any other page; the brief carries them under "tenancy and security", and the Security role reads them first (jg 2026-10-28).

**The security-domain paths.** Add a `## Security-domain paths` table to the house rules: `| code path | what crosses |`, each path cell a comma-separated list of `backticked` globs, as in the page map (`*` within one folder, `**` across folders). List the code where the threat model's trust boundaries live: login, permissions, the public endpoints, webhooks, the code that reads secrets, the code that builds queries or shell commands. Always list four more, whatever the threat model says, because they are ways into the repo and its agents rather than into the product: the dependency manifests and lockfiles (e.g. `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `Cargo.toml`, `Cargo.lock`, `requirements*.txt`, `poetry.lock`, `go.mod`, `go.sum`; a new package can carry a published advisory), the CI config (e.g. `.github/**`, `.gitlab-ci.yml`, `.circleci/**`; it runs with the repo's secrets), what Claude Code loads in every session (`**/.claude/**`, `CLAUDE.md`, `**/CLAUDE.md`, `CLAUDE.local.md`, `**/CLAUDE.local.md`, `.mcp.json`; its hooks, permissions, MCP servers and instructions), and the compiled brief (`docs/architecture/BRIEF.md`; it is pasted into every session and every subagent) (Security, 2026-10-28). A piece of an objective whose diff changes one of these paths is refused Done on the board until a `harteburn:security` verdict covers it. The verdict is read from that run's transcript, never from a typed field. With no table, the board shows a warning and holds nothing (jg 2026-10-28).

## 6. Point to it

One line in the repo's `CLAUDE.md`:

> **HarteBurn:** settled rules are `docs/_house-rules.md`; every session and agent also gets `docs/architecture/BRIEF.md`. Changed an architecture page or a house rule? Run `/brief`, or `node scripts/brief-stamp.mjs --no-rule-change` if no rule changed.

## 7. Optional: offer the plugin from the repo

Name the marketplace and the plugin in the repo's committed `.claude/settings.json` (see [Install](install.md#offer-it-from-a-repo)). Anyone who opens the repo in Claude Code is then offered the install. Ask the owner first: it changes what every person who clones the repo sees.

## 8. Check

Start a new session in the repo and ask it to quote a rule anchor with no tools. Then edit a page without recompiling and try to push: the push should be refused, naming the page.
