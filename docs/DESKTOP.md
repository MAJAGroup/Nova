# Native desktop browser

The user changed the primary architecture from server-hosted browsing back to a conventional desktop application. `npm start` and `npm run desktop` now launch Electron directly. `npm run start:server` preserves the optional remote service without starting it in desktop mode.

## Structure

- `desktop-main.js`: native window, browser view lifecycle, navigation, split layout, media/tab controls, permission dialogs, private IPC and session recovery.
- `desktop-preload.js`: narrow context-isolated bridge available only to the trusted app shell.
- `desktop-state.js`: atomic private JSON session persistence and branching visit bookkeeping.
- `newtab.html`, `app.js`, `styles.css`: browser chrome and living Universe.
- `scripts/prepare-desktop.cjs`: stages a dependency-free native app for electron-builder. Server dependencies are excluded from the desktop package.

Chromium pages run locally in sandboxed views, without Node integration or the shell preload. All privileged IPC checks the sender is the trusted application main frame. Native website permission prompts retain explicit user approval. The browser shares its persistent cookie profile across normal tabs, as a conventional browser does. It does not impose the remote mode's private-network restrictions on a user's local browser.

## Universe and usability

Each star corresponds to a real native tab. Page titles, sites, loading errors, active state, audio/mute, pin state, last activation, and recent page journeys come from the main process. A bounded journey stores distinct navigation visits and retains branches when a user goes back and follows a different page. Duplicate/pop-up relationships produce trails when both tabs are visible.

Star DOM nodes are retained across metadata updates, so loading/title changes do not continually restart animations or replace keyboard focus. Ambient motion is limited to small drift and halo opacity. Reduced-motion preferences disable animation and transitions.

Select or press Enter to inspect; double-click or choose Open page to browse. Search and sorting, list layout, labeled inspector controls, move-to-space, close/reopen, pin, mute, duplicate, reload and split actions make the universe an actual tab-management interface. Pinning keeps stars first in sorting; it does not prevent closing them.

## Recovery

The existing `orbit-spatial-browser` Electron user-data directory is shared by source and packaged builds, preserving the prior profile. It stores `desktop-session.json` alongside Chromium's persistent profile and the existing encrypted model configuration. The session file is written atomically with mode 0600. It records open tabs, supported native history entries/index, journey branches, pin/mute state, active tab and up to 20 recently closed tabs. UI space assignments and star positions remain in the shell's local storage.

Recovery reloads URLs and restores supported native history, not the JavaScript heap. Split layout itself currently returns to a single active view after restart. Downloads use Chromium/Electron defaults; there is no dedicated download manager UI. Device-to-device continuity and multi-user accounts belong only to the optional remote mode.

## AI scope

The original desktop assistant remains available through its configured OpenAI-compatible endpoint and native deterministic commands. The remote implementation's bounded agent, approval database, autonomous/background tasks and provider adapters have not been ported to Electron's native controller. No claim of native agent parity is made. This distinction avoids secretly starting the remote stack behind a desktop wrapper.

## Packaging and verification

`npm run pack` stages six native sources and builds an unpacked app into `release/`. `npm run dist` creates a platform artifact. Production dependency rebuilding is unnecessary because the native app uses only Electron/Node built-ins. Installers are not signed or notarized; macOS/Windows packaging requires platform verification.

`npm run test:desktop` launches the actual Electron application with a private temporary profile and deterministic website, then tests native text entry/link navigation, tabs, star controls, split views, reduced motion and restart recovery. It requires an X11/Wayland graphical display (or a correctly configured CI virtual display).

Linux release artifacts are built in `release/`. If your system lacks FUSE, launch the AppImage with `APPIMAGE_EXTRACT_AND_RUN=1 ./release/ORBIT-0.2.0.AppImage`. This extraction fallback does not disable Chromium sandboxing.
