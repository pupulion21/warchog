import { createPublicClient, createWalletClient, custom, fallback, http, defineChain, erc20Abi, recoverTypedDataAddress, encodeAbiParameters, keccak256, type Abi, type EIP1193Provider } from 'viem';
import { monadTestnet } from 'viem/chains';
import rawAbi from '../contracts/abi/PaidDuelEscrowV2.json';
import { escrowProfile } from './chain-profile.ts';
import { PAYMENT_POLICY, RESULT_TYPES, type DuelTerms, type ResultProof } from './payment-types.ts';
import { duelView, type Address, type RecordId, type DuelRecord, type DuelSnapshot, type RecoveryAction } from './duel-model.ts';

export const escrow = escrowProfile.address;
export const token = escrowProfile.token;
export const abi = rawAbi as Abi;
export const chain = escrowProfile.localTest?defineChain({id:escrowProfile.chainId,name:escrowProfile.name,nativeCurrency:{name:'Local Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:escrowProfile.rpcUrls}}}):{ ...monadTestnet,blockExplorers:{default:{name:'Monadscan',url:escrowProfile.explorer}} };
export const publicClient = createPublicClient({ chain, transport: fallback(escrowProfile.rpcUrls.map(url=>http(url,{timeout:10000,retryCount:0})),{rank:false,retryCount:0}) });
export interface Policy {
  entry: bigint; pool: bigint; winnerAward: bigint; treasuryFee: bigint; feeBps: number;
  maxFundingWindow: bigint; playWindow: bigint; settlementWindow: bigint;
}
export interface Configuration { policy: Policy; intakePaused: boolean; resultsPaused: boolean; signer: Address; epoch: number; revoked: boolean; chainTime: bigint; block: bigint }
export async function configuration(): Promise<Configuration> {
  const [chainId, block] = await Promise.all([publicClient.getChainId(), publicClient.getBlock()]);
  if (chainId !== escrowProfile.chainId) throw new Error('The network response does not match the configured escrow chain.');
  const names = ['policy', 'token', 'intakePaused', 'resultsPaused', 'nextSigner', 'nextSignerEpoch'];
  const values = await publicClient.multicall({ allowFailure: false, deployless:escrowProfile.localTest,blockNumber: block.number,
    contracts: names.map(functionName => ({ address: escrow, abi, functionName })) });
  const [policy, liveToken, intakePaused, resultsPaused, signer, epoch] = values as unknown as [Policy, Address, boolean, boolean, Address, number];
  if (liveToken.toLowerCase() !== token.toLowerCase() || Object.entries(PAYMENT_POLICY).some(([key, value]) => BigInt(policy[key as keyof Policy]) !== BigInt(value))) {
    throw new Error('Live contract settings do not match the pinned WARCHOG deployment.');
  }
  const revoked = await publicClient.readContract({ address: escrow, abi, functionName: 'revokedSigner', args: [signer], blockNumber: block.number }) as boolean;
  return { policy, intakePaused, resultsPaused, signer, epoch, revoked, chainTime: block.timestamp, block: block.number };
}
export async function readDuel(id: RecordId, account?: Address): Promise<DuelSnapshot> {
  const block = await publicClient.getBlock();
  const values = await publicClient.multicall({ allowFailure: false, deployless:escrowProfile.localTest,blockNumber: block.number, contracts: [
    { address: escrow, abi, functionName: 'getDuel', args: [id] },
    { address: escrow, abi, functionName: 'intakePaused', args: [] }, { address: escrow, abi, functionName: 'resultsPaused', args: [] },
    ...(account ? [{ address: escrow, abi, functionName: 'credits', args: [id, account] }] : []),
  ] });
  const [duel, intakePaused, resultsPaused, credit = 0n] = values as unknown as [DuelRecord, boolean, boolean, bigint?];
  const revoked = duel.state === 1 || duel.state === 2 ? await publicClient.readContract({ address: escrow, abi,
    functionName: 'revokedSigner', args: [duel.signer], blockNumber: block.number }) as boolean : false;
  return { id, duel, credit, intakePaused, resultsPaused, revoked, chainTime: block.timestamp };
}
export type WalletProvider = EIP1193Provider & {
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
};
export async function walletIdentity(provider:WalletProvider,account:Address){
  const wallet=createWalletClient({chain,transport:custom(provider)});
  const [accounts,chainId]=await Promise.all([wallet.getAddresses(),wallet.getChainId()]);
  if(accounts[0]?.toLowerCase()!==account.toLowerCase()||chainId!==chain.id)throw new Error('Wallet changed or is on another network. Reconnect before continuing.');
  return wallet;
}
async function transaction(provider:WalletProvider,account:Address,address:Address,contractAbi:Abi,functionName:string,args:readonly unknown[],onHash:(hash:RecordId)=>void){
  await walletIdentity(provider,account);await configuration();
  const {request}=await publicClient.simulateContract({address,abi:contractAbi,functionName,args,account});
  const wallet=await walletIdentity(provider,account);const hash=await wallet.writeContract(request);onHash(hash);
  const receipt=await publicClient.waitForTransactionReceipt({hash,timeout:120000});
  if(receipt.status!=='success')throw new Error('Transaction reverted. Refresh the contract state before retrying.');
  return hash;
}
export async function fundingInfo(terms:DuelTerms,id:RecordId,account:Address){
  const config=await configuration();
  const [snapshot,allowance,balance,preview,termsHash]=await Promise.all([
    readDuel(id,account),publicClient.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[account,escrow]}),
    publicClient.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[account]}),
    publicClient.readContract({address:escrow,abi,functionName:'previewDuelId',args:[{...terms,fundingDeadline:BigInt(terms.fundingDeadline)}]}),
    publicClient.readContract({address:escrow,abi,functionName:'termsHash',args:[{...terms,fundingDeadline:BigInt(terms.fundingDeadline)}]}),
  ]);
  if(preview!==id||!terms.players.some(p=>p.toLowerCase()===account.toLowerCase()))throw new Error('Funding terms do not belong to this wallet and record.');
  if(snapshot.duel.state!==0){const d=snapshot.duel;if(d.termsHash!==termsHash||d.rulesetHash!==terms.rulesetHash||d.signer.toLowerCase()!==terms.signer.toLowerCase()||d.signerEpoch!==terms.signerEpoch||d.players.some((p,i)=>p.toLowerCase()!==terms.players[i].toLowerCase()))throw new Error('The onchain record does not match the agreed duel terms.');}
  const seat=terms.players.findIndex(p=>p.toLowerCase()===account.toLowerCase());
  return {config,snapshot,allowance,balance,termsHash:termsHash as RecordId,seat,ownFunded:Boolean(snapshot.duel.fundedMask&(1<<seat))};
}
export async function approveEntry(provider:WalletProvider,account:Address,terms:DuelTerms,id:RecordId,onHash:(hash:RecordId)=>void){
  const f=await fundingInfo(terms,id,account);
  if(f.config.intakePaused||f.config.resultsPaused||f.ownFunded||f.snapshot.duel.state>1||f.config.chainTime>BigInt(terms.fundingDeadline))throw new Error('Funding is closed, paused, or your entry is already deposited.');
  if(f.allowance>=PAYMENT_POLICY.entry)return;
  return transaction(provider,account,token,erc20Abi,'approve',[escrow,PAYMENT_POLICY.entry],onHash);
}
export async function depositEntry(provider:WalletProvider,account:Address,terms:DuelTerms,id:RecordId,onHash:(hash:RecordId)=>void){
  const f=await fundingInfo(terms,id,account);
  if(f.config.intakePaused||f.config.resultsPaused||f.snapshot.revoked||f.ownFunded||f.snapshot.duel.state>1||f.config.chainTime>BigInt(terms.fundingDeadline))throw new Error('Funding is closed, paused, or your entry is already deposited.');
  if(f.balance<PAYMENT_POLICY.entry)throw new Error('This wallet needs 1 test USDC for its entry.');
  if(f.allowance<PAYMENT_POLICY.entry)throw new Error('Approve the 1 USDC entry first.');
  if(f.snapshot.duel.state===0&&(f.config.signer.toLowerCase()!==terms.signer.toLowerCase()||f.config.epoch!==terms.signerEpoch||f.config.revoked))throw new Error('Signer configuration changed. Create a fresh match before depositing.');
  return transaction(provider,account,escrow,abi,f.snapshot.duel.state===0?'createAndFundDuel':'fundDuel',f.snapshot.duel.state===0?[{...terms,fundingDeadline:BigInt(terms.fundingDeadline)}]:[id],onHash);
}
export async function submitProof(provider:WalletProvider,account:Address,proof:ResultProof,id:RecordId,onHash:(hash:RecordId)=>void){
  const s=await readDuel(id,account),d=s.duel,r=proof.message;
  const message={...r,finishedAt:BigInt(r.finishedAt),expiresAt:BigInt(r.expiresAt)};
  if(d.state!==2||s.revoked||s.resultsPaused||r.recordId!==id||r.stage!==0||r.resultSequence!==1||r.termsHash!==d.termsHash||r.rulesetHash!==d.rulesetHash||r.signerEpoch!==d.signerEpoch||
    r.participantA.toLowerCase()!==d.players[0].toLowerCase()||r.participantB.toLowerCase()!==d.players[1].toLowerCase()||r.matchId!==keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint8'}],[id,0])))throw new Error('The signed result does not match this active contract record.');
  const recovered=await recoverTypedDataAddress({domain:{name:'CHOG Paid Duel',version:'2',chainId:chain.id,verifyingContract:escrow},types:RESULT_TYPES,primaryType:'Result',message,signature:proof.signature});
  if(recovered.toLowerCase()!==d.signer.toLowerCase())throw new Error('Result signature is not from the recorded contract signer.');
  return transaction(provider,account,escrow,abi,'submitResult',[message,proof.signature],onHash);
}
export async function recover(provider: WalletProvider, account: Address, id: RecordId, method: RecoveryAction, onHash: (hash: RecordId) => void) {
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const validateWallet = async () => {
    const [addresses, chainId] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
    if (addresses[0]?.toLowerCase() !== account.toLowerCase() || chainId !== chain.id) throw new Error('Wallet changed. Refresh your duel before continuing.');
  };
  await validateWallet();
  await configuration();
  const snapshot = await readDuel(id, account);
  if (!duelView(snapshot, account).actions.some(action => action.method === method)) throw new Error('This action is no longer available. Refresh your duel.');
  const { request } = await publicClient.simulateContract({ address: escrow, abi, functionName: method,
    args: method === 'withdrawFor' ? [id, account] : [id], account });
  await validateWallet();
  const hash = await wallet.writeContract(request);
  onHash(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error('Transaction reverted. Refresh to check your credit; it was not marked as claimed.');
  return hash;
}
