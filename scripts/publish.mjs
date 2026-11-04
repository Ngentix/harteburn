#!/usr/bin/env node
// HarteBurn publish: the private repo's committed tree becomes the public repo's next commit.
//
//   node scripts/publish.mjs --out <dir> [--check]
//
// <dir> is a checkout of the public repo, or an empty folder. The publish:
//   - takes only allow-listed paths from the private repo's HEAD commit (never the working tree, so an
//     uncommitted or ignored file cannot ride along);
//   - never takes a NEVER path, whatever the allow-list says;
//   - refuses symlinks and submodules on an allowed path (a link could carry private files out);
//   - reads every file first, and writes nothing if any holds a private deny-list term
//     (publish.config.json at the private repo's root, which is never published), a claude.ai artifact
//     URL, or a key; each refusal names the file, the line and the reason;
//   - in every .md file, drops `<!-- private -->` … `<!-- /private -->` blocks and unwraps `<!-- public` … `-->`
//     blocks before that scan (see `markers`; only docs/*.md, README.md and CHANGELOG.md, never a charter; a
//     marker counts inside a fenced code block too), and refuses an unpaired or nested marker;
//   - commits in <dir> on top of <dir>'s own history (no parent when <dir> has none), so no object from
//     the private history ever reaches it;
//   - never pushes. Pushing is the owner's act.
// --check writes nothing: it prints the tree it would publish and every refusal (exit 1 on any).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { globRe } from "./globs.mjs";
import { BOARD_DIR, LEGACY } from "./paths.mjs";
import { LICENSE_KEY_PREFIXES } from "./redact.mjs";

/** What the public tree may hold. A new folder stays private until someone adds it here. */
export const ALLOW = [
  ".claude-plugin/**", "agents/**", "skills/**", "hooks/**", "scripts/**", "templates/**",
  "ethos.md", "bookends.md", "budgets.json", "README.md", "LICENSE", "CHANGELOG.md", ".gitignore",
  "docs/*.md", "retros/TEMPLATE-retro.md",
];

/** Never public, whatever ALLOW or the config says. */
export const NEVER = [
  /^retros\/(?!TEMPLATE-retro\.md$)/i, /^docs\/superpowers\//i, /^docs\/reviews\//i, /^service\//i,
  new RegExp(`^\\${LEGACY.boardDir}/`, "i"), new RegExp(`^\\${BOARD_DIR}/`, "i"), /^tests\//i, /^publish\.config\.json$/i, /(^|\/)\.env(\.|$)/i,
  // They list the hosted service's open weaknesses: a map for an attacker, not for a reader of the plugin.
  /^docs\/harteburn-security-[^/]*\.md$/i, /^docs\/triage\.md$/i,
];

