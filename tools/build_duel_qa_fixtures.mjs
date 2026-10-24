// Test-only ABI-encoded RPC fixtures. Nothing here is served as application match data.
import { encodeFunctionData, encodeFunctionResult, multicall3Abi } from 'viem';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const abi = JSON.parse(readFileSync('contracts/abi/PaidDuelEscrowV2.json'));
const dep = JSON.parse(readFileSync('contracts/deployments/monad-testnet.json'));
const a = '0x000000000000000000000000000000000000000a', b = '0x000000000000000000000000000000000000000b', c = '0x000000000000000000000000000000000000000c';
const revoked = '0x000000000000000000000000000000000000000d';
const names = ['funding_a','funding_b','funding_expired','active','play_closed','settlement_expired','revoked','complete','paid','cancelled','paused','none'];
const ids = Object.fromEntries(names.map((name,i)=>[name,`0x${(i+1).toString(16).padStart(64,'0')}`]));
const responses = {};
const policy = Object.fromEntries(Object.entries(dep.policy).map(([k,v])=>[k,k==='feeBps'?v:BigInt(v)]));
const calldata = (functionName,args=[]) => encodeFunctionData({abi,functionName,args});
const result = (functionName,value) => encodeFunctionResult({abi,functionName,result:value});
const aggregate = (calls) => encodeFunctionData({abi:multicall3Abi,functionName:'aggregate3',args:[calls.map(([functionName,args])=>({target:dep.address,allowFailure:true,callData:calldata(functionName,args)}))]});
function add(map,calls,values) { map[aggregate(calls).toLowerCase()]=encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:values.map((value,i)=>({success:true,returnData:result(calls[i][0],value)}))}); }
for (const phase of ['base','refunded','paid']) {
 const map = responses[phase] = {};
 const cfg = ['policy','token','intakePaused','resultsPaused','nextSigner','nextSignerEpoch'].map(n=>[n,[]]);
 add(map,cfg,[policy,dep.token.address,false,false,dep.roles.resultSigner,1]);
 map[calldata('revokedSigner',[dep.roles.resultSigner]).toLowerCase()] = result('revokedSigner',false);
 map[calldata('revokedSigner',[revoked]).toLowerCase()] = result('revokedSigner',true);
 for (const name of names) {
  const id=ids[name];
  let state=name.startsWith('funding')?1:['active','play_closed','settlement_expired','revoked','paused'].includes(name)?2:name==='cancelled'?4:name==='none'?0:3;
  if (name==='funding_a' && phase!=='base') state=4;
  const terminal=state>=3, funding=state===1;
  const d={state,players:[a,b],signer:name==='revoked'?revoked:dep.roles.resultSigner,signerEpoch:1,fundedMask:name==='funding_a'?1:funding?(name==='funding_b'?2:1):3,
   fundingDeadline:BigInt(name==='funding_expired'?1699999999:1700000900),lockedAt:1700000000n,playDeadline:BigInt(['play_closed','settlement_expired'].includes(name)?1699999999:1700003600),settlementDeadline:BigInt(name==='settlement_expired'?1699999999:1700004500),rulesetHash:`0x${'2'.repeat(64)}`,termsHash:`0x${'3'.repeat(64)}`,
   ledger:{totalDeposited:name==='funding_a'||funding?1000000n:2000000n,unallocated:terminal?0n:funding?1000000n:2000000n,outstanding:terminal?(name==='paid'?0n:name==='funding_a'?(phase==='paid'?0n:1000000n):2000000n):0n,totalPaid:name==='paid'?2000000n:name==='funding_a'&&phase==='paid'?1000000n:0n}};
  if(name==='none'){d.fundedMask=0;d.ledger={totalDeposited:0n,unallocated:0n,outstanding:0n,totalPaid:0n};}
  for (const account of [undefined,a,b,c]) {
   const credit=account===a?(name==='complete'?1900000n:name==='cancelled'?1000000n:name==='funding_a'&&phase==='refunded'?1000000n:0n):account===b&&name==='cancelled'?1000000n:0n;
   const calls=[['getDuel',[id]],['intakePaused',[]],['resultsPaused',[]],...(account?[['credits',[id,account]]]:[])];
   add(map,calls,[d,name==='paused',name==='paused',...(account?[credit]:[])]);
  }
  for(const method of ['cancelFunding','refundExpiredFunding','refundExpired','refundRevoked'])map[calldata(method,[id]).toLowerCase()]='0x';
  for(const account of [a,b,c])map[calldata('withdrawFor',[id,account]).toLowerCase()]=result('withdrawFor',1000000n);
 }
}
mkdirSync('.local',{recursive:true});writeFileSync('.local/duel-qa-fixtures.json',JSON.stringify({a,b,c,ids,responses,escrow:dep.address}));
console.log(`Generated ABI fixtures for ${names.length} records, 4 viewer identities and 3 transaction phases.`);
