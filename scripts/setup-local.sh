#!/usr/bin/env bash
# ============================================================================
# JEE Study App — one-command local setup (Arch Linux, or any systemd distro)
#
#   ./scripts/setup-local.sh
#
# What it does:
#   1. Installs dependencies (bun if present, else npm)
#   2. Builds the production bundle (Next.js standalone output)
#   3. Installs a systemd --user service: starts at login, restarts on crash,
#      binds to 127.0.0.1 only (never exposed to your LAN)
#   4. Creates a "JEE Study" entry in your app menu (own app window if a
#      Chromium-based browser is installed)
#   5. Health-checks the server before declaring success
#
# Re-run any time after `git pull` — everything is idempotent.
#
# Options:
#   JEE_PORT=3000    port to serve on (default 3000)
#   JEE_SKIP_BUILD=1 skip deps+build (only reinstall service/launcher)
# ============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${JEE_PORT:-3000}"
URL="http://localhost:${PORT}"
SVC="jee-study"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! \033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. runtime checks ------------------------------------------------------
command -v node >/dev/null 2>&1 \
  || die "node not found. On Arch:  sudo pacman -S nodejs npm"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "node >= 20 required, found $(node -v). On Arch:  sudo pacman -S nodejs npm"

# --- 2. dependencies + build ------------------------------------------------
cd "$APP_DIR"
if [ "${JEE_SKIP_BUILD:-0}" != "1" ]; then
  if command -v bun >/dev/null 2>&1 && [ -f bun.lock ]; then
    say "Installing dependencies (bun)"
    bun install
  elif [ -f package-lock.json ]; then
    say "Installing dependencies (npm ci)"
    npm ci || { warn "npm ci failed — falling back to npm install"; npm install; }
  else
    say "Installing dependencies (npm install)"
    npm install
  fi

  say "Building production bundle (takes a minute)"
  npm run build
else
  warn "JEE_SKIP_BUILD=1 — skipping deps + build"
fi

SERVER_JS="$APP_DIR/.next/standalone/server.js"
[ -f "$SERVER_JS" ] || die "standalone build not found at $SERVER_JS — run without JEE_SKIP_BUILD"

# --- 3. systemd user service ------------------------------------------------
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/${SVC}.service" <<EOF
[Unit]
Description=JEE Study App (local Next.js server)
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/.next/standalone
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
ExecStart=$(command -v node) $SERVER_JS
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

HAVE_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  HAVE_SYSTEMD=1
  say "Installing + starting systemd user service '$SVC'"
  systemctl --user daemon-reload
  systemctl --user enable --quiet "$SVC"
  systemctl --user restart "$SVC"
else
  warn "systemd user session not available — start the server manually with:"
  warn "  NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 node $SERVER_JS"
fi

# --- 4. health check --------------------------------------------------------
say "Waiting for server at $URL"
HEALTHY=""
for _ in $(seq 1 30); do
  if curl -fs "$URL" 2>/dev/null | grep -q "JEE Study"; then HEALTHY=1; break; fi
  sleep 1
done
if [ -z "$HEALTHY" ]; then
  warn "server did not become healthy within 30s"
  if [ "$HAVE_SYSTEMD" = "1" ]; then
    die "check logs:  journalctl --user -u $SVC -e"
  else
    die "start it manually (see command above), then reopen the app"
  fi
fi
say "Server is up and healthy."

# --- 5. app-menu launcher ---------------------------------------------------
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ICON_DIR="$DATA_HOME/icons"
APPS_DIR="$DATA_HOME/applications"
mkdir -p "$ICON_DIR" "$APPS_DIR"
cp "$APP_DIR/public/icons/icon-512.png" "$ICON_DIR/${SVC}.png"

BROWSER_BIN=""
for b in chromium google-chrome-stable google-chrome brave vivaldi-stable microsoft-edge-stable; do
  if command -v "$b" >/dev/null 2>&1; then BROWSER_BIN="$b"; break; fi
done

if [ -n "$BROWSER_BIN" ]; then
  EXEC_LINE="$BROWSER_BIN --app=$URL --class=$SVC %U"
  COMMENT="JEE prep console (app window)"
else
  EXEC_LINE="xdg-open $URL"
  COMMENT="JEE prep console (in browser)"
fi

cat > "$APPS_DIR/${SVC}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=JEE Study
Comment=$COMMENT
Exec=$EXEC_LINE
Icon=$SVC
Terminal=false
Categories=Education;Science;
StartupWMClass=$SVC
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" || true

# --- 6. done ----------------------------------------------------------------
say "Done. Your data lives in the browser (IndexedDB) at origin $URL —"
say "always open the app via localhost, never 127.0.0.1, so the origin never changes."
cat <<EOF

  Open the app
    • App menu (rofi / kickoff / etc.)  ->  "JEE Study"
    • Best windowed experience: open $URL in Chrome/Chromium,
      click the install icon in the address bar  ->  "Install page as app"

  Manage the service
    • Status:    systemctl --user status $SVC
    • Logs:      journalctl --user -u $SVC -e
    • Restart:   systemctl --user restart $SVC
    • No autostart:  systemctl --user disable $SVC

  Update later:   git pull && ./scripts/setup-local.sh
  Remove it all:  ./scripts/uninstall-local.sh
EOF
