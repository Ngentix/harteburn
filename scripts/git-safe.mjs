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
