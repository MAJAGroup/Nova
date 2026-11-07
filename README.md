# ORBIT · Cosmic Browser

A native Chromium desktop browser with a living universe of tabs. **The desktop app is the primary experience.** No server, Docker, account, or separate Chromium installation is needed for desktop browsing. The Linux app is built at `release/ORBIT-0.2.0.AppImage`.

## Launch the desktop app

Use Node 22.12 or newer:

```bash
npm ci
npm start
```

`npm run desktop` launches the same application. Websites render directly inside isolated Electron `WebContentsView` instances, with native keyboard, pointer, scrolling and media behavior. There is no JPEG stream or HTTP server in desktop mode.

## Your living universe

- Tabs become softly glowing stars with subtle drifting and halo animations. Loading stars move differently; active and pinned stars have visible orbits.
- **Select a star** to inspect it; **double-click** to open its page. Enter opens its details using the keyboard.
- See the title, site, loading/error/audio state, last activity, and page journey in the inspector.
- Pin, duplicate, mute, reload, close, or move a tab into a named space. Split a selected tab with the active tab; both use real, independently interactive Chromium views. **Single pane** restores one view.
- Search by page title or address; sort by activity, title, or site. Switch to List view for a conventional alternative.
- Reopen recently closed tabs. Tabs, pinned/muted state, supported native history and browsing cookies persist across app restarts. In-memory web app state is not guaranteed to restore.
- Choose **Reduce motion**, or use your operating system’s reduced-motion preference.
- Ctrl/Cmd+L focuses the address bar; Ctrl/Cmd+T opens a tab; Ctrl/Cmd+W closes it; Ctrl/Cmd+Shift+O opens Universe.

The desktop assistant retains the original optional BullsAI/OpenAI-compatible connection in Settings. Its direct commands work without a model. Advanced autonomous tasks from the optional server implementation are not yet exposed through the native app.

## Build an application

```bash
npm run pack   # unpacked native app under release/
npm run dist   # platform installer / Linux AppImage
```

Packaging stages only the native browser sources, keeping server, SQLite, React and Playwright runtime dependencies out of the app. Build macOS and Windows installers on their respective platforms. Signing/notarization is not configured.

## Optional self-hosted remote mode

The remote implementation remains available for future use:

```bash
npx playwright install --with-deps chromium
cp .env.example .env
npm run build
npm run start:server
```

Open http://127.0.0.1:3000. This optional mode uses accounts, server-side Chromium, streaming, semantic views and bounded background agents. The following remote-mode features do not imply native desktop feature parity.

## Remote-mode browsing

- Navigate using a pane’s address bar, back, forward, and reload buttons.
- Click a streamed webpage or focus it and type. Escape exits remote keyboard capture. The text bar supports paste and mobile input.
- **Accessible view** exposes headings, links, and labeled form controls from the same remote page. Refresh structure after dynamic changes.
- Enter **Open YouTube and Reddit** to create two independent remote browsing panes. Explicit HTTP(S) URLs also work. Fixture tests avoid reliance on public websites.
- Resize the split using the keyboard-operable pane balance slider; rotate or swap panes. Hide a pane without closing its tab.
- **Universe** represents real visits as glowing stars, with branching journey trails, subtle active-star halos, pan, zoom, fit, search, and a semantic history list. Reduced motion disables the star arrival and halo animation.
- **Mission control** runs bounded AI tasks on a selected tab or in a separate browser workspace. Approve exact page-bound actions, pause, cancel, or take control. Background execution is opt-in.
- **Settings** controls contrast, motion, text scale, stream quality/rate, device revocation, history clearing, and account deletion.
- Ctrl/Cmd+L focuses the address bar. Ctrl/Cmd+J focuses workspace commands.

AI requires server-side configuration in `.env`. No model credentials are included. See [AI_AGENT.md](AI_AGENT.md).

## Checks

```bash
npm run typecheck
npm run build
npm test
npm run format:check
npm run test:desktop  # needs a graphical display
```

Tests start real Chromium, fixture websites, an authenticated API, WebSocket clients, and a deterministic test-only model server. UI tests exercise registration, split browsing, semantics, star navigation, mobile layout, keyboard shortcuts, reduced motion, and axe checks. Screenshots are written to `artifacts/` (ignored by Git). Live model and public website compatibility require additional deployment-specific testing.

## Deploy

```bash
docker compose up -d --build
```

The container binds only `127.0.0.1:3000` on the host and persists application data in a named volume. Use an HTTPS reverse proxy with WebSocket upgrades, exact `PUBLIC_ORIGIN`, and `COOKIE_SECURE=true` for remote access. The host must permit Chromium’s sandbox. The provided container configuration has not been executed in this environment; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Documentation

[Architecture](ARCHITECTURE.md) · [Setup](SETUP.md) · [Agent](AI_AGENT.md) · [Accessibility](ACCESSIBILITY.md) · [Security](SECURITY.md) · [Deployment](DEPLOYMENT.md) · [Decisions](DECISIONS.md) · [Progress](PROGRESS.md) · [Known limitations](KNOWN_LIMITATIONS.md) · [Thin-client protocol](docs/PROTOCOL.md)

This is a functional single-host implementation under continued development. It does not yet satisfy every advanced requirement in the master prompt. The limitations file explicitly identifies the remaining capabilities.
