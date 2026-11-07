# MASTER IMPLEMENTATION PROMPT
## Project: Cosmic Browser — An Accessibility-First, Autonomous AI-Powered Remote Browser

### YOUR ROLE AND OPERATING INSTRUCTIONS

You are an autonomous principal software engineer, browser systems architect, accessibility specialist, AI agent engineer, UI/UX designer, DevOps engineer, and QA engineer.

Your responsibility is to **build a complete, functioning software application** based on the requirements in this document.

Do not simply describe how the project could be built. Actually implement it in the available development environment.

You are authorized to make reasonable engineering decisions, create and modify project files, install required development dependencies, execute commands, configure local services, run tests, debug problems, and improve the implementation.

Follow these operating rules:

1. Inspect the existing repository, development environment, available resources, and operating system before starting.
2. If the repository is empty, initialize the project using the architecture defined below.
3. Make technical decisions independently when requirements do not specify an exact implementation.
4. Favor reliable, maintained, open-source components over unnecessarily reinventing infrastructure.
5. Implement real integrations and functional code rather than simulated interfaces.
6. You may use temporary mocks during development and automated tests, but production features must not secretly depend on mocked behavior.
7. Install and configure dependencies when permitted by the execution environment.
8. Run the application, inspect its behavior, fix failures, and repeat until the implemented functionality is verified.
9. Do not stop after planning, creating scaffolding, generating screenshots, or implementing frontend components.
10. Do not request clarification for routine architectural or implementation choices. Document your assumptions and proceed.
11. Request authorization only when an action genuinely requires a secret, external account permission, paid resource, destructive operation, or another important user decision.
12. Never fabricate successful execution, passing tests, deployment, or completed features.
13. Maintain a development progress file that tracks implemented features, unresolved issues, tests, and architectural decisions.
14. If the execution environment imposes time, resource, or permission constraints, complete the most valuable functional vertical slices and clearly document the remaining work.
15. Continue implementing and testing within the available execution session rather than merely recommending future work.

Your objective is a functional, self-hosted product suitable for continued development and eventual production deployment.

---

# 1. PRODUCT VISION

Build an entirely new kind of browser centered on three principles:

**Universal accessibility, server-side execution, and intelligent autonomous interaction.**

The browser's rendering engine and resource-intensive operations must run on a remote server.

Users connect to their browsing environment from phones, tablets, desktops, laptops, and appropriately designed low-power clients.

The client device should not need to execute the JavaScript, rendering workloads, or other heavy processing of the websites being visited.

The browser must offer:

- Conventional interactive web browsing.
- A deeply integrated autonomous AI agent.
- Accessibility-adapted interaction methods.
- Persistent browser sessions.
- Cross-device session recovery.
- Background AI task execution.
- A visually distinctive cosmic navigation canvas.
- Navigation history represented as linked and branching journeys.
- Split-screen browsing and parallel AI operations.
- Secure multi-user access.
- Modular browser-engine integration.

The result should feel like an intelligent browsing environment rather than a traditional browser with an AI chat sidebar.

Working name: **Cosmic Browser**. Keep branding configurable so it can be renamed later.

---

# 2. FUNDAMENTAL ARCHITECTURAL PRINCIPLES

## 2.1 Server-side execution

The server must handle:

- Browser engine execution.
- HTML/CSS layout and website rendering.
- Website JavaScript.
- Browser networking.
- Browser contexts and tabs.
- Browser history and navigation.
- AI planning and inference requests.
- Autonomous browser automation.
- Accessibility tree extraction.
- Task execution and scheduling.
- Persistence and session management.
- Remote visual streaming or frame delivery.

Client devices handle only what is necessary for:

- Authentication.
- Receiving and displaying the remote browser.
- Sending keyboard, mouse, touch, or assistive input.
- Showing accessible navigation controls.
- Displaying task progress and approvals.
- Optional microphone capture or audio playback.

Do not implement a solution that merely displays website URLs inside local iframes. That would violate the fundamental server-side browsing requirement.

## 2.2 Existing engine, custom platform

Use an existing browser engine initially.

Recommended foundation:

- Chromium/Blink.
- Playwright for browser management and automation.
- Chrome DevTools Protocol for lower-level engine operations.
- Chromium accessibility APIs for structural page extraction.

Chromium Embedded Framework may be evaluated if it offers a demonstrable advantage, but it is not required for the initial implementation.

Build a modular engine interface so higher-level systems are not tightly coupled to Playwright or Chromium.

Define a browser-engine abstraction supporting:

- Create and destroy contexts.
- Create and close tabs.
- Navigate.
- Go backward and forward.
- Reload.
- Observe navigation events.
- Retrieve tab metadata.
- Capture visual output.
- Retrieve DOM and accessibility representations.
- Dispatch input.
- Execute approved browser actions.
- Manage downloads.
- Handle permissions.
- Save and restore supported browser state.

Design interfaces that could accommodate Gecko, WebKit, or a custom engine in the future.

Do not attempt to implement a new HTML, CSS, or JavaScript engine from scratch in the initial release.

Engine replacement should be architecturally possible, but do not falsely claim that different engines are interchangeable without adaptation.

## 2.3 Hybrid remote browsing

Implement two synchronized presentations of server-side browser state.

**Visual representation**

The user receives a visual representation of the actual webpage rendered by the server and can interact with it using conventional input.

**Semantic representation**

The server extracts accessible page information such as:

- Headings.
- Links.
- Buttons.
- Forms.
- Input fields.
- Labels.
- Roles.
- Accessible names.
- Focus information.
- Document structure.
- Navigation landmarks.
- Relevant element states.

These representations must refer to the same browser session.

Do not recreate an entire website on the client or attempt to run arbitrary remote website JavaScript locally.

Use a structured protocol for semantic browsing and action requests.

Implement synchronization so navigation and meaningful page changes update the accessibility interface.

---

# 3. TECHNOLOGY STACK

Use a practical, maintainable, open-source stack.

Preferred initial implementation:

**Frontend**
- TypeScript.
- React.
- Vite.
- Tailwind CSS.
- React Flow / XYFlow for graph-based cosmic navigation.
- Zustand or equivalent lightweight state management.
- Accessible component primitives.
- WebSocket client for live state updates.

