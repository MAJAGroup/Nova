# Date-based History Atlas (local changes)

Implemented on the restored `d1d2adb` UI. No commits or pushes performed for this task.

- History is a pinned view beside Orbit view, using the same atlas styling, Three.js backdrop, star renderer, icon labels, and OrbitControls.
- Chronological date lanes, chronological visit positions inside each date, date filtering, scoped search, exact timestamps, visit details, linked visits, and explicit navigation arrows. All dates shows cross-day connections.
- Persistent native visit graph with separate opener relationships, branching navigation, closed-tab history, and reopening. Metadata only; no archived page contents.
- Shared star renderer now accepts an optional layout and reduced-motion callback. Fixed CSS2D label cleanup when removing stars, preventing ghost labels after filtering.
- History reserves room for the docked assistant. Preserved Orbit view's original components and interactions.
- Bounded scene (300 matching visits) with 3,000 retained visits; older matches reachable through dates/search. Sidebar fallback when WebGL is unavailable.
- Clear-history confirmation and narrowly scoped trusted-shell IPC.

Verification: model checks for local dates/chronological layout and navigation semantics; real Electron checks for branching links, date groups, search, reopening, persistence, assistant layout, clearing, and switching back to Orbit view. Three tests passed. Visual preview inspected; final results refreshed after the final check.

## Spatial constellations and favicon nuclei

Replaced the flat date lanes with three-dimensional spiral constellations. Dates progress chronologically along the scene; each group has depth, a soft nebula and a camera-facing date label. Added gentle camera orbit, pause/resume, and reduced-motion support. History uses Orbit's same star/halo renderer. Site favicons form the nuclei and are retained in visit metadata, including same-site navigation where Chromium reuses a cached icon without another update event. Sidebar visit rows show the same icon.

Verification: all three tests passed, including actual favicon rendering and persistence across restart, branching navigation, dated grouping, and Orbit/History switching. Updated preview visually inspected. All changes remain local and uncommitted; nothing pushed.

## Navigation-based History constellations

History now shares Orbit's constellation renderer, inline hover labels, background, camera controls, sidebar rows, collapse toggle and fit control. The History clock icon is at the far upper-right of the browser toolbar; the tab row again contains Orbit and live tabs.

Constellations follow the retained parent-visit graph across dates and child tabs, named for their first page. Only genuine navigation edges are rendered, with directional arrows and violet new-tab links; selecting a visit highlights its ancestry. Date/search filters retain constellation identity and colors without drawing invented shortcuts across hidden visits. All dates opens by default.

Validation: model coverage for branching, child tabs, cross-date membership, filtered paths, independent roots and malformed retained fragments; actual Electron coverage for native visits, toolbar position, shared constellation labels, sidebar collapse, filtering, assistant bounds, reopening, persistence, clearing and Orbit switching. Preview: artifacts/navigation-history-atlas.png.

## List-first history with live search constellations

History now opens as a regular, date-grouped list with newest visits first and 100-entry pagination. The search field remains in the same header position across modes. Nonempty input creates the Three.js scene lazily and arranges only matching visits; clearing the query restores the list and stops the scene loop. Reopening resets to the list. Search covers all retained history, including entries beyond the loaded list.

Search constellations now use chronological columns and ordered branching shapes, with sibling links fanning out before their destination subtrees. Only actual parent links between matches are drawn. The geometry stays planar, with disjoint journey bands. Shared Orbit renderers support optional emphasis, label placement and immediate layout for history, retaining their default Orbit behavior.

Validation covers native branching and child tabs, list/search transitions, no results, clear and Escape, result changes, reopening, pagination, older unrendered matches, assistant bounds, persistence, and clear history. Model checks sample interleaved branching graphs for crossed or overlapping path segments. Visuals: artifacts/history-list.png and artifacts/history-search-constellations.png.
