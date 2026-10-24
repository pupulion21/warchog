import type { Actor, CombatEvent, InputFrame, Projectile } from './combat.ts';
import type { StageId } from './stage.ts';
import type { PaidStatus } from './payment-types.ts';
export const PROTOCOL = 1;
export const FIGHTER_IDS = ['yot','mamio','mamio-empowered','benja','toad','ping','novee','tonashiro','bigchog','rogue','tabsu','venty','cookie'] as const;
export type RoomPhase = 'waiting' | 'funding' | 'countdown' | 'playing' | 'reconnecting' | 'complete' | 'cancelled';
export interface OnlinePlayer { fighter: string; connected: boolean; ready: boolean; wallet?: string }
export interface OnlineResult { outcome: 'Finished' | 'Forfeit' | 'Void'; winner: number | null; reason: string; replayHash: string; finishedAt: number }
export interface RoomView {
  code: string; seat: number; mode: 'free' | 'paid'; phase: RoomPhase; stage: StageId;
  players: (OnlinePlayer | null)[]; countdown: number; remaining: number; reconnectSeconds: number;
  rulesetHash: string; result: OnlineResult | null; paid?:PaidStatus;recoveryOnly?:boolean;
}
export interface OnlineSnapshot { tick: number; time: number; remaining: number; hitstop: number; actors: Actor[]; projectiles: Projectile[]; events: CombatEvent[]; stats: { hits: number; damage: number }[] }
export type ClientPacket =
  | { type: 'create' | 'queue'; fighter: string; stage: StageId; mode?:'free'|'paid' }
  | { type: 'join'; code: string; fighter: string }
  | { type: 'choose'; fighter: string; stage: StageId }
  | { type: 'ready'; ready: boolean }
  | { type: 'input'; seq: number; input: InputFrame; lockOn: boolean }
  | { type: 'leave' }
  | { type: 'ping'; sent: number };
export type ServerPacket =
  | { type: 'hello'; protocol: number; room: RoomView | null }
  | { type: 'room'; room: RoomView }
  | { type: 'snapshot'; snapshot: OnlineSnapshot }
  | { type: 'left' }
  | { type: 'pong'; sent: number }
  | { type: 'error'; message: string };
