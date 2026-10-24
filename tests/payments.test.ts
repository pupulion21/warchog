import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import type {Address,Hex} from 'viem';
import {serverSettings} from '../server/config.ts';
import {Settlement,type ChainDuel,type SettlementConfiguration} from '../server/settlement.ts';
import {PaidMatches} from '../server/paid.ts';
import {Rooms} from '../server/rooms.ts';
import {Store} from '../server/store.ts';
const bytes=(c:string)=>('0x'+c.repeat(64)) as Hex;
test('server reads only a private local key configuration, without exposing it to the browser namespace',()=>{
 const dir=mkdtempSync(join(tmpdir(),'warchog-env-')),file=join(dir,'server.env'),old=process.env.WARCHOG_ENV_FILE;
 const oldKey=process.env.WARCHOG_SIGNER_PRIVATE_KEY;delete process.env.WARCHOG_SIGNER_PRIVATE_KEY;
 try{const key=generatePrivateKey();writeFileSync(file,`WARCHOG_PAYMENTS_ENABLED=true\nWARCHOG_SIGNER_PRIVATE_KEY=${key}\n`,{mode:0o600});process.env.WARCHOG_ENV_FILE=file;
  const s=serverSettings();assert.ok(s.signerKey===key);assert.equal(s.paymentsEnabled,true);
  chmodSync(file,0o644);assert.throws(()=>serverSettings(),/0600/);
 }finally{if(old===undefined)delete process.env.WARCHOG_ENV_FILE;else process.env.WARCHOG_ENV_FILE=old;if(oldKey===undefined)delete process.env.WARCHOG_SIGNER_PRIVATE_KEY;else process.env.WARCHOG_SIGNER_PRIVATE_KEY=oldKey;rmSync(dir,{recursive:true});}
});
test('readiness rejects a missing, wrong, revoked or paused signer and terms use server-owned identity',async()=>{
 const key=generatePrivateKey(),account=privateKeyToAccount(key),other=privateKeyToAccount(generatePrivateKey()).address;
 const config:SettlementConfiguration={signer:account.address,epoch:3,time:1000n,intakePaused:false,resultsPaused:false,revoked:false};
 const reader={getChainId:async()=>10143,getDuel:async()=>({} as ChainDuel),revoked:async()=>config.revoked,resultsPaused:async()=>config.resultsPaused,timestamp:async()=>config.time,configuration:async()=>({...config}),preview:async()=>({id:bytes('1'),termsHash:bytes('2')})};
 const settlement=new Settlement(key,reader);
 assert.equal((await new Settlement(undefined,reader).readiness()).ready,false);
 assert.equal((await new Settlement(('0x'+'0'.repeat(64)) as Hex,reader).readiness()).ready,false);
 assert.equal((await settlement.check()).ready,true);
 config.signer=other;assert.equal((await settlement.check()).ready,false);await assert.rejects(settlement.prepare([account.address,other],bytes('3')));
 config.signer=account.address;for(const field of ['revoked','intakePaused','resultsPaused'] as const){config[field]=true;assert.equal((await settlement.check()).ready,false);config[field]=false;}
 const a=await settlement.prepare([account.address,other],bytes('3')),b=await settlement.prepare([account.address,other],bytes('3'));
 assert.notEqual(a.terms.salt,b.terms.salt);assert.equal(a.terms.signer,account.address);assert.equal(a.terms.signerEpoch,3);assert.equal(a.terms.fundingDeadline,'1600');assert.deepEqual(a.terms.players,[account.address,other]);
});
test('paid room locks terms but cannot advance physics until both actual contract entries activate',async()=>{
 const store=new Store(':memory:'),rooms=new Rooms(store,{countdownMs:0,roundSeconds:30});
 try{
  const key=generatePrivateKey(),signer=privateKeyToAccount(key),a=privateKeyToAccount(generatePrivateKey()).address,b=privateKeyToAccount(generatePrivateKey()).address;
  const now=BigInt(Math.floor(Date.now()/1000)),config:SettlementConfiguration={signer:signer.address,epoch:1,time:now,intakePaused:false,resultsPaused:false,revoked:false};
  const pa={id:'a',wallet:a,send:()=>{}},pb={id:'b',wallet:b,send:()=>{}};
  const room=await rooms.create(pa,'yot','cwo-alley',false,'paid');rooms.join(pb,room.code,'benja');
  const d:ChainDuel={state:0,players:[a,b],signer:signer.address,signerEpoch:1,lockedAt:now,playDeadline:now+3600n,settlementDeadline:now+4500n,rulesetHash:rooms.matchRules(room) as Hex,termsHash:bytes('4'),fundedMask:0,fundingDeadline:now+600n};
  const reader={getChainId:async()=>10143,getDuel:async()=>structuredClone(d),revoked:async()=>false,resultsPaused:async()=>false,timestamp:async()=>now,configuration:async()=>config,preview:async()=>({id:bytes('5'),termsHash:d.termsHash})};
  const paid=new PaidMatches(rooms,store,new Settlement(key,reader));await paid.ready('a',true);await paid.ready('b',true);
  assert.equal(room.phase,'funding');assert.ok(room.paid?.terms);assert.throws(()=>rooms.choose('a','cookie','neon-street'));
  for(let i=0;i<30;i++)rooms.tick();assert.equal(room.combat.tick,0);
  d.state=1;d.fundedMask=1;await paid.sync();assert.equal(room.paid?.fundedMask,1);rooms.tick();assert.equal(room.combat.tick,0);
  d.state=2;d.fundedMask=3;const views=await Promise.all([paid.refresh(room.code,'a'),paid.refresh(room.code,'b')]);
  assert.ok(views.every(view=>view.fundedMask===3&&!view.message.includes('constraint')));assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM paid_bindings').get()!.n,1);
  rooms.tick();assert.equal(room.phase,'playing');assert.ok(room.combat.tick>0);
  room.combat.forceHit(1,200);rooms.tick();await paid.sync();
  const proof=await paid.proof('a',room.code) as {signature:Hex};rooms.membership.delete('a');
  const restored=new PaidMatches(rooms,store,new Settlement(undefined,reader));
  assert.equal((await restored.proof('a',room.code) as {signature:Hex}).signature,proof.signature);
  assert.equal(restored.history('a')[0].recoveryOnly,true);
 }finally{rooms.close();store.close();}
});
test('same-wallet paid opponents are rejected before a match can lock or accept deposits',async()=>{
 const store=new Store(':memory:'),rooms=new Rooms(store);try{
  const wallet=privateKeyToAccount(generatePrivateKey()).address,room=await rooms.create({id:'a',wallet,send:()=>{}},'yot','cwo-alley',false,'paid');
  assert.throws(()=>rooms.join({id:'b',wallet,send:()=>{}},room.code,'benja'),/distinct/);assert.equal(room.players[1],null);
 }finally{rooms.close();store.close();}
});
