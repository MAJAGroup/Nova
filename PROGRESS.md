# History constellation on main

- Switched from `feature/cosmic-browser` to `main` and pulled `origin/main` with a fast-forward to `193546a`.
- Preserved previous unfinished work in stash `cosmic-star-board-before-main-switch`; it was not applied over main's new modular desktop UI.
- Added a separate History view (toolbar ◷ / Ctrl+H), preserving the existing 3D tab cosmos, grouping, browsing controls, and assistant.
- Records actual top-level HTTP(S) navigations as distinct visits, with native back/forward history slots and separate new-tab opener edges.
- Persists up to 3,000 visits, including closed tabs, to an atomic private JSON file. Unreadable existing history is preserved and reported.
- Displays visits as glowing stars and directed constellation trails. Supports inspector, ancestor highlighting, saved draggable layouts, pan/zoom/fit, minimap, search with ancestor context, branch collapse, list alternative, keyboard navigation, and reduced motion.
- Historical stars reopen current web content, linked to their source visit. This is metadata history, not an archive of page contents or JavaScript state.
- Clear history has an explicit inline confirmation and leaves current tabs/cookies intact.

## Verification

- `npm test`: 4 tests passed (branching/back-forward/repeated visits, exact opener association, persistence/retention/clear, graph/search/collapse/camera math).
- `npm run test:desktop`: native Electron end-to-end test passed. Verified live link traversal, back/forward, preserved forks, reload, popup source edges, closed-tab history, drag/pan/search/collapse/list/reduced motion, reopening saved pages, restart persistence, clear history, and the unchanged 3D tab cosmos.
- Built `dist/ORBIT-0.3.0.AppImage`. Packaged verification exposed the existing builder default excluding Three.js's `examples` directory. Explicitly included OrbitControls and CSS2DRenderer and verified both exist in the app archive.
- JavaScript syntax checks and `git diff --check` passed.
- The tests use a temporary profile and deterministic local pages. Rendered UI is captured in `artifacts/history-constellation.png`.


- Packaged AppImage end-to-end verification also passed (33.2 seconds), including its bundled 3D cosmos. The completed app is `dist/ORBIT-0.3.0.AppImage`.
