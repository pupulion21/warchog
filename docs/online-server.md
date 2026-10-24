# WARCHOG online server

The TypeScript/Node backend owns online combat and payment-result authority. Vite attaches it to the same origin during development and preview. `npm run build && npm run server` serves the built game, API and WebSocket from one standalone process (default `127.0.0.1:5190`). Node 24+ is required for built-in SQLite and TypeScript stripping.

## Configuration

`server/config.ts` reads `.local/warchog-server.env` by default, or the path in the process variable `WARCHOG_ENV_FILE`. The file must have permissions **0600**. Process environment values take precedence. Copy the root `.env.example`; never commit the private copy.

| Variable | Purpose |
| --- | --- |
| `WARCHOG_PAYMENTS_ENABLED` | `true` requests paid entry; all live readiness checks must also pass. Default false. |
| `WARCHOG_SIGNER_PRIVATE_KEY` | Dedicated registered result signer, server only. Free play needs no key. |
| `WARCHOG_DB_PATH` | SQLite path, default `.local/warchog.sqlite`. |
| `WARCHOG_ROUND_SECONDS` | Round duration, default 180; included in the rules fingerprint. |
| `WARCHOG_ORIGINS` | Additional allowed browser origins, comma separated. |
| `WARCHOG_HOST`, `WARCHOG_PORT` | Standalone listener; set these in the process environment, default `127.0.0.1:5190`. |

Run `npm run payments:check` to inspect public readiness without exposing the key or sending transactions. Restart after configuration changes. `GET /api/health` reports actual feature gates; a configuration flag alone does not enable prize entry.

## Match rules and authority

Both humans submit bounded, sequenced inputs. The server advances simulation at 60 Hz and broadcasts state at 20 Hz; clients render interpolated state. Input cannot select HP, positions or winners. Inputs expire after 350 ms without updates. Both seats use the same collision, damage, cooldown, dodge, knockdown and KO rules.

Default rules: three-second countdown, 180-second fight, higher remaining HP wins at timeout, equal HP or double KO produces Void. The host selects the map; each player selects their fighter. A fingerprint binds combat/physics/stage/protocol/server sources, round configuration and agreed selections. Paid selections lock before funding.

Esc opens settings while online simulation continues. Leaving an active match forfeits. A disconnect neutralizes input and freezes the match for up to 30 seconds; each seat has a cumulative 60-second reconnect allowance. Rejoining with the same session restores its seat. Exhaustion gives the connected opponent Forfeit; both disconnected gives Void. A process stall over three seconds voids a running match.

## Storage and lifecycle

SQLite stores sessions, challenges, match summaries, final state, replay chunks, paid terms/bindings and signed results. Session cookies are HttpOnly and SameSite=Strict; stored tokens are hashed. Database files are private and are never served. Each completed match has one authoritative outcome and replay commitment.

Rooms live in one process. **A process restart cannot restore an in-progress physics world.** Startup marks unfinished records interrupted; persisted outcomes/proofs and contract recovery stay available. Interrupted paid matches follow the persisted record and eligible Void/refund path rather than resuming a new fight against the same deposit. Back up the database privately. Multiple replicas require shared room ownership/routing.

Waiting rooms and completed objects expire; physics resources are released. Connections, payload size and message rates are bounded. Development/preview close their backend with the owning HTTP server; standalone handles SIGINT/SIGTERM. QA owns isolated databases and closes its own processes.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Public readiness, rules and protocol. |
| `POST /api/session` | Create/resume a guest session. |
| `POST /api/auth/challenge`, `/api/auth/verify` | One-time origin/session/chain-bound wallet authentication. |
| `WS /api/ws` | Create, queue, join, choose, ready, input, leave and server state/events. |
| `GET /api/rooms/lookup` | Room lookup before joining. |
| `GET /api/matches/:code` | Participant-only persisted match evidence. |
| `GET /api/paid/status?code=...` | Funding, contract state and recovery status. |
| `GET /api/paid/history` | Authenticated participant's persisted paid records. |
| `POST /api/paid/result` | Persisted signature for this server's authoritative outcome. |
| `POST /api/paid/bind` | Compatibility binding for a verified, already Active record. |

Mutations and WebSocket connections check origin. Paid rooms require two authenticated distinct wallets. No endpoint signs a browser-supplied winner. A record cannot fund two rooms; requests synchronize and proofs persist before delivery.

## Paid lifecycle

Both players lock their selections. The server agrees unique immutable terms, ordered wallets, rules hash, signer snapshot and funding deadline. Each player approves/deposits with their own wallet. The server waits for finalized public-chain state and validates the exact terms before allowing combat; the localhost EVM fixture uses latest state.

The result signer validates contract policy, signer/epoch, pauses, revocation, timing, record binding and replay commitment. It preserves the deployed EIP-712 domain `CHOG Paid Duel` / `2`, stage 0 and sequence 1. Only authoritative Finished, Forfeit or Void results can produce proofs. The browser submits settlement and separately claims credit; the backend never sends token transactions.

Cached proofs/history can be recovered without signing again. Signer changes, pauses, deadlines and transfer failures retain eligible cancellation/refund/claim paths. Free play works without payment configuration and never creates escrow credit.

See [the root README](../README.md) for setup and [contract integration](warchog-contract-integration.md) for exact contract behavior. Local payment acceptance passed; public-testnet two-wallet acceptance remains outstanding.
