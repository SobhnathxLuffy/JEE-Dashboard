#!/usr/bin/env bash
# Removes everything scripts/setup-local.sh installed:
#   - systemd --user service "jee-study" (stopped + disabled)
#   - app-menu launcher + icon
# Your study data (IndexedDB in the browser profile) is NOT touched —
# clear site data for http://localhost:3000 in the browser to wipe that too.
set -uo pipefail

SVC="jee-study"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${SVC}.service"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! \033[0m %s\n' "$*" >&2; }

if command -v systemctl >/dev/null 2>&1; then
  say "Stopping + disabling service '$SVC'"
  systemctl --user disable --now "$SVC" 2>/dev/null || warn "service was not installed"
  systemctl --user daemon-reload 2>/dev/null || true
fi

rm -f "$UNIT" "$DATA_HOME/applications/${SVC}.desktop" "$DATA_HOME/icons/${SVC}.png"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA_HOME/applications" || true

say "Removed service, launcher and icon. Browser data (IndexedDB) untouched."
say "To also wipe app data: browser -> Site settings -> clear data for http://localhost:3000"
