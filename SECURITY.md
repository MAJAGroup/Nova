# Security

> Desktop is now the primary product (`npm start`), following the user's updated preference. It uses local Electron Chromium views without starting a server. Unless explicitly marked desktop, the detailed service/agent/deployment sections below describe the optional remote mode (`npm run start:server`). See [README.md](README.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for native behavior and limitations.


Remote browsers execute untrusted website code. This implementation is intended for controlled self-hosting and continued hardening, not an assertion of production-grade tenant isolation.

## Implemented boundaries

- Salted scrypt password hashes; random, hashed, expiring, revocable device tokens; HttpOnly/SameSite cookies. Use secure cookies and HTTPS remotely.
- Server-side ownership checks for workspaces, tabs, structures, actions, frames, tasks, approvals, history and sessions. WebSocket sessions revalidate authentication while connected.
- Exact origin checks plus a required custom mutation header; no cross-origin API access. CSP forbids inline scripts, framing, remote scripts and third-party resources in the application UI.
- Separate Chromium contexts per workspace, server-owned browser handles, no exposed debugging listener. Chromium sandbox enabled by default. Downloads canceled, permissions ungranted, service workers blocked.
- A local HTTP/CONNECT egress proxy resolves and validates every destination, rejects private/reserved/mapped/metadata addresses and non-web ports, then connects to the checked IP. Chromium proxy configuration includes loopback traffic and disables direct WebRTC UDP and QUIC. Routes reject non-HTTP(S) requests.
- Browser storage checkpoints use AES-256-GCM encryption with a generated private data-volume key. Protect and back up that key with the database. Task and navigation metadata remain plaintext within the private data directory.
- Strict input/tool validation, rate limits, tab/workspace/context/task quotas, idle cleanup, bounded frame buffers, model/action/time limits, deterministic action approvals.
- History clearing, session revocation, and account deletion with cascade cleanup.

## Threats and remaining work

A browser context is not a process/container isolation boundary. Tenants currently share a Chromium process. A Chromium exploit could escape context boundaries; an application egress proxy cannot replace a host firewall or container network policy after a process compromise. Before serving mutually untrusted tenants, isolate workers by user, enforce OS/network egress restrictions, add administrative monitoring, independent penetration testing and worker resource accounting.

Also remaining: per-IP registration quotas stronger than request rate limiting, password reset/MFA/email verification, key rotation, browser permission approval workflows, complete log/data retention policies, rate-limiting by user/task, SSO, downloadable security audit report, and tested backup restores. TLS termination is external. Never disable the sandbox to make public hosting easier.

Web content is untrusted input to the model. Page instructions cannot authorize tools; all modifying tools require server approval. Human approvals can still be socially engineered, so review the exact action and destination. There is no unrestricted agent shell or page JavaScript execution tool.

Report issues privately to the deployment administrator. Do not include credentials or private browsing contents in issue reports.
