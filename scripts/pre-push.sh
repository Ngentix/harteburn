#!/bin/sh
# HarteBurn's pre-push check, put here by the plugin because this repo has a security-domain table.
# The same bytes in every repo and version. A pre-push this repo had before is pre-push.local beside it,
# run after this check passes. Builtins only until node: git, sed and the like may not be on PATH.
no() {
  echo "HarteBurn's pre-push check $1, so this push is refused. To push without the check, type in your own terminal: git push --no-verify$2" >&2
  exit 1
}
# HarteBurn uninstalled: the undo puts the repo's own hook back, or removes this one.
gone() {
  a=$(cd "$h" && pwd -P)
  if [ -f "$h/pre-push.local" ]; then u="mv $a/pre-push.local $a/pre-push"; else u="rm $a/pre-push"; fi
  no "could not find HarteBurn (named in $f)" "; to remove the check: $u"
}
# From inside the git dir git runs the hook as hooks/pre-push: the hooks folder's parent is then "."
case $0 in */*) h=${0%/*} ;; *) h=. ;; esac
case $h in */*) f=${h%/*}/harteburn/plugin-root ;; *) f=harteburn/plugin-root ;; esac
r= k=
[ -f "$f" ] && { read -r r; read -r k; } < "$f"
[ -n "$r" ] && [ -f "$r/hooks/harteburn-hook.mjs" ] || gone
command -v node >/dev/null 2>&1 || no "needs node on PATH"
[ -n "$k" ] || no "could not read its settings (in $f)"
# The transcripts folder is the one the session recorded, never the pushing environment's.
# The repo's own hook gets the value it had (HARTEBURN_OUTER_CCD: + and the value, or - for unset).
if [ "${CLAUDE_CONFIG_DIR+set}" = set ]; then HARTEBURN_OUTER_CCD=+$CLAUDE_CONFIG_DIR; else HARTEBURN_OUTER_CCD=-; fi
CLAUDE_CONFIG_DIR=$k
export CLAUDE_CONFIG_DIR HARTEBURN_OUTER_CCD
exec node "$r/hooks/harteburn-hook.mjs" pre-push "$0" "$@"