**Backend**
- Node.js with TypeScript.
- Fastify or a similarly suitable high-performance API framework.
- Playwright for Chromium control.
- Chrome DevTools Protocol where necessary.
- PostgreSQL for persistent application data.
- Redis for ephemeral coordination and queues.
- BullMQ or an equivalent reliable background-job system.
- Prisma or another maintained database access layer.
- WebSockets for real-time application events.

**AI**
- Provider-independent LLM abstraction.
- OpenAI-compatible API support.
- Ollama support for locally hosted models.
- Optional cloud-model configuration.
- Optional vision-capable models.
- Structured tool-calling support where available.
- Validation and bounded fallback behavior for non-tool-calling models.

**Streaming**
- Start with a working Chromium frame or screencast transport.
- Support keyboard, pointer, touch, scrolling, and viewport resizing.
- Architect a transport interface that permits lower-latency streaming.
- Evaluate WebRTC and existing open-source streaming components such as Selkies.
- Implement a media-capable streaming transport for audio/video browsing where feasible.
- Clearly distinguish basic frame streaming from full multimedia streaming.

**Deployment**
- Docker.
- Docker Compose.
- Linux-first server deployment.
- Reverse-proxy compatibility.
- Environment-based configuration.
- Persistent Docker volumes.
- Health checks.

Choose maintained compatible versions and pin dependencies appropriately.

If a selected technology proves unsuitable, replace it with a better alternative and document the reason.

Prefer a clean monorepo with shared types.

---

# 4. CORE APPLICATION STRUCTURE

Implement the system as logically separated components.

Suggested organization:

```text
cosmic-browser/
├── apps/
│   ├── web/
│   ├── api/
│   └── thin-client/
├── packages/
│   ├── browser-engine/
│   ├── browser-protocol/
│   ├── accessibility/
│   ├── agent-core/
│   ├── task-orchestrator/
│   ├── cosmic-graph/
│   ├── streaming/
│   ├── security/
│   └── shared/
├── workers/
│   └── browser-worker/
├── infrastructure/
│   ├── docker/
│   └── compose/
├── tests/
├── docs/
├── .env.example
├── README.md
└── docker-compose.yml
```

This structure is a guideline, not an inflexible requirement.

Use packages only when they create meaningful separation. Avoid excessive microservices.

A modular monolith with dedicated browser workers is preferable to unnecessarily distributing every subsystem.

---

# 5. USER AUTHENTICATION AND SESSION MANAGEMENT

The browser is hosted on a server and supports multiple registered users.

Implement:

- User registration.
- Secure login and logout.
- Password hashing with a modern password hashing algorithm.
- Session authentication.
- User-specific workspaces.
- Persistent preferences.
- User-specific browsing state.
- Browser-session ownership.
- Active-device management.
- Session expiration.
- Session revocation.

Use secure cookies or another well-designed authentication mechanism.

Enforce authorization server-side for every relevant operation and real-time channel.

One user must never be able to access another user's browser contexts, visual streams, cookies, history, tasks, or approvals.

Support:

1. One user on one device.
2. One user reconnecting from another device.
3. One user connected from multiple devices.
4. Multiple independent users on the same server.

Define a deterministic policy for simultaneous control of a pane.

For example, one device may have active input control while another observes, with an explicit control handoff.

Do not silently allow conflicting input from multiple clients.

---

# 6. PERSISTENT REMOTE BROWSER SESSIONS

A user must be able to:

1. Log in from a phone.
2. Open websites.
3. Create tabs.
4. Start an AI task.
5. Disconnect.
6. Reconnect from a computer.
7. Continue from the same logical browsing environment.

Persist:

- Workspace definitions.
- Tabs.
- URLs.
- Navigation relationships.
- Browsing history.
- Supported browser profile and storage state.
- AI task state.
- Accessibility preferences.
- Workspace layouts.
- Relevant UI state.

Keep browser processes active when required by active tasks and available resources.

Implement idle resource management so inactive browser sessions do not consume unlimited CPU and RAM.

Support browser process restart and session recovery.

Important distinction:

A restarted browser process cannot always reconstruct an exact in-memory JavaScript application state.

Restore what is technically available, such as URLs, supported storage state, tab relationships, and persistent task checkpoints.

If an exact state cannot be restored, clearly notify the user rather than pretending recovery was lossless.

Use explicit lifecycle states, for example:

- Starting.
- Active.
- Idle.
- Suspended.
- Recovering.
- Failed.
- Closed.

---

# 7. THE COSMIC NAVIGATION SYSTEM

This is a defining feature of the product.

Traditional browsers display tabs as a flat horizontal list.

This browser must additionally provide a visually immersive **cosmic navigation canvas**.

## 7.1 Core concept

Represent the user's browsing environment as a navigable cosmic universe.

Suggested metaphor:

| Cosmic object | Browser concept |
|---|---|
| Galaxy | Major workspace or project |
| Solar system | Task or related group of tabs |
| Star | Root tab or starting page |
| Planet | Visited webpage |
| Moon | Child page, popup, or related detail |
| Orbit | Navigation or logical relationship |
| Constellation | Related group of pages |
| Journey trail | Sequence of navigation events |
| Comet trail | AI activity or task progression |

Treat these as configurable visual metaphors, not rigid backend entity types.

Use elegant visuals rather than overwhelming decorative effects.

## 7.2 Navigation as linked journeys

The user explicitly requires tab navigation to behave like linked relationships.

Example:

```text
New Tab
   |
   v
google.com
   |
   v
nice.com
```

The cosmic canvas should visually connect these nodes.

The relationship must be visible, clickable, and understandable.

However, do not implement navigation history as a strict linked list internally.

Real browser navigation can branch.

Example:

```text
             google.com
             /        \
            v          v
       nice.com      reddit.com
          |
          v
       article.com
```

Use a graph-based internal model with suitable navigation and history semantics.

Support:

