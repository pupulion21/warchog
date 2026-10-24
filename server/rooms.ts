import { createHash, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Combat, neutralInput, type InputFrame, type CombatEvent } from '../src/combat.ts';
import { getStage, type StageId } from '../src/stage.ts';
import { FIGHTER_IDS, type RoomView, type OnlineResult, type ServerPacket } from '../src/online-protocol.ts';
import { Store } from './store.ts';
import type { PaidStatus } from '../src/payment-types.ts';
export interface Peer { id: string; wallet?: string; active?:()=>boolean; send: (message: ServerPacket) => void }
export interface Player { id: string; fighter: string; wallet?: string; ready: boolean; peer?: Peer; offlineAt: number; lastInput: number; seq: number; input: InputFrame; lockOn: boolean; disconnectedMs: number }
export interface Room {
  code: string; stage: StageId; mode: 'free' | 'paid'; phase: RoomView['phase']; players: (Player | null)[];
  createdAt: number; countdownAt: number; startedAt: number; endedAt: number; lastStatusAt: number; combat: Combat;
  result: OnlineResult | null; events: CombatEvent[]; stats: { hits: number; damage: number }[];
  replay: unknown[]; part: number; hash: ReturnType<typeof createHash>; public: boolean; physicsDisposed: boolean;
  paidDeadline?: number;
  paid?:PaidStatus;
}
export const validFighter = (id: unknown): id is string => typeof id === 'string' && (FIGHTER_IDS as readonly string[]).includes(id);
export class Rooms {
  rooms = new Map<string, Room>();
  membership = new Map<string, Room>();
  rulesetHash: string;
  roundSeconds: number;
  disconnectMs: number;
  countdownMs: number;
  private store: Store;
  constructor(store: Store, options: { roundSeconds?: number; disconnectMs?: number; countdownMs?: number } = {}) {
    this.store = store; this.roundSeconds = options.roundSeconds ?? 180; this.disconnectMs = options.disconnectMs ?? 30_000; this.countdownMs = options.countdownMs ?? 3000;
    const sources = ['../src/combat.ts','../src/physics.ts','../src/stage.ts','../src/online-protocol.ts','./rooms.ts'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));
    this.rulesetHash = '0x' + createHash('sha256').update(JSON.stringify({ version: 1, sources, fighters: FIGHTER_IDS, tickHz: 60, roundSeconds: this.roundSeconds, disconnectMs: this.disconnectMs, countdownMs: this.countdownMs, ties: 'Void', timeout: 'higher HP' })).digest('hex');
  }
  private player(peer: Peer, fighter: string): Player { return { id: peer.id, fighter, ...(peer.wallet?{wallet:peer.wallet}:{}), ready: false, peer, offlineAt: 0, lastInput: 0, seq: -1, input: neutralInput(), lockOn: true, disconnectedMs: 0 }; }
  async create(peer: Peer, fighter: string, stage: StageId, quick = false, mode:'free'|'paid'='free') {
    if (this.membership.has(peer.id)) throw new Error('Leave your current room before creating another.');
    if (!validFighter(fighter)) throw new Error('Choose a fighter from the WARCHOG roster.');
    getStage(stage);
    if(mode==='paid'&&!peer.wallet)throw new Error('Sign in with your wallet before joining a prize duel.');
    if (quick) {
      const open = [...this.rooms.values()].find(r => r.mode===mode&&r.public && r.phase === 'waiting' && !r.players[1] && r.players[0]?.peer&&(!peer.wallet||r.players[0].wallet?.toLowerCase()!==peer.wallet.toLowerCase()));
      if (open) return this.join(peer, open.code, fighter);
    }
    if ([...this.rooms.values()].filter(r => !r.result).length >= 32) throw new Error('The arena is full. Please try again shortly.');
    const combat = await Combat.create(stage);
    // No await after checking membership/capacity: a second request cannot reserve another room.
    if ((peer.active&&!peer.active()) || this.membership.has(peer.id) || [...this.rooms.values()].filter(r => !r.result).length >= 32) { combat.dispose(); throw new Error('Room request changed. Try again.'); }
    if (quick) { const open = [...this.rooms.values()].find(r => r.mode===mode&&r.public && r.phase==='waiting' && !r.players[1] && r.players[0]?.peer&&(!peer.wallet||r.players[0].wallet?.toLowerCase()!==peer.wallet.toLowerCase())); if (open) { combat.dispose(); return this.join(peer,open.code,fighter); } }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (this.rooms.has(code) || this.store.match(code));
    const room: Room = { code, stage, mode, phase: 'waiting', players: [this.player(peer, fighter), null], createdAt: Date.now(), countdownAt: 0, startedAt: 0, endedAt: 0, lastStatusAt: 0,
      combat, result: null, events: [], stats: [{ hits: 0, damage: 0 }, { hits: 0, damage: 0 }], replay: [], part: 0, hash: createHash('sha256'), public: quick, physicsDisposed: false };
    room.hash.update(JSON.stringify({ code, stage, rulesetHash: this.rulesetHash }) + '\n');
    this.rooms.set(code, room); this.membership.set(peer.id, room); this.persist(room); this.broadcastRoom(room);
    return room;
  }
  join(peer: Peer, code: string, fighter: string) {
    if (this.membership.has(peer.id)) throw new Error('Leave your current room before joining another.');
    if (!validFighter(fighter)) throw new Error('Choose a fighter from the WARCHOG roster.');
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.phase !== 'waiting' || room.players[1]) throw new Error('That room is unavailable or already full.');
    if(room.mode==='paid'&&(!peer.wallet||peer.wallet.toLowerCase()===room.players[0]?.wallet?.toLowerCase()))throw new Error('Prize duels require two distinct signed-in wallets.');
    room.players[1] = this.player(peer, fighter); this.membership.set(peer.id, room);
    this.persist(room); this.broadcastRoom(room); return room;
  }
  reconnect(peer: Peer) {
    const room = this.membership.get(peer.id); if (!room) return null;
    const player = room.players.find(p => p?.id === peer.id)!;
    if (player.offlineAt) {
      const duration = Date.now() - player.offlineAt; player.disconnectedMs += duration;
      if (room.startedAt && !room.result && (duration >= this.disconnectMs || player.disconnectedMs >= this.disconnectMs * 2)) {
        const other = room.players.find(p => p?.id !== peer.id);
        this.finish(room, other?.peer ? 'Forfeit' : 'Void', other?.peer ? room.players.indexOf(other) : null, 'Reconnect time exhausted.');
      }
    }
    player.peer = peer; player.offlineAt = 0; player.input = neutralInput(); player.lastInput = 0; player.seq = -1;
    if (room.phase === 'reconnecting' && room.players.every(p => p?.peer)) room.phase = 'playing';
    this.broadcastRoom(room); this.sendSnapshot(room, []); return this.view(room, peer.id);
  }
  disconnect(id: string, peer: Peer) {
    const room = this.membership.get(id), player = room?.players.find(p => p?.id === id);
    if (!room || !player || player.peer !== peer) return;
    player.peer = undefined; player.offlineAt = Date.now(); player.input = neutralInput();
    if (room.phase === 'playing') room.phase = 'reconnecting';
    if (room.phase === 'countdown') { room.phase = 'waiting'; room.players.forEach(p => { if (p) p.ready = false; }); }
    this.broadcastRoom(room);
  }
  choose(id: string, fighter: string, stage: StageId) {
    const room = this.require(id); if (room.phase !== 'waiting') throw new Error('Fighters are locked after the countdown begins.');
    if(room.mode==='paid'&&(room.paid?.terms||room.paidDeadline))throw new Error('The funded match has locked its fighter and arena choices.');
    if (!validFighter(fighter)) throw new Error('Unknown fighter.');
    const player = room.players.find(p => p?.id === id)!; player.fighter = fighter; player.ready = false;
    if (room.players[0]?.id === id) { getStage(stage); if (room.stage !== stage) { room.stage = stage; room.combat.setStage(stage); room.players.forEach(p => { if (p) p.ready = false; }); } }
    this.persist(room); this.broadcastRoom(room);
  }
  ready(id: string, ready: boolean) {
    const room = this.require(id); if (room.phase !== 'waiting') return;
    if(room.mode==='paid'&&(!room.paidDeadline||Date.now()+this.roundSeconds*1000+this.countdownMs>room.paidDeadline))throw new Error('Insufficient contract play time remains. Use the contract recovery path when eligible.');
    room.players.find(p => p?.id === id)!.ready = ready;
    if (room.players.every(p => p?.peer && p.ready)) { room.phase = 'countdown'; room.countdownAt = Date.now() + this.countdownMs; }
    this.persist(room); this.broadcastRoom(room);
  }
  input(id: string, seq: number, input: InputFrame, lockOn: boolean) {
    const room = this.require(id), player = room.players.find(p => p?.id === id)!;
    if (room.phase !== 'playing' || seq <= player.seq) return;
    player.seq = seq; player.lastInput = Date.now(); player.lockOn = lockOn;
    const previous = player.input;
    player.input = { x: Math.max(-1, Math.min(1, input.x)), z: Math.max(-1, Math.min(1, input.z)), run: input.run };
    for (const key of ['attack','skill','stomp','dodge','jump'] as const) player.input[key] = Boolean(input[key] || previous[key]);
  }
  leave(id: string) {
    const room = this.membership.get(id); if (!room) return;
    const seat = room.players.findIndex(p => p?.id === id);
    if (!room.result) this.finish(room, room.startedAt ? 'Forfeit' : 'Void', room.startedAt ? 1 - seat : null, room.startedAt ? 'Opponent left the match.' : 'Room closed before the fight.');
    room.players[seat]!.peer = undefined; this.membership.delete(id);
  }
  require(id: string) { const room = this.membership.get(id); if (!room) throw new Error('Join a room first.'); return room; }
  view(room: Room, id: string): RoomView {
    return { code: room.code, mode: room.mode, stage: room.stage, phase: room.phase, seat: room.players.findIndex(p => p?.id === id),
      players: room.players.map(p => p ? { fighter: p.fighter, connected: Boolean(p.peer), ready: p.ready, ...(p.wallet ? { wallet: p.wallet } : {}) } : null),
      countdown: Math.max(0, Math.ceil((room.countdownAt - Date.now()) / 1000)), remaining: Math.max(0, this.roundSeconds - room.combat.time),
      reconnectSeconds: Math.max(0, Math.ceil((this.disconnectMs - Math.max(0, ...room.players.map(p => p?.offlineAt ? Date.now() - p.offlineAt : 0))) / 1000)),
      rulesetHash: this.matchRules(room), result: room.result,...(room.paid?{paid:room.paid}:{}) };
  }
  broadcastRoom(room: Room) { for (const player of room.players) player?.peer?.send({ type: 'room', room: this.view(room, player.id) }); if(room.phase==='waiting'||room.phase==='countdown')this.sendSnapshot(room,[]); }
  sendSnapshot(room: Room, events: CombatEvent[]) {
    const { combat: c } = room;
    const packet: ServerPacket = { type: 'snapshot', snapshot: { tick: c.tick, time: c.time, remaining: Math.max(0,this.roundSeconds-c.time), hitstop: c.hitstop, actors: c.actors, projectiles: c.projectiles, events, stats: room.stats } };
    room.players.forEach(p => p?.peer?.send(packet));
  }
  tick(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.result) {
        if (now - room.endedAt > 300_000) { room.players.forEach(p => { if (p && this.membership.get(p.id) === room) this.membership.delete(p.id); }); this.disposePhysics(room); this.rooms.delete(room.code); }
        continue;
      }
      if ((room.phase==='countdown'||room.phase==='reconnecting') && now-room.lastStatusAt>=500) {room.lastStatusAt=now;this.broadcastRoom(room);}
      if (room.phase === 'waiting' || room.phase === 'funding' || room.phase === 'countdown') {
        if (now - room.createdAt > 600_000) { this.finish(room, 'Void', null, 'Room expired before both players were ready.'); continue; }
        if (room.phase === 'countdown' && now >= room.countdownAt) { room.phase = 'playing'; room.startedAt = now; this.broadcastRoom(room); }
      }
      if (room.phase === 'reconnecting') {
        const expired = room.players.map(p => !p?.peer && p?.offlineAt && now - p.offlineAt >= this.disconnectMs);
        if (expired.some(Boolean)) {
          const winner = room.players[0]?.peer ? 0 : room.players[1]?.peer ? 1 : null;
          this.finish(room, winner === null ? 'Void' : 'Forfeit', winner, winner === null ? 'Both players disconnected.' : 'Opponent did not reconnect.');
        }
        continue;
      }
      if (room.phase !== 'playing') continue;
      const players = room.players as [Player, Player];
      const inputs = players.map(p => now - p.lastInput > 350 ? neutralInput() : { ...p.input });
      room.combat.lockOn = players[0].lockOn;
      room.combat.step(inputs[0], 1 / 60, inputs[1], players[1].lockOn);
      const row = [room.combat.tick, inputs, players.map(p => p.lockOn)]; room.hash.update(JSON.stringify(row) + '\n'); room.replay.push(row);
      players.forEach(p => { for (const key of ['attack','skill','stomp','dodge','jump'] as const) p.input[key] = false; });
      const events = room.combat.drainEvents(); room.events.push(...events);
      for (const e of events) if (e.type === 'hit') { room.stats[e.source].hits++; room.stats[e.source].damage += e.damage ?? 0; }
      if (room.replay.length >= 60) this.flush(room);
      if (room.combat.roundOver) {
        const alive = room.combat.actors.map(a => a.hp > 0);
        const winner = alive[0] === alive[1] ? null : alive[0] ? 0 : 1;
        this.finish(room, winner === null ? 'Void' : 'Finished', winner, winner === null ? 'Double K.O.' : 'K.O.');
      } else if (room.combat.time >= this.roundSeconds) {
        const [a,b] = room.combat.actors.map(a => a.hp), winner = a === b ? null : a > b ? 0 : 1;
        this.finish(room, winner === null ? 'Void' : 'Finished', winner, winner === null ? 'Time up · equal HP.' : 'Time up · higher HP wins.');
      } else if (room.combat.tick % 3 === 0) { this.sendSnapshot(room, room.events); room.events = []; }
    }
  }
  finish(room: Room, outcome: OnlineResult['outcome'], winner: number | null, reason: string) {
    if (room.result) return;
    this.flush(room); room.hash.update(JSON.stringify({ outcome, winner, reason, fighters: room.players.map(p => p?.fighter) }));
    room.result = { outcome, winner, reason, replayHash: '0x' + room.hash.digest('hex'), finishedAt: Math.floor(Date.now() / 1000) };
    room.phase = outcome === 'Void' && !room.startedAt ? 'cancelled' : 'complete'; room.endedAt = Date.now();
    this.persist(room); this.sendSnapshot(room, room.events); room.events = []; this.broadcastRoom(room);
    this.disposePhysics(room);
  }
  private flush(room: Room) { if (room.replay.length) { this.store.chunk(room.code, room.part++, room.replay); room.replay = []; } }
  matchRules(room: Room) { return '0x'+createHash('sha256').update(JSON.stringify({base:this.rulesetHash,stage:room.stage,fighters:room.players.map(p=>p?.fighter)})).digest('hex'); }
  persist(room: Room) { this.store.saveRoom(room.code, { ...this.view(room, room.players[0]?.id ?? ''), participants: room.players.map(p => p?.id), startedAt: room.startedAt, result: room.result, ...(room.result?{finalState:{tick:room.combat.tick,actors:room.combat.actors}}:{}) }, Boolean(room.result)); }
  private disposePhysics(room: Room) { if (!room.physicsDisposed) { room.combat.dispose(); room.physicsDisposed = true; } }
  close() { for (const room of this.rooms.values()) { if (!room.result) this.finish(room, 'Void', null, 'Server stopped; match voided.'); this.disposePhysics(room); } this.rooms.clear(); this.membership.clear(); }
}
