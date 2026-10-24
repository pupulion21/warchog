import { createPublicClient, http, fallback, encodeAbiParameters, keccak256, zeroAddress, defineChain, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import { readFileSync } from 'node:fs';
import type { OnlineResult } from '../src/online-protocol.ts';
import { PAYMENT_POLICY, type EscrowProfile, type DuelTerms } from '../src/payment-types.ts';
import { randomBytes } from 'node:crypto';
const dep = JSON.parse(readFileSync(new URL('../contracts/deployments/monad-testnet.json', import.meta.url), 'utf8'));
const abi = JSON.parse(readFileSync(new URL('../contracts/abi/PaidDuelEscrowV2.json', import.meta.url), 'utf8')) as Abi;
export const resultTypes = { Result: [
  { name: 'recordId', type: 'bytes32' }, { name: 'matchId', type: 'bytes32' }, { name: 'stage', type: 'uint8' },
  { name: 'participantA', type: 'address' }, { name: 'participantB', type: 'address' }, { name: 'winnerRecipient', type: 'address' },
  { name: 'outcomeType', type: 'uint8' }, { name: 'termsHash', type: 'bytes32' }, { name: 'rulesetHash', type: 'bytes32' },
  { name: 'replayHash', type: 'bytes32' }, { name: 'finishedAt', type: 'uint64' }, { name: 'resultSequence', type: 'uint32' },
  { name: 'signerEpoch', type: 'uint32' }, { name: 'expiresAt', type: 'uint64' },
] } as const;
export const resultDomain = { name: 'CHOG Paid Duel', version: '2', chainId: 10143, verifyingContract: dep.address as Address } as const;
export const defaultProfile:EscrowProfile={chainId:dep.chainId,name:dep.network,address:dep.address,token:dep.token.address,
  rpcUrls:['https://testnet-rpc.monad.xyz','https://rpc-testnet.monadinfra.com'],explorer:'https://testnet.monadscan.com',expectedSigner:dep.roles.resultSigner};
export interface ChainDuel { state: number; players: [Address, Address]; signer: Address; signerEpoch: number; lockedAt: bigint; playDeadline: bigint; settlementDeadline: bigint; rulesetHash: Hex; termsHash: Hex; fundedMask?:number;fundingDeadline?:bigint }
export interface SettlementConfiguration { signer:Address;epoch:number;time:bigint;intakePaused:boolean;resultsPaused:boolean;revoked:boolean }
export interface SettlementReader { getChainId: () => Promise<number>; getDuel: (id: Hex) => Promise<ChainDuel>; revoked: (signer: Address) => Promise<boolean>; resultsPaused: () => Promise<boolean>; timestamp: () => Promise<bigint>;
  configuration?:()=>Promise<SettlementConfiguration>;preview?:(terms:DuelTerms)=>Promise<{id:Hex;termsHash:Hex}> }
export function createReader(profile:EscrowProfile=defaultProfile):SettlementReader{
 const chain=profile.localTest?defineChain({id:profile.chainId,name:profile.name,nativeCurrency:{name:'Local Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:profile.rpcUrls}}}):monadTestnet;
 const client=createPublicClient({chain,transport:fallback(profile.rpcUrls.map(url=>http(url,{retryCount:0,timeout:10000})),{rank:false,retryCount:0})});
 const read=async(functionName:string,args:readonly unknown[]=[])=>client.readContract({address:profile.address,abi,functionName,args});
 return {
  getChainId:()=>client.getChainId(),getDuel:async id=>await client.readContract({address:profile.address,abi,functionName:'getDuel',args:[id],blockTag:profile.localTest?'latest':'finalized'}) as ChainDuel,
  revoked:async signer=>await read('revokedSigner',[signer]) as boolean,resultsPaused:async()=>await read('resultsPaused') as boolean,timestamp:async()=>(await client.getBlock()).timestamp,
  configuration:async()=>{
   const [chainId,block,finalized]=await Promise.all([client.getChainId(),client.getBlock(),profile.localTest?Promise.resolve(null):client.getBlock({blockTag:'finalized'})]);
   if(chainId!==profile.chainId)throw new Error('Escrow RPC is on the wrong chain.');
   if(!profile.localTest&&!finalized?.hash)throw new Error('Finalized escrow reads are unavailable.');
   if(Math.abs(Number(block.timestamp)*1000-Date.now())>60000)throw new Error('Server clock is not synchronized with the chain.');
   const names=['policy','token','nextSigner','nextSignerEpoch','intakePaused','resultsPaused'];
   const values=await client.multicall({allowFailure:false,deployless:profile.localTest,blockNumber:block.number,contracts:names.map(functionName=>({address:profile.address,abi,functionName}))});
   const [policy,token,signer,epoch,intakePaused,resultsPaused]=values as unknown as [Record<string,bigint|number>,Address,Address,number,boolean,boolean];
   if(token.toLowerCase()!==profile.token.toLowerCase()||Object.entries(PAYMENT_POLICY).some(([k,v])=>BigInt(policy[k])!==BigInt(v)))throw new Error('Escrow policy/token does not match WARCHOG.');
   const revoked=await read('revokedSigner',[signer]) as boolean;
   return {signer,epoch,time:block.timestamp,intakePaused,resultsPaused,revoked};
  },
  preview:async terms=>{
   const args=[{...terms,fundingDeadline:BigInt(terms.fundingDeadline)}];
   const [id,termsHash]=await Promise.all([read('previewDuelId',args),read('termsHash',args)]);
   return {id:id as Hex,termsHash:termsHash as Hex};
  },
 };
}
export const liveReader=createReader();
// A server result may only be signed for the exact activated record bound before play.
// No transaction or funding approval is sent by this adapter.
export class Settlement {
  private account: ReturnType<typeof privateKeyToAccount> | undefined;
  private keyError='';
  private reader: SettlementReader;
  profile:EscrowProfile;
  constructor(privateKey?: Hex, reader?: SettlementReader,profile:EscrowProfile=defaultProfile) {
    try{this.account=privateKey?privateKeyToAccount(privateKey):undefined;}catch{this.keyError='Server signer key is invalid. Free online remains available.';}
    this.profile=profile;this.reader=reader??createReader(profile);
  }
  get address() { return this.account?.address; }
  private cached?:{at:number;value:Awaited<ReturnType<Settlement['check']>>};
  async check(){
    if(!this.account)return {ready:false,reason:this.keyError||'Result signer is not configured on the server.',expectedSigner:this.profile.expectedSigner};
    if(!this.reader.configuration)return {ready:false,reason:'Escrow configuration reader is unavailable.',expectedSigner:this.profile.expectedSigner};
    try{
      const c=await this.reader.configuration();
      const reason=c.signer.toLowerCase()!==this.account.address.toLowerCase()?'Server key does not match the contract result signer.':c.revoked?'Contract result signer is revoked.':c.intakePaused?'New deposits are paused by the contract.':c.resultsPaused?'Contract result acceptance is paused.':'';
      return {ready:!reason,reason,expectedSigner:c.signer,epoch:c.epoch};
    }catch{return {ready:false,reason:'Could not verify the deployed escrow. Retry before depositing.',expectedSigner:this.profile.expectedSigner};}
  }
  async readiness(){if(this.cached&&Date.now()-this.cached.at<5000)return this.cached.value;const value=await this.check();this.cached={at:Date.now(),value};return value;}
  async prepare(wallets:[Address,Address],rulesetHash:Hex){
    if(!this.account||!this.reader.configuration||!this.reader.preview)throw new Error('Result signer is not configured for funding.');
    const c=await this.reader.configuration();
    if(c.signer.toLowerCase()!==this.account.address.toLowerCase()||c.intakePaused||c.resultsPaused||c.revoked)throw new Error('Paid intake is unavailable with the current signer configuration.');
    if(wallets[0].toLowerCase()===wallets[1].toLowerCase())throw new Error('Two distinct wallets are required.');
    const terms:DuelTerms={salt:('0x'+randomBytes(32).toString('hex')) as Hex,players:wallets,rulesetHash,signer:c.signer,signerEpoch:c.epoch,fundingDeadline:String(c.time+600n)};
    const preview=await this.reader.preview(terms);return {...preview,terms};
  }
  read(id:Hex){return this.reader.getDuel(id);}
  isRevoked(signer:Address){return this.reader.revoked(signer);}
  isResultsPaused(){return this.reader.resultsPaused();}
  chainTime(){return this.reader.timestamp();}
  async bind(id: Hex, wallets: readonly [Address, Address], rulesetHash: Hex) {
    if (!this.account) throw new Error('Result signer is not configured. Paid entry remains closed.');
    const [chainId, duel, time] = await Promise.all([this.reader.getChainId(), this.reader.getDuel(id), this.reader.timestamp()]);
    if (chainId !== this.profile.chainId || duel.state !== 2 || duel.signer.toLowerCase() !== this.account.address.toLowerCase() ||
      duel.players.some((p, i) => p.toLowerCase() !== wallets[i].toLowerCase()) || duel.rulesetHash.toLowerCase() !== rulesetHash.toLowerCase() ||
      time > duel.playDeadline || await this.reader.revoked(duel.signer)) throw new Error('Paid duel does not match this server, its players, rules, or play window.');
    return { id, duel: structuredClone(duel) };
  }
  async sign(bound: Awaited<ReturnType<Settlement['bind']>>, result: OnlineResult) {
    if (!this.account) throw new Error('Result signer is not configured.');
    const [current, time, paused, revoked] = await Promise.all([this.reader.getDuel(bound.id), this.reader.timestamp(), this.reader.resultsPaused(), this.reader.revoked(bound.duel.signer)]);
    const d = bound.duel;
    if (current.state !== 2 || current.termsHash !== d.termsHash || current.signer !== d.signer || current.signerEpoch !== d.signerEpoch || paused || revoked || time > d.settlementDeadline) throw new Error('Settlement is no longer available; use the contract recovery path when eligible.');
    if (!/^0x[0-9a-fA-F]{64}$/.test(result.replayHash) || /^0x0{64}$/.test(result.replayHash)) throw new Error('A persisted replay hash is required.');
    if (result.winner !== null && result.winner !== 0 && result.winner !== 1) throw new Error('Invalid winner.');
    if ((result.outcome === 'Void') !== (result.winner === null)) throw new Error('Outcome and winner disagree.');
    const finishedAt = BigInt(result.finishedAt);
    if (finishedAt < d.lockedAt || finishedAt > d.playDeadline || finishedAt > time) throw new Error('Finish time is outside the contract play window.');
    const message = { recordId: bound.id, matchId: keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint8' }], [bound.id, 0])), stage: 0,
      participantA: d.players[0], participantB: d.players[1], winnerRecipient: result.winner === null ? zeroAddress : d.players[result.winner],
      outcomeType: result.outcome === 'Finished' ? 0 : result.outcome === 'Forfeit' ? 1 : 2,
      termsHash: d.termsHash, rulesetHash: d.rulesetHash, replayHash: result.replayHash as Hex, finishedAt, resultSequence: 1, signerEpoch: d.signerEpoch,
      expiresAt: d.settlementDeadline };
    const domain={...resultDomain,chainId:this.profile.chainId,verifyingContract:this.profile.address};
    const signature = await this.account.signTypedData({ domain, types: resultTypes, primaryType: 'Result', message });
    return { domain, primaryType: 'Result', types: resultTypes, message, signature };
  }
}
