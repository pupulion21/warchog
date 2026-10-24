import { PROTOCOL, type ClientPacket, type OnlineSnapshot, type RoomView, type ServerPacket } from './online-protocol.ts';
import type { InputFrame, Actor } from './combat.ts';
export class OnlineClient {
  room: RoomView | null = null;
  snapshot: OnlineSnapshot | null = null;
  connected = false;
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = true;
  private seq = 0;
  private generation = 0;
  private visual: Actor[] = [];
  private renderFrame = -1;
  constructor(private callbacks: { room: (room: RoomView | null) => void; snapshot: (snapshot: OnlineSnapshot) => void; error: (message: string) => void; connection: (connected: boolean) => void }) {}
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN && this.connected) return;
    if (this.connecting) return this.connecting;
    this.stopped = false;
    const generation=++this.generation;
    const pending=this.open(generation).finally(()=>{if(this.connecting===pending)this.connecting=undefined;});
    this.connecting=pending;return pending;
  }
  get reconnecting(){return !this.stopped&&Boolean(this.room);}
  private async open(generation:number) {
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal:AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('The online arena is unavailable. Try again shortly.');
    if(generation!==this.generation||this.stopped)throw new Error('Connection cancelled.');
    const url = new URL('/api/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    await new Promise<void>((resolve,reject) => {
      const ws = this.socket = new WebSocket(url);
      let greeted = false;
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Could not connect to the arena.')); }, 10_000);
      ws.onmessage = event => {
        if(this.socket!==ws||generation!==this.generation)return;
        const packet = JSON.parse(event.data) as ServerPacket;
        if (packet.type === 'hello') {
          clearTimeout(timeout);
          if (packet.protocol !== PROTOCOL) { this.stopped = true; ws.close(); reject(new Error('Game updated. Refresh WARCHOG to continue.')); return; }
          greeted = true; this.connected = true; this.attempts = 0; this.callbacks.connection(true);
          this.room = packet.room; this.callbacks.room(this.room); resolve();
        } else if (packet.type === 'room') { this.room = packet.room; this.callbacks.room(packet.room); }
        else if (packet.type === 'snapshot') { this.snapshot = packet.snapshot; if(this.room)this.room.remaining=packet.snapshot.remaining;this.callbacks.snapshot(packet.snapshot); }
        else if (packet.type === 'left') { this.room = null; this.snapshot = null; this.visual = []; this.callbacks.room(null); }
        else if (packet.type === 'error') this.callbacks.error(packet.message);
      };
      ws.onerror = () => { if (!greeted) { clearTimeout(timeout); reject(new Error('Could not connect to the arena.')); } };
      ws.onclose = event => {
        clearTimeout(timeout);
        if(this.socket!==ws||generation!==this.generation){if(!greeted)reject(new Error('Connection replaced.'));return;}
        if (event.code === 4001) { this.stopped = true; this.callbacks.error('This session moved to another tab.'); }
        this.connected = false; this.callbacks.connection(false);
        if (!greeted) reject(new Error('The arena connection closed.'));
        if (!this.stopped && this.room && this.attempts++ < 8) this.reconnectTimer = setTimeout(() => { void this.connect().catch(() => {}); }, Math.min(2000, 400 * this.attempts));
        else if(!this.stopped&&this.room){this.stopped=true;this.callbacks.error('Could not reconnect. Return to the hub to try again.');this.callbacks.connection(false);}
      };
    });
  }
  send(packet: ClientPacket) { if (this.socket?.readyState === WebSocket.OPEN && this.connected) this.socket.send(JSON.stringify(packet)); }
  input(input: InputFrame, lockOn: boolean) { this.send({ type: 'input', seq: ++this.seq, input, lockOn }); }
  leave() { this.send({ type: 'leave' }); this.stop(); this.room = null; this.snapshot = null; this.visual = []; this.callbacks.room(null); }
  stop() { this.stopped = true; ++this.generation;this.connecting=undefined;clearTimeout(this.reconnectTimer); this.socket?.close(); this.socket = undefined; this.connected = false; }
  // Visual interpolation never changes server HP, cooldowns, hit detection or result.
  sample(actor: Actor, dt: number, frame: number) {
    if (this.renderFrame !== frame) this.renderFrame = frame;
    const old = this.visual[actor.seat];
    const factor = old && Math.hypot(old.x - actor.x, old.z - actor.z) < 4 ? 1 - Math.exp(-dt * 22) : 1;
    const copy = { ...actor, x: old ? old.x + (actor.x - old.x) * factor : actor.x, y: old ? old.y + (actor.y - old.y) * factor : actor.y, z: old ? old.z + (actor.z - old.z) * factor : actor.z };
    this.visual[actor.seat] = copy; return copy;
  }
}
