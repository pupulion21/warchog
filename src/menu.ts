import { onlineSetupMarkup } from './online-menu.ts';
import type { RoomView } from './online-protocol.ts';
import type { FighterEntry } from './roster.ts';
import { STAGES, getStage, type StageId, type StageDefinition } from './stage.ts';

// Both modes are free local practice. Paid 1v1 entry belongs to DuelLobby.
export type PlayMode = 'versus' | 'training' | 'online';
export type MenuScreen = 'home' | 'setup' | 'game';

export function menuMarkup() {
  return `<section id="front-menu" class="arcade-menu" data-screen="home" aria-label="WARCHOG arcade">
    <header class="arcade-header"><button id="menu-home" class="arcade-brand" aria-label="WARCHOG home"><img src="/favicon.svg" alt=""><span>WAR<b>CHOG</b><small>THE CREW · ARENA 3D</small></span></button><span class="arcade-location"><i></i> COMMUNITY ARCADE</span><nav aria-label="Arcade navigation"><button id="menu-back" class="paper-button" hidden>← BACK</button><button id="menu-duels" class="paper-button" data-open-duel>MY DUEL</button><button id="menu-help" class="paper-button">HOW TO PLAY</button></nav></header>
    <main id="hub" class="arcade-hub"><div class="hub-heading"><span class="comic-eyebrow">A LITTLE COMMUNITY. A LOT OF CHAOS.</span><span class="home-kicker">THE MONAD ARENA</span><h1>WAR<br><em>CHOG.</em></h1><span class="comic-sticker">12 FIGHTERS. EVERY ANGLE. ✦</span></div><section class="home-showcase" aria-label="The CHOG crew in 3D"><div id="home-stage" class="model-stage" aria-label="Live 3D CHOG showcase"><span class="stage-loading">GETTING THE CREW READY…</span></div><span class="stage-location"><i></i><span id="stage-live-label">LIVE FROM CWO ALLEY</span></span><div class="showcase-note"><span>THE CREW, IN A NEW DIMENSION.</span><strong>ALL SIDES.<br>ALL HEART.</strong></div><div class="showcase-controls"><span>DRAG TO TURN THE CREW</span><button data-showcase-turn="-1" aria-label="Turn characters left">‹</button><button data-showcase-reset aria-label="Reset character view">↺</button><button data-showcase-turn="1" aria-label="Turn characters right">›</button></div></section><nav class="arcade-modes" aria-label="Play mode"><button class="arcade-mode duel-mode" data-open-duel><span class="mode-mark" aria-hidden="true">✦</span><span><small>THE MAIN EVENT · FREE ONLINE</small><strong>1v1 DUEL</strong><p>Find a rival or invite a friend. Free online play is open.</p></span><b aria-hidden="true">↗</b></button><button class="arcade-mode practice-mode cpu-mode" data-play="versus"><span class="mode-mark" aria-hidden="true">✦</span><span><small>FREE PRACTICE BOUT</small><strong>VS COMPUTER</strong><p>A CPU rival. No deposit. Just a little chaos.</p></span><b aria-hidden="true">↗</b></button><button class="arcade-mode practice-mode" data-play="training"><span class="mode-mark" aria-hidden="true">{ }</span><span><small>THE PRACTICE CORNER</small><strong>TRAINING</strong><p>Learn the moves. Build a combo. Make a little chaos.</p></span><b aria-hidden="true">↗</b></button></nav><div class="arcade-crew"><span>THE WHOLE<br><b>CREW'S HERE.</b></span><div id="hub-crew" aria-label="The CHOG crew"></div><span id="menu-ready" class="menu-ready" role="status">OPENING THE ALLEY…</span></div></main>
    <main id="match-setup" class="match-setup" hidden><div class="setup-heading"><button id="setup-switch" class="paper-button">SWITCH MODE ↗</button><span id="setup-eyebrow" class="comic-eyebrow">THE MAIN EVENT</span><h1 id="setup-title" tabindex="-1">MAKE IT <em>YOUR MATCH.</em></h1><p id="setup-description">Pick your fighter and your rival. Settle it in CWO Alley.</p></div><section class="setup-fighters" aria-label="Your 3D match lineup"><button id="stage-tour" class="stage-tour" aria-pressed="false">EXPLORE ARENA 3D ↗</button><div id="setup-stage" class="model-stage" aria-label="Live 3D player and rival preview"></div><div class="setup-nameplates"><button class="setup-fighter" data-pick-seat="0" aria-label="Choose your fighter"><span class="pick-label">01 / YOUR CHOG <b>CHANGE ↗</b></span><span class="pick-name"><small id="setup-player-role">Collab connector</small><strong id="setup-player">Yot</strong></span></button><span class="setup-versus" aria-hidden="true">VS</span><button class="setup-fighter rival-pick" data-pick-seat="1" aria-label="Choose your rival"><span class="pick-label">02 / YOUR RIVAL <b>CHANGE ↗</b></span><span class="pick-name"><small id="setup-rival-role">Collab connector</small><strong id="setup-rival">Yot</strong></span></button></div><div class="showcase-controls"><span>DRAG TO TURN · CHOOSE A SIDE TO CHANGE</span><button data-showcase-turn="-1" aria-label="Turn lineup left">‹</button><button data-showcase-reset aria-label="Reset lineup view">↺</button><button data-showcase-turn="1" aria-label="Turn lineup right">›</button></div></section><aside class="arena-ticket"><div class="ticket-art" id="stage-picture"><span id="stage-time">AFTERNOON MISCHIEF</span></div><div class="stage-choice-heading"><span>03 / CHOOSE YOUR PLACE</span><b>5 ARENAS</b></div><div class="stage-grid" role="group" aria-label="Arena selection">${STAGES.map(stage=>`<button data-stage="${stage.id}" aria-pressed="${stage.id==='cwo-alley'}" class="stage-card ${stage.id==='cwo-alley'?'selected':''}"><img src="/assets/stages/${stage.id}/preview.webp" alt=""><span>${stage.name}</span></button>`).join('')}</div><select id="stage-select" class="stage-select" aria-label="Choose arena">${STAGES.map(stage=>`<option value="${stage.id}" ${stage.id==='cwo-alley'?'selected':''}>${stage.name}</option>`).join('')}</select>${onlineSetupMarkup()}<div class="ticket-copy"><span class="comic-eyebrow">METROPOLIS</span><h2 id="stage-name">CWO ALLEY</h2><p id="stage-tag">Leave your mark</p><div id="setup-rules" class="setup-rules">CPU RIVAL · ONE BOUT · K.O. WINS</div><button id="start" class="arcade-enter" disabled>GETTING READY… <span>↗</span></button><p id="menu-status" role="status">Loading the arena and your starting fighters.</p></div></aside></main>
    <footer class="arcade-footer"><span>12 FIGHTERS <i>✦</i> 13 FORMS <i>✦</i> ONE CREW</span><span>1v1 DUELS · FREE TRAINING · TOURNAMENTS COMING SOON</span></footer>
  </section>
  <dialog id="pause-dialog" class="game-dialog pause-dialog" aria-labelledby="pause-title"><button id="pause-close" class="pause-close" aria-label="Resume game">×</button><span class="comic-eyebrow">TAKE A BREATHER</span><h2 id="pause-title">CHAOS ON HOLD.</h2><div id="pause-stage"></div><div class="pause-layout"><div class="pause-actions"><button id="resume" class="dialog-primary">KEEP PLAYING →</button><button id="pause-restart">RESTART BOUT</button><button id="pause-fighters">CHANGE FIGHTERS / ARENA</button><button id="pause-home">BACK TO THE HUB</button></div><div class="pause-options"><div id="pause-utilities" class="pause-utilities"></div><section id="pause-camera" aria-label="Camera settings"></section><section id="pause-training" class="training-only" aria-label="Training tools"></section><p class="pause-key-guide"><b>WASD</b> move · <b>U I O</b> attacks<br><b>J</b> dodge · <b>K / Space</b> jump · <b>P</b> target<br>Drag to look · scroll to zoom · <b>C</b> recenter</p><p class="pause-touch-guide">Left thumb moves. Right buttons attack and dodge.<br>Swipe to look around or up; pinch to zoom.<br>Tap Ⅱ to pause and change settings.</p></div></div><small>ESC TO RESUME</small></dialog>
  <dialog id="help-dialog" class="game-dialog help-dialog" aria-labelledby="help-title"><button id="help-close" class="help-close" aria-label="Close how to play">×</button><span class="comic-eyebrow">EVERY CHOG STARTS SOMEWHERE</span><h2 id="help-title">MAKE YOUR MOVE.</h2><p>Circle your rival, find an opening, then make contact.</p><dl><dt>WASD / ARROWS</dt><dd>Move · hold Shift to run</dd><dt>U / I / O</dt><dd>Basic chain / ranged skill / ground slam</dd><dt>J</dt><dd>Dodge</dd><dt>K / SPACE</dt><dd>Jump</dd><dt>P</dt><dd>Lock or unlock rival</dd><dt>DRAG / SCROLL</dt><dd>Look around and up / zoom</dd><dt>Z / X / C</dt><dd>Rotate left / right / recenter</dd><dt>ESC</dt><dd>Pause / resume · settings and Training tools</dd></dl><p class="touch-help">On touch: left thumb moves, right buttons attack. Swipe the arena to orbit; pinch with two fingers to zoom.</p><p class="help-training">In Training, open Esc → Training setup for dummy behavior, slow motion, hitboxes and animation inspection. Stats stay in the corner; the arena stays clear.</p></dialog>`;
}

