import { ArenaPhysics } from './physics.ts';
import type { StageId } from './stage.ts';

export type State = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'attack1' | 'attack2' | 'attack3' |
  'skill' | 'stomp' | 'dodge' | 'hurt' | 'down' | 'getup' | 'ko';
export type DummyMode = 'idle' | 'strafe' | 'spar';
export type ActionKind = 'attack1' | 'attack2' | 'attack3' | 'skill' | 'stomp' | 'dodge';
export interface InputFrame { x: number; z: number; attack?: boolean; skill?: boolean; stomp?: boolean; dodge?: boolean; jump?: boolean; run?: boolean }
export interface Actor {
  seat: number; x: number; y: number; z: number; yaw: number; hp: number;
  vx: number; vz: number; vy: number; grounded: boolean; state: State; stateTime: number;
  action: { kind: ActionKind; time: number; fired: boolean; queued: boolean; id: number } | null;
  hurt: number; down: number; getup: number; invuln: number;
  skillCooldown: number; stompCooldown: number; dodgeCooldown: number;
  traveled: number; speed: number; combo: number; actionCounter: number;
  lastHitYaw: number; buffer: { kind: ActionKind; expires: number } | null;
}
export interface CombatEvent {
  id: number; type: 'action' | 'release' | 'hit' | 'whiff' | 'land' | 'jump' | 'ko' | 'recover' | 'blocked';
  source: number; target?: number; x: number; y: number; z: number;
  kind?: ActionKind; damage?: number; heavy?: boolean; tick: number;
}
export interface Projectile { id: number; owner: number; x: number; y: number; z: number; vx: number; vz: number; life: number }
export const MOVES = {
  attack1: { duration: 0.4, contact: 0.15, damage: 9, reach: 1.9, push: 3.4 },
  attack2: { duration: 0.46, contact: 0.19, damage: 12, reach: 2, push: 3.8 },
  attack3: { duration: 0.63, contact: 0.28, damage: 20, reach: 2.2, push: 6.2 },
  skill: { duration: 0.6, contact: 0.23, damage: 18, reach: 13, push: 4.6 },
  stomp: { duration: 0.86, contact: 0.38, damage: 28, reach: 3.1, push: 7.8 },
  dodge: { duration: 0.28, contact: 99, damage: 0, reach: 0, push: 0 },
} satisfies Record<ActionKind, { duration: number; contact: number; damage: number; reach: number; push: number }>;
export const neutralInput = (): InputFrame => ({ x: 0, z: 0 });
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const approach = (v: number, target: number, step: number) => v + clamp(target - v, -step, step);
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
function makeActor(seat: number): Actor {
  return { seat, x: 0, y: 0, z: seat ? 2 : -2, yaw: seat ? Math.PI : 0, hp: 200,
    vx: 0, vz: 0, vy: 0, grounded: true, state: 'idle', stateTime: 0, action: null,
    hurt: 0, down: 0, getup: 0, invuln: 0, skillCooldown: 0, stompCooldown: 0, dodgeCooldown: 0,
    traveled: 0, speed: 0, combo: 0, actionCounter: 0, lastHitYaw: 0, buffer: null };
}

