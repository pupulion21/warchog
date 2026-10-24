export type PaymentAddress = `0x${string}`;
export type PaymentHex = `0x${string}`;
export interface EscrowProfile {
  chainId: number; name: string; address: PaymentAddress; token: PaymentAddress;
  rpcUrls: string[]; explorer: string; expectedSigner?: PaymentAddress; localTest?: boolean;
}
export const PAYMENT_POLICY = { entry: 1_000_000n, pool: 2_000_000n, winnerAward: 1_900_000n,
  treasuryFee: 100_000n, feeBps: 500, maxFundingWindow: 900n, playWindow: 3600n, settlementWindow: 4500n } as const;
export interface DuelTerms {
  salt: PaymentHex; players: [PaymentAddress, PaymentAddress]; rulesetHash: PaymentHex;
  signer: PaymentAddress; signerEpoch: number; fundingDeadline: string;
}
export interface PaidStatus {
  stage: 'preparing'|'funding'|'active'|'result-ready'|'settled'|'cancelled'|'recovery'|'unavailable';
  message: string; recordId?: PaymentHex; terms?: DuelTerms; termsHash?: PaymentHex;
  fundedMask: number; contractState: number; fundingDeadline?: string; playDeadline?: string; settlementDeadline?: string;
  signerRevoked?: boolean; resultsPaused?: boolean; checkedAt?: number;
}
export interface ResultMessage {
  recordId: PaymentHex; matchId: PaymentHex; stage: number; participantA: PaymentAddress; participantB: PaymentAddress;
  winnerRecipient: PaymentAddress; outcomeType: number; termsHash: PaymentHex; rulesetHash: PaymentHex; replayHash: PaymentHex;
  finishedAt: string; resultSequence: number; signerEpoch: number; expiresAt: string;
}
export interface ResultProof { message: ResultMessage; signature: PaymentHex }
export const RESULT_TYPES = { Result: [
  {name:'recordId',type:'bytes32'},{name:'matchId',type:'bytes32'},{name:'stage',type:'uint8'},
  {name:'participantA',type:'address'},{name:'participantB',type:'address'},{name:'winnerRecipient',type:'address'},
  {name:'outcomeType',type:'uint8'},{name:'termsHash',type:'bytes32'},{name:'rulesetHash',type:'bytes32'},
  {name:'replayHash',type:'bytes32'},{name:'finishedAt',type:'uint64'},{name:'resultSequence',type:'uint32'},
  {name:'signerEpoch',type:'uint32'},{name:'expiresAt',type:'uint64'},
] } as const;
