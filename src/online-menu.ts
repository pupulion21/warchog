import { OnlineClient } from './online.ts';
import type { RoomView, OnlineSnapshot } from './online-protocol.ts';
import type { StageId } from './stage.ts';
import { PaidPanel, paidPanelMarkup } from './paid-panel.ts';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
export function onlineSetupMarkup() {
  return `<section id="online-setup" class="online-setup" hidden aria-label="Online room"><span class="comic-eyebrow">REAL RIVAL · FREE ONLINE</span><p id="online-status" role="status">Choose your fighter, then find a rival or create a room.</p><div id="online-entry"><button id="online-quick" class="arcade-enter">FIND A RIVAL ↗</button><button id="online-create" class="paper-button">CREATE PRIVATE ROOM</button><div class="online-join-row"><input id="online-code" maxlength="6" placeholder="ROOM CODE" aria-label="Six-character room code" autocomplete="off" autocapitalize="characters"><button id="online-join" class="paper-button">JOIN</button></div></div><div id="online-room" hidden><span>ROOM <b id="online-room-code"></b></span><button id="online-copy" class="paper-button">COPY INVITE ↗</button><p id="online-seats"></p><button id="online-ready" class="arcade-enter" disabled>LOADING FIGHTERS…</button><button id="online-leave" class="paper-button">LEAVE ROOM</button></div><small id="online-mode-note">No entry fee or prize. Esc opens settings; the online match continues.</small></section>`;
}
export class OnlineLobby {
  client: OnlineClient;
  private payments:PaidPanel;
  private mode:'free'|'paid'='free';
  private historyRoom:RoomView|null=null;
  private busy = false;
  private version = 0;
  private loadedKey = '';
  private preparingKey = '';
  private preparing = false;
  private queuedRoom: RoomView | null = null;
  private error = '';
  constructor(private callbacks: {
    setup: () => void; selection: () => { fighter: string; stage: StageId };
    load: (room: RoomView) => Promise<void>; room: (room: RoomView | null) => void;
    snapshot: (snapshot: OnlineSnapshot) => void; connection: (connected: boolean) => void;
  }) {
    $('online-setup').insertAdjacentHTML('beforeend',paidPanelMarkup());
    this.payments=new PaidPanel(text=>{this.error=text;this.render();});
    this.client = new OnlineClient({ room: room => { if(room)this.mode=room.mode;this.payments.update(room);this.callbacks.room(room); this.render(); if (room) void this.prepare(room); },
      snapshot: s => this.callbacks.snapshot(s), error: text => { this.error = text; this.render(); },
      connection: connected => { this.callbacks.connection(connected); this.render(); } });
    $('online-create').onclick = () => void this.request('create'); $('online-quick').onclick = () => void this.request('queue'); $('online-join').onclick = () => void this.request('join');
    $<HTMLInputElement>('online-code').oninput = event => { const input = event.target as HTMLInputElement; input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g,''); };
    $('online-code').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void this.request('join'); } };
    $('online-ready').onclick = () => { const r = this.client.room; if (r) this.client.send({ type: 'ready', ready: !r.players[r.seat]?.ready }); };
    $('online-leave').onclick = () => this.leave();
    $('online-copy').onclick = () => { const url = new URL(location.href); url.search = ''; url.searchParams.set('room', this.client.room!.code);if(this.client.room?.mode==='paid')url.searchParams.set('mode','paid'); void navigator.clipboard.writeText(url.href).then(() => { this.error = 'Invite copied. Send it to your rival.'; this.render(); }).catch(() => { this.error = `Share room code ${this.client.room!.code}.`; this.render(); }); };
  }
  open(code?: string,mode:'free'|'paid'='free') {this.mode=mode;this.payments.setMode(mode); this.callbacks.setup(); if (code) { $<HTMLInputElement>('online-code').value = code; void this.client.connect().catch(error=>{this.error=error.message;this.render();}); } this.render(); }
  async resume(code:string){
    this.callbacks.setup();this.mode='paid';this.payments.setMode('paid');
    try{const response=await fetch('/api/paid/history');const history=await response.json() as RoomView[];const room=history.find(r=>r.code===code);if(!room)throw new Error('This saved duel is not available in the current session.');
      this.historyRoom={...room,recoveryOnly:true};this.payments.update(this.historyRoom);this.callbacks.room(this.historyRoom);this.render();
    }catch(error){this.error=error instanceof Error?error.message:'Could not restore this duel.';this.render();}
  }
  private async request(type: 'create' | 'queue' | 'join') {
    if (this.busy) return;
    const code = $<HTMLInputElement>('online-code').value.trim().toUpperCase();
    if (type === 'join' && !/^[A-Z2-9]{6}$/.test(code)) { this.error = 'Enter the six-character room code.'; this.render(); return; }
    this.busy = true; this.error = ''; this.render();
    try {
      if(type==='join'){
        const response=await fetch('/api/rooms/lookup?code='+encodeURIComponent(code));
        if(response.ok){const metadata=await response.json();if(metadata.mode==='paid'){this.mode='paid';this.payments.setMode('paid');}}
      }
      if(this.mode==='paid'&&!this.payments.ready)await this.payments.connect();
      await this.client.connect();
      if (!this.client.room) { const choice = this.callbacks.selection(); this.client.send(type === 'join' ? { type, code, fighter: choice.fighter } : { type, ...choice,mode:this.mode }); }
    } catch (error) { this.error = error instanceof Error ? error.message : 'Could not reach the arena.'; }
    finally { this.busy = this.preparing; this.render(); }
  }
  private key(room: RoomView) { return `${room.stage}:${room.players.map(p=>p?.fighter??'').join(':')}:${room.seat}`; }
  private async prepare(room: RoomView) {
    const key = this.key(room);
    if (this.loadedKey===key || this.preparingKey===key) return;
    this.queuedRoom=room;
    if(this.preparing)return;
    this.preparing=true;this.busy=true;this.render();
    try {
      while(this.queuedRoom){
        const next=this.queuedRoom,version=this.version;this.queuedRoom=null;this.preparingKey=this.key(next);
        try { await this.callbacks.load(next); if(version===this.version&&this.client.room?.code===next.code&&this.key(this.client.room)===this.preparingKey){this.loadedKey=this.preparingKey;this.error='';} }
        catch(error){if(version===this.version)this.error=error instanceof Error?error.message:'Could not load this arena. Leave and try again.';}
        finally{this.preparingKey='';}
      }
    } finally { this.preparing=false;this.busy=false;this.render();if(this.client.room)this.callbacks.room(this.client.room); }
  }
  selectionChanged() {
    const room = this.client.room;
    if (room && room.phase === 'waiting' && !this.busy) { this.loadedKey = ''; this.client.send({ type: 'choose', ...this.callbacks.selection() }); }
  }
  get loaded() { return Boolean(this.client.room && this.loadedKey === this.key(this.client.room)); }
  leave() { ++this.version; this.historyRoom=null;this.queuedRoom=null; this.loadedKey = ''; this.busy = false; this.error = ''; this.client.leave(); this.render(); }
  private render() {
    const room = this.client.room??this.historyRoom;
    $('online-mode-note').textContent=this.mode==='paid'?'1 test USDC per player. Both players lock picks and fund before the fight.':'No entry fee or prize. Esc opens settings; the online match continues.';
    $('online-entry').hidden = Boolean(room); $('online-room').hidden = !room;
    for (const id of ['online-quick','online-create','online-join']) $<HTMLButtonElement>(id).disabled = this.busy;
    $('online-status').textContent = this.error || (this.busy ? 'Getting the online arena ready…' : !room ? 'Choose your fighter, then find a rival or create a room.' :room.recoveryOnly?'Saved prize duel · finish settlement or claim an available credit.': !this.client.connected ? 'Connection interrupted. Reconnecting…' : room.phase === 'funding'?room.paid?.message??'Waiting for confirmed entries.':room.phase === 'waiting' ? room.players[1] ? this.mode==='paid'?'Lock your picks to agree the funded match.':'Both rivals are here. Ready up when your fighter is loaded.' : 'Waiting for a rival. Share your invite or room code.' : room.phase === 'countdown' ? `Get ready · ${room.countdown}` : room.phase === 'reconnecting' ? `Waiting for rival to reconnect · ${room.reconnectSeconds}s` : room.result ? room.result.reason : 'Fight in progress.');
    if (room) {
      $('online-room-code').textContent = room.code;
      $('online-seats').textContent = room.players.map((p,i) => p ? `${i===room.seat?'YOU':'RIVAL'} · ${p.connected ? p.ready?'READY':'CHOOSING':'OFFLINE'}` : 'RIVAL · WAITING').join(' / ');
      const button = $<HTMLButtonElement>('online-ready');
      button.hidden=room.mode==='paid'&&Boolean(room.paid?.terms);
      button.disabled = !this.loaded || this.busy || !this.client.connected || room.phase !== 'waiting' || !room.players.every(p=>p?.connected);
      button.textContent = !this.loaded || this.busy ? 'LOADING FIGHTERS…' : room.players[room.seat]?.ready ? 'READY ✓ · CANCEL' : room.mode==='paid'?'LOCK PICKS & CONTINUE ↗':'I’M READY ↗';
    }
  }
}
