# Install

HarteBurn is a **Claude Code plugin**. **Read [limitations](limitations.md) first**: it is complete only where Claude Code runs with plugins (the terminal, the desktop app's Code tab in a local session, VS Code, JetBrains, the Agent SDK). Elsewhere you build one from the product repo with `scripts/export.mjs`: a claude.ai Project kit, or files for Cursor, GitHub Copilot, Codex, Gemini and any tool that reads AGENTS.md, each with less of HarteBurn, and each says exactly what.

Installing it costs nothing. A "marketplace" is only a catalogue file. This repo is its own marketplace, named `ngentix`, with one plugin, `harteburn`.

## Before you start

The release repository, `Ngentix/harteburn`, is public. No GitHub login is required.

## One machine, every surface

On one computer, **the terminal, the desktop app's local Code sessions, VS Code and JetBrains share the same settings**. Install HarteBurn at user scope on any one of them and it applies to all of them, in every repo.

### Terminal (recommended)

```
claude plugin marketplace add Ngentix/harteburn
claude plugin install harteburn@ngentix
```

A checkout of the release works too:

```
git clone https://github.com/Ngentix/harteburn ~/ngentix/harteburn
claude plugin marketplace add ~/ngentix/harteburn
claude plugin install harteburn@ngentix
```

Check it:

```
claude plugin list            # harteburn@ngentix · enabled
claude plugin details harteburn@ngentix
```

**Start a new session.** A session that was already open does not load a newly installed plugin.

### Claude desktop app, Code tab

The Code tab runs Claude Code inside the desktop app, and **local** Code sessions get the full HarteBurn. One thing the desktop app does not document is a button for adding a marketplace. So the reliable route is a one-time copy-paste in Terminal; after that, the Code tab simply has HarteBurn.

**Step 1 — one time, in the Terminal app** (Applications → Utilities → Terminal). Paste these lines, pressing Return after each:

```
claude plugin marketplace add Ngentix/harteburn
claude plugin install harteburn@ngentix
```

- If `claude` is "command not found", install Claude Code first from [code.claude.com](https://code.claude.com). If you only have the desktop app and no `claude` command, use step 1b instead.
- You should see `✔ Successfully installed plugin: harteburn@ngentix (scope: user)`.

**Step 1b — no Terminal: from the desktop app** (route documented by Anthropic, not yet tried by us). In a Code tab local session, click **+** next to the prompt box → **Plugins** → **Add plugin**. If **harteburn** from **ngentix** is listed, select it, choose **User** scope (every project on this computer), and install. If it is not listed, the marketplace has to be added first, and the desktop app has no documented button for that. Use step 1, or ask someone to do it once for you.

**Step 2 — quit and reopen the Claude desktop app.** Plugins load when a session starts.

**Step 3 — check it.** In the Code tab, open a **local** session in a repo that has a brief (Connector Cloud), and type:

> Using no tools, quote rule [B3] of the architecture brief.

You should get the rule word for word. To see what is installed: **+** → **Plugins** → **Manage plugins**.

**Limits in the desktop app:**
- **Cloud sessions** in the Code tab do not get plugins installed on your computer. Use a local session.
- **WSL sessions** (Windows): plugins are not available.
- The Terminal, the desktop Code tab and VS Code share the same settings on one computer. Installing in one installs it in all three.

### Cowork (desktop app)

Cowork loads plugin agents and hooks, so HarteBurn may run there, close to fully. **Not yet tried by us.** If you try it, check that a session can quote rule [B3] before relying on it.

### VS Code

Type `/plugins` in the Claude Code prompt box to open **Manage plugins**, add the marketplace `Ngentix/harteburn`, and install **harteburn**. Plugins configured in the extension are also available in the terminal, and the other way round.

### JetBrains

The JetBrains plugin runs Claude Code in the IDE's terminal. Use the terminal steps there.

### Claude Code on the web and cloud sessions

A cloud session **does not load** plugins installed on your own machine, or ones a repo's `.claude/settings.json` turns on. The only route there is organization-managed settings, below. Whether a cloud session can reach a private GitHub marketplace is not documented.

### Agent SDK

Point the SDK at a local copy of the plugin. The SDK accepts only `type: "local"`:

```ts
plugins: [{ type: "local", path: "/Users/you/ngentix/harteburn" }]
```

An installed copy also works: `~/.claude/plugins/cache/ngentix/harteburn/<version>`.

## Organization-wide (Team and Enterprise)

An Owner can put HarteBurn on every member's machine through **managed settings**: Organization settings → Claude Code → Managed settings, MDM, or a `managed-settings.json` file:

```json
{
  "extraKnownMarketplaces": {
    "ngentix": { "source": { "source": "github", "repo": "Ngentix/harteburn" } }
  },
  "enabledPlugins": { "harteburn@ngentix": true }
}
```

Claude Code registers the marketplace and installs the plugin at the start of each member's next session. Each member still needs read access to the repo. This is also the only documented route into cloud sessions.

## Offer it from a repo

A repo can name the plugin in its committed `.claude/settings.json`, the same two keys as above, so anyone who opens that repo in Claude Code is offered the install. Connector Cloud does not do this yet (owner's decision pending).

## Update

An install is a **copy** pinned to a commit, at `~/.claude/plugins/cache/ngentix/harteburn/<version>`. It is not a live link to your clone, so a new version reaches you only through:

```
claude plugin marketplace update ngentix
claude plugin update harteburn@ngentix
```

Then restart, or run `/reload-plugins`. To turn on auto-update for this marketplace: `/plugin` → Marketplaces → Enable auto-update.

**Added from a folder** (`claude plugin marketplace add ~/ngentix/harteburn`), sessions load HarteBurn from that folder: a new session gets whatever the checkout holds, and no `plugin update` is needed. The cache entry in `installed_plugins.json` may show an older version; it is not what loads. Proven 2026-10-27: the 0.16.0 cache had no `designer.md`, and new sessions in connector-cloud and a project-website dispatched `harteburn:designer` from the 0.20.0 folder.

**Headless runs** (`claude -p`) in a repo you have never opened interactively ignore that repo's `.claude/settings.json` allow list until you accept its trust dialog once. HarteBurn still loads; only the repo's own allowed commands prompt or fail.

## Turn it off or remove it

```
claude plugin disable harteburn@ngentix     # keep it, stop it loading
claude plugin enable harteburn@ngentix
claude plugin uninstall harteburn@ngentix
claude plugin marketplace remove ngentix
```

## Check it works

In a repo that has a brief, such as Connector Cloud, start a new session and ask:

> Using no tools, quote rule [B3] of the architecture brief.

You should get the rule verbatim. In any repo, the session's first checklist line names the HarteBurn roles it convened, and those it excused.

## Not Claude Code: claude.ai chat, Cursor, Copilot and others

- **claude.ai chat or the desktop app's chat:** the plugin does not run there (no hooks, no agents in chat). Use the **Project kit** instead: [Projects](projects.md).
- **Cursor, GitHub Copilot, Codex, Gemini, Windsurf and others:** use the export, which writes HarteBurn into each tool's own files: [Other tools](other-tools.md).

Both are built from the product repo with `scripts/export.mjs`; HarteBurn keeps no per-product copies.