- Parent-child relationships.
- Navigation edges.
- Multiple branches.
- Backward and forward navigation.
- Newly opened tabs.
- Tab duplication.
- Popup relationships.
- Task-generated tabs.
- Closed tab recovery.
- Historical visits.
- Navigation timestamps.

Keep distinct the concepts of:

- A browser tab.
- A webpage visit.
- A navigation event.
- A new tab opened by another page.
- An AI task associated with a tab.

Do not confuse multiple visits to the same URL with one permanently shared graph node.

## 7.3 Cosmic canvas interactions

Implement:

- Pan.
- Zoom.
- Fit-to-view.
- Select nodes.
- Open an associated tab.
- Inspect page information.
- Navigate between related nodes.
- Expand and collapse groups.
- Search the graph.
- Highlight navigation paths.
- Show active tabs.
- Show agent-controlled tabs.
- Show task ownership.
- Show currently focused content.
- Restore relevant historical pages.
- Display closed or archived sessions.

Allow users to organize workspace groups.

Use an automatic graph layout with sensible spacing and limited visual clutter.

For large histories, use clustering, virtualization, or other performance techniques.

## 7.4 Canvas design

Use:

- AMOLED-dark backgrounds.
- Subtle star-field motifs.
- Soft orbital lines.
- Carefully controlled accent colors.
- Smooth but restrained animations.
- Attractive node transitions.
- Clear typography.
- Visually differentiated active states.

The interface should feel immersive and polished, but it must remain a usable browser.

Do not make the cosmic canvas mandatory for normal navigation.

The primary browser experience should support both conventional browsing and opening the cosmic canvas when desired.

## 7.5 Accessibility alternatives

Every major operation available in the cosmic canvas must also be accessible through a semantic, keyboard-operable interface.

Provide an equivalent:

- Hierarchical tab list.
- Navigation history tree or list.
- Workspace selector.
- Searchable page history.
- AI task list.

A canvas rendered with SVG, Canvas, WebGL, or another graphical technology must not be the only way to access these functions.

---

# 8. MULTI-PANE SPLIT BROWSING

Implement an intelligent split-screen workspace system.

Example instruction:

**"Open YouTube and Reddit."**

Expected behavior:

1. Interpret the instruction as a request to open two websites.
2. Create or reuse a workspace.
3. Open YouTube in one remote browsing pane.
4. Open Reddit in another remote browsing pane.
5. Automatically split the interface into two sections.
6. Display both independent browser views.
7. Allow simultaneous interaction without one pane controlling the other.
8. Add both tabs to the workspace and cosmic navigation graph.

Do not simply open two ordinary background tabs and call that split-screen support.

## 8.1 Pane independence

Each pane should support:

- Its own active tab.
- Independent page navigation.
- Independent input focus.
- Independent scrolling.
- Independent page state.
- Independent visual stream.
- AI task association.
- Independent loading and error states.

Provide proper coordination when multiple panes intentionally share an authenticated browser context.

Avoid accidental interference between unrelated tasks.

## 8.2 Layout management

Support:

- Single pane.
- Two horizontal panes.
- Two vertical panes.
- Resizable dividers.
- Pane swapping.
- Maximize and restore.
- Closing a pane without unexpectedly deleting its tabs.
- Saving and restoring layouts.

Design the internal layout manager to support three or more panes later.

For small screens, use a responsive alternative such as vertically stacked views or a pane switcher.

Do not force two unusably narrow desktop-style panes onto a phone.

## 8.3 Natural-language workspace commands

Implement deterministic handling for commands such as:

- "Open YouTube and Reddit."
- "Split the screen between Google and Wikipedia."
- "Close the right pane."
- "Move Reddit to the left."
- "Make YouTube full screen."
- "Show my navigation universe."
- "Open three websites in separate panes."
- "Switch to my research workspace."

Use reliable command parsing for straightforward operations, even when no LLM is configured.

An LLM may handle more ambiguous instructions.

## 8.4 AI-assisted parallel operations

Example:

"Search for videos about accessible technology on YouTube and find related discussions on Reddit."

Expected behavior:

1. Create two independent browsing contexts or explicitly scoped page controllers.
2. Assign the relevant instruction to each context.
3. Execute the operations independently where safe.
4. Show live progress separately.
5. Collect the results.
6. Generate a combined comparison or summary.
7. Preserve the individual browsing histories.
8. Allow the user to inspect either context.

Independent browsing operations should run concurrently when resources and dependencies permit.

Use proper concurrency controls to prevent simultaneous conflicting actions on the same tab.

Merely opening multiple tabs is not proof of parallel execution.

---

# 9. AUTONOMOUS AI BROWSER AGENT

Implement a deeply integrated autonomous AI system.

The AI should not be restricted to answering questions about the current webpage.

It must be capable of planning and executing meaningful browser operations.

## 9.1 Core capabilities

Implement the foundations for:

- Understanding user instructions.
- Inspecting the current page.
- Extracting relevant page semantics.
- Using screenshots when needed.
- Navigating websites.
- Following links.
- Clicking buttons.
- Scrolling.
- Typing text.
- Filling forms.
- Searching.
- Opening and closing tabs.
- Switching tabs.
- Creating split workspaces.
- Reading structured content.
- Comparing information across pages.
- Producing summaries with source links.
- Managing multistep tasks.
- Detecting failed operations.
- Replanning after failures.
- Requesting permission before sensitive actions.

The AI must operate against the real server-side browser.

Do not implement a fake chatbot that merely claims to have visited websites.

## 9.2 Agent architecture

Create logical subsystems for:

**Planner**

Converts a user goal into an actionable sequence of tasks.

**Browser Observer**

Retrieves page information using DOM structure, accessibility semantics, screenshots, and limited relevant metadata.

**Executor**

Dispatches validated browser actions through the engine abstraction.

**Verifier**

Checks whether an operation achieved its expected outcome.

**Recovery Controller**

Handles retryable failures, replanning, and user intervention.

**Approval Manager**

Enforces sensitive-action checkpoints.

**Task Orchestrator**

Coordinates tasks, state transitions, and background execution.

These roles may share one LLM or use separate models.

Do not require a multi-agent architecture merely for appearance. Keep boundaries modular so specialized agents can be introduced later.

