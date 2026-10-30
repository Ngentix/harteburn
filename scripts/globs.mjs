// Path globs and the two-column path tables, for the plugin's own scripts (rc-security piece 3).
// templates/scripts/brief-stamp.mjs keeps its own copy of globRe and the cell parser, because it is
// copied into each repo and must run without the plugin; tests/board-security.test.mjs holds the two
// globRe copies equal (the cell parser's two copies are three lines each, and not compared).

// * stays inside one folder; ** crosses folders ("deploy/**" matches deploy/a/b.tf).
export function globRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // Case-insensitive: on a case-insensitive disk `Claude.md` is `CLAUDE.md` (Security round 16); it only ever holds more.
  return new RegExp(`^${re}$`, "i");
}

/** A table cell as its comma-separated entries, backticks removed. */
export const cellItems = (cell) =>
  cell
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, "").trim())
    .filter(Boolean);

/**
 * The rows of the table under the `## ` heading `heading` matches, as { paths, rest }: the first
 * cell's globs and the other cells' text. The header row (first cell `code path`) and the rule row
 * are skipped. Returns null when there is no such heading, so "no table" and "an empty table" differ.
 */
export function parsePathTable(text, heading) {
  let inside = false, found = false;
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (/^## /.test(line)) {
      inside = heading.test(line);
      found ||= inside;
    }
    if (!inside || !line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 2 || /^\s*code path\s*$/i.test(cells[0])) continue;
    const paths = cellItems(cells[0]);
    if (paths.length) rows.push({ paths, rest: cells.slice(1).map((c) => c.trim()) });
  }
  return found ? rows : null;
}