export class Combat {
  physics: ArenaPhysics;
  actors: Actor[] = [makeActor(0), makeActor(1)];
  projectiles: Projectile[] = [];
  events: CombatEvent[] = [];
  tick = 0; time = 0; hitstop = 0; mode: DummyMode = 'idle'; lockOn = true;
  totalDamage = 0; hits = 0; comboDamage = 0; lastHitTime = -10;
  private eventId = 0; private projectileId = 0; private aiAttackAt = 1.6;
  constructor(physics: ArenaPhysics) { this.physics = physics; }
  static async create(stageId: StageId = 'cwo-alley') { return new Combat(await ArenaPhysics.create(stageId)); }
  setStage(stageId: StageId) { this.physics.setStage(stageId); this.reset(); }
  get roundOver() { return this.actors.some(a => a.hp <= 0); }
  private state(a: Actor, s: State) { if (a.state !== s) { a.state = s; a.stateTime = 0; } }
  private emit(type: CombatEvent['type'], a: Actor, extra: Partial<CombatEvent> = {}) {
    this.events.push({ id: ++this.eventId, type, source: a.seat, x: a.x, y: a.y + 1, z: a.z, tick: this.tick, ...extra });
    if (this.events.length > 150) this.events.shift();
  }
  drainEvents() { const events = this.events; this.events = []; return events; }
  reset() {
    this.actors = [makeActor(0), makeActor(1)];
    this.actors.forEach(a => this.physics.reset(a.seat, a.x, a.z));
    this.physics.step();
    this.projectiles = []; this.events = []; this.tick = 0; this.time = 0; this.hitstop = 0;
    this.totalDamage = this.hits = this.comboDamage = 0; this.lastHitTime = -10; this.aiAttackAt = 1.6;
  }
  teleport(seat: number, x: number, z: number) {
    const a = this.actors[seat]; a.x = clamp(x, -9.5, 9.5); a.z = clamp(z, -8, 8); a.y = 0;
    this.physics.reset(seat, a.x, a.z); this.physics.step();
  }
  private eligible(a: Actor) { return !this.roundOver && a.hp > 0 && a.hurt <= 0 && a.down <= 0 && a.getup <= 0; }
  private start(a: Actor, kind: ActionKind) {
    if (!this.eligible(a)) { if (a.hp > 0) a.buffer = { kind, expires: this.time + 0.12 }; return false; }
    if (a.action) {
      if (kind === 'attack1' && a.action.kind.startsWith('attack') && a.action.kind !== 'attack3') a.action.queued = true;
      return false;
    }
    if ((kind === 'skill' && a.skillCooldown > 0) || (kind === 'stomp' && a.stompCooldown > 0) ||
      (kind === 'dodge' && a.dodgeCooldown > 0)) return false;
    if (kind === 'skill') a.skillCooldown = 2.5;
    if (kind === 'stomp') a.stompCooldown = 4.5;
    if (kind === 'dodge') { a.dodgeCooldown = 0.8; a.invuln = 0.19; }
    a.action = { kind, time: 0, fired: false, queued: false, id: ++a.actionCounter };
    this.state(a, kind); this.emit('action', a, { kind }); return true;
  }
  private receiveHit(source: Actor, target: Actor, damage: number, push: number, knockdown = false, contact?: { x: number; y: number; z: number }) {
    if (target.hp <= 0 || target.invuln > 0 || target.down > 0 || target.getup > 0) return false;
    const dx = target.x - source.x, dz = target.z - source.z, length = Math.hypot(dx, dz) || 1;
    target.hp = Math.max(0, target.hp - damage);
    target.vx = dx / length * push; target.vz = dz / length * push;
    target.lastHitYaw = Math.atan2(-dx, -dz);
    target.action = null; target.buffer = null;
    target.hurt = target.hp > 0 ? (knockdown ? 0 : 0.29) : 0;
    target.invuln = 0.12;
    if (knockdown || target.hp <= 0) { target.down = target.hp > 0 ? 0.9 : 99999; target.vy = 3; target.grounded = false; }
    this.state(target, target.hp <= 0 ? 'ko' : knockdown ? 'down' : 'hurt');
    this.hitstop = Math.max(this.hitstop, knockdown ? 0.07 : 0.042);
    if (source.seat === 0) {
      this.totalDamage += damage; this.hits++;
      this.comboDamage = this.time - this.lastHitTime < 1.4 ? this.comboDamage + damage : damage;
      this.lastHitTime = this.time;
    }
    const hit = contact || { x: (source.x + target.x) / 2, y: target.y + 0.95, z: (source.z + target.z) / 2 };
    this.emit('hit', source, { ...hit, target: target.seat, damage, heavy: knockdown });
    if (target.hp <= 0) this.emit('ko', target, { target: target.seat });
    return true;
  }
  forceHit(seat: number, damage = 14, knockdown = false) {
    return this.receiveHit(this.actors[1 - seat], this.actors[seat], damage, 4.5, knockdown);
  }
  private strike(a: Actor, kind: ActionKind) {
    const m = MOVES[kind], b = this.actors[1 - a.seat];
    if (kind === 'skill') {
      this.projectiles.push({ id: ++this.projectileId, owner: a.seat,
        x: a.x + Math.sin(a.yaw) * 0.7, y: a.y + 1.02, z: a.z + Math.cos(a.yaw) * 0.7,
        vx: Math.sin(a.yaw) * 11, vz: Math.cos(a.yaw) * 11, life: 1.3 });
      this.emit('release', a, { kind }); return;
    }
    const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
    const dot = distance > 0.01 ? (dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw)) / distance : 1;
    const radial = kind === 'stomp';
    if (radial) this.emit('release', a, { kind });
    if (distance <= m.reach && Math.abs(a.y - b.y) < 1.4 && (radial || dot > 0.25)) {
      if (this.receiveHit(a, b, m.damage, m.push, kind === 'attack3' || radial)) return;
    }
    if (!radial) this.emit('whiff', a, { kind });
  }
  private aiInput(): InputFrame {
    const a = this.actors[1], player = this.actors[0];
    if (this.mode === 'idle' || this.roundOver) return neutralInput();
    const dx = player.x - a.x, dz = player.z - a.z, d = Math.hypot(dx, dz) || 1;
    let x = -dz / d * 0.65, z = dx / d * 0.65;
    const correction = clamp((d - 2.4) * 0.6, -0.7, 0.7);
    x += dx / d * correction; z += dz / d * correction;
    const input: InputFrame = { x, z };
    if (this.mode === 'spar') {
      if (d > 1.7) { input.x = dx / d * 0.9; input.z = dz / d * 0.9; }
      else { input.x = 0; input.z = 0; }
      if (this.time >= this.aiAttackAt && this.eligible(a) && !a.action) {
        if (d < 2.2) input.attack = true; else if (d > 3) input.skill = true;
        this.aiAttackAt = this.time + 1.25;
      }
    }
    return input;
  }
  step(input: InputFrame = neutralInput(), dt = 1 / 60, rivalInput?: InputFrame, rivalLockOn = true) {
    if (Math.abs(dt - 1 / 60) > 0.000001) throw new Error('Combat requires a 60 Hz fixed step.');
    this.tick++;
    if (this.hitstop > 0) { this.hitstop = Math.max(0, this.hitstop - dt); return; }
    this.time += dt;
    const frames = [input, rivalInput ?? this.aiInput()];
    for (const a of this.actors) {
      const f = frames[a.seat], target = this.actors[1 - a.seat], lockedOn = a.seat === 0 ? this.lockOn : rivalLockOn;
      a.stateTime += dt;
      for (const key of ['hurt', 'invuln', 'skillCooldown', 'stompCooldown', 'dodgeCooldown'] as const) a[key] = Math.max(0, a[key] - dt);
      if (a.down > 0 && a.hp > 0) {
        a.down = Math.max(0, a.down - dt);
        if (a.down === 0) { a.getup = 0.58; a.invuln = 0.72; this.state(a, 'getup'); }
      } else if (a.getup > 0) {
        a.getup = Math.max(0, a.getup - dt);
        if (a.getup === 0) { this.emit('recover', a); this.state(a, 'idle'); }
      }
      if (a.buffer && a.buffer.expires < this.time) a.buffer = null;
      if (a.buffer && this.eligible(a) && !a.action) { const kind = a.buffer.kind; a.buffer = null; this.start(a, kind); }
      if (f.attack) this.start(a, 'attack1');
      if (f.skill) this.start(a, 'skill');
      if (f.stomp) this.start(a, 'stomp');
      if (f.dodge) this.start(a, 'dodge');
      if (f.jump && this.eligible(a) && !a.action && a.grounded) { a.vy = 7.1; a.grounded = false; this.state(a, 'jump'); this.emit('jump', a); }
      const aim = Math.atan2(target.x - a.x, target.z - a.z);
      if (lockedOn && this.eligible(a) && (!a.action || a.action.time < MOVES[a.action.kind].contact * 0.5)) {
        a.yaw += clamp(angleDelta(a.yaw, aim), -dt * 10, dt * 10);
      }
      let mx = Number.isFinite(f.x) ? f.x : 0, mz = Number.isFinite(f.z) ? f.z : 0;
      const magnitude = Math.hypot(mx, mz); if (magnitude > 1) { mx /= magnitude; mz /= magnitude; }
      const canMove = this.eligible(a) && !a.action;
      const speed = f.run ? 5 : 3.3;
      if (canMove) {
        a.vx = approach(a.vx, mx * speed, dt * 24); a.vz = approach(a.vz, mz * speed, dt * 24);
        if (!lockedOn && magnitude > 0.1) a.yaw += clamp(angleDelta(a.yaw, Math.atan2(mx, mz)), -dt * 12, dt * 12);
        this.state(a, a.grounded ? magnitude > 0.1 ? f.run ? 'run' : 'walk' : 'idle' : a.vy > 0 ? 'jump' : 'fall');
      } else { a.vx = approach(a.vx, 0, dt * 12); a.vz = approach(a.vz, 0, dt * 12); }
      if (a.action?.kind === 'dodge') { a.vx = Math.sin(a.yaw) * 8.2; a.vz = Math.cos(a.yaw) * 8.2; }
      if (a.hurt > 0) this.state(a, 'hurt');
      if (a.down > 0) this.state(a, a.hp <= 0 ? 'ko' : 'down');
      a.vy -= 22 * dt;
      const grounded = this.physics.move(a.seat, a.vx * dt, a.vy * dt, a.vz * dt);
      if (grounded) { if (!a.grounded && a.vy < -1) this.emit('land', a); a.vy = 0; a.grounded = true; }
      else a.grounded = false;
      a.speed = Math.hypot(a.vx, a.vz); a.traveled += a.speed * dt;
    }
    this.physics.step();
    for (const a of this.actors) Object.assign(a, this.physics.position(a.seat));
    const [a, b] = this.actors, dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
    if (distance < 0.79 && Math.abs(a.y - b.y) < 1.3 && a.hp > 0 && b.hp > 0) {
      const inv = 1 / (distance || 1), push = (0.79 - distance) / 2;
      const px = distance ? dx * inv * push : push, pz = dz * inv * push;
      if (!this.physics.blocked(a.x - px, a.z - pz, 0.36)) { a.x -= px; a.z -= pz; }
      if (!this.physics.blocked(b.x + px, b.z + pz, 0.36)) { b.x += px; b.z += pz; }
      for (const v of this.actors) { const p = this.physics.bodies[v.seat].translation(); this.physics.bodies[v.seat].setTranslation({ x: v.x, y: p.y, z: v.z }, true); }
    }
    // Sample both actors before committing contacts so simultaneous attacks can trade.
    const strikes: { actor: Actor; kind: ActionKind }[] = [];
    for (const a of this.actors) {
      const action = a.action; if (!action) continue;
      action.time += dt;
      if (!action.fired && action.time >= MOVES[action.kind].contact) { action.fired = true; strikes.push({ actor: a, kind: action.kind }); }
      if (action.time >= MOVES[action.kind].duration) {
        const next: ActionKind | null = action.queued && action.kind === 'attack1' ? 'attack2' : action.queued && action.kind === 'attack2' ? 'attack3' : null;
        a.action = null; if (next) this.start(a, next); else if (this.eligible(a)) this.state(a, a.grounded ? 'idle' : 'fall');
      }
    }
    for (const strike of strikes) this.strike(strike.actor, strike.kind);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i], target = this.actors[1 - p.owner];
      const oldX = p.x, oldZ = p.z;
      p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt;
      const vx = p.x - oldX, vz = p.z - oldZ;
      const t = clamp(((target.x - oldX) * vx + (target.z - oldZ) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      if (Math.hypot(target.x - (oldX + vx * t), target.z - (oldZ + vz * t)) < 0.55 && Math.abs(p.y - (target.y + 0.85)) < 0.85) {
        if (this.receiveHit(this.actors[p.owner], target, MOVES.skill.damage, MOVES.skill.push, false, { x: p.x, y: p.y, z: p.z })) p.life = 0;
      }
      if (this.physics.blocked(p.x, p.z)) { p.life = 0; this.emit('blocked', this.actors[p.owner], { x: p.x, y: p.y, z: p.z }); }
      if (p.life <= 0) this.projectiles.splice(i, 1);
    }
  }
  snapshot() {
    return { stageId: this.physics.stage.id, tick: this.tick, time: this.time, hitstop: this.hitstop, mode: this.mode, lockOn: this.lockOn,
      actors: structuredClone(this.actors), projectiles: structuredClone(this.projectiles),
      totalDamage: this.totalDamage, hits: this.hits, comboDamage: this.comboDamage, roundOver: this.roundOver };
  }
  dispose() { this.physics.dispose(); }
}