export class ArcadeMenu {
  screen: MenuScreen = 'home';
  mode: PlayMode = 'versus';
  private available = false;
  private failure = '';
  private stage = getStage('cwo-alley');
  private stageLoading = false;
  private stageError = '';
  private onlineRoom: RoomView | null = null;
  private root = document.getElementById('front-menu')!;
  constructor(private callbacks: { release: () => void; pick: (seat: number) => void; begin: (mode: PlayMode) => void; leave: () => void; stage: (id: StageId) => Promise<void> }) {
    document.querySelectorAll<HTMLButtonElement>('[data-play]').forEach(button => button.onclick = () => this.setup(button.dataset.play as PlayMode));
    for (const id of ['menu-home', 'menu-back', 'setup-switch']) document.getElementById(id)!.onclick = () => this.home();
    document.querySelectorAll<HTMLButtonElement>('[data-pick-seat]').forEach(button => button.onclick = () => { if (this.available) this.callbacks.pick(Number(button.dataset.pickSeat)); });
    document.getElementById('start')!.onclick = () => {
      if (!this.available || this.stageLoading) return;
      this.callbacks.release(); this.screen = 'game'; this.root.hidden = true;
      this.callbacks.begin(this.mode);
    };
    document.querySelectorAll<HTMLButtonElement>('button[data-stage]').forEach(button => button.onclick = () => void this.selectStage(button.dataset.stage as StageId));
    (document.getElementById('stage-select') as HTMLSelectElement).onchange = event => void this.selectStage((event.target as HTMLSelectElement).value as StageId);
    this.render();
  }
  async selectStage(id: StageId) {
    if (!this.available || this.stageLoading) return false;
    this.stageLoading = true; this.stageError = ''; this.syncStage();
    try { await this.callbacks.stage(id); this.stage = getStage(id); return true; }
    catch (error) { this.stageError = error instanceof Error ? error.message : 'Could not load that arena. Try again.'; return false; }
    finally { this.stageLoading = false; this.syncStage(); }
  }
  private syncStage() {
    const disabled = !this.available || this.stageLoading || (this.mode === 'online' && !!this.onlineRoom && (this.onlineRoom.seat !== 0 || this.onlineRoom.phase !== 'waiting'));
    document.querySelectorAll<HTMLButtonElement>('button[data-stage]').forEach(button => {
      const selected = button.dataset.stage === this.stage.id;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); button.disabled = disabled;
    });
    const select = document.getElementById('stage-select') as HTMLSelectElement; select.value = this.stage.id; select.disabled = disabled;
    document.getElementById('stage-name')!.textContent = this.stage.name.toUpperCase();
    document.getElementById('stage-tag')!.textContent = this.stage.tag;
    document.getElementById('stage-time')!.textContent = this.stage.time;
    document.getElementById('stage-live-label')!.textContent = 'LIVE FROM ' + this.stage.name.toUpperCase();
    document.getElementById('stage-picture')!.style.backgroundImage = `url('/assets/stages/${this.stage.id}/preview.webp')`;
    const start = document.getElementById('start') as HTMLButtonElement; start.disabled = disabled;
    if (this.stageLoading) start.textContent = 'OPENING ARENA…';
    else if (this.available) start.innerHTML = `${this.mode === 'training' ? 'LET’S PRACTICE' : 'ENTER THE ARENA'} <span>↗</span>`;
    document.getElementById('menu-status')!.textContent = this.stageError || (this.stageLoading ? 'Getting the next place ready…' : this.available ? 'Free local practice. No deposit or onchain prize.' : 'Loading the arena and your starting fighters.');
  }
  syncRoom(room: RoomView | null) { this.onlineRoom = room; if(room)this.stage=getStage(room.stage);this.syncStage(); this.syncOnline(); }
  playOnline() { this.mode = 'online'; this.callbacks.release(); this.screen = 'game'; this.root.hidden = true; this.callbacks.begin('online'); }
  private syncOnline() {
    const online = this.mode === 'online';
    document.getElementById('online-setup')!.hidden = !online;
    document.getElementById('start')!.hidden = online;
    document.querySelectorAll<HTMLButtonElement>('[data-pick-seat]').forEach(b => b.disabled = !this.available || (online && (b.dataset.pickSeat === '1' || !!this.onlineRoom && this.onlineRoom.phase !== 'waiting')));
    if (online) {
      document.getElementById('setup-eyebrow')!.textContent = 'REAL RIVAL · FREE ONLINE';
      document.getElementById('setup-title')!.innerHTML = 'BRING YOUR <em>FIGHTING SPIRIT.</em>';
      document.getElementById('setup-description')!.textContent = 'Choose your CHOG. Invite a friend or find a rival. The host chooses the arena.';
      document.getElementById('setup-rules')!.textContent = '2 PLAYERS · SERVER REFEREE · FREE ONLINE PRACTICE';
      if (!this.onlineRoom?.players[1]) document.getElementById('setup-rival')!.textContent = 'Waiting for rival';
    }
  }
  home() {
    this.callbacks.leave(); this.callbacks.release(); this.screen = 'home'; this.render();
    document.getElementById('menu-home')!.focus({ preventScroll: true });
  }
  setup(mode = this.mode) {
    this.callbacks.leave(); this.callbacks.release(); this.mode = mode; this.screen = 'setup'; this.render();
    document.getElementById('setup-title')!.focus({ preventScroll: true });
  }
  ready() { this.available = true; this.render(); }
  error(message: string) { this.failure = message; this.render(); }
  updateFighters(current: FighterEntry[], entries: FighterEntry[]) {
    for (const [seat, name] of ['player', 'rival'].entries()) {
      const entry = current[seat]; if (!entry) continue;
      document.getElementById(`setup-${name}`)!.textContent = entry.name;
      document.getElementById(`setup-${name}-role`)!.textContent = entry.role;
    }
    const crew = document.getElementById('hub-crew')!;
    if (!crew.children.length) for (const entry of entries.filter(c => c.form !== 'empowered')) {
      const image = document.createElement('img'); image.src = `/assets/portraits3d/${entry.id}.webp`; image.alt = entry.name; image.title = entry.name; crew.append(image);
    }
  }
  private render() {
    this.root.hidden = this.screen === 'game'; this.root.dataset.screen = this.screen;
    this.root.scrollTop = 0;
    document.getElementById('hub')!.hidden = this.screen !== 'home';
    document.getElementById('match-setup')!.hidden = this.screen !== 'setup';
    document.getElementById('menu-back')!.hidden = this.screen === 'home';
    const training = this.mode === 'training';
    document.getElementById('setup-eyebrow')!.textContent = training ? 'THE PRACTICE CORNER' : 'FREE PRACTICE BOUT';
    document.getElementById('setup-title')!.innerHTML = training ? 'FIND YOUR <em>FIGHTING SPIRIT.</em>' : 'MAKE IT <em>YOUR MATCH.</em>';
    document.getElementById('setup-description')!.textContent = training ? 'Your own pace. Your own rival. Room to try every move.' : 'Pick your fighter, CPU rival, and arena. Practice bouts have no entry fee or prize.';
    document.getElementById('setup-rules')!.textContent = training ? 'UNLIMITED TIME · DUMMY CONTROLS · RESET ANYTIME' : 'CPU RIVAL · ONE BOUT · K.O. WINS';
    const button = document.getElementById('start') as HTMLButtonElement;
    button.disabled = !this.available;
    button.innerHTML = this.available ? `${training ? 'LET’S PRACTICE' : 'ENTER THE ALLEY'} <span>↗</span>` : 'GETTING READY…';
    document.querySelectorAll<HTMLButtonElement>('[data-pick-seat]').forEach(b => b.disabled = !this.available);
    document.getElementById('menu-ready')!.textContent = this.failure ? 'COULD NOT OPEN THE ALLEY' : this.available ? 'READY TO PLAY' : 'OPENING THE ALLEY…';
    this.syncStage(); this.syncOnline();
    if (this.failure) document.getElementById('menu-status')!.textContent = this.failure;
  }
}