## 9.3 Agent execution loop

Implement a bounded observe-plan-act-verify loop.

Conceptual flow:

```text
User Request
     |
     v
Interpret Intent
     |
     v
Generate Plan
     |
     v
Inspect Browser State
     |
     v
Choose Next Action
     |
     v
Check Permissions
     |
     v
Execute Browser Action
     |
     v
Verify Outcome
     |
     +------ Failure ------+
     |                     |
     v                     v
Next Step             Retry / Replan
     |
     v
Task Complete
     |
     v
Accessible Result
```

The loop must enforce:

- Maximum action counts.
- Time limits.
- Retry limits.
- Cancellation.
- Task ownership.
- Resource limits.
- Action validation.
- Approval requirements.

Avoid unbounded autonomous loops.

## 9.4 LLM provider configuration

Support a configurable AI provider system.

At minimum:

- OpenAI-compatible endpoints.
- Ollama-compatible endpoints.
- Configurable model IDs.
- Configurable API base URLs.
- Configurable inference parameters.
- Model availability checks.
- Tool-calling capability detection or explicit configuration.
- Clear handling of model errors.

Do not hardcode model credentials into source code.

Allow a user or administrator to choose an available model.

Support separate model roles where useful:

- Planning/reasoning.
- Vision/page interpretation.
- Fast interaction.
- Summarization.

These may initially use the same model.

Implement a deterministic, non-LLM fallback for basic browsing commands.

The browser must remain usable without any configured AI provider.

## 9.5 Page understanding

Prefer structured page semantics before visual-only methods.

Useful information includes:

- Accessible names.
- Roles.
- Text.
- Link destinations.
- Input types.
- Form labels.
- Element states.
- Relevant DOM structure.
- Viewport information.

Use screenshots or vision models for cases where semantic information is insufficient.

Do not send full page dumps indiscriminately to an LLM.

Limit information to what is needed for the current operation, respecting token budgets, user privacy, and provider configuration.

## 9.6 Tool design

Implement typed, validated browser tools.

Examples:

```text
browser.navigate
browser.back
browser.forward
browser.reload
browser.openTab
browser.closeTab
browser.switchTab
browser.createSplit
browser.click
browser.type
browser.scroll
browser.getPageStructure
browser.getScreenshot
browser.getCurrentUrl
browser.searchText
browser.extractContent
browser.waitForElement
browser.requestApproval
task.reportProgress
task.finish
```

Every tool must validate input and enforce authorization.

Browser pages and LLM output must not be able to invoke arbitrary server commands.

Do not expose unrestricted shell execution, filesystem access, host networking, or process execution as ordinary website-agent tools.

---

# 10. AI EXECUTION MODES

Implement two primary modes.

## 10.1 Assisted browsing

The AI operates in the browser session currently visible to the user.

The user can:

- Observe actions.
- Interrupt actions.
- Take manual control.
- Ask the AI to continue.
- Cancel the task.

Show a clear visual indicator whenever the AI is controlling a tab.

## 10.2 Autonomous workspace

The AI operates in its own browsing context or task workspace.

The user may continue browsing independently.

Support multiple concurrent AI tasks subject to configured resource limits.

Each autonomous task must have identifiable:

- Ownership.
- Browsing context.
- Workspace.
- Execution status.
- Permission scope.
- Action history.

## 10.3 Human takeover and handoff

The user must be able to:

- Inspect an agent-controlled browser.
- Pause its execution.
- Take control.
- Interact manually.
- Return control to the agent.

Ensure the AI does not continue clicking or typing while the human has exclusive control.

Use explicit control states and synchronization.

When handing control back, the agent must reobserve the page rather than assuming nothing changed.

---

# 11. BACKGROUND EXECUTION

Users must be able to start tasks and then disconnect.

Background execution is user-controlled.

For each task, support an option such as:

**Continue running after I disconnect.**

If enabled, the task may continue on the server without an active connected client.

If disabled, it should pause according to a documented policy when the user disconnects.

## 11.1 Task states

Implement a persistent task lifecycle, including:

- Queued.
- Planning.
- Running.
- Waiting for approval.
- Paused.
- Recovering.
- Completed.
- Failed.
- Cancelled.

Store sufficient structured task state to support recovery.

## 11.2 Background task coordination

The backend must support:

- Persistent queues.
- Worker assignment.
- Task cancellation.
- Safe retries.
- State checkpoints.
- Worker failure detection.
- Resource quotas.
- Task leases or equivalent ownership controls.
- Reconnection.
- Progress updates.

Do not rely solely on in-memory JavaScript variables for task persistence.

## 11.3 Approval checkpoints

If a sensitive action is reached while the user is offline:

1. Pause that action.
2. Persist the approval request.
3. Notify the user through the application.
4. Wait for an explicit authorized decision.
5. Resume or reject the action accordingly.

Other independent, approved tasks may continue.

Approval requests must survive reconnects and server restarts.

## 11.4 Cross-device task recovery

Example:

A user starts a research task on a phone, disconnects, and reconnects on a desktop.

The desktop must display:

- Task identity.
- Current status.
- Completed steps.
- Remaining steps.
- Current browser context.
- Results collected.
- Pending approvals.
- Available controls.

Provide a clear option to resume viewing the task's browser session.

---

# 12. SAFETY AND APPROVAL SYSTEM

Build a deterministic authorization layer independent of the LLM.

The LLM must not be the final authority for sensitive actions.

Require approval for appropriate actions such as:

- Purchases and payments.
- Sending messages or emails.
- Publishing posts.
- Deleting data.
- Submitting important forms.
- Changing account settings.
- Sharing personal information.
- Downloading or uploading sensitive files.
- Granting permissions.
- Other externally consequential actions.

Make approval policies configurable where appropriate.

The server must enforce permission checks before the action is executed.

Do not allow an LLM to bypass approval by rephrasing a tool call.

Use explicit task and action identifiers, expiry rules, and single-use approval tokens or equivalent safeguards.

Where possible, verify the intended action and current page state again immediately before execution.

Treat webpage text as untrusted data. Defend against prompt injection that attempts to change agent instructions, extract secrets, or authorize operations.

