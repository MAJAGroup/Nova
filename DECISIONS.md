# Engineering decisions

> Desktop is now the primary product (`npm start`), following the user's updated preference. It uses local Electron Chromium views without starting a server. Unless explicitly marked desktop, the detailed service/agent/deployment sections below describe the optional remote mode (`npm run start:server`). See [README.md](README.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for native behavior and limitations.


1. **Preserve prior work.** The existing Electron app and extension remain intact. The remote browser is a parallel implementation because a local Electron browser cannot satisfy server-side execution.
2. **Single-host modular monolith.** Fastify, React, Playwright and shared TypeScript contracts form one deployable service. Dedicated distributed workers would add failure modes before a working vertical slice.
3. **SQLite instead of PostgreSQL/Redis/BullMQ.** WAL transactions persist logical browser state, tasks, approval checkpoints and device sessions with no external services. This supports a single server process only. Task recovery pauses after server restart rather than claiming a distributed durable worker implementation.
4. **Real image transport first.** JPEG screenshots are delivered with bounded buffering and configurable quality/rate. This validates actual remote rendering and input. WebRTC/Selkies may later provide multimedia transport; no audio capability is claimed today.
5. **Graph visits, not URL identity.** Each navigation occurrence gets an immutable visit ID and parent; opener edges are distinct from same-tab navigation. Back/forward select prior branches. The universe displays pages as stars while preserving a semantic equivalent.
6. **Provider-independent bounded agent.** An explicit JSON action adapter supports OpenAI-compatible and Ollama endpoints without binding to a cloud framework. The master prompt’s self-hosted provider requirements take precedence over cloud defaults in architecture skills. Production contains no test-model fallback.
7. **Conservative approvals.** Every modifying agent tool is gated. This is less autonomous but more defensible than fragile keyword-based sensitive-action detection.
8. **Security layers with explicit limits.** Default Chromium sandbox, separate contexts, private-network egress denial with DNS-pinned connections, ownership checks, origin checking, and encrypted storage checkpoints. This remains weaker than per-tenant isolated workers plus enforced OS egress.
9. **CSS and lazy-loaded React Flow.** Native accessible controls and custom CSS keep the UI straightforward. React Flow loads only in Universe mode; no Tailwind or extra component/state framework is necessary for this initial client.
10. **Node 22 baseline.** The host had Node 20, incompatible with selected native/runtime packages. A pinned development Node 22 package enables local verification; Docker uses Node 22 directly.