/** Content no public file may hold. The customer names come from the private config, never from here. */
export const LEAKS = [
  ["a claude.ai artifact URL", /claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]{8,}/i],
  ["a Stripe secret key", /\b[sr]k_live_[A-Za-z0-9]{12,}/],
  ["a Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{12,}/],
  ["a HarteBurn license key", new RegExp(`\\b(?:${LICENSE_KEY_PREFIXES.join("|")})_[A-Za-z0-9_-]{20,}`)],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["a Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{30,}/],
  ["an OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
];
/** Files published as bytes; every other allowed file must be valid UTF-8 text (a stray encoding could hide a term from the scan). */
const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?)$/i;

/** The two markdown markers, each exactly a whole line (a trailing CR aside; an indented or trailing-text look-alike is prose):
 *  `<!-- private -->` … `<!-- /private -->`  dropped, markers included (dev-only prose);
 *  `<!-- public` … `-->`                     unwrapped: the markers go, the lines between stay (a comment in
 *                                             the private repo, prose in the public tree).
 *  Blocks never nest. A marker with no partner, or a marker inside a block, refuses with its line. */
export const PRIVATE_OPEN = /^<!-- private -->\r?$/, PRIVATE_CLOSE = /^<!-- \/private -->\r?$/;
export const PUBLIC_OPEN = /^<!-- public\r?$/, PUBLIC_CLOSE = /^-->\r?$/;
/** Where the markers apply: the pages and the changelog. Never a charter, a skill or the ethos: what a
 *  session's model reads is published as read, so the public repo can audit it (Security on piece 2). */
export const MARKED = ["docs/*.md", "README.md", "CHANGELOG.md"].map((g) => globRe(g));
export function markers(lines) {
  const out = [];
  let open = null; // { kind: "private" | "public", line }
  // A marker counts inside a fenced code block too (the reference page's layout block hides its tests/ line
  // that way); an example of the syntax in a doc is written indented, which is prose.
  for (const l of lines) {
    const t = l.text;
    if (PRIVATE_OPEN.test(t)) {
      if (open) return { error: `a private block opens inside the ${open.kind} block opened on line ${open.line}; blocks never nest`, line: l.n };
      open = { kind: "private", line: l.n };
    } else if (PRIVATE_CLOSE.test(t)) {
      if (!open) return { error: "a private block closes here but none is open", line: l.n };
      if (open.kind !== "private") return { error: `a private block closes inside the public block opened on line ${open.line}`, line: l.n };
      open = null;
    } else if (PUBLIC_OPEN.test(t)) {
      if (open) return { error: `a public block opens inside the ${open.kind} block opened on line ${open.line}; blocks never nest`, line: l.n };
      open = { kind: "public", line: l.n };
    } else if (open?.kind === "public" && PUBLIC_CLOSE.test(t)) {
      open = null;
    } else if (open?.kind !== "private") {
      out.push(l);
    }
  }
  if (open) return { error: `the ${open.kind} block opened here never closes`, line: open.line };
  return { lines: out };
}

const git = (cwd, args, opts = {}) =>
  execFileSync("git", args, { cwd, encoding: opts.encoding ?? "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });

/** The private config, read from HEAD. Fails closed: with no deny list there is no publish. */
function config(root) {
  let raw;
  try {
    raw = git(root, ["show", "HEAD:publish.config.json"]);
  } catch {
    return { error: "publish.config.json is not in the private repo's HEAD commit: commit it with the deny list (the customer names no public file may hold)" };
  }
  let c;
  try {
    c = JSON.parse(raw);
  } catch (e) {
    return { error: `publish.config.json does not parse (${e.message}): fix it and commit` };
  }
  const deny = (Array.isArray(c.deny) ? c.deny : []).map(String).map((t) => t.trim()).filter(Boolean);
  if (!deny.length) return { error: "publish.config.json has no deny terms: list the customer names no public file may hold" };
  return { deny, allow: (Array.isArray(c.allow) ? c.allow : []).map(String).filter(Boolean) };
}

/** The files the public tree would hold, read from HEAD, plus every refusal. */
export function plan(root) {
  const cfg = config(root);
  if (cfg.error) return { files: [], refusals: [cfg.error] };
  const allow = [...ALLOW, ...cfg.allow].map((g) => globRe(g));
  const entries = git(root, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]).split("\0").filter(Boolean).map((l) => {
    const [meta, path] = l.split("\t");
    const [mode, type, sha] = meta.split(" ");
    return { mode, type, sha, path };
  });
  const files = [];
  const refusals = [];
  const terms = cfg.deny.map((t) => [t, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")]);
  for (const e of entries) {
    if (NEVER.some((re) => re.test(e.path)) || !allow.some((re) => re.test(e.path))) continue;
    if (e.mode === "120000" || e.type === "commit") {
      refusals.push(`${e.path}: a ${e.mode === "120000" ? "symlink" : "submodule"} cannot be published (it could carry files from outside the allow-list)`);
      continue;
    }
    for (const [t, re] of terms) if (re.test(e.path)) refusals.push(`${e.path}: its path names "${t}", a term on the private deny list`);
    for (const [why, re] of LEAKS) if (re.test(e.path)) refusals.push(`${e.path}: its path holds ${why}`);
    const body0 = git(root, ["cat-file", "blob", e.sha], { encoding: "buffer" });
    if (!BINARY.test(e.path) && !Buffer.from(body0.toString("utf8"), "utf8").equals(body0)) {
      refusals.push(`${e.path}: is not valid UTF-8 text (a text file is published only when every byte reads; a binary needs a listed extension)`);
      continue;
    }
    let body = body0;
    // Markdown is published after its private blocks are dropped and its public blocks unwrapped, and
    // scanned after, so a private block may name what the public tree never may.
    let lines = body.toString("utf8").split("\n").map((text, i) => ({ text, n: i + 1 }));
    if (MARKED.some((re) => re.test(e.path))) {
      const m = markers(lines);
      if (m.error) { refusals.push(`${e.path}:${m.line}: ${m.error}`); continue; }
      lines = m.lines;
      body = Buffer.from(lines.map((l) => l.text).join("\n"), "utf8");
    }
    for (const { text: line, n } of lines) {
      for (const [t, re] of terms) if (re.test(line)) refusals.push(`${e.path}:${n}: names "${t}", a term on the private deny list`);
      for (const [why, re] of LEAKS) if (re.test(line)) refusals.push(`${e.path}:${n}: holds ${why}`);
    }
    files.push({ path: e.path, mode: e.mode, body });
  }
  return { files, refusals };
}

function clear(dir) {
  for (const f of readdirSync(dir)) if (f !== ".git") rmSync(join(dir, f), { recursive: true, force: true });
}

/** Why <dir> cannot receive a publish, or "". It must be outside the private repo, and a public
 * checkout or an empty folder: clearing anything else would delete files nobody meant to publish over. */
export function unsafeOut(root, out) {
  if (!out) return "--out needs a folder: a checkout of the public repo, or an empty folder";
  const r = resolve(root), o = resolve(out);
  if (o === r || o.startsWith(r + sep) || r.startsWith(o + sep)) return `${o} is the private repo, inside it or above it: give a public checkout outside it`;
  if (existsSync(o) && !existsSync(join(o, ".git")) && readdirSync(o).length) return `${o} has files but is not a git checkout: give the public repo's checkout, or an empty folder`;
  return "";
}

export function publish(root, out, { check = false } = {}) {
  const unsafe = unsafeOut(root, out);
  if (unsafe) return { code: 2, lines: [`HarteBurn publish refused: ${unsafe}. Nothing was written.`] };
  const { files, refusals } = plan(root);
  const lines = [];
  if (refusals.length) {
    lines.push(`HarteBurn publish refused (${refusals.length}): nothing was written.`, ...refusals.map((r) => `- ${r}`));
    return { code: 1, lines };
  }
  if (check) {
    lines.push(`HarteBurn publish would write ${files.length} files:`, ...files.map((f) => `  ${f.path}`));
    return { code: 0, lines };
  }
  mkdirSync(out, { recursive: true });
  if (!existsSync(join(out, ".git"))) git(out, ["init", "-q", "-b", "main"]);
  clear(out);
  for (const f of files) {
    const dest = join(out, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.body, { mode: f.mode === "100755" ? 0o755 : 0o644 });
  }
  git(out, ["add", "-A"]);
  const changed = git(out, ["status", "--porcelain"]).trim();
  if (!changed) {
    lines.push("HarteBurn publish: the public tree already matches; no commit made.");
    return { code: 0, lines };
  }
  const version = (() => {
    try { return JSON.parse(readFileSync(join(out, ".claude-plugin/plugin.json"), "utf8")).version || ""; } catch { return ""; }
  })();
  // The message names no private commit (Security, piece 1). A checkout with no git identity gets the publish's own.
  const identity = (() => { try { git(out, ["config", "user.email"]); return []; } catch { return ["-c", "user.name=HarteBurn publish", "-c", "user.email=publish@ngentix.ai"]; } })();
  git(out, [...identity, "commit", "-q", "-m", `Publish HarteBurn${version ? " " + version : ""}`, "-m", `${files.length} files from the private repo.`]);
  lines.push(`HarteBurn publish: ${files.length} files committed in ${out} (not pushed; pushing is the owner's act).`);
  return { code: 0, lines };
}

const invoked = process.argv[1] && resolve(process.argv[1]).endsWith("publish.mjs");
if (invoked) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const value = at >= 0 ? args[at + 1] : undefined;
  if (!value || value.startsWith("--")) {
    console.error("usage: node scripts/publish.mjs --out <public checkout or empty folder> [--check]");
    process.exit(2);
  }
  const out = resolve(value);
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const r = publish(root, out, { check: args.includes("--check") });
  (r.code ? console.error : console.log)(r.lines.join("\n"));
  process.exit(r.code);
}