Never automatically bypass CAPTCHAs, authentication challenges, paywalls, or website access controls.

If human intervention is required, provide a clear handoff.

---

# 13. ACCESSIBILITY-FIRST DESIGN

Accessibility is a central architectural requirement, not a final styling pass.

Target WCAG 2.2 AA for the application interface, with automated testing and documented manual verification.

Do not claim full WCAG conformance without an appropriate audit.

The browser must provide accessible functionality without requiring AI.

## 13.1 Visual disabilities

Support:

- Screen-reader-compatible application navigation.
- Semantic HTML controls.
- Keyboard navigation.
- Focus indicators.
- Scalable typography.
- High contrast.
- Clear accessible labels.
- Text-based webpage structure.
- Accessible navigation history.
- Optional text-to-speech.
- Optional AI image descriptions with suitable vision support.

## 13.2 Motor disabilities

Support:

- Keyboard-only navigation.
- Large interactive targets.
- Reduced need for complex gestures.
- Voice commands when enabled.
- Predictable focus.
- Adjustable interaction settings.
- Access through alternative input devices that emulate keyboard or pointer input.

Avoid requiring drag-and-drop for critical operations.

Provide equivalent buttons and menus.

## 13.3 Hearing disabilities

Support:

- Visual representations of alerts.
- Text-based AI responses.
- Text transcripts for spoken AI output.
- Caption or transcription integration where technically available.
- No essential audio-only instructions.

Do not fabricate captions or transcripts where none are available.

## 13.4 Cognitive accessibility

Support:

- Simplified focus mode.
- Reduced visual clutter.
- Clear task progress.
- Predictable navigation.
- Plain-language AI explanations.
- Consistent control placement.
- Adjustable motion.
- Clearly distinguishable manual and AI-controlled states.

## 13.5 Multiple presentation modes

Implement at least:

1. Conventional visual browser.
2. Cosmic navigation canvas.
3. Structured accessibility view.
4. Simplified focus mode.
5. AI task view.

These modes should reflect the same underlying browser or task data.

## 13.6 Reduced motion

Respect the user's operating-system reduced-motion preference.

Provide a dedicated application setting.

When reduced motion is enabled:

- Disable decorative cosmic animations.
- Avoid unnecessary camera movement.
- Avoid flashing effects.
- Use simple transitions.
- Preserve all functionality.

## 13.7 Accessibility testing

Include automated checks for:

- Semantic roles.
- Form labels.
- Keyboard interaction.
- Focus order.
- Focus visibility.
- Contrast.
- Modal behavior.
- Accessible error messages.
- Reduced motion.
- Core navigation alternatives.

Use axe-core or a comparable accessibility testing system.

Document manual screen-reader verification procedures.

---

# 14. THIN CLIENT SUPPORT

The browser must be usable from different kinds of devices.

## 14.1 Standard devices

Provide a responsive web application for:

- Desktop browsers.
- Mobile browsers.
- Tablets.

Support installation as a Progressive Web App where practical.

The client web application is only the control and presentation interface.

Website rendering and execution remain remote.

## 14.2 Low-power devices

Minimize:

- Client JavaScript work.
- Layout complexity during browsing.
- Network payload sizes.
- Excessive frame decoding.
- Background visual effects.
- Unnecessary re-rendering.

Provide adjustable stream quality and update rates.

Support constrained network conditions and reconnecting transports.

## 14.3 Devices unable to run a modern browser

A device that cannot run any browser still needs a communication and presentation client.

Design a documented lightweight client protocol.

As a functional proof of concept, implement a minimal terminal-based or similarly lightweight client that can:

- Authenticate securely.
- List workspaces and tabs.
- Read structured webpage information.
- Navigate links.
- Submit text input.
- Issue basic browser commands.
- Inspect AI task status.
- Respond to approval requests.

It must communicate with the server without embedding a full browser engine.

A fully graphical native client for every embedded device is not required initially, but the protocol should support future implementations.

---

# 15. REMOTE RENDERING AND STREAMING

Implement a dedicated presentation transport abstraction.

At minimum, create a working end-to-end pipeline that:

1. Receives browser rendering output on the server.
2. Sends visual data to the client.
3. Displays the output.
4. Accepts user input.
5. Sends input back to the correct browser instance.
6. Updates the visible page.
7. Handles viewport changes.
8. Handles reconnects.

Initially, Chromium screencasting or another practical frame transport is acceptable.

However, design for a lower-latency production transport.

Evaluate existing open-source remote streaming components rather than building an entire multimedia framework unnecessarily.

For multimedia-capable browsing, account for:

- Video rendering.
- Browser audio.
- Stream synchronization.
- Browser input.
- Transport latency.
- Server encoding costs.
- Client decoding limitations.

Keep the streaming abstraction independent from the browser engine where practical.

Do not claim audio/video streaming support simply because a webpage displays a video element.

Verify the actual remote media path.

Provide fallback behavior where advanced streaming features are unavailable.

---

# 16. USER INTERFACE DESIGN

Build a polished, coherent application.

Avoid generic administrative-dashboard styling.

The product should feel like an advanced browser with an immersive cosmic identity.

## 16.1 Main browser interface

Include:

- Address/search bar.
- Back and forward.
- Reload.
- Tab controls.
- Workspace selector.
- Pane layout controls.
- AI command input.
- AI task status.
- Cosmic canvas launcher.
- Accessibility controls.
- User menu.

Ensure the browser viewport receives adequate space.

## 16.2 AI interface

Provide:

- Natural-language input.
- Current task status.
- Step-by-step action descriptions.
- Pause.
- Resume.
- Cancel.
- Takeover.
- Approval controls.
- Final results.
- Relevant source links.

The user should be able to see what the AI is doing without exposing unnecessary private model reasoning.

Use a meaningful action log and plan summary.

## 16.3 Cosmic canvas

Create a distinct, visually polished navigation experience with:

- Dark space background.
- Planet/star-inspired page nodes.
- Navigation paths.
- Grouped solar systems.
- Active-state highlights.
- Agent activity indicators.
- Smooth pan and zoom.
- Node details.
- Accessible list alternative.

