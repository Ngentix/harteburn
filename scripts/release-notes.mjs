#!/usr/bin/env node
// HarteBurn's releases to the dev channel (rc-slack, jg 2026-10-28): every version that reaches main
// posts its CHANGELOG section to Slack, ending with how to update.
//
//   node scripts/release-notes.mjs <version> [--dry-run]       post one version's notes (needs SLACK_WEBHOOK)
//   node scripts/release-notes.mjs --since <sha> [--dry-run]   post each version a push released, oldest first
//
// A release is a push to main that changes .claude-plugin/plugin.json's version (no tags); the notes
// are that version's "## <version>" section of CHANGELOG.md. Prior art: connector-cloud's
// scripts/release-notes.mjs (its escaping and bullets). Nothing is deployed, so a post says
// "released", never "verified". `--dry-run` prints each payload as one JSON line and posts nothing.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const UPDATE = "Update: claude plugin update harteburn@ngentix, then reload";
const PLUGIN_JSON = ".claude-plugin/plugin.json";

// Slack's mrkdwn treats & < > as control characters; everything else is literal.
const escapeSlack = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** CHANGELOG Markdown as Slack mrkdwn: **bold** is *bold*, a `- ` item is a bullet. */
const mrkdwn = (s) => escapeSlack(s).replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^- /gm, "• ");

/** The body of `version`'s "## <version>" section, '' when the changelog has none. */
export function section(changelog, version) {
  const lines = (changelog || "").split("\n");
  const head = (l) => l.startsWith("## ") && l.slice(3).split(/\s/)[0] === version;
  const start = lines.findIndex(head);
  if (start < 0) return "";
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

/** The Slack text for one version. */
export function slackText(version, changelog) {
  const notes = section(changelog, version);
  const head = `*HarteBurn ${escapeSlack(version)}* released`;
  return notes ? `${head}\n${mrkdwn(notes)}\n\n${UPDATE}` : `${head} (the changelog has no notes for ${escapeSlack(version)})\n\n${UPDATE}`;
}

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** plugin.json's version at `rev`, or '' when there is none there. */
function versionAt(cwd, rev) {
  try {
    return JSON.parse(git(cwd, "show", `${rev}:${PLUGIN_JSON}`)).version || "";
  } catch {
    return "";
  }
}

/**
 * The versions a push from `since` to HEAD released, oldest first: each version plugin.json held
 * along the way that `since` did not. A `since` git cannot read (all zeros for a new branch, or a
 * commit this clone lacks) releases HEAD's version only.
 */
export function releasedSince(cwd, since) {
  const head = versionAt(cwd, "HEAD");
  let before = "";
  let revs = [];
  try {
    git(cwd, "cat-file", "-e", `${since}^{commit}`);
    before = versionAt(cwd, since);
    revs = git(cwd, "log", "--reverse", "--format=%H", `${since}..HEAD`, "--", PLUGIN_JSON).split("\n").filter(Boolean);
  } catch {
    return head ? [head] : [];
  }
  // A push that ends on `since`'s version (a bump reverted) released nothing.
  if (!head || head === before) return [];
  const out = [];
  for (const v of revs.map((r) => versionAt(cwd, r))) if (v && v !== before && !out.includes(v)) out.push(v);
  return out;
}

/** POST `text` to the dev channel; true when Slack took it. */
async function post(hook, text, version) {
  const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) {
    console.error(`Slack refused the release notes for ${version}: HTTP ${res.status} ${await res.text()}`);
    return false;
  }
  console.log(`release notes for ${version} posted`);
  return true;
}

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (process.argv[1] && isMain()) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const rest = args.filter((a) => a !== "--dry-run");
  const cwd = process.cwd();
  let versions;
  if (rest[0] === "--since") {
    if (!rest[1]) {
      console.error("usage: node scripts/release-notes.mjs --since <sha> [--dry-run]");
      process.exit(2);
    }
    versions = releasedSince(cwd, rest[1]);
  } else if (rest[0]) versions = [rest[0]];
  else {
    console.error("usage: node scripts/release-notes.mjs <version> | --since <sha> [--dry-run]");
    process.exit(2);
  }
  let changelog = "";
  try {
    changelog = readFileSync(join(cwd, "CHANGELOG.md"), "utf8");
  } catch {}
  const texts = versions.map((v) => [v, slackText(v, changelog)]);
  if (dry) {
    for (const [, text] of texts) console.log(JSON.stringify({ text }));
    process.exit(0);
  }
  const hook = process.env.SLACK_WEBHOOK;
  if (texts.length && !hook) {
    console.error("SLACK_WEBHOOK is not set; nothing posted");
    process.exit(1);
  }
  let ok = true;
  for (const [v, text] of texts) ok = (await post(hook, text, v)) && ok;
  process.exit(ok ? 0 : 1);
}
