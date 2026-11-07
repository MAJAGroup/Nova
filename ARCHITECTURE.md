# Architecture

> Desktop is now the primary product (`npm start`), following the user's updated preference. It uses local Electron Chromium views without starting a server. Unless explicitly marked desktop, the detailed service/agent/deployment sections below describe the optional remote mode (`npm run start:server`). See [README.md](README.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for native behavior and limitations.


## Components

`apps/api` is a long-running Fastify modular monolith. `packages/browser-engine` provides an engine interface and its Chromium/Playwright adapter. `packages/protocol` defines strict Zod action contracts and shared state/observation types. `packages/security` implements credential helpers and a DNS-pinning egress proxy. `apps/web` is a React/Vite presentation client. `apps/thin-client` is a terminal proof of concept.

SQLite WAL stores users, hashed device sessions, workspace layouts, encrypted storage snapshots, tabs, visit relationships, tasks, steps, and approvals. Foreign keys cascade user deletion. The migration ledger records the initial schema. SQLite is an intentional single-host deviation from the preferred PostgreSQL/Redis stack.

## Data flow

1. The client logs in and receives a random HttpOnly, SameSite session cookie. Only its hash is persisted.
2. Owned workspace tabs map to a browser context; unrelated workspaces have independent cookie/local-storage contexts.
3. Validated actions pass through ownership checks, device control leases, task checks, and per-tab execution serialization.
4. Chromium executes websites and routes HTTP(S) through a destination-filtering proxy. DNS is resolved and checked before connecting to that exact IP.
5. The frame transport takes real viewport JPEG screenshots, then delivers them on an authenticated WebSocket. One outstanding frame operation per socket and buffered-byte limits provide backpressure.
6. Semantic observations extract visible roles, labels, links, headings and field states from that same page. Client requests reference temporary element IDs.
7. Navigation creates distinct visits and parent edges. Back/forward move the current pointer; following another link after going back creates another child. Popup root visits carry an `opener` edge across tabs.
8. API changes are reflected in authenticated state snapshots approximately every 1.5 seconds. Sequence numbers are connection-local; reconnect obtains a complete fresh state rather than replaying events.

## Persistence and lifecycle

Browser contexts launch lazily, stay alive across client disconnects, and suspend after the idle threshold if no active task requires them. Saved Chromium storage state is encrypted with AES-256-GCM using a private data-volume key. Browser disconnects clear runtime maps so the next operation can restore the logical session. Restoration cannot recover JavaScript heap state or native back/forward stacks. Pending tasks pause on server restart and require inspection/resume. Background tasks continue through client disconnects within a live server process.

The engine implementation has lifecycle methods for contexts, pages, screenshot/semantics, input, and storage checkpointing. Other engines and lower-latency transports require their own adapters; interchangeability is not claimed.

## Concurrency

Pages are independent controllers. Browsing commands open split targets concurrently. Task execution is serialized per tab; different tabs can run concurrently within per-user task quotas. A manual device lease lasts 30 seconds, renewed by input; other devices observe until an explicit takeover. Agent handoff waits for any action already in flight before allowing manual input. Server process sharding and distributed task leases are not implemented.