Avoid excessive neon effects or animations that interfere with usability.

## 16.4 Responsive design

On mobile:

- Prioritize the active webpage.
- Use compact controls.
- Provide an accessible command interface.
- Adapt split panes intelligently.
- Provide easy workspace switching.
- Support touch interaction.

On desktop:

- Offer flexible pane layouts.
- Support keyboard shortcuts.
- Allow simultaneous viewing of browsing and agent activity.
- Make the cosmic canvas useful on large displays.

---

# 17. DATA MODEL

Design a normalized schema covering at least the following concepts:

**User**
- ID.
- Authentication metadata.
- Preferences.
- Creation timestamps.

**DeviceSession**
- User ID.
- Device identity.
- Authentication/session state.
- Last activity.

**Workspace**
- Owner.
- Name.
- Layout.
- Preferences.

**BrowserSession**
- Owner.
- Engine type.
- Worker assignment.
- Runtime state.
- Recovery metadata.

**BrowserContext**
- Parent browser session.
- Isolation policy.
- Supported storage state.
- Ownership.

**BrowserTab**
- Browser context.
- Workspace.
- Current URL.
- Title.
- Active state.
- Parent or opener relationship.

**NavigationEntry**
- Tab.
- URL.
- Page title.
- Timestamp.
- Navigation type.
- History association.

**NavigationEdge**
- Source entry.
- Destination entry.
- Relationship type.

**WorkspacePane**
- Workspace.
- Associated active tab.
- Position.
- Size.
- Layout metadata.

**AgentTask**
- User.
- Goal.
- Status.
- Execution mode.
- Background policy.
- Associated context.
- Current checkpoint.

**AgentStep**
- Task.
- Action.
- Status.
- Public execution log.
- Verification result.

**ApprovalRequest**
- Task.
- Action.
- Risk category.
- Status.
- Expiry.
- Decision metadata.

**UserAccessibilityPreferences**
- Presentation mode.
- Motion preferences.
- Contrast.
- Font scaling.
- Input preferences.

**Notification**
- User.
- Event.
- Status.
- Timestamp.

Use migrations, indexes, foreign keys, and suitable uniqueness constraints.

Avoid storing sensitive page contents or credentials unnecessarily.

---

# 18. API AND REAL-TIME PROTOCOL

Design documented APIs for:

- Authentication.
- Workspaces.
- Browser sessions.
- Tabs.
- Navigation.
- Browser input.
- Accessibility tree.
- Navigation graph.
- Split layouts.
- AI tasks.
- Approvals.
- Notifications.
- User preferences.

Use typed request and response contracts.

Example endpoint families:

```text
/auth/*
/workspaces/*
/sessions/*
/tabs/*
/navigation/*
/panes/*
/accessibility/*
/tasks/*
/approvals/*
/preferences/*
```

Use WebSocket channels or another suitable transport for:

- Browser state changes.
- Tab navigation updates.
- Agent progress.
- Task lifecycle events.
- Approval requests.
- Session health.
- Remote visual frames where applicable.

Every event should be associated with appropriate user, session, and workspace identifiers.

Implement authorization for subscriptions.

Define event sequence numbers or equivalent recovery behavior for reconnecting clients.

Do not leak events across users.

---

# 19. SECURITY AND PRIVACY

The system executes an internet-facing browser on a remote server.

Treat it as security-sensitive infrastructure.

Implement:

- Strong authentication.
- TLS-ready deployment.
- Secure session cookies.
- CSRF protection where applicable.
- WebSocket authentication.
- Per-user authorization.
- Per-context isolation.
- Browser process sandboxing.
- Least-privilege service execution.
- Network access restrictions.
- Resource limits.
- Secure secret management.
- Input validation.
- Safe error handling.
- Explicit permissions.
- Data retention controls.
- Auditability of consequential actions.

Prevent browsing features from becoming unrestricted server-side request-forgery mechanisms.

Block access to cloud metadata endpoints, internal service networks, and sensitive host interfaces by default.

Allow legitimate access to internal/self-hosted websites only through explicit administrator policy.

Never expose browser remote-debugging ports directly to the internet.

Keep AI model credentials on the server.

Do not collect unnecessary browsing logs.

Do not send private webpage contents to external AI providers without suitable user disclosure and configuration.

Implement a way to delete user history and stored application data.

Protect browser profiles and persisted authentication state.

Add dependency and container security checks where practical.

---

# 20. RELIABILITY AND PERFORMANCE

The system must support resource-constrained servers and resource-constrained clients.

Implement:

- Per-user session limits.
- Browser-context quotas.
- Background-task concurrency limits.
- Idle session cleanup.
- Task cancellation.
- Worker health monitoring.
- Memory-aware browser lifecycle management.
- Stream backpressure.
- Adaptive visual quality.
- Efficient graph rendering.
- Bounded AI context sizes.
- Retries with backoff.
- Structured error reporting.

Do not promise unlimited concurrent users.

Document expected CPU, RAM, storage, and network requirements.

Run performance tests using measurable conditions.

Include resource monitoring for browser processes and background workers.

---

# 21. IMPLEMENTATION PHASES

Implement the project incrementally in working vertical slices.

Do not spend the entire execution session building infrastructure before producing a usable browser.

## Phase 1 — Functional remote browser

Deliver:

- Running frontend and backend.
- Authentication.
- Chromium browser worker.
- Remote browser view.
- Address bar.
- Navigation.
- Input forwarding.
- Tab creation and closing.
- Working end-to-end browser interaction.

Verify that the server, not the client, executes website code.

## Phase 2 — Workspaces and persistence

Deliver:

- Workspace management.
- Browser context ownership.
- Persistent tab metadata.
- Session recovery.
- Cross-device reconnect.
- User preferences.
- Resource lifecycle management.

## Phase 3 — Cosmic navigation

Deliver:

- Navigation event tracking.
- Graph data model.
- Cosmic canvas.
- Branching navigation visualization.
- Tab selection from nodes.
- Search.
- Zoom and pan.
- Accessible list/tree equivalent.

## Phase 4 — Split browsing

Deliver:

