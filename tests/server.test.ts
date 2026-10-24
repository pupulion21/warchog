import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { Rooms, type Peer } from '../server/rooms.ts';
import { Settlement, type ChainDuel } from '../server/settlement.ts';
import { PaidMatches } from '../server/paid.ts';
import { FIGHTER_IDS, type ServerPacket } from '../src/online-protocol.ts';
import { readFileSync } from 'node:fs';
const pause = (ms: number) => new Promise(resolve=>setTimeout(resolve,ms));
const peer = (id: string): Peer => ({id,send:()=>{}});
async function roomTest(fn: (rooms: Rooms, store: Store) => Promise<void>) {
 const store=new Store(':memory:'), rooms=new Rooms(store,{countdownMs:0,disconnectMs:15_000});
 try {await fn(rooms,store);}finally{rooms.close();store.close();}
}
test('server roster IDs exactly match selectable 3D forms',()=>{
 const roster=JSON.parse(readFileSync('public/assets/roster.json','utf8'));assert.deepEqual([...FIGHTER_IDS].sort(),roster.entries.map((x:{id:string})=>x.id).sort());
});
test('simultaneous quick matchmaking pairs exactly two distinct sessions',async()=>roomTest(async rooms=>{
 const [a,b]=await Promise.all([rooms.create(peer('a'),'yot','cwo-alley',true),rooms.create(peer('b'),'benja','neon-street',true)]);
 assert.equal(a,b);assert.equal(rooms.rooms.size,1);assert.deepEqual(a.players.map(p=>p?.id),['a','b']);
 assert.throws(()=>rooms.join(peer('a'),a.code,'yot'));assert.throws(()=>rooms.join(peer('c'),a.code,'yot'));
}));
test('a guest cannot change the host map, and selections lock before fighting',async()=>roomTest(async rooms=>{
 const r=await rooms.create(peer('a'),'yot','neon-street');rooms.join(peer('b'),r.code,'cookie');rooms.choose('b','toad','house-cup');assert.equal(r.stage,'neon-street');
 rooms.ready('a',true);rooms.ready('b',true);assert.equal(r.phase,'countdown');assert.throws(()=>rooms.choose('a','toad','house-cup'));
}));
test('both human seats use identical damage rules; idle rival receives no CPU attacks',async()=>roomTest(async rooms=>{
 const r=await rooms.create(peer('a'),'yot','cwo-alley');rooms.join(peer('b'),r.code,'benja');rooms.ready('a',true);rooms.ready('b',true);rooms.tick();
 r.combat.teleport(0,0,-.5);r.combat.teleport(1,0,.5);
 rooms.input('b',1,{x:0,z:0,attack:true},true);
 for(let i=0;i<45;i++)rooms.tick();
 assert.equal(r.combat.actors[0].hp,191);assert.equal(r.combat.actors[1].hp,200);
 assert.equal(r.stats[1].hits,1);
}));
test('stale sequence inputs cannot replace fresh controls; server bounds movement and clears expired input',async()=>roomTest(async rooms=>{
 const r=await rooms.create(peer('a'),'yot','cwo-alley');rooms.join(peer('b'),r.code,'benja');rooms.ready('a',true);rooms.ready('b',true);rooms.tick();
 rooms.input('a',10,{x:500,z:0},true);rooms.input('a',9,{x:-1,z:0},true);assert.equal(r.players[0]!.input.x,1);
 const now=Date.now();for(let i=0;i<40;i++)rooms.tick(now+i*17);assert.ok(r.combat.actors[0].x<1.9);assert.ok(r.combat.actors[0].speed<.1);
}));
test('disconnect freezes the authoritative fight, resume resets sequence, timeout forfeits once',async()=>roomTest(async rooms=>{
 const a=peer('a'),b=peer('b'),r=await rooms.create(a,'yot','cwo-alley');rooms.join(b,r.code,'benja');rooms.ready('a',true);rooms.ready('b',true);rooms.tick();
 const tick=r.combat.tick;rooms.disconnect('a',a);rooms.tick();assert.equal(r.phase,'reconnecting');assert.equal(r.combat.tick,tick);
 rooms.reconnect(a);assert.equal(r.phase,'playing');assert.equal(r.players[0]!.seq,-1);
 rooms.disconnect('a',a);rooms.tick(Date.now()+16_000);assert.equal(r.result?.outcome,'Forfeit');assert.equal(r.result?.winner,1);
 const hash=r.result!.replayHash;rooms.leave('a');assert.equal(r.result!.replayHash,hash);
}));
test('double disconnect produces Void, not a claimed winner, and persists replay evidence',async()=>roomTest(async(rooms,store)=>{
 const a=peer('a'),b=peer('b'),r=await rooms.create(a,'yot','cwo-alley');rooms.join(b,r.code,'benja');rooms.ready('a',true);rooms.ready('b',true);rooms.tick();
 rooms.disconnect('a',a);rooms.disconnect('b',b);rooms.tick(Date.now()+16_000);
 assert.equal(r.result?.outcome,'Void');assert.equal(r.result?.winner,null);assert.match(r.result!.replayHash,/^0x[0-9a-f]{64}$/);
 assert.equal(store.match(r.code).result.outcome,'Void');assert.ok(store.db.prepare('SELECT COUNT(*) AS n FROM replay_chunks').get()!.n);
}));
test('authoritative KO persists one outcome and releases the Rapier world',async()=>roomTest(async(rooms,store)=>{
 const r=await rooms.create(peer('a'),'yot','cwo-alley');rooms.join(peer('b'),r.code,'benja');rooms.ready('a',true);rooms.ready('b',true);rooms.tick();
 r.combat.forceHit(1,200);rooms.tick();assert.equal(r.result?.winner,0);assert.equal(r.result?.outcome,'Finished');assert.equal(r.physicsDisposed,true);assert.equal(store.match(r.code).result.winner,0);
}));
test('round timeout awards higher HP, while equal HP and double KO have no winner',async()=>{
 for(const scenario of ['higher','equal','double'] as const)await roomTest(async rooms=>{
  const r=await rooms.create(peer('a'),'yot','house-cup');rooms.join(peer('b'),r.code,'benja');rooms.ready('a',true);rooms.ready('b',true);rooms.tick();
  if(scenario==='higher')r.combat.forceHit(1,14);
  if(scenario==='double'){r.combat.forceHit(0,200);r.combat.forceHit(1,200);}else r.combat.time=181;
  rooms.tick();assert.equal(r.result?.outcome,scenario==='higher'?'Finished':'Void');assert.equal(r.result?.winner,scenario==='higher'?0:null);
 });
});
test('real WebSocket API authenticates sessions, rejects untrusted state fields and isolates records',async()=>{
 const app=createApp({dbPath:':memory:',autoTick:false});const http=createServer((req,res)=>{void app.handle(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});app.attach(http);http.listen(0,'127.0.0.1');await once(http,'listening');
 const origin=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
 const request=async(path:string,data:unknown={},cookie='')=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});
 let ws:WebSocket|undefined;
 try{
  assert.equal((await fetch(origin+'/api/session',{method:'POST',headers:{Origin:'https://outside.invalid'}})).status,403);
  const response=await request('/api/session');const cookie=response.headers.get('set-cookie')!.split(';')[0];assert.ok(response.headers.get('set-cookie')!.includes('HttpOnly'));
  const messages:ServerPacket[]=[];ws=new WebSocket(origin.replace('http:','ws:')+'/api/ws',{headers:{Origin:origin,Cookie:cookie}});ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));await once(ws,'open');
  for(let i=0;i<30&&!messages.length;i++)await pause(10);assert.equal(messages[0].type,'hello');
  ws.send(JSON.stringify({type:'create',fighter:'yot',stage:'cwo-alley'}));
  for(let i=0;i<50&&app.rooms.rooms.size===0;i++)await pause(10);assert.equal(app.rooms.rooms.size,1);
  ws.send(JSON.stringify({type:'input',seq:1,lockOn:true,input:{x:0,z:0,hp:9999}}));
  for(let i=0;i<30&&!messages.some(p=>p.type==='error');i++)await pause(10);assert.ok(messages.some(p=>p.type==='error'&&p.message.includes('validated control')));
  const code=[...app.rooms.rooms.keys()][0];const other=await request('/api/session');const otherCookie=other.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(origin+`/api/matches/${code}`,{headers:{Cookie:otherCookie}})).status,404);
  assert.equal((await request('/api/paid/create',{},cookie)).status,503);
  const account=privateKeyToAccount(generatePrivateKey());const challenge=await(await request('/api/auth/challenge',{address:account.address},otherCookie)).json();
  const signature=await account.signMessage({message:challenge.message});
  assert.equal((await request('/api/auth/verify',{nonce:challenge.nonce,signature},otherCookie)).status,200);
  assert.equal((await request('/api/auth/verify',{nonce:challenge.nonce,signature},otherCookie)).status,400);
  ws.send(JSON.stringify({type:'leave'}));ws.close();
  for(let i=0;i<50&&!app.rooms.rooms.get(code)?.result;i++)await pause(10);
  assert.equal(app.rooms.rooms.get(code)?.result?.outcome,'Void');
 }finally{ws?.terminate();app.close();await new Promise<void>(resolve=>http.close(()=>resolve()));}
});
test('settlement adapter signs the deployed EIP-712 domain only for a matching active record',async()=>{
 const key=generatePrivateKey(),account=privateKeyToAccount(key),a=privateKeyToAccount(generatePrivateKey()).address,b=privateKeyToAccount(generatePrivateKey()).address;
 const id=`0x${'1'.repeat(64)}` as Hex,rules=`0x${'2'.repeat(64)}` as Hex;
 const d:ChainDuel={state:2,players:[a,b],signer:account.address,signerEpoch:1,lockedAt:100n,playDeadline:3700n,settlementDeadline:4600n,rulesetHash:rules,termsHash:`0x${'3'.repeat(64)}`};
 let revoked=false,paused=false,time=200n;
 const reader={getChainId:async()=>10143,getDuel:async()=>d,revoked:async()=>revoked,resultsPaused:async()=>paused,timestamp:async()=>time};
 const settlement=new Settlement(key,reader);const bound=await settlement.bind(id,[a,b],rules);
 const result={outcome:'Finished' as const,winner:0,reason:'K.O.',replayHash:`0x${'4'.repeat(64)}`,finishedAt:190};
 const proof=await settlement.sign(bound,result);assert.equal((await recoverTypedDataAddress(proof)).toLowerCase(),account.address.toLowerCase());
 assert.equal(proof.domain.name,'CHOG Paid Duel');assert.equal(proof.message.stage,0);assert.equal(proof.message.resultSequence,1);assert.equal(proof.message.winnerRecipient,a);
 await assert.rejects(settlement.bind(id,[b,a],rules));revoked=true;await assert.rejects(settlement.sign(bound,result));revoked=false;paused=true;await assert.rejects(settlement.sign(bound,result));paused=false;time=4601n;await assert.rejects(settlement.sign(bound,result));
 await assert.rejects(new Settlement(undefined,reader).bind(id,[a,b],rules));
});
test('a funded record binds exact server rules; only the authoritative result can produce one persisted signature',async()=>{
 const store=new Store(':memory:'),rooms=new Rooms(store,{countdownMs:0,roundSeconds:30});
 try{
  const key=generatePrivateKey(),signer=privateKeyToAccount(key),a=privateKeyToAccount(generatePrivateKey()).address,b=privateKeyToAccount(generatePrivateKey()).address;
  const r=await rooms.create({...peer('a'),wallet:a},'yot','cwo-alley');rooms.join({...peer('b'),wallet:b},r.code,'benja');
  const id=`0x${'5'.repeat(64)}` as Hex,now=BigInt(Math.floor(Date.now()/1000));
  const d:ChainDuel={state:2,players:[a,b],signer:signer.address,signerEpoch:1,lockedAt:now-1n,playDeadline:now+3600n,settlementDeadline:now+4500n,rulesetHash:rooms.matchRules(r) as Hex,termsHash:`0x${'6'.repeat(64)}`};
  const reader={getChainId:async()=>10143,getDuel:async()=>structuredClone(d),revoked:async()=>false,resultsPaused:async()=>false,timestamp:async()=>BigInt(Math.floor(Date.now()/1000))};
  const paid=new PaidMatches(rooms,store,new Settlement(key,reader));
  await assert.rejects(paid.proof('a'));
  await paid.bind('a',id);assert.equal(r.mode,'paid');assert.throws(()=>rooms.choose('a','toad','house-cup'));
  rooms.ready('a',true);rooms.ready('b',true);rooms.tick();r.combat.forceHit(1,200);rooms.tick();
  const [proof1,proof2]=await Promise.all([paid.proof('a'),paid.proof('b')]) as {signature:Hex,message:{winnerRecipient:string}}[];
  assert.equal(proof1.signature,proof2.signature);assert.equal(proof1.message.winnerRecipient,a);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM signed_results').get()!.n,1);
  const second=await rooms.create({...peer('c'),wallet:a},'yot','cwo-alley');rooms.join({...peer('d'),wallet:b},second.code,'benja');
  await assert.rejects(paid.bind('c',id));assert.equal(second.mode,'free');
 }finally{rooms.close();store.close();}
});
