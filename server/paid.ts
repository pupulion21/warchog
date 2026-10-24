import type { Address, Hex } from 'viem';
import { Rooms, type Room } from './rooms.ts';
import { Store } from './store.ts';
import { Settlement } from './settlement.ts';
import type { DuelTerms, PaidStatus } from '../src/payment-types.ts';
const encode=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
type Bound=Awaited<ReturnType<Settlement['bind']>>;
type Saved={code:string;id:Hex;terms:DuelTerms;termsHash:Hex;view:PaidStatus};
export class PaidMatches {
  private rooms:Rooms; private store:Store; private settlement:Settlement;
  private bindings=new Map<string,Bound>(); private pending=new Set<string>(); private signing=new Map<string,Promise<unknown>>();
  private syncing=false;private stopped=false;
  private syncingCodes=new Map<string,Promise<void>>();
  constructor(rooms:Rooms,store:Store,settlement:Settlement){this.rooms=rooms;this.store=store;this.settlement=settlement;}
  private wallets(room:Room):[Address,Address]{
    const wallets=room.players.map(p=>p?.wallet);
    if(!wallets[0]||!wallets[1]||wallets[0].toLowerCase()===wallets[1].toLowerCase())throw new Error('Both distinct participant wallets must sign in before joining the room.');
    return wallets as [Address,Address];
  }
  async ready(sessionId:string,ready:boolean){
    const room=this.rooms.require(sessionId);
    if(room.mode!=='paid'||room.paidDeadline){this.rooms.ready(sessionId,ready);return;}
    if(room.phase!=='waiting')return;
    room.players.find(p=>p?.id===sessionId)!.ready=ready;
    this.rooms.broadcastRoom(room);
    if(room.players.every(p=>p?.ready&&p.peer))await this.prepare(room);
  }
  private async prepare(room:Room){
    if(this.pending.has(room.code))return;
    this.pending.add(room.code);room.phase='funding';room.paid={stage:'preparing',message:'Checking agreed match terms…',fundedMask:0,contractState:0};this.rooms.broadcastRoom(room);
    try{
      const rules=this.rooms.matchRules(room) as Hex,preview=await this.settlement.prepare(this.wallets(room),rules);
      if(this.stopped||room.result||room.phase!=='funding'||this.rooms.matchRules(room)!==rules)return;
      const view:PaidStatus={stage:'funding',message:'Approve and deposit 1 test USDC each. The fight starts only after both entries confirm.',recordId:preview.id,terms:preview.terms,termsHash:preview.termsHash,fundedMask:0,contractState:0,fundingDeadline:preview.terms.fundingDeadline};
      const saved:Saved={code:room.code,...preview,view};
      this.store.db.prepare('INSERT INTO paid_terms VALUES(?,?,?)').run(room.code,preview.id,encode(saved));
      room.paid=view;this.rooms.persist(room);this.rooms.broadcastRoom(room);
    }catch(error){
      if(!this.stopped&&!room.result){room.phase='waiting';room.players.forEach(p=>{if(p)p.ready=false;});room.paid={stage:'unavailable',message:error instanceof Error?error.message:'Could not prepare funding terms.',fundedMask:0,contractState:0};this.rooms.broadcastRoom(room);}
    }finally{this.pending.delete(room.code);}
  }
  private bound(code:string):Bound|undefined{
    const existing=this.bindings.get(code);if(existing)return existing;
    const row=this.store.db.prepare('SELECT data FROM paid_bindings WHERE code=?').get(code) as {data:string}|undefined;
    if(!row)return;
    const b=JSON.parse(row.data) as Bound;
    for(const key of ['lockedAt','playDeadline','settlementDeadline','fundingDeadline'] as const)if(b.duel[key]!==undefined)b.duel[key]=BigInt(b.duel[key]!);
    this.bindings.set(code,b);return b;
  }
  async bind(sessionId:string,id:Hex){
    const room=this.rooms.require(sessionId);
    if(room.phase!=='waiting'||room.startedAt||room.result||room.mode!=='free'||this.pending.has(room.code))throw new Error('Only an unfought room can bind a funded record.');
    this.pending.add(room.code);const rules=this.rooms.matchRules(room) as Hex;
    try{
      const bound=await this.settlement.bind(id,this.wallets(room),rules);
      if(this.stopped||room.phase!=='waiting'||room.startedAt||room.result||this.rooms.matchRules(room)!==rules)throw new Error('Room choices changed while the contract was being checked.');
      this.store.db.prepare('INSERT INTO paid_bindings VALUES(?,?,?)').run(room.code,id,encode(bound));
      this.bindings.set(room.code,bound);room.mode='paid';room.paidDeadline=Number(bound.duel.playDeadline)*1000;
      room.paid={stage:'active',message:'Both contract entries confirmed.',recordId:id,fundedMask:3,contractState:2,playDeadline:String(bound.duel.playDeadline),settlementDeadline:String(bound.duel.settlementDeadline)};
      room.players.forEach(p=>{if(p)p.ready=false;});this.rooms.persist(room);this.rooms.broadcastRoom(room);
      return {recordId:id,rulesetHash:rules,playDeadline:bound.duel.playDeadline};
    }finally{this.pending.delete(room.code);}
  }
  authorize(code:string,sessionId:string){
    const match=this.store.match(code);
    if(!match?.participants.includes(sessionId))throw new Error('Paid match not found for this session.');
    return match;
  }
  history(sessionId:string){
    const rows=this.store.db.prepare("SELECT m.data AS match,p.data AS paid FROM matches m JOIN paid_terms p ON p.code=m.code WHERE EXISTS(SELECT 1 FROM json_each(m.data,'$.participants') WHERE value=?) ORDER BY m.updated DESC LIMIT 10").all(sessionId) as {match:string;paid:string}[];
    return rows.map(row=>{const m=JSON.parse(row.match),p=JSON.parse(row.paid) as Saved;const seat=m.participants.indexOf(sessionId);delete m.participants;return {...m,seat,paid:p.view,recoveryOnly:!this.rooms.rooms.has(m.code)||!this.rooms.membership.has(sessionId)};});
  }
  status(code:string,sessionId:string){
    this.authorize(code,sessionId);
    const room=this.rooms.rooms.get(code);if(room?.paid)return room.paid;
    const row=this.store.db.prepare('SELECT data FROM paid_terms WHERE code=?').get(code) as {data:string}|undefined;
    if(row)return (JSON.parse(row.data) as Saved).view;
    throw new Error('Funding terms are not ready.');
  }
  async refresh(code:string,sessionId:string){this.authorize(code,sessionId);const row=this.store.db.prepare('SELECT data FROM paid_terms WHERE code=?').get(code) as {data:string}|undefined;if(row&&!this.syncing&&!this.pending.has(code))await this.syncOne(JSON.parse(row.data) as Saved);return this.status(code,sessionId);}
  async proof(sessionId:string,code?:string){
    code??=this.rooms.require(sessionId).code;
    const match=this.authorize(code,sessionId),room=this.rooms.rooms.get(code),bound=this.bound(code);
    const result=room?.result??match.result;
    if((room?.mode??match.mode)!=='paid'||!bound||!result)throw new Error('An authoritative completed paid match is required.');
    const cached=this.store.db.prepare('SELECT data FROM signed_results WHERE record_id=?').get(bound.id) as {data:string}|undefined;
    if(cached)return JSON.parse(cached.data);
    const pending=this.signing.get(code);if(pending)return pending;
    const task=this.settlement.sign(bound,result).then(proof=>{
      if(this.stopped)throw new Error('Server stopped before proof persistence. Retry on the restarted server.');
      this.store.db.prepare('INSERT INTO signed_results VALUES(?,?,?)').run(bound.id,code!,encode(proof));return proof;
    }).finally(()=>this.signing.delete(code!));
    this.signing.set(code,task);return task;
  }
  async sync(){
    if(this.syncing||this.stopped)return;this.syncing=true;
    try{
      const rows=this.store.db.prepare("SELECT data FROM paid_terms WHERE json_extract(data,'$.view.stage') NOT IN ('settled','cancelled','recovery')").all() as {data:string}[];
      for(const row of rows){if(this.stopped)break;await this.syncOne(JSON.parse(row.data) as Saved);}
    }finally{this.syncing=false;}
  }
  private syncOne(saved:Saved){const old=this.syncingCodes.get(saved.code);if(old)return old;const task=this.syncRecord(saved).finally(()=>this.syncingCodes.delete(saved.code));this.syncingCodes.set(saved.code,task);return task;}
  private async syncRecord(saved:Saved){
    const room=this.rooms.rooms.get(saved.code),match=this.store.match(saved.code);if(!match)return;
    try{
      const [d,now]=await Promise.all([this.settlement.read(saved.id),this.settlement.chainTime()]);if(this.stopped)return;
      const view:PaidStatus={...saved.view,contractState:d.state,fundedMask:d.fundedMask??0,checkedAt:Date.now(),message:'Waiting for confirmed entries.'};
      const revoked=d.state===1||d.state===2?await this.settlement.isRevoked(d.signer):false;
      if(this.stopped)return;
      view.signerRevoked=revoked;
      if(d.state===0||d.state===1){view.stage=revoked||now>BigInt(saved.terms.fundingDeadline)?'recovery':'funding';view.message=revoked?'Signer revoked. Release and claim eligible refunds.':now>BigInt(saved.terms.fundingDeadline)?'Funding deadline passed. Release and claim any deposited entry.':'Approve and deposit 1 test USDC per player.';}
      if(d.state===0&&now>BigInt(saved.terms.fundingDeadline)){view.stage='cancelled';view.message='Unfunded terms expired. No entry was collected.';if(room&&!room.result)this.rooms.finish(room,'Void',null,'Unfunded terms expired.');}
      if(d.state===2){
        view.playDeadline=String(d.playDeadline);view.settlementDeadline=String(d.settlementDeadline);
        view.stage=revoked||now>d.settlementDeadline?'recovery':'active';view.message=revoked?'Signer revoked. Refunds can be released.':now>d.settlementDeadline?'Settlement expired. Release both refunds.':'Both entries are confirmed. Preparing the fight.';
        if(!revoked&&now<=d.playDeadline){
          let bound=this.bound(saved.code);
          if(!bound){
            bound=await this.settlement.bind(saved.id,saved.terms.players,saved.terms.rulesetHash);if(this.stopped)return;
            this.store.db.prepare('INSERT INTO paid_bindings VALUES(?,?,?)').run(saved.code,saved.id,encode(bound));this.bindings.set(saved.code,bound);
          }
          if(room&&!room.result){
            room.paidDeadline=Number(d.playDeadline)*1000;
            if(room.phase==='funding')room.phase='waiting';
            if(room.phase==='waiting'&&room.players.every(p=>p?.peer&&p.ready)){
              if(Date.now()+this.rooms.roundSeconds*1000+this.rooms.countdownMs<room.paidDeadline)this.rooms.ready(room.players[0]!.id,true);
              else this.rooms.finish(room,'Void',null,'Insufficient time remains to start this funded fight.');
            }
          }
          if(!room&&!match.result&&match.interrupted){
            match.result={outcome:'Void',winner:null,reason:'Server restarted before a verifiable finish.',replayHash:'0x'+(await import('node:crypto')).createHash('sha256').update(encode({code:saved.code,interrupted:true,recordId:saved.id})).digest('hex'),finishedAt:Number(now)};
            match.phase='cancelled';this.store.saveRoom(saved.code,match,true);
          }
        }
        const result=room?.result??match.result;
        if(result&&!revoked&&now<=d.settlementDeadline){
          if(result.outcome==='Void'&&!room?.startedAt&&BigInt(result.finishedAt)<d.lockedAt){result.finishedAt=Number(now);if(room)this.rooms.persist(room);else this.store.saveRoom(saved.code,match,true);}
          try{await this.proof(match.participants[0],saved.code);view.stage='result-ready';view.message='Official result signed. Submit it to the contract, then claim your credit.';}
          catch(error){view.message=error instanceof Error?error.message:'Result signing is waiting for the contract.';view.resultsPaused=await this.settlement.isResultsPaused();}
        }
      }
      if(d.state===3){view.stage='settled';view.message='Result accepted by the contract. Claim your available credit.';}
      if(d.state===4){view.stage='cancelled';view.message='Contract cancelled this duel. Claim any allocated refund.';if(room&&!room.result)this.rooms.finish(room,'Void',null,'Funding cancelled or the duel was voided.');}
      if(this.stopped)return;
      saved.view=view;this.store.db.prepare('UPDATE paid_terms SET data=? WHERE code=?').run(encode(saved),saved.code);
      if(room){room.paid=view;this.rooms.persist(room);this.rooms.broadcastRoom(room);}
    }catch(error){
      if(this.stopped)return;
      saved.view.message=error instanceof Error?error.message:'Could not refresh this contract record.';
      this.store.db.prepare('UPDATE paid_terms SET data=? WHERE code=?').run(encode(saved),saved.code);
      if(room){room.paid=saved.view;this.rooms.broadcastRoom(room);}
    }
  }
  close(){this.stopped=true;}
}