- Multi-pane workspace.
- Automatic two-site split commands.
- Independent navigation.
- Responsive layouts.
- Pane resizing.
- Layout persistence.
- Independent concurrent operations.

## Phase 5 — AI agent

Deliver:

- Configurable model provider.
- Agent planning.
- Typed browser tools.
- Page observation.
- Real browser actions.
- Verification.
- Error handling.
- Action logs.
- Assisted browsing.
- Autonomous workspaces.

## Phase 6 — Background task execution

Deliver:

- Persistent task queue.
- Background execution preference.
- Checkpoints.
- Pause/resume/cancel.
- Reconnection.
- Approval persistence.
- Worker recovery.
- Notifications.

## Phase 7 — Accessibility

Accessibility requirements must influence every earlier phase; this phase is a focused verification and improvement pass, not the first implementation of accessibility.

Deliver:

- Structured browsing interface.
- Keyboard navigation.
- Screen-reader compatibility.
- Focus mode.
- Reduced motion.
- High contrast.
- Accessible task controls.
- Accessibility test suite.
- Thin-client proof of concept.

## Phase 8 — Streaming and media improvements

Deliver:

- Optimized visual transport.
- Network-quality controls.
- Improved latency.
- Multimedia support where technically feasible.
- Graceful fallbacks.
- Resource-use measurements.

## Phase 9 — Security, reliability, and release

Deliver:

- Hardened deployment.
- Automated tests.
- Multi-user isolation verification.
- Failure recovery testing.
- Documentation.
- Docker Compose deployment.
- Health monitoring.
- Production configuration guidance.

After each phase, execute the actual code and verify its behavior before proceeding.

---

# 22. REQUIRED AUTOMATED TESTS

Implement meaningful tests for the completed functionality.

## 22.1 Browser tests

Verify:

- Opening a website.
- Following a link.
- Going backward.
- Going forward.
- Creating a tab.
- Closing a tab.
- Refreshing a page.
- Typing into a field.
- Clicking an element.
- Recovering from a navigation failure.

## 22.2 Navigation graph tests

Given:

```text
New Tab -> google.com -> nice.com
```

Verify that the graph contains the corresponding navigation nodes and relationships.

Then navigate back and follow a different link.

Verify that the alternative navigation path is represented correctly without corrupting the earlier journey.

Test tab-created-from-tab relationships separately from navigation within the same tab.

## 22.3 Split browsing tests

Given the command:

"Open YouTube and Reddit."

Verify:

- Two panes are created.
- Both targets are assigned correctly.
- Both pages are loaded independently.
- One pane can navigate without changing the other.
- Layout state is retained.

For automated CI, use deterministic local fixture sites representing different destinations rather than relying exclusively on third-party websites.

Include an optional real-site smoke test for YouTube and Reddit.

## 22.4 Agent tests

Use deterministic test pages to verify that the agent:

- Observes page elements.
- Creates a plan.
- Clicks an element.
- Fills a form.
- Verifies the outcome.
- Handles an absent element.
- Recovers from a navigation error.
- Stops when cancelled.
- Respects action limits.

Use mock LLM responses where needed for reproducible automated tests.

Test at least one actual configured model integration when credentials and resources permit.

## 22.5 Approval tests

Verify that an action requiring approval cannot execute before approval is granted.

Test:

- Approval.
- Rejection.
- Expiry.
- Reconnection.
- Duplicate approvals.
- Malicious webpage instructions.
- Attempts to bypass approval through alternate tool calls.

## 22.6 Persistence tests

Verify:

- Session reconnect.
- Workspace recovery.
- Navigation history recovery.
- Task state recovery.
- Background task continuation after client disconnect.
- Appropriate failure reporting after browser process termination.

## 22.7 Multi-user security tests

Verify that user A cannot access:

- User B's streams.
- User B's tabs.
- User B's cookies.
- User B's tasks.
- User B's approvals.
- User B's navigation history.

## 22.8 Accessibility tests

Verify:

- Keyboard-only operation.
- Accessible names.
- Focus visibility.
- Dialog semantics.
- Reduced motion.
- Accessible cosmic navigation alternative.
- Task approval without pointer interaction.

---

# 23. ACCEPTANCE CRITERIA

The project is not considered functionally complete merely because its frontend looks correct.

The following scenarios must work end to end.

### Scenario A — Remote browsing

A user logs in, opens a website, sees server-rendered content, clicks links, types text, and navigates successfully.

### Scenario B — Cosmic browsing history

A user opens Google, navigates to another website, and sees the linked journey in the cosmic canvas.

The nodes are interactive and correspond to real browser history.

### Scenario C — Split-screen browsing

A user enters:

"Open YouTube and Reddit."

The application opens two independent remote browsing panes automatically.

Both panes support navigation and user interaction.

### Scenario D — Parallel AI task

A user asks the AI to research two topics on different websites.

The system creates appropriate browsing contexts, executes independent operations, reports their individual progress, and returns combined results.

### Scenario E — Autonomous background task

A user starts a task with background execution enabled and disconnects.

The task continues according to its settings.

The user reconnects and sees its progress or results.

### Scenario F — Sensitive action

An AI task reaches a sensitive action.

The action pauses.

The user receives an approval request.

The action does not execute without valid approval.

### Scenario G — Human takeover

A user pauses an agent, takes over the browser context, manually performs an action, and returns control to the agent.

The agent reobserves the updated page and continues safely.

### Scenario H — Accessible navigation

A user operates the application without a mouse and accesses tabs, navigation, AI controls, and approvals through semantic keyboard-operable interfaces.

### Scenario I — Cross-device continuity

A user disconnects from one device and reconnects from another.

Their workspace, supported browser state, tasks, and navigation relationships remain available.

### Scenario J — Multiple users

Two users can browse independently without exposing each other's sessions or data.

---

# 24. DOCUMENTATION REQUIREMENTS

Generate:

**README.md**

Explain the application, features, architecture, installation, and use.

**ARCHITECTURE.md**

Document components, data flow, browser workers, engine abstraction, and remote presentation.

**SETUP.md**

Document development and production-like setup.

**AI_AGENT.md**

