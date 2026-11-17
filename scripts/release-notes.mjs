#!/usr/bin/env node
// HarteBurn's release notes to the dev channel (rc-slack, jg 2026-10-28; public posts jg 2026-11-13).
//
//   node scripts/release-notes.mjs <version> [--public] [--dry-run]       post one version's notes (needs SLACK_WEBHOOK)
//   node scripts/release-notes.mjs --since <sha> [--public] [--dry-run]   post what a push released
//
// A release is a push to main that changes .claude-plugin/plugin.json's version (no tags); the notes
// are that version's "## <version>" section of CHANGELOG.md.
//   - The private tree (no --public): one post per version, "built (not yet public)", no update line:
//     a user cannot install it until it is published.
//   - The public tree (--public, the workflow passes it there): one post, "published", holding every
//     CHANGELOG section after the version the public tree held before the push, newest first, then the
//     update line. A publish can skip versions; each one it carries is named.
// Nothing is deployed, so a post never says "verified". `--dry-run` prints each payload as one JSON
// line and posts nothing.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { markers } from "./publish.mjs";

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
  // A <!-- private --> block never posts, and a <!-- public … --> block posts unwrapped, as publish does
  // (Security F2, 2026-11-13); a section whose markers do not pair posts no notes rather than a guess.
  const kept = markers(lines.slice(start + 1, end).map((text, i) => ({ text, n: start + 2 + i })));
  if (kept.error) return "";
  return kept.lines.map((l) => l.text).join("\n").trim();
}

/** The Slack text for one private build: not installable until it is published, so no update line. */
export function slackText(version, changelog) {
  const notes = section(changelog, version);
  const head = `*HarteBurn ${escapeSlack(version)}* built (not yet public)`;
  return notes ? `${head}\n${mrkdwn(notes)}` : `${head} (the changelog has no notes for ${escapeSlack(version)})`;
}

/** -1, 0 or 1 for two x.y.z versions; a part that is not a number counts as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The CHANGELOG's versions after `before` up to and including `head`, newest first; `head` alone when `before` is ''. */
export function versionsBetween(changelog, before, head) {
  if (!head) return [];
  if (!before) return [head];
  const all = (changelog || "").split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).split(/\s/)[0]);
  const out = [];
  for (const v of all) if (compareVersions(v, before) > 0 && compareVersions(v, head) <= 0 && !out.includes(v)) out.push(v);
  if (!out.includes(head)) out.unshift(head);
  return out.sort((x, y) => compareVersions(y, x));
}

/** The Slack text for one public release: every version it carries, newest first, then how to update. */
export function publicText(versions, changelog) {
  const [head] = versions;
  const title = `*HarteBurn ${escapeSlack(head)}* published`;
  if (versions.length === 1) {
    const notes = section(changelog, head);
    return notes ? `${title}\n${mrkdwn(notes)}\n\n${UPDATE}` : `${title} (the changelog has no notes for ${escapeSlack(head)})\n\n${UPDATE}`;
  }
  const parts = versions.map((v) => {
    const notes = section(changelog, v);
    return `*${escapeSlack(v)}*\n${notes ? mrkdwn(notes) : "(the changelog has no notes for this version)"}`;
  });
  const oldest = versions[versions.length - 1];
  return `${title}, with every version since the last publish (${escapeSlack(oldest)} to ${escapeSlack(head)})\n\n${parts.join("\n\n")}\n\n${UPDATE}`;
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

/** The public tree's release from `since` to HEAD: the versions it carries, newest first ([] when the version did not change). */
export function publishedSince(cwd, since, changelog) {
  const head = versionAt(cwd, "HEAD");
  let before = "";
  try {
    git(cwd, "cat-file", "-e", `${since}^{commit}`);
    before = versionAt(cwd, since);
  } catch {}
  if (!head || head === before) return [];
  return versionsBetween(changelog, before, head);
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
  const pub = args.includes("--public");
  const rest = args.filter((a) => a !== "--dry-run" && a !== "--public");
  const cwd = process.cwd();
  let changelog = "";
  try {
    changelog = readFileSync(join(cwd, "CHANGELOG.md"), "utf8");
  } catch {}
  let versions;
  if (rest[0] === "--since") {
    if (!rest[1]) {
      console.error("usage: node scripts/release-notes.mjs --since <sha> [--public] [--dry-run]");
      process.exit(2);
    }
    versions = pub ? publishedSince(cwd, rest[1], changelog) : releasedSince(cwd, rest[1]);
  } else if (rest[0]) versions = [rest[0]];
  else {
    console.error("usage: node scripts/release-notes.mjs <version> | --since <sha> [--public] [--dry-run]");
    process.exit(2);
  }
  const texts = pub ? (versions.length ? [[versions[0], publicText(versions, changelog)]] : []) : versions.map((v) => [v, slackText(v, changelog)]);
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
