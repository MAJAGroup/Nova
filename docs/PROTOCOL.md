# Lightweight client protocol, version 1

Use HTTPS remotely. The terminal proof of concept (`npm run thin`) implements this protocol without embedding a browser engine. Set `COSMIC_URL`; passwords are entered hidden or supplied via `COSMIC_PASSWORD`. Provision an account first through the web interface. Avoid putting credentials into shell history.

All endpoints are under `/api`. Mutations require `Content-Type: application/json` and `X-Cosmic-Client: 1`. Browser origins must match PUBLIC_ORIGIN. Login returns a `cosmic` cookie; retain it securely and send it with subsequent requests. Do not expose it in logs.

| Request | Body / result |
| --- | --- |
| POST `/auth/register`, `/auth/login` | `{email,password}` → cookie |
| POST `/auth/logout` | `{}` → revokes current device |
| GET `/state` | Owned workspaces, tabs, visits, tasks, steps, approvals and preferences |
| POST `/workspaces` | `{name}` |
| POST `/tabs` | `{workspace,url?,opener?}` |
| POST `/tabs/:id/close`, `/restore` | `{}` |
| POST `/tabs/:id/control` | `{}` → pauses task and explicitly takes device control |
| POST `/tabs/:id/action` | Validated action from `packages/protocol` |
| GET `/tabs/:id/structure` | `{url,title,text,elements,snapshot}` |
| POST `/workspaces/:id/layout` | `{panes:[tabIds],layout:"horizontal"|"vertical",ratio:20..80}` |
| POST `/command` | `{workspace,command}` → deterministic workspace operation |
| POST `/tasks` | `{tab,goal,background,externalPageConsent:true,mode?:"assisted"|"autonomous"}` |
| POST `/tasks/:id/pause`, `/resume`, `/cancel` | `{}` |
| POST `/approvals/:id` | `{approve:boolean}` |
| GET `/devices` | Owned signed-in devices |
| DELETE `/devices/:id`, `/history`, `/account` | Revoke / clear / delete, respectively |
| POST `/preferences` | `{reducedMotion,highContrast,fontScale:1..1.6}` |
| GET `/health` | API liveness, browser connection, contexts, RSS |

Actions: `navigate {url}`, `back`, `forward`, `reload`, `observe`, `click {element}`, `fill {element,text}`, `pointer {x,y}`, `key {key}`, `text {text}`, `scroll {x,y}`, `resize {width,height}`. Discriminant is `type`. Semantic element IDs are scoped to a current live page; refresh structure after navigation. Error responses contain `{error:string}` with HTTP status. Ownership is always enforced server-side.

## Realtime/frame channel

Connect to `/api/live` by WebSocket with the session cookie and same browser origin. A `state` event contains `{type,seq,state}`. Clients may request `{type:"frame",tab,quality:25..85}`. Responses are `{type:"frame",tab,seq,jpeg}` with a base64 JPEG. The intrinsic JPEG dimensions define coordinates for pointer actions; scale client pointer positions accordingly. At most one frame operation is active per socket; overlapping frame requests may be discarded. Keep requests bounded (the web client uses 1–5 total FPS), and do not queue requests when disconnected or hidden.

Reconnect with exponential/backoff policy appropriate to your device and replace local state with the next full `state`. Sequence numbers are monotonically increasing only within one connection. Expired/revoked sessions close the connection. The web client reconnects every two seconds and suppresses frames while hidden. Error events report protocol/action failures; they are never cross-user broadcasts.
