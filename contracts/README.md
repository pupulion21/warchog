# WARCHOG 1v1 escrow

`PaidDuelEscrowV2.sol` and `EscrowAccounting.sol` are the unchanged source for the existing Monad testnet deployment. No proxy or upgrade mechanism is used. The token, treasury and fee are immutable.

## Funding and settlement

1. Persist ordered player addresses, a unique salt, ruleset hash, current signer/epoch and funding deadline. Call `previewDuelId` to obtain the onchain record ID.
2. An assigned player approves the escrow for 1,000,000 USDC units and calls `createAndFundDuel` with those terms.
3. The other player approves the same amount and calls `fundDuel`. The second deposit activates the duel atomically.
4. The record's locked signer signs the complete EIP-712 `Result`. Anyone can deliver it with `submitResult`.
5. A normal/forfeit result allocates 1,900,000 units to the eligible winner and 100,000 to the immutable treasury. `withdrawFor(recordId, recipient)` transfers each allocated credit to its bound recipient.

A cancellation/refund allocates credit first; `withdrawFor` performs the token transfer separately. The sole depositor can cancel while Funding. Funding may expire after its deadline; active settlement expires after 75 minutes. A valid Void or signer revocation also opens the applicable refund path. A player cannot cancel an active duel unilaterally. Record IDs are single-use.

## Signed result

Use the domain, ABI and policy from `deployments/monad-testnet.json`. Preserve **CHOG Paid Duel**, version **2**, chain ID **10143** and the deployed verifying-contract address. The ABI describes every `Result` field. Do not omit terms, ruleset/replay hashes, stage, ordered participants, sequence, epoch or deadlines.

The signer determines gameplay results. The contract validates authorized signatures, eligibility and fixed payouts; a replay hash does not prove honest gameplay. Owner/guardian may pause intake/results or revoke a signer. Only the owner can unpause/rotate roles; ownership transfer requires acceptance. USDC issuer pause/blacklist can delay token transfers, while failed transfers retain the credit.

## Validation and provenance

The deployment receipt finalized at block 73722106. Runtime and constructor roles were checked, and the verification service reported source verification on both explorers. Public testnet gameplay transactions have not been exercised by this package.

The 48-test Duel suite and mock-token harness were imported from the deployment working tree. The earlier 117-test result covered the wider CHOG contract project, including legacy and tournament suites; it must not be presented as 117 WARCHOG Duel tests. Source SHA-256 hashes are recorded in the deployment manifest. No historical git commit is claimed to identify previously untracked V2 files.

The original standard JSON input preserves deployment-time import paths. Recompile it with the recorded Solidity version to reproduce verification. This standalone project's remapping only changes the dependency location for convenient local development.
