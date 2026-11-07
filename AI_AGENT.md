# Browser agent

> Desktop is now the primary product (`npm start`), following the user's updated preference. It uses local Electron Chromium views without starting a server. Unless explicitly marked desktop, the detailed service/agent/deployment sections below describe the optional remote mode (`npm run start:server`). See [README.md](README.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for native behavior and limitations.


The runner uses a bounded observe → model action → validate → authorize → execute → observe loop. Supported model actions include navigation, semantic click/fill, scroll, observation, and completion. All actions are parsed using a discriminated Zod schema; arbitrary code, shell access and filesystem tools are not exposed.

Configure `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, and optionally `AI_API_KEY`. OpenAI-compatible `/chat/completions` and Ollama `/api/chat` JSON responses are supported. The current adapter uses explicit JSON action output rather than provider-specific native tool calling. Unsupported response formats fail with a visible error. Requests use a 45-second timeout, bounded response and page observation sizes, temperature zero, and at most two model retries per run.

Each task permits at most 20 actions. Each uninterrupted run has a five-minute time limit. Tasks support assisted mode on the selected tab and an autonomous workspace with an isolated cookie context. Autonomous work starts at the selected page URL without copying credentials. Two active tasks per user may run on separate tabs. Combined multi-topic planning and synthesis are not implemented.

The user must explicitly consent to sending page text and control names to the configured provider for each task. Fields of type password are omitted from semantic values, but page text may itself contain private information. Model credentials remain on the server.

## Approval and handoff

The server requires approval for **all modifying agent actions**, including navigation, clicks, text entry, keys, pointer input, and resizing. It does not trust the model to classify risk. Observe, scroll, and finish are read-only exceptions. Each persisted approval is bound to an exact action, task, owner, page-observation hash, and ten-minute expiry. It is consumed before execution. Rejecting or taking manual control pauses the task and invalidates pending approvals. A page change invalidates approval; resume requests a fresh observation and plan.

Actions with uncertain outcomes are never automatically repeated. A server restart pauses active tasks for inspection. Background continuation is opt-in and lasts across client disconnects, not unverified automatic execution after a process crash. Disabling background pauses on the last WebSocket disconnect. The terminal proof of concept does not maintain a presence socket, so use background=true for terminal-created tasks.

Task logs show observations, proposals, approvals and post-action observations. Observation verifies that the engine can read resulting state; it does not guarantee a model’s interpretation or completion claim. CAPTCHAs, paywalls and access-control challenges require human intervention.

Tests use a clearly isolated deterministic HTTP model fixture against real browser pages. No live provider credentials were available, so actual model quality and compatibility remain unverified.
