# Setup

> Desktop is now the primary product (`npm start`), following the user's updated preference. It uses local Electron Chromium views without starting a server. Unless explicitly marked desktop, the detailed service/agent/deployment sections below describe the optional remote mode (`npm run start:server`). See [README.md](README.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for native behavior and limitations.


1. Install Node 22.12+ and npm. Allocate approximately 2 CPU cores and 4 GiB RAM for a few lightweight tabs; heavy websites may require much more.
2. Run `npm ci` and `npx playwright install --with-deps chromium`. Chromium downloads approximately 320 MiB plus media and OS libraries. Installation may need administrator privileges for system dependencies.
3. Copy `.env.example` to `.env`. `npm run start:server` loads it automatically. Development watchers inherit exported environment variables.
4. Run `npm run build`, then `npm run start:server`. Register through the UI. There is no default account.
5. For external devices, configure HTTPS and a reverse proxy; see DEPLOYMENT.md. Cookies must be secure over HTTPS and PUBLIC_ORIGIN must match exactly.

Default URLs listen on loopback. Internal browsing is denied unless an administrator lists an exact `host:port` in `ALLOW_INTERNAL_HOSTS`. This exception grants access to that destination, so use it sparingly. Never add metadata endpoints or infrastructure services.

Chromium sandboxing defaults to enabled. Do not silently disable it if the host disallows namespaces. `CHROMIUM_SANDBOX=false` exists only for trusted fixture development. Production needs a sandbox-compatible host/runtime and network-level egress controls.

For Ollama, set `AI_PROVIDER=ollama`, `AI_BASE_URL=http://127.0.0.1:11434`, and an installed `AI_MODEL`. For OpenAI-compatible services use the provider’s `/v1` base URL, model, and optional server-side key. Restart after changing configuration. No external AI service is required for browsing.

Useful checks: `/api/health`, `npm run typecheck`, `npm test`. Fixture sites and the deterministic model are created by tests only. Normal production navigation always uses real Chromium.
