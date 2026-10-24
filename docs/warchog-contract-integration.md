# WARCHOG contract integration

The source of truth is the original escrow package from [pupulion21/warchog@3b8eb82](https://github.com/pupulion21/warchog/tree/3b8eb82): `PaidDuelEscrowV2.sol`, ABI, deployment and Foundry tests. The deployed Solidity, ABI and deployment metadata remain unchanged. The game adds an authoritative Node backend, wallet-authenticated funding and result/claim UI.

## Modes

| Mode | Authority |
| --- | --- |
| 1v1 Duel, free | Two-human server simulation, private rooms and matchmaking. |
| 1v1 Duel, prize | Server simulation bound to an on-chain escrow record; enabled only after live readiness checks. |
| VS Computer / Training | Free local simulation; never generates payment credit. |
| Tournaments | Coming soon; no tournament contract is present. |

Fighter moves, maps, HP, hits and animations are game rules. The escrow commits the rules/terms and accepts signed outcomes. `Result.stage == 0` is the single match slot, not an arena ID. Both parties agree their fighters, map and rules fingerprint before deposits.

## Policy

Monad testnet chain **10143**, escrow `0xFf4553156a4F75feB47674bB8e96C537404413bd`, six-decimal token `0x534b2f3A21130d7a60830c2Df862319e593943A3`. The browser pins its destination from deployment metadata; query strings or API responses cannot redirect transactions.

Each player funds **1 test USDC**. Finished/Forfeit allocates **1.90** to the winner and **0.10** to treasury. Void returns funded entries. Allocation creates a credit; `withdrawFor(recordId, recipient)` transfers that credit to the fixed recipient. The UI distinguishes accepted result, allocated credit and successful token transfer.

Funding must end within 15 minutes of creation (application terms use ten minutes). The second deposit activates atomically. The outer play window is 60 minutes from activation and settlement window 75 minutes. The normal fight is 180 seconds. Refund deadlines use strict greater-than comparisons, matching Solidity.

## End-to-end flow

1. Each participant connects their wallet and signs a one-time login challenge. This transfers nothing and approves nothing.
2. Both select and lock fighters/map. The server persists unique terms, ordered participants, rules hash, salt, recorded signer/epoch and funding deadline, then uses `previewDuelId` / `termsHash`.
3. Each wallet approves exactly one entry and separately deposits. Both funding orders are supported. Pending transactions do not start gameplay.
4. The server verifies finalized Active state, exact binding and live signer/policy before starting the authoritative round. Public-chain clock drift is bounded.
5. The server persists its Finished, Forfeit or Void outcome and replay commitment, then signs the exact EIP-712 Result. The deployed domain remains **`CHOG Paid Duel` / `2`**, stage **0**, sequence **1**, with the original chain and verifying contract.
6. A player submits the verified proof with their wallet. After a successful receipt, eligible credit can be claimed in a separate transaction. No server account submits these transactions.

Wallet/network changes invalidate previous account state. Writes reread policy/eligibility, check identity, simulate and await successful receipts. Rejection, timeout and revert remain visible. Transaction hashes alone never mean paid, settled or claimed.

## Recovery

| State or condition | Available contract action |
| --- | --- |
| Funding, sole depositor | `cancelFunding` |
| Funding, strictly past funding deadline | `refundExpiredFunding` |
| Active | Await official result; no unilateral cancellation. |
| Active, strictly past settlement deadline | `refundExpired` |
| Nonterminal record with revoked recorded signer | `refundRevoked` |
| Complete or Cancelled with positive viewer credit | `withdrawFor(id, connectedAccount)` |

Intake pause stops new deposits; result pause stops accepting outcomes. Neither blocks eligible refunds or withdrawals. Signer rotation changes new records, while old records retain their signer and epoch. Revocation opens recovery for nonterminal records. A failing token transfer leaves credit intact.

Participant history and cached proofs persist in SQLite and support session recovery. Public record lookup/recent IDs are also available; recent IDs are a bounded local list, not a complete wallet indexer. After a backend restart an active physics world is interrupted; persisted payment evidence drives recovery, never a client-declared winner.

## Configuration and validation

The historical deployment field `applicationPaymentsEnabled: false` is preserved. The application uses the private `WARCHOG_PAYMENTS_ENABLED` flag plus verified live chain readiness. A fresh clone keeps paid entry closed until a correctly registered signer is configured. See [backend setup](online-server.md); keep its key out of the browser and Git.

Node tests cover payment state, binding, authentication and signer rejection. The real localhost EVM/two-browser suite passed 23 checks against the original escrow, including both funding, Finished/Forfeit/Void, claims, pause/cancel and transfer-failure recovery. The broader browser suite passed 194 checks. Reports are linked in [README](../README.md).

These checks used isolated local funds and temporary keys. No public-chain transaction was sent during implementation; a real two-wallet Monad testnet acceptance run remains outstanding.
