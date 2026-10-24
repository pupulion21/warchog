# WARCHOG

Smart-contract package for WARCHOG 1v1 duels on Monad testnet. The game website and 3D gameplay are developed separately. Tournaments are coming soon and no tournament contract is included here.

The deployed **PaidDuelEscrowV2** is at [`0xFf4553156a4F75feB47674bB8e96C537404413bd`](https://testnet.monadscan.com/address/0xFf4553156a4F75feB47674bB8e96C537404413bd#code), chain **10143**. It was deployed at block **73722106** and source-verified on Monadscan and MonadVision.

Each player deposits **1 USDC testnet**. The winner receives **1.90 USDC** and the treasury **0.10 USDC**. Cancellation where permitted, Void and expiry allocate full refunds without the platform fee. Allocated funds are paid with `withdrawFor`; refunds and withdrawals remain available during escrow pauses. MON pays network gas.

## Build and test

Install Node.js/npm and Foundry with Solidity 0.8.38 available, then run:

```sh
npm ci
npm run contracts:build
npm run contracts:test
```

Validation for this package: **48 Duel tests passed, zero failed/skipped** with the local Monad execution model and 256 cases per fuzz test. See [validation details](contracts/validation.json).

The included Duel suite uses local mock tokens. A passing local test does not establish that public testnet deposits, settlement, payouts or refunds have been exercised. Game payment integration is not enabled by this package.

## Integration

- [Deployed addresses, roles, ABI hash and policy](contracts/deployments/monad-testnet.json)
- [Public contract ABI](contracts/abi/PaidDuelEscrowV2.json)
- [Contract flow and signature details](contracts/README.md)
- [Original compiler verification input](contracts/verification/standard-input.json)

The Solidity source is unchanged from the verified deployment. Its existing contract name and EIP-712 domain are preserved: **`CHOG Paid Duel` / version `2`**. WARCHOG integrations must use that exact domain.

The standalone Foundry configuration points to this repository's root `node_modules`. That changes import paths in compiler metadata. Use the original standard JSON input and exact compiler version in `contracts/verification/` to reproduce the deployment compilation and explorer verification; do not claim a standalone rebuild has identical metadata.

Private keys and local environment files are excluded. The manifest contains public addresses only. These deployment roles are for testnet; use fresh keys for a mainnet release.
