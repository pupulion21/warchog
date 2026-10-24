// Mirrors PaidDuelEscrowV2 at pupulion21/warchog@3b8eb82. No combat outcome is inferred here.
export type Address = `0x${string}`;
export type RecordId = `0x${string}`;
export type RecoveryAction = 'cancelFunding' | 'refundExpiredFunding' | 'refundExpired' | 'refundRevoked' | 'withdrawFor';
export interface DuelRecord {
  state: number; players: readonly [Address, Address]; signer: Address; signerEpoch: number; fundedMask: number;
  fundingDeadline: bigint; lockedAt: bigint; playDeadline: bigint; settlementDeadline: bigint;
  rulesetHash: RecordId; termsHash: RecordId;
  ledger: { totalDeposited: bigint; unallocated: bigint; outstanding: bigint; totalPaid: bigint };
}
export interface DuelSnapshot {
  id: RecordId; duel: DuelRecord; credit: bigint; revoked: boolean; intakePaused: boolean; resultsPaused: boolean;
  chainTime: bigint;
}
export const isRecordId = (value: string): value is RecordId => /^0x[0-9a-fA-F]{64}$/.test(value);
export const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export function usdc(value: bigint) {
  const cents = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value / 1_000_000n}${cents ? '.' + cents.padEnd(2, '0') : '.00'}`;
}
export function duelView(snapshot: DuelSnapshot, account?: Address, now = snapshot.chainTime) {
  const { duel: d, credit, revoked } = snapshot;
  const seat = account ? d.players.findIndex(p => p.toLowerCase() === account.toLowerCase()) : -1;
  const deposited = seat >= 0 && Boolean(d.fundedMask & (1 << seat));
  const actions: { method: RecoveryAction; label: string }[] = [];
  const labels = ['NOT FOUND', 'AWAITING FUNDING', 'DUEL ACTIVE', 'SETTLED', 'REFUND ALLOCATED'];
  let description = 'No duel exists with this ID on Monad testnet.';
  if (d.state === 1) {
    description = deposited ? 'Your entry is deposited. You can cancel while the other entry is still unpaid.' : 'One entry is deposited. The duel activates only after both assigned players fund it.';
    if (account && deposited && d.fundedMask === (1 << seat)) actions.push({ method: 'cancelFunding', label: 'Cancel & unlock refund' });
    if (now > d.fundingDeadline) {
      description = 'The funding deadline passed. Release the deposited entry, then claim the refund.';
      if (account) actions.push({ method: 'refundExpiredFunding', label: 'Unlock expired entry' });
    }
  } else if (d.state === 2) {
    description = snapshot.resultsPaused ? 'Result acceptance is paused. Entries stay locked until a valid result is accepted or a refund becomes available.' : 'Both entries are locked. The official match result must be confirmed and submitted.';
    if (now > d.playDeadline) description = 'The play window has closed. A result finished in time may still settle before the settlement deadline.';
    if (now > d.settlementDeadline) {
      description = 'The settlement deadline passed without an accepted result. Both paid entries can be released without a fee.';
      if (account) actions.push({ method: 'refundExpired', label: 'Unlock both refunds' });
    }
  } else if (d.state === 3) description = 'The signed result was accepted. The winner and treasury receive claimable credits; claiming transfers the tokens.';
  else if (d.state === 4) description = 'Paid entries were returned as credits with no fee. Each recipient can claim their refund.';
  if (revoked && (d.state === 1 || d.state === 2)) {
    description = 'The result authority was revoked. Paid entries can be released now without a fee.';
    if (account) actions.push({ method: 'refundRevoked', label: 'Unlock refunds' });
  }
  if (account && credit > 0n) actions.unshift({ method: 'withdrawFor', label: `Claim ${usdc(credit)} test USDC` });
  return { label: labels[d.state] ?? 'UNKNOWN STATE', description, seat, deposited, actions };
}
