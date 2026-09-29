# JEE Study App

A local-first JEE preparation console. **All data stays in your browser (IndexedDB)** — no account needed, works offline, nothing leaves your machine unless you turn on sync.

- **Dashboard** — Today's todo list, revision-due queue, AI study coach
- **Question Bank** — JSON batch import (schema shown in-app), PDF → bank AI extraction, drag & drop everywhere
- **Tests** — NTA-rule CBT player, PDF page-mode papers, answer-key parsing, review with error tags (C/F/A/R/T/G) and "explain this question" AI
- **Calendar** — Google-Calendar-grade day/week/month time-blocking, one-way sync to your Google Calendar
- **Syllabus tracker** — 65 chapters with Tier 1/2/3 badges, Amber-first repair queue
- **Analytics** — north-star "correct under time", chapter health, score timeline, negatives lost, time per subject
- **Cross-device sync** — optional, end-to-end via your **own** Supabase project (magic-link auth, per-record LWW with tombstones)

## Run it on your machine (Arch Linux)

One command:

```bash
git pull            # first time: git clone https://github.com/SobhnathxLuffy/JEE-Dashboard.git
cd JEE-Dashboard
./scripts/setup-local.sh
```

Prerequisites: `node` ≥ 20 (`sudo pacman -S nodejs npm`). The script installs deps with bun if you have it, otherwise npm.

What it sets up:

1. **Production build** of the app (`output: standalone`)
2. **systemd user service `jee-study`** — server starts at login, restarts on crash, binds to `127.0.0.1` only (never visible to your LAN), ~100 MB RAM
3. **"JEE Study" launcher entry** in your app menu — opens the app in its own window if a Chromium-based browser is installed

Then open it any of these ways:

- App menu → **JEE Study**
- In Chrome/Chromium: open `http://localhost:3000` → click the **install icon** in the address bar → *Install page as app* — this gives you a standalone window, a launcher icon, and offline support (the app is a full PWA)
- Or just bookmark `http://localhost:3000`

> **Data origin rule:** always open the app via `localhost`, never `127.0.0.1`. IndexedDB is scoped per-origin, and `localhost:3000` vs `127.0.0.1:3000` are two different origins with two separate data sets. The app also requests persistent storage on startup so the browser won't evict your data.

Manage the service:

```bash
systemctl --user status jee-study      # what is it doing
journalctl --user -u jee-study -e      # logs
systemctl --user restart jee-study     # after killing your machine, it self-heals anyway
systemctl --user disable jee-study     # don't auto-start at login
```

Update / uninstall:

```bash
git pull && ./scripts/setup-local.sh   # update to the latest version (idempotent)
./scripts/uninstall-local.sh           # remove service + launcher (browser data untouched)
```

### Manual run (no systemd)

```bash
npm install        # or: bun install
npm run build
NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

### Different port

```bash
JEE_PORT=3001 ./scripts/setup-local.sh
```

## Install on your phone (Android APK)

The repo builds its own APK via GitHub Actions on every push. Grab the latest:

1. Open **github.com/SobhnathxLuffy/JEE-Dashboard → Releases → `mobile-latest`**
2. Download **JEE-Study-debug.apk** on the phone
3. Allow *install from unknown apps* for your browser when prompted → open the APK

Every build is signed with the same committed debug key, so updates install straight over old versions (no uninstall needed). The APK is fully self-contained: the whole app ships inside it, works offline, and data lives in the app's own IndexedDB.

**Sync on the phone** — Data → Sync:

1. Connect the same Supabase project (URL + anon key) — or set a project up there the first time
2. Sign in with the same email; Supabase emails you a magic link
3. Tapping the link opens the *browser* (not the app), so in the app paste the link instead: long-press it in the email → *Copy link address* → paste into the app's "Paste the link here" field → **Verify**
4. Done — questions, tests, responses, syllabus, todos, calendar, formulas **and question papers (PDFs ≤ ~4.8 MB)** flow both ways. Bigger PDFs sync metadata-only; re-upload the file where you need it.

Notes:

- AI features on the phone call your provider directly from the app (no local proxy server) — answers arrive whole instead of streaming, everything else is identical
- Google Calendar push may be limited inside the APK (Google's sign-in popup is restricted in app webviews) — the web/PWA version handles that flow best
- Rebuild locally anytime: `npm run build:mobile && cd android && ./gradlew assembleDebug`

## Development

```bash
bun install        # or npm install
bun run dev        # dev server on :3000
bun run lint       # eslint
```

Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · IndexedDB (7 stores) · pdfjs-dist · recharts.

## AI features (optional)

"Explain this question", PDF → question-bank extraction, and the AI Study Coach run through `/api/ai` — a server-side proxy so your API key never touches the browser. Configure your provider (OpenAI-compatible endpoint + key + model) in **Data → AI settings**. Costs are pay-per-call through your own credits; everything else works without any key.

## Privacy model

| What | Where it lives |
|------|----------------|
| Questions, tests, syllabus progress, todos, calendar | Your browser (IndexedDB) |
| AI API key | Your browser's localStorage only; the local `/api/ai` proxy (127.0.0.1-bound) forwards calls to your chosen provider — nothing else sees it |
| Sync (optional) | Your own Supabase project — app vendor sees nothing |
| Google Calendar token | Your browser; one-way push app → Google |