Explain model providers, tools, task execution, approvals, and limitations.

**ACCESSIBILITY.md**

Document supported interaction modes, accessibility decisions, tests, and known gaps.

**SECURITY.md**

Document the threat model, isolation boundaries, credentials, permissions, and operational safeguards.

**DEPLOYMENT.md**

Explain Linux/Docker deployment, volumes, environment variables, HTTPS/reverse proxy configuration, backups, and maintenance.

**DECISIONS.md**

Record consequential architectural decisions, including alternatives considered.

**PROGRESS.md**

Track implementation progress and remaining work.

**KNOWN_LIMITATIONS.md**

Explicitly document limitations such as unsupported websites, streaming constraints, recovery behavior, and unimplemented optional features.

Provide a complete `.env.example` with explanatory comments and no real secrets.

---

# 25. DEPLOYMENT EXPECTATIONS

The project should run on a self-hosted Linux server.

Provide a documented startup workflow, ideally:

```bash
docker compose up -d --build
```

Include the necessary services for the implemented architecture.

Use persistent volumes for essential application state.

Implement health checks.

Do not publish PostgreSQL, Redis, Chromium debugging interfaces, or other internal services to the public internet.

Expose only the intended application entry point.

Make reverse-proxy deployment straightforward.

Document HTTPS requirements.

Support configuration of resource limits and user/session quotas.

Where feasible, support CPU-only deployment without requiring a dedicated GPU.

If a GPU enables better rendering or streaming, make it optional rather than mandatory.

---

# 26. ENGINEERING QUALITY REQUIREMENTS

Use:

- TypeScript strict mode.
- Clear package boundaries.
- Typed API contracts.
- Database migrations.
- Centralized error handling.
- Structured logging.
- Secure configuration.
- Automated formatting.
- Linting.
- Unit tests.
- Integration tests.
- End-to-end tests.
- Reproducible builds.

Avoid:

- Unbounded retry loops.
- Fragile fixed delays.
- Hardcoded credentials.
- Unnecessary global mutable state.
- Browser processes running without ownership tracking.
- Shared user profiles by accident.
- Unvalidated AI tool arguments.
- Client-side-only authorization.
- Fake progress indicators.
- Placeholder functionality disguised as completed features.

Use meaningful comments for complex browser and agent lifecycle logic.

---

# 27. HOW TO EXECUTE THIS PROJECT

Follow this process autonomously.

### Step 1 — Inspect

Inspect the repository, toolchain, Docker availability, operating system, resources, and current source files.

Do not overwrite existing user work unnecessarily.

### Step 2 — Decide

Make the initial technical decisions.

Document any deviations from the proposed stack.

Choose solutions based on feasibility, maintainability, security, and the requirements in this specification.

### Step 3 — Initialize

Create the real application structure, dependency manifests, configuration, database schema, and development environment.

### Step 4 — Implement

Develop the functional system in vertical slices.

Start with a server-hosted browser a user can actually operate.

Add the cosmic canvas, split browsing, autonomous agent, persistence, approvals, and accessibility capabilities.

### Step 5 — Execute

Run build commands, migrations, services, and the application.

Inspect logs and perform real interactions.

### Step 6 — Test

Run the automated test suites.

Perform end-to-end browser testing.

Inspect actual UI behavior and fix defects.

### Step 7 — Improve

Resolve critical issues, accessibility problems, security gaps, concurrency bugs, and major usability problems.

### Step 8 — Verify

Confirm which acceptance scenarios pass.

Do not claim functionality is complete without evidence.

### Step 9 — Deliver

Provide the working source code, deployment configuration, documentation, and test results.

Do not stop at a theoretical design or generated prototype.

---

# 28. FINAL DELIVERABLES

The expected output is:

1. A working self-hosted browser application.
2. A real server-side Chromium-based browsing engine.
3. A working desktop/mobile client.
4. Authentication and user-specific browser sessions.
5. Persistent tabs, navigation, and workspaces.
6. An interactive cosmic navigation graph.
7. Automatic split-screen browsing.
8. Independent browser contexts for parallel work.
9. A functioning AI browser agent.
10. A human approval and control-handoff system.
11. User-controlled persistent background tasks.
12. Accessible alternative navigation interfaces.
13. A documented lightweight-client protocol and proof-of-concept client.
14. Docker-based deployment.
15. Automated tests and their actual execution results.
16. Complete setup and architecture documentation.
17. An explicit record of remaining limitations.

If some advanced capabilities cannot be completed within the available environment, do not replace them with fake functionality. Implement a legitimate functional fallback, document the limitation, and preserve extensible interfaces for future development.

---

# 29. NON-NEGOTIABLE PRODUCT REQUIREMENTS

The following are fundamental:

- Websites execute on the server, not the user's device.
- The platform uses a real browser engine.
- The user can browse without an LLM.
- Accessibility is part of the core architecture.
- The cosmic canvas represents real navigation relationships.
- Navigation must support branches rather than only a linear list.
- Split panes are independently controllable.
- The AI interacts with real browser sessions.
- Autonomous work may continue after disconnecting when authorized.
- Sensitive actions require enforceable approval checkpoints.
- Users can pause or take over AI-controlled browsing.
- Browser and task state must be recoverable to the extent technically possible.
- Different users' browsing environments must be isolated.
- The software must be genuinely runnable and testable.

---

# 30. FINAL DIRECTIVE

You are not being asked to propose an application.

**You are being asked to engineer and implement it.**

Use your tools, development environment, terminal access, testing capabilities, and software engineering judgment to build the software.

Take ownership of ordinary technical decisions.

Break complex implementation work into manageable stages internally, but continue delivering working functionality rather than stopping after each stage to request confirmation.

Prioritize functional correctness, accessibility, safety, maintainability, and performance over unnecessary complexity.

The final application should combine the following into one coherent product:

**A server-hosted browser, a deeply integrated autonomous AI agent, an accessibility-first interaction platform, a cosmic navigation universe, and a multi-pane intelligent browsing workspace.**

Begin by inspecting the environment and repository, then proceed directly into implementation.

**Build the software. Run it. Test it. Fix it. Verify it. Report accurately what works.**
