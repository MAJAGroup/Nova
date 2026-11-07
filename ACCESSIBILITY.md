# Accessibility

> Desktop is now the primary product (`npm start`), following the user's updated preference. It uses local Electron Chromium views without starting a server. Unless explicitly marked desktop, the detailed service/agent/deployment sections below describe the optional remote mode (`npm run start:server`). See [README.md](README.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for native behavior and limitations.


The interface uses semantic forms, labels, landmarks, visible focus outlines, a skip link, native buttons/selects/range controls, text error messages, and conventional keyboard interaction. Browser, universe, accessible, focus, and task views share the same server state. No AI is needed for accessible browsing.

The accessible view exposes visible headings, links, buttons and form fields from the remote page. Inputs and actions are executed in that page. The extraction is a bounded DOM-based semantic representation, not a complete Chromium accessibility tree: shadow DOM, cross-origin frame semantics, complex widgets and image descriptions remain gaps.

The universe’s glowing stars are backed by real visit entries. A keyboard-operable history list provides every page selection without graph gestures. Active stars have a subtle orbital animation. System reduced-motion and the explicit preference disable arrival, orbit and hover transitions. High contrast and text scaling are persisted per account.

The remote image view captures keyboard input only while focused. Escape exits capture. Use Accessible view for ordinary Tab navigation through remote controls. A separate text bar supports mobile typing and paste. All task decisions are standard keyboard-operable buttons. On narrow screens, split panes stack vertically.

## Verification

Automated browser tests cover registration, named controls, semantic browsing, split pane landmarks, command focus shortcuts, mobile overflow, star rendering, and reduced motion. axe-core scans the workspace and semantic interface; passing automated scans is not a claim of WCAG 2.2 AA conformance.

Manual audit still required: NVDA/Firefox and VoiceOver/Safari landmark order; page announcements after remote navigation; focus recovery on tab close; 200–400% zoom; touch assistive technologies; switch control; remote complex widgets; high contrast themes on multiple operating systems. Voice input, spoken responses, captions and AI image descriptions are not implemented. Audio is not required to operate the interface.
