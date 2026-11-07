# Linux deployment

> Desktop is now the primary product (`npm start`), following the user's updated preference. It uses local Electron Chromium views without starting a server. Unless explicitly marked desktop, the detailed service/agent/deployment sections below describe the optional remote mode (`npm run start:server`). See [README.md](README.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for native behavior and limitations.


## Startup

Use Docker Engine/Compose on a Linux host that allows Chromium sandbox user namespaces. Allocate an initial 2 vCPU / 4 GiB RAM / 5 GiB free disk; actual capacity depends on websites, frame rate, and simultaneous users. CPU-only operation is supported. A GPU is not required.

```bash
cp .env.example .env
# Edit the origin, secure cookie option, model settings, and quotas.
docker compose up -d --build
docker compose logs -f cosmic
```

Only the application’s loopback-bound port 3000 is published. No database, proxy or Chromium debugging port is exposed. The application runs as the non-root `node` user, with init process, shared-memory allocation, PID, CPU and RAM limits. The named `cosmic-data` volume contains SQLite, encrypted storage snapshots, and the encryption key. Keep it private.

The image installs development/build tooling because the server uses the TypeScript loader at runtime. This is a reproducible convenience rather than a minimal release image. A production release should split build/runtime images, compile the server, scan/pin the base image digest, and remove Electron packaging dependencies from the remote service manifest.

## HTTPS reverse proxy

Use your existing Caddy, nginx, Traefik or equivalent. For example, with Caddy on the host:

```caddyfile
browser.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Set `PUBLIC_ORIGIN=https://browser.example.com` and `COOKIE_SECURE=true` before recreation. Preserve the WebSocket upgrade. Do not publish the service directly on plain HTTP for other devices. When deploying a separate proxy container, use a private container network rather than publishing additional internal ports.

## Sandboxing and egress

Sandboxing remains enabled in Compose. Some container hosts deny the namespace syscalls Chromium requires. Configure a reviewed seccomp profile allowing Chromium’s required namespace operations; do not use `privileged`, globally disable seccomp, or disable Chromium sandboxing for public deployments. Follow the upstream [Playwright sandbox guidance](https://playwright.dev/docs/docker).

Apply host/network egress restrictions in addition to the application DNS-pinning proxy. The current browser worker shares the API container and process ownership boundary. Untrusted public multi-tenant service needs separately isolated workers and independent security review.

## Configuration and operations

`.env.example` lists every supported deployment knob. `MAX_TABS` is per user, five workspaces are allowed per user, two active tasks per user, `MAX_CONTEXTS` is server-wide, and idle contexts suspend after `IDLE_TIMEOUT_MS`. Tune quotas below host limits. Health checks report API liveness, context count, browser connection and API RSS; per-browser-process memory accounting is deferred.

Disable registration after creating intended accounts if appropriate. Revoke compromised devices from Settings. Keep model API keys only in deployment environment/secret injection. No default credentials are provided.

## Backups and upgrades

Stop the service before copying the complete data volume, including SQLite WAL/SHM files if present and `storage.key`. Protect backups as sensitive browsing data. Restore to a test deployment before an upgrade. Losing the encryption key loses saved browser authentication state. Never copy a live SQLite file alone and assume a consistent backup.

Rebuild after dependency updates and run tests. Restore URLs and supported storage after restart; users must inspect and resume interrupted tasks. The application does not replay uncertain actions after a crash.

## Verification status

The local application, real Chromium, native Electron application, and packaged Linux browser were executed. Container deployment was not executed. The initial sandbox check hit a Podman read-only runtime error; subsequent release work focused on the desktop artifact after the user changed the product direction. Compose should be verified on the intended supported host before use.
