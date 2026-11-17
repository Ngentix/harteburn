import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";

// The git the gate runs: one only root can change, file and every folder above it, so a git planted first on
// PATH (Homebrew's folder is the user's own) never answers for it (automated review of 619a8fa; Architect).
// None such: a path that fails, read as git that cannot run (jg 2026-11-02, option A).
const rootOnly = (p) => {
  try {
    for (let f = realpathSync(p); ; f = dirname(f)) {
      const s = statSync(f);
      if (s.uid !== 0 || s.mode & 0o022) return false;
      if (f === "/") return true;
    }
  } catch { return false; }
};
export const trustedGit = (candidates = ["/usr/bin/git", "/bin/git"]) => candidates.find(rootOnly);
export let GIT = trustedGit() || "/usr/bin/git";
/** Tests only, loaded in-process (tests/fixtures/git-seam.mjs): no environment variable chooses git (jg 2026-10-30). */
export const setGit = (p) => { GIT = p; };
/** Apple's /usr/bin/git runs the git DEVELOPER_DIR names, and GIT_EXEC_PATH picks its subcommands (Architect on 619a8fa). */
export const gitEnv = ({ DEVELOPER_DIR, GIT_EXEC_PATH, ...env }) => env;

// No transport at all for a read-only query. A repo's protocol.<name>.allow beats protocol.allow, so each
// built-in transport is named too (automated reviews of 44ced9b and the lag hook, 2026-11-12); a remote
// helper by another name must already be on PATH. Pair it with GIT_NO_LAZY_FETCH=1 in the env. The hook uses
// it; board-security.mjs keeps its own literal SAFE (pinned by its tests), held equal by tests/lag.test.mjs.
export const TRANSPORTS = ["file", "ext", "ssh", "git", "http", "https", "ftp", "ftps", "fd"];
export const SAFE_ARGS = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", ...TRANSPORTS.flatMap((p) => ["-c", `protocol.${p}.allow=never`])];

/** SAFE_ARGS can name only the built-in transports; a repo's protocol.<custom>.allow still beats protocol.allow.
 * Returns `base` plus GIT_CONFIG_KEY/VALUE pairs that set every protocol.<name>.allow the repo's config names
 * back to never, as board-security.mjs's filtersOff does (automated review of 6c19ea8, 2026-11-12). Throws
 * (fail closed) when git cannot read the config, or ignores the pairs (git older than 2.31). */
/** A planted include can name a FIFO and block git forever (Security F2): every read-only git call is cut off. */
export const GIT_TIMEOUT_MS = 5000;

export function protocolResetEnv(cwd, inherited) {
  // An inherited GIT_CONFIG_PARAMETERS beats the GIT_CONFIG_* pairs, so it cannot be reset, only dropped
  // (Security F1): a read-only query needs none of the owner's command-line config.
  const { GIT_CONFIG_PARAMETERS, ...base } = inherited;
  const run = (args, env) => execFileSync(GIT, [...SAFE_ARGS, ...args], { cwd, env: { ...gitEnv(env), GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS });
  let keys = [];
  try {
    // Every scope, the command line's too, as the board does; our own SAFE_ARGS keys just get `never` twice.
    keys = run(["config", "-z", "--name-only", "--get-regexp", "^protocol\\..+\\.allow$"], base).split("\0").filter(Boolean);
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = no such key; anything else (a timeout too) is a config git cannot read
  }
  const env = { ...base, GIT_CONFIG_COUNT: String(keys.length) };
  keys.forEach((k, i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = "never"; });
  // The check reads a key SAFE_ARGS does not set: one of ours reads back never even from a git that
  // ignores the pairs. None such: nothing to reset beyond SAFE_ARGS.
  const ours = new Set(TRANSPORTS.map((p) => `protocol.${p}.allow`));
  const probe = keys.find((k) => !ours.has(k));
  if (probe && run(["config", "-z", "--show-scope", "--get", probe], env) !== "command\0never\0") {
    throw new Error("git did not take the protocol reset (git 2.31 or later is needed)");
  }
  return env;
}
