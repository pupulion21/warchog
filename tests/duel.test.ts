import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duelView, isRecordId, usdc, type Address, type DuelSnapshot } from '../src/duel-model.ts';
const a: Address = '0x000000000000000000000000000000000000000a';
const b: Address = '0x000000000000000000000000000000000000000b';
const stranger: Address = '0x000000000000000000000000000000000000000c';
function snap(state = 1): DuelSnapshot {
  return { id: `0x${'1'.repeat(64)}`, credit: 0n, revoked: false, intakePaused: false, resultsPaused: false, chainTime: 100n,
    duel: { state, players: [a, b], signer: stranger, signerEpoch: 1, fundedMask: state === 1 ? 1 : 3,
      fundingDeadline: 200n, lockedAt: 100n, playDeadline: 3700n, settlementDeadline: 4600n,
      termsHash: `0x${'2'.repeat(64)}`, rulesetHash: `0x${'3'.repeat(64)}`,
      ledger: { totalDeposited: state === 1 ? 1_000_000n : 2_000_000n, unallocated: 0n, outstanding: 0n, totalPaid: 0n } } };
}
const actions = (s: DuelSnapshot, account?: Address, now = s.chainTime) => duelView(s, account, now).actions.map(a => a.method);
test('only a sole deposited seat can cancel an unfunded duel', () => {
  assert.deepEqual(actions(snap(), a), ['cancelFunding']);
  assert.deepEqual(actions(snap(), b), []); assert.deepEqual(actions(snap(), stranger), []); assert.deepEqual(actions(snap()), []);
  const s = snap(); s.duel.fundedMask = 2; assert.deepEqual(actions(s, b), ['cancelFunding']); assert.deepEqual(actions(s, a), []);
});
test('funding expiry is strict and permissionless, including during intake pause', () => {
  const s = snap(); s.intakePaused = true;
  assert.deepEqual(actions(s, stranger, 200n), []);
  assert.deepEqual(actions(s, stranger, 201n), ['refundExpiredFunding']);
});
test('active duels have no unilateral cancel or refund at the end of the play window', () => {
  for (const account of [a, b, stranger]) assert.deepEqual(actions(snap(2), account, 3701n), []);
});
test('active refund opens after settlement, including while results and intake are paused', () => {
  const s = snap(2); s.intakePaused = true; s.resultsPaused = true;
  assert.deepEqual(actions(s, a, 4600n), []); assert.deepEqual(actions(s, stranger, 4601n), ['refundExpired']);
});
test('revocation opens immediate recovery for Funding and Active, never terminal records', () => {
  for (const state of [1, 2]) { const s = snap(state); s.revoked = true; assert.ok(actions(s, stranger).includes('refundRevoked')); }
  for (const state of [0, 3, 4]) { const s = snap(state); s.revoked = true; assert.deepEqual(actions(s, stranger), []); }
});
test('allocated winner or refund credit requires a separate claim, despite pauses', () => {
  for (const state of [3, 4]) {
    const s = snap(state); s.credit = state === 3 ? 1_900_000n : 1_000_000n; s.resultsPaused = true; s.intakePaused = true;
    assert.deepEqual(actions(s, a), ['withdrawFor']); assert.deepEqual(actions(s), []);
    assert.ok(duelView(s, a).actions[0].label.includes(state === 3 ? '1.90' : '1.00'));
    s.credit = 0n; assert.deepEqual(actions(s, a), []);
  }
});
test('settled zero credit never implies this wallet won or has already received payment', () => {
  const view = duelView(snap(3), b);
  assert.equal(view.label, 'SETTLED'); assert.doesNotMatch(view.description, /you won|you lost|you were paid/i);
});
test('result pause and play/settlement windows are separate states', () => {
  const s = snap(2); s.resultsPaused = true;
  assert.match(duelView(s, a).description, /paused/);
  assert.match(duelView(s, a, 3701n).description, /may still settle/);
  assert.match(duelView(s, a, 4601n).description, /without a fee/);
});
test('record IDs require exactly one bytes32 and credits retain all six decimals', () => {
  assert.ok(isRecordId(`0x${'aF'.repeat(32)}`));
  for (const id of ['0x123', `0x${'g'.repeat(64)}`, `<script>${'a'.repeat(64)}`, `0x${'a'.repeat(65)}`]) assert.equal(isRecordId(id), false);
  assert.equal(usdc(1_900_000n), '1.90'); assert.equal(usdc(1_000_000n), '1.00'); assert.equal(usdc(1n), '0.000001'); assert.equal(usdc(0n), '0.00');
});
