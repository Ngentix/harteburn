// What HarteBurn keeps under <git dir>/harteburn, and what everything else there is (rc-disk, jg 2026-10-28).
// The steward proposes scratch and worktrees for removal once their objective is past, and asks first;
// it never proposes a kept name. docs/reference.md "Files HarteBurn writes in a repo" shows the same list.

/** Each kept name: an exact name or a glob (`*` = any run of characters). `dir` names a directory. */
export const KEEP = [
  { name: "ledger.jsonl", why: "every dispatch; the board's runs and /retro read it" },
  { name: "log-*.jsonl", why: "each objective's finished work; /retro and open-changes read it" },
  { name: "stamps-*.json", why: "the board's own stamps for each record" },
  { name: "open-record.json", why: "this tree's open objective, which dates what is past" },
  { name: "steward.last", why: "the steward's last run and its result" },
  { name: "steward.jsonl", why: "every sweep's result, read across objectives" },
  { name: "steward-always.json", why: "the owner's standing answers for this repo" },
  { name: "steward-ask.json", why: "what the steward is asking the owner, and what was declined" },
  { name: "rounds.jsonl", why: "the Prover's round chain" },
  { name: "ci-releases.jsonl", why: "released versions the gate compares against" },
  { name: "legs.jsonl", why: "a run's measured legs" },
  { name: "brief-score.json", why: "the brief's last faithfulness score" },
  { name: "ide-board-opened", why: "the board preview opens once per session" },
  { name: "prover-wt", dir: true, why: "the Prover's warm worktree; a cold one costs a full build" },
];

const pattern = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
const KEPT = KEEP.map((k) => ({ re: pattern(k.name), dir: !!k.dir }));

/** "link" | "keep" | "worktree" | "dir" | "scratch" for one entry of <git dir>/harteburn. A link may point
 * at another repo, so it is only ever listed. */
export function classify(name, { dir = false, worktree = false, link = false } = {}) {
  if (link) return "link";
  const isDir = dir || worktree;
  if (KEPT.some((k) => k.dir === isDir && k.re.test(name))) return "keep";
  if (worktree) return "worktree";
  return isDir ? "dir" : "scratch";
}
