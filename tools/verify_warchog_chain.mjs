// Finite, read-only deployment check. Does not connect a wallet or submit transactions.
import { createPublicClient, fallback, http } from 'viem';
import { monadTestnet } from 'viem/chains';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const abi = JSON.parse(readFileSync('contracts/abi/PaidDuelEscrowV2.json'));
const deployment = JSON.parse(readFileSync('contracts/deployments/monad-testnet.json'));
const client = createPublicClient({ chain: monadTestnet, transport: fallback([
  http('https://rpc-testnet.monadinfra.com', { timeout: 12000, retryCount: 0 }),
  http('https://testnet-rpc.monad.xyz', { timeout: 12000, retryCount: 0 }),
], { rank: false, retryCount: 0 }) });
const report = { checkedAt: new Date().toISOString(), upstream: 'pupulion21/warchog@3b8eb82', readOnly: true, checks: [] };
function check(name, pass) { report.checks.push({ name, pass: Boolean(pass) }); }
try {
  check('Pinned source SHA-256 matches deployment manifest', Object.entries(deployment.sourceSha256).every(([path, hash]) => createHash('sha256').update(readFileSync(path)).digest('hex') === hash));
  const chainId = await client.getChainId();
  check('RPC chain is Monad testnet 10143', chainId === deployment.chainId);
  const block = await client.getBlock();
  const names = ['policy','token','treasury','nextSigner','nextSignerEpoch','intakePaused','resultsPaused','totalReserved'];
  const values = await client.multicall({ allowFailure: false, blockNumber: block.number, contracts: names.map(functionName => ({ address: deployment.address, abi, functionName })) });
  report.live = Object.fromEntries(names.map((name, i) => [name, values[i]]));
  report.blockNumber = block.number; report.chainTime = block.timestamp;
  check('Live entry, prize, fee and all deadlines match pinned policy', Object.entries(deployment.policy).every(([key, value]) => BigInt(report.live.policy[key]) === BigInt(value)));
  check('Live token is the pinned Circle USDC contract', report.live.token.toLowerCase() === deployment.token.address.toLowerCase());
  check('Live treasury matches deployment manifest', report.live.treasury.toLowerCase() === deployment.roles.treasury.toLowerCase());
  check('Contract intake remains closed in application configuration', deployment.applicationPaymentsEnabled === false);
} catch (error) { report.error = error.shortMessage ?? error.message; check('Live deployment readable', false); }
report.pass = report.checks.every(check => check.pass);
mkdirSync('validation', { recursive: true });
writeFileSync('validation/warchog-chain-read.json', JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
console.log(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
if (!report.pass) process.exitCode = 1;
