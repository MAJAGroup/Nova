# Development progress · 2026-11-07

## Current product direction

The user subsequently changed the requirement from a hosted server to a proper desktop browser. The primary command is now `npm start`, which launches the native Electron application. No background API/server is started. The remote implementation remains available explicitly via `npm run start:server`.

## Native desktop implemented

- Real local Chromium views with normal navigation, text/pointer interaction and independent native split views.
- Living Universe: glowing tab stars, subtle drift/halos, loading indicators, active/pinned states and opener trails.
- Informative inspector: title, full address, page/audio/error status, last activity, recent journey, space assignment and page actions.
- Search, sort, pinned-first ordering, keyboard star inspection, list alternative, drag positioning and reduced motion.
- Pin/unpin, duplicate, mute/unmute, reload, split/single view, close/reopen, and navigation from the journey.
- Persistent tabs, cookies/profile, supported native history, branching visit records and pin/mute state; atomic private session snapshots.
- Narrow preload bridge and trusted-shell IPC sender checks. Website renderers have no Node integration or privileged preload.
- Native platform menu/shortcuts, application icon, app-only packaging with no remote dependencies.
- Single-instance behavior and a shared native profile path so source and packaged versions use the existing ORBIT profile.

## Optional remote mode implemented

- Fastify/React application; salted scrypt authentication, seven-day revocable devices, origin/header CSRF checks and owned WebSockets.
- Real sandboxed Playwright Chromium, DNS-pinning destination filter, server-rendered JPEG transport and semantic input controls.
- SQLite WAL persistence with initial migration ledger, encrypted browser storage snapshots and URL/layout/history recovery.
- Branching visit graph, star canvas, semantic history alternative and independent split commands.
- Bounded OpenAI-compatible/Ollama JSON agent loop, explicit page-disclosure consent, exact single-use page-bound approvals, pause/cancel/handoff and opt-in continuation after disconnect.
- Separate autonomous workspaces, quotas, idle suspension, state snapshots, settings and terminal protocol/client.
- Docker/Compose configuration and supporting architecture/setup/security/accessibility documentation.

## Execution evidence

- `npm run build`: passed; React/Vite production bundle generated.
- `npm run typecheck`: passed under strict TypeScript.
- `npm run format:check`: passed.
- `npm test`: **15 tests passed, 0 failed**, including real Chromium integration, multi-user isolation, approvals, deterministic test-model execution, branching desktop visits, recovery, responsive UI and axe scans.
- `npm run test:desktop`: passed against the real Electron source application.
- Packaged native executable regression: passed, including direct page text entry, link navigation, two native browser views, pin/mute, search, reduced motion, close/reopen, and restart recovery.
- `npm run pack`: passed; native Linux unpacked app built without node_modules/runtime service dependencies.
- `npm run dist -- --linux AppImage`: passed; standalone Linux AppImage produced in release/.
- Actual AppImage regression (extraction mode, Chromium sandbox preserved): **passed**, including native browsing, split, close/reopen and restart recovery (6.85-second functional run).
- Actual UI screenshots inspected for desktop universe, inspector, remote workspace and mobile layout in ignored artifacts/.

## Corrections made during verification

- Upgraded development runtime from incompatible host Node 20 to project-local Node 22.
- Prevented native back/forward operations from creating spurious remote history visits.
- Synchronized API navigation metadata before split-command responses.
- Fixed duplicate accessible pane landmarks and a missing command-form landmark found by axe.
- Retained star DOM elements across metadata updates to preserve focus and avoid animation restarts.
- Hid native web views while app settings dialogs are open, preserving modal usability.
- Kept profile/session behavior consistent between development and packaged native builds.

## Remaining work and explicit limits

See KNOWN_LIMITATIONS.md and docs/DESKTOP.md. In particular: advanced autonomous/background AI is still remote-mode-only; native desktop retains its existing assistant and deterministic commands. Native full accessibility audit, richer download management, arbitrary multi-pane layouts, signed installers and macOS/Windows artifact verification remain outstanding. Remote audio streaming, distributed workers, combined parallel research synthesis and public multi-tenant hardening are not complete. No live-model integration was tested without a configured model. Container execution was not verified; after the user changed product direction, the release work focused on the native desktop artifact.
