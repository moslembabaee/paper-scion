#!/usr/bin/env bash
# Paper Factory — restore Scion harness configs and agent templates from git.
#
# Reinstalls everything under .factory/ into the live Scion installation:
#   .factory/harness/*    -> /root/.scion/harness-configs/{claude,antigravity}/
#   .factory/templates/*  -> /root/.scion/templates/
#
# Then syncs the templates to the Scion Hub so they are registered there.
#
# Usage: bash .factory/restore.sh [--skip-hub-sync]

set -eu

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-/root/projects/paper-scion}"
SCION_HOME="${SCION_HOME:-/root/.scion}"
SKIP_HUB_SYNC=0
[ "${1:-}" = "--skip-hub-sync" ] && SKIP_HUB_SYNC=1

echo "==> Restoring Paper Factory configuration into $SCION_HOME"

# ---------------------------------------------------------------------------
# 1. Harness configs
# ---------------------------------------------------------------------------
for h in claude antigravity; do
  src="$HERE/harness"
  dst="$SCION_HOME/harness-configs/$h"
  [ -d "$src" ] || continue
  mkdir -p "$dst"
  for f in "$src/$h."*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    name="${base#"$h."}"
    case "$name" in
      config.yaml)      cp "$f" "$dst/config.yaml" ;;
      provision.py)     cp "$f" "$dst/provision.py" ;;
      scion_harness.py) cp "$f" "$dst/scion_harness.py" ;;
      settings.json)    mkdir -p "$dst/home/.claude"; cp "$f" "$dst/home/.claude/settings.json" ;;
      claude.json)      mkdir -p "$dst/home"; cp "$f" "$dst/home/.claude.json" ;;
      *)                cp "$f" "$dst/$name" ;;
    esac
    echo "    harness/$h: $name"
  done
  # The hub keeps a copy of the global harness configs; refresh it too.
  HUB_STORE="$SCION_HOME/storage/local/hubs/22a1fd78eacb/harness-configs/global/$h"
  if [ -d "$HUB_STORE" ]; then
    for f in "$src/$h."*; do
      [ -f "$f" ] || continue
      base=$(basename "$f"); name="${base#"$h."}"
      case "$name" in
        config.yaml)      cp "$f" "$HUB_STORE/config.yaml" ;;
        provision.py)     cp "$f" "$HUB_STORE/provision.py" ;;
        scion_harness.py) cp "$f" "$HUB_STORE/scion_harness.py" ;;
        settings.json)    mkdir -p "$HUB_STORE/home/.claude"; cp "$f" "$HUB_STORE/home/.claude/settings.json" ;;
        claude.json)      mkdir -p "$HUB_STORE/home"; cp "$f" "$HUB_STORE/home/.claude.json" ;;
      esac
    done
    echo "    hub store: $h refreshed"
  fi
done

# ---------------------------------------------------------------------------
# 2. Agent templates
# ---------------------------------------------------------------------------
for t in "$HERE"/templates/*/; do
  [ -d "$t" ] || continue
  name=$(basename "$t")
  mkdir -p "$SCION_HOME/templates/$name"
  cp -f "$t"*.yaml "$t"*.md "$SCION_HOME/templates/$name/" 2>/dev/null || true
  echo "    template: $name"
done

# ---------------------------------------------------------------------------
# 3. Sync templates to the Scion Hub
# ---------------------------------------------------------------------------
if [ "$SKIP_HUB_SYNC" = "0" ]; then
  echo "==> Syncing templates to the Scion Hub"
  for t in "$HERE"/templates/*/; do
    name=$(basename "$t")
    ( cd "$PROJECT_DIR" && scion template sync "$name" ) || echo "    WARNING: sync failed for $name"
  done
fi

# ---------------------------------------------------------------------------
# 4. Notification subscription (project-wide, so no agent is missed)
# ---------------------------------------------------------------------------
if [ "$SKIP_HUB_SYNC" = "0" ]; then
  ( cd "$PROJECT_DIR" && scion notifications subscribe --project paper-scion --triggers COMPLETED,ERROR,FAILED ) \
    || echo "    (project notification subscription may already exist)"
fi

echo "==> Restore complete."
echo "    Verify: scion harness-config list && scion template list"
