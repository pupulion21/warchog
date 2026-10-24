import './style.css';
import './menu.css';
import './play.css';
import './duel.css';
import './online.css';
import { OnlineLobby } from './online-menu.ts';
import type { RoomView, OnlineSnapshot } from './online-protocol.ts';
import { DuelLobby, duelMarkup } from './duel.ts';
import { ArcadeMenu, menuMarkup, type PlayMode } from './menu.ts';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import {
  Engine, Scene, Color3, Color4, Vector3, FreeCamera, HemisphericLight, DirectionalLight,
  ShadowGenerator, LoadAssetContainerAsync, MeshBuilder, Ray, Matrix, StandardMaterial,
} from './babylon.ts';
import { Combat, MOVES, neutralInput, type InputFrame, type DummyMode, type CombatEvent } from './combat.ts';
import { Avatar } from './avatar.ts';
import { material } from './arena.ts';
import { ArenaWorld } from './world.ts';
import { Effects } from './effects.ts';
import { GameAudio } from './audio.ts';
import { ARENA, STAGE, type StageId } from './stage.ts';
import { OrbitRig } from './camera.ts';
import { FighterRoster, rosterMarkup } from './roster.ts';
import { Showcase } from './showcase.ts';

let onlineLobby: OnlineLobby | undefined;
let preservingOnline = false, onlineSendAt = 0, onlineCameraReady = false, lastOnlineEvent = 0;

const icons = {
  cross: '<path d="m8 8 8 8M16 8l-8 8"/>',
  tune: '<path d="M5 7h14M5 17h14"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  bolt: '<path d="m14 2-9 12h6l-1 8 9-12h-6z"/>',
  fist: '<path d="M5 13V8a2 2 0 0 1 4 0V5a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v7l-5 6H9l-5-6a2 2 0 0 1 1-2Z"/>',
  ring: '<ellipse cx="12" cy="17" rx="9" ry="4"/><path d="m9 3 3 8 3-8M12 11v5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
};
const icon = (key: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]}</svg>`;
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <canvas id="arena" aria-label="WARCHOG CWO Alley 3D arena" tabindex="-1"></canvas>
  <div class="viewport-vignette"></div>
  <main class="game-ui" inert>
    <div class="fight-hud">
      <div class="fighter-hud player-hud"><div class="fighter-meta"><span class="fighter-name"><span id="name-player">YOT</span> <span class="tag">YOU</span></span><span class="health-number" id="hp-player">200 <em>/ 200</em></span></div><div class="health-track"><div class="health-chip" id="chip-player"></div><div class="health-fill" id="health-player"></div></div><div class="fighter-sub"><span id="role-player">COLLAB CONNECTOR</span><span id="state-player">READY</span></div></div>
      <div class="round-center"><button id="game-menu" class="match-pause" aria-haspopup="dialog" aria-label="Pause game (Esc)" title="Pause · Esc"><span aria-hidden="true">Ⅱ</span><kbd>Esc</kbd></button><span id="round-mode">FREE PRACTICE</span><strong id="round-mark">∞</strong><div><i></i><i></i><i></i></div></div>
      <div class="fighter-hud dummy-hud"><div class="fighter-meta"><span class="health-number" id="hp-dummy">200 <em>/ 200</em></span><span class="fighter-name"><span class="tag rival-tag">CPU</span> <span id="name-dummy">YOT</span></span></div><div class="health-track"><div class="health-chip" id="chip-dummy"></div><div class="health-fill" id="health-dummy"></div></div><div class="fighter-sub"><span id="state-dummy">IDLE</span><span id="role-dummy">YOUR FRIENDLY RIVAL</span></div></div>
    </div>
    <div id="floating-numbers" aria-hidden="true"></div>
    <div class="camera-controls" role="group" aria-label="Camera controls">
      <div class="camera-toolbar"><span class="camera-caption">CAMERA</span><button id="camera-left" data-camera-orbit="-1" aria-label="Rotate camera left (Z)" title="Rotate left · hold Z">‹</button><button id="camera-mode" aria-pressed="false" aria-label="Follow fighter automatically" title="Switch between free orbit and following the fighter"><span id="camera-mode-name">ORBIT</span><span class="camera-mode-dot"></span></button><button id="camera-right" data-camera-orbit="1" aria-label="Rotate camera right (X)" title="Rotate right · hold X">›</button><span class="camera-divider"></span><button id="camera-reset" aria-label="Recenter camera (C)" title="Recenter camera · C">${icon('reset')}</button></div>
      <span class="camera-gesture-hint"><span class="camera-desktop-hint">DRAG TO ORBIT · SCROLL TO ZOOM · C TO RECENTER</span><span class="camera-touch-hint">SWIPE TO ORBIT · PINCH TO ZOOM</span></span>
    </div>
    <div class="side-note"><span class="vertical-line"></span>SMALL ARENA. BIG ENERGY.</div>
    <section class="session-card training-only" aria-label="Training session statistics"><span class="eyebrow">PRACTICE MAKES CHAOS</span><h1>Find your<br><em>fighting spirit.</em></h1><div class="session-stats"><div><strong id="stat-hits">00</strong><span>HITS LANDED</span></div><div><strong id="stat-damage">0</strong><span>TOTAL DAMAGE</span></div></div><p id="hint">Move closer. Say hello with a punch.</p></section>
    <div class="training-tools training-only"><button id="training-toggle" class="training-toggle" aria-expanded="false" aria-controls="training-panel">${icon('tune')}<span>Training setup</span><b>⌃</b></button>
      <section id="training-panel" class="training-panel" hidden aria-label="Training settings"><div class="panel-title">MAKE IT YOUR MATCH<button id="panel-close" class="icon-button" aria-label="Close training settings">${icon('cross')}</button></div><label class="field-label">DUMMY BEHAVIOR</label><div class="segmented" id="dummy-mode"><button data-mode="idle" class="selected">Idle</button><button data-mode="strafe">Circle</button><button data-mode="spar">Fight back</button></div><p class="field-help" id="mode-help">A patient punching partner.</p><div class="toggle-row"><label for="lock-toggle">Lock on to rival</label><input id="lock-toggle" type="checkbox" checked></div><div class="toggle-row"><label for="hitbox-toggle">Show collision shapes</label><input id="hitbox-toggle" type="checkbox"></div><div class="toggle-row"><label for="shake-toggle">Camera shake</label><input id="shake-toggle" type="checkbox" checked></div><div class="toggle-row"><label for="fx-toggle">Full effects</label><input id="fx-toggle" type="checkbox" checked></div><div class="speed-row"><label for="speed">Playback speed</label><select id="speed"><option value="1">Normal · 1×</option><option value="0.5">Slow · ½×</option><option value="0.25">Very slow · ¼×</option></select></div><div class="debug-actions"><button id="test-hit">Receive hit</button><button id="test-down">Test knockdown</button><button id="test-ko">Test K.O.</button></div><div class="animation-inspector"><label class="field-label" for="animation">INSPECT ANIMATION</label><select id="animation"><option value="">Follow gameplay</option><option value="idle">Combat idle</option><option value="walk_forward">Walk forward</option><option value="walk_back">Walk back</option><option value="walk_left">Strafe left</option><option value="walk_right">Strafe right</option><option value="attack1">Basic attack</option><option value="skill">Skill cast</option><option value="stomp">Ground slam</option><option value="hurt">Hit reaction</option><option value="down">Knockdown</option><option value="getup">Get up</option><option value="ko">K.O.</option></select></div><div class="diagnostics"><span id="diag-fps">60 FPS</span><span id="diag-state">RIG LOADING</span><span id="diag-fx">0 FX</span></div></section>
    </div>
    <footer class="bottom-bar"><div class="movement-help training-only"><div class="key-grid"><kbd>W</kbd><div><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div></div><div><strong>MAKE YOUR MOVE</strong><span>Move · Drag to orbit · Scroll to zoom</span><span class="secondary-help"><kbd>SPACE</kbd> jump <kbd>SHIFT</kbd> run <kbd>R</kbd> reset <kbd>P</kbd> lock</span></div></div><div class="action-bar"><button class="action-button basic" data-action="attack" id="action-attack"><span class="action-symbol">${icon('fist')}</span><span><strong>LINK CHAIN</strong><small>BASIC ATTACK</small></span><kbd>U</kbd></button><button class="action-button skill" data-action="skill" id="action-skill"><span class="cooldown-shade"></span><span class="action-symbol">${icon('bolt')}</span><span><strong>PARTNER PING</strong><small id="skill-ready">RANGED SKILL</small></span><kbd>I</kbd></button><button class="action-button heavy" data-action="stomp" id="action-stomp"><span class="cooldown-shade"></span><span class="action-symbol">${icon('ring')}</span><span><strong>COLLAB STOMP</strong><small id="stomp-ready">HEAVY SKILL</small></span><kbd>O</kbd></button><button class="dodge-button" data-action="dodge" id="action-dodge" aria-label="Dodge (J)" title="Dodge · J">${icon('arrow')}<kbd>J</kbd></button><button id="action-jump" class="jump-button desktop-jump" data-action="jump" aria-label="Jump (K or Space)" title="Jump · K / Space"><span aria-hidden="true">↑</span><kbd>K</kbd></button></div></footer>
    <div class="mobile-controls"><div id="joystick" aria-label="Movement joystick" role="group"><div class="joystick-rim"></div><div id="joystick-thumb"></div></div><button class="mobile-jump" data-action="jump" aria-label="Jump">↑<small>JUMP</small></button></div>
    <button id="reset" class="reset-button training-only">${icon('reset')}<span>Reset arena</span><kbd>R</kbd></button>
    ${rosterMarkup()}
    <div id="lock-label" class="lock-label">${icon('target')}<span>RIVAL LOCKED</span></div>
    <div id="combo" class="combo-pop" hidden><strong>2</strong><span>HIT COMBO</span></div>
    <section id="result" class="result-overlay" hidden aria-live="polite"><span class="eyebrow">THAT'S THE SPIRIT</span><h2 id="result-title">K.O.</h2><p id="result-text">A little practice goes a long way.</p><button id="result-reset">Run it back ${icon('reset')}</button><button id="result-home" class="result-home">BACK TO THE HUB</button><small id="result-hint">PRESS R TO RESET</small></section>
    <div id="toast" class="toast" role="status"></div>
  </main>
  ${menuMarkup()}
  ${duelMarkup()}
  <section id="loading" class="loading-overlay" hidden><div class="loading-wordmark">WAR<span>CHOG</span></div><p>CWO ALLEY · METROPOLIS</p><div class="loading-track"><div id="loading-progress"></div></div><span id="loading-status">Opening the alley…</span><button id="retry" hidden>Try loading again</button><small>THE CHOG CREW · ONE ALLEY · ALL HEART</small></section>
`;

const pauseStage=document.getElementById('pause-stage')!;
pauseStage.innerHTML=`<div class="location"><span class="status-dot"></span><span id="stage-header-name">${STAGE.name.toUpperCase()}</span></div>`;
document.getElementById('pause-utilities')!.innerHTML=`<button id="game-help" aria-label="How to play"><span aria-hidden="true">?</span><span>Controls</span></button><button id="sound" aria-label="Mute sound">${icon('sound')}<span>Sound on</span></button><button id="fullscreen" aria-label="Full screen">${icon('expand')}<span>Full screen</span></button>`;
document.getElementById('pause-camera')!.append(document.querySelector('.camera-controls')!);
document.getElementById('pause-training')!.append(document.querySelector('.training-tools')!);
document.getElementById('training-panel')!.append(document.getElementById('reset')!,document.getElementById('roster-toggle')!);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const canvas = $<HTMLCanvasElement>('arena');
const audio = new GameAudio();
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
engine.setHardwareScalingLevel(Math.max(1, (window.devicePixelRatio || 1) / 1.5));
const scene = new Scene(engine);
// The fighting venue and actors stay in front of the surrounding district, even
// when portrait framing backs the camera through a distant decorative building.
scene.onNewMeshAddedObservable.add(mesh => { mesh.renderingGroupId = mesh.metadata?.environmentLayer === 'background' ? 0 : 1; });
scene.setRenderingAutoClearDepthStencil(1, true, true, true);
const softwareGpu = /swiftshader|llvmpipe|software/i.test(engine.getGlInfo().renderer);
scene.shadowsEnabled = !softwareGpu;
scene.useRightHandedSystem = true;
scene.clearColor = Color4.FromHexString('#c6bad8ff');
scene.ambientColor = Color3.FromHexString('#e9d9e2').scale(0.25);
scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.009; scene.fogColor = Color3.FromHexString('#c6bad8');
const camera = new FreeCamera('arena camera', new Vector3(6.5, 6.5, -8.5), scene);
camera.minZ = 0.1; camera.maxZ = 450; camera.fov = 0.83;
const sky = new HemisphericLight('soft sky', new Vector3(0, 1, 0), scene);
sky.intensity = 0.65; sky.diffuse = Color3.FromHexString('#fff7e9'); sky.groundColor = Color3.FromHexString('#a393ac');
const sun = new DirectionalLight('afternoon sun', new Vector3(-0.45, -1.2, 0.7), scene);
sun.position.set(6, 13, -8); sun.intensity = 0.65; sun.diffuse = Color3.FromHexString('#fff1d9');
sun.autoCalcShadowZBounds = true;
const shadows = new ShadowGenerator(window.matchMedia('(pointer: coarse)').matches ? 512 : 1024, sun);
shadows.useBlurExponentialShadowMap = true; shadows.blurKernel = 12; shadows.setDarkness(0.28);
const arena = new ArenaWorld(scene, shadows, stage => {
  sky.intensity=stage.skyIntensity;sky.diffuse=Color3.FromHexString(stage.sunlight);sky.groundColor=Color3.FromHexString(stage.groundLight);
  sun.intensity=stage.sunIntensity;sun.diffuse=Color3.FromHexString(stage.sunlight);
});
const avatars = [new Avatar(scene, 0, shadows), new Avatar(scene, 1, shadows)];
const effects = new Effects(scene);
const roster=new FighterRoster(scene,avatars,{change:()=>{if(playMode!=='online'||!started)reset();updateFighterLabels();menu.updateFighters(roster.current,roster.entries);onlineLobby?.selectionChanged();},release:releaseInputs,error:toast,createPreview:()=>new Avatar(scene,2,shadows)});
const debugMaterial = material(scene, 'debug hurtbox', '#80d9a0'); debugMaterial.wireframe = true; debugMaterial.alpha = 0.6;
const debugShapes = [0, 1].map(i => {
  const mesh = MeshBuilder.CreateCapsule('hurtbox ' + i, { height: 1.68, radius: 0.35, tessellation: 12 }, scene);
  mesh.material = debugMaterial; mesh.isPickable = false; mesh.setEnabled(false); return mesh;
});
const reachMaterial = material(scene, 'debug active reach', '#f48676'); reachMaterial.wireframe = true;
const debugReach = MeshBuilder.CreateSphere('active attack volume', { diameter: 1, segments: 12 }, scene);
debugReach.material = reachMaterial; debugReach.isPickable = false; debugReach.setEnabled(false);
let debugStageShapes: ReturnType<typeof MeshBuilder.CreateBox>[] = [];
function rebuildStageDebug(){
for(const mesh of debugStageShapes)mesh.dispose();
debugStageShapes = [
  ...arena.stage.obstacles.map(o => ({ x: o.x, y: o.h / 2, z: o.z, w: o.w, h: o.h, d: o.d })),
  ...[-1, 1].flatMap(side => [
    { x: side * (ARENA.width / 2 + 0.2), y: 1, z: 0, w: 0.4, h: 4, d: ARENA.depth + 0.4 },
    { x: 0, y: 1, z: side * (ARENA.depth / 2 + 0.2), w: ARENA.width + 0.8, h: 4, d: 0.4 },
  ]),
].map(o => {
  const mesh = MeshBuilder.CreateBox('stage collision', { width: o.w, height: o.h, depth: o.d }, scene);
  mesh.position.set(o.x, o.y, o.z); mesh.material = debugMaterial; mesh.isPickable = false; mesh.setEnabled(false); return mesh;
});
}
rebuildStageDebug();

let combat: Combat;
let ready = false, started = false, paused = false, timeScale = 1, showHitboxes = false, shakeEnabled = true, fullFx = true;
let inspectClip = '', manual = false, cameraInitialized = false;
let viewOverride: {position:Vector3;target:Vector3;cutaways:boolean}|null = null;
let playMode: PlayMode = 'training';
const pauseDialog = $<HTMLDialogElement>('pause-dialog');
const helpDialog = $<HTMLDialogElement>('help-dialog');
const menu = new ArcadeMenu({ release: releaseInputs, pick: seat => { $('roster-done').textContent = 'Back to match setup →'; void roster.open(seat,menu.mode==='online'); }, begin: enterGame, leave: leaveGame, stage: async id=>{await chooseStage(id);onlineLobby?.selectionChanged();} });
const duelLobby = new DuelLobby(mode => menu.setup(mode), releaseInputs, mode => onlineLobby?.open(undefined,mode),code=>void onlineLobby?.resume(code));
const onlineBanner = document.createElement('div'); onlineBanner.id = 'online-banner'; onlineBanner.hidden = true; onlineBanner.setAttribute('role','status'); document.querySelector('.game-ui')!.append(onlineBanner);
onlineLobby = new OnlineLobby({
  setup: () => { preservingOnline = true; try { menu.setup('online'); } finally { preservingOnline = false; } },
  selection: () => ({ fighter: roster.current[0]?.id ?? 'yot', stage: arena.stage.id }),
  load: async room => {
    if (arena.stage.id !== room.stage) await chooseStage(room.stage);
    for (const [local, seat] of [room.seat,1-room.seat].entries()) { const fighter = room.players[seat]?.fighter; if (fighter && roster.current[local]?.id !== fighter) await roster.select(local,fighter); }
    await scene.whenReadyAsync(); updateFighterLabels(); menu.syncRoom(room);
  },
  room: onOnlineRoom, snapshot: applyOnlineSnapshot,
  connection: connected => { if (!connected && started && playMode==='online') { releaseInputs(); onlineBanner.hidden=false;onlineBanner.textContent=onlineLobby?.client.reconnecting?'Reconnecting to the arena…':'Connection closed. Return to the hub to reconnect.'; } },
});
const orbit = new OrbitRig(window.innerWidth < 580);
const showcase = new Showcase(canvas,engine,scene,camera,avatars,roster,shadows,arena.updateCamera,()=>arena.stage.name);
let accumulator = 0, last = performance.now(), lastHud = 0, toastUntil = 0;
const cameraPointers = new Map<number, { x: number; y: number }>();
const cameraHolds = new Map<number, { direction: number; since: number }>();
let joyPointer: number | null = null, joyX = 0, joyZ = 0;
const held = new Set<string>(), pulses: Partial<InputFrame> = {};
const activeKeys: Record<string, keyof InputFrame> = { KeyU:'attack',KeyI:'skill',KeyO:'stomp',KeyJ:'dodge',KeyK:'jump',Space:'jump' };
const inputButtons = new Set(Object.keys(activeKeys));
let chipHp = [200, 200];
const floating: { el: HTMLElement; x: number; y: number; z: number; life: number }[] = [];

function blockedInput() { return arena.busy || !started || paused || document.hidden || pauseDialog.open || helpDialog.open || roster.isOpen || roster.busy; }
async function chooseStage(id: StageId) {
  releaseInputs();await arena.select(id);
  combat.setStage(id);reset();rebuildStageDebug();cameraInitialized=false;root.dataset.stage=id;
  document.querySelector('.location')!.innerHTML=`<span class="status-dot"></span><span id="stage-header-name">${arena.stage.name.toUpperCase()}</span><span class="location-number">/ METROPOLIS</span>`;
  if(menu.screen==='setup')showcase.show('setup');
  showcase.explore(true);showcase.invalidate();await scene.whenReadyAsync();
}
function closeTraining() { $('training-panel').hidden = true; $('training-toggle').setAttribute('aria-expanded', 'false'); }
function leaveGame() {
  started = false; accumulator = 0; releaseInputs(); closeTraining(); effects.reset();
  document.querySelector<HTMLElement>('.game-ui')!.inert = true;
  canvas.tabIndex = -1;
  pauseDialog.close(); helpDialog.close();
  onlineBanner.hidden = true;
  if (!preservingOnline && onlineLobby?.client.room) onlineLobby.leave();
  else if (!preservingOnline) onlineLobby?.client.stop();
}
function enterGame(mode: PlayMode) {
  playMode = mode; started = true;
  showcase.show('game');
  document.querySelector<HTMLElement>('.game-ui')!.inert = false;
  canvas.tabIndex = 0;
  root.dataset.mode = mode;
  timeScale = 1; showHitboxes = false; inspectClip = '';
  $<HTMLSelectElement>('speed').value = '1'; $<HTMLInputElement>('hitbox-toggle').checked = false;
  combat.lockOn = true; $<HTMLInputElement>('lock-toggle').checked = true;
  setMode(mode === 'versus' ? 'spar' : 'idle'); reset();
  const online = mode === 'online';
  onlineCameraReady = false; lastOnlineEvent = 0; onlineSendAt = 0;
  $('round-mode').textContent = online ? 'FREE ONLINE' : mode === 'training' ? 'FREE PRACTICE' : 'VS COMPUTER';
  $('round-mark').textContent = mode === 'training' ? '∞' : 'VS';
  $('pause-restart').textContent = mode === 'training' ? 'RESET PRACTICE' : 'RESTART BOUT';
  $('result-hint').textContent = mode === 'training' ? 'PRESS R TO RESET' : 'ONE BOUT · K.O. WINS';
  $('roster-done').textContent = 'Back to the alley →';
  $('pause-title').textContent = online ? 'THE MATCH KEEPS GOING.' : 'CHAOS ON HOLD.';
  $('pause-restart').hidden = online; $('pause-fighters').hidden = online;
  $('pause-home').textContent = online ? 'LEAVE MATCH / BACK TO HUB' : 'BACK TO THE HUB';
  $('result-reset').textContent = online ? 'PLAY ANOTHER DUEL ↗' : 'Run it back ↻';
  $('result-hint').textContent = online ? 'FREE ONLINE PRACTICE · NO PRIZE' : mode === 'training' ? 'PRESS R TO RESET' : 'ONE BOUT · K.O. WINS';
  document.querySelector('.rival-tag')!.textContent = online ? 'P2' : 'CPU';
  orbit.recenter(combat.actors[0].yaw); cameraInitialized = false;
  audio.unlock();audio.setAmbience(arena.stage.id);audio.updateAmbience(true); canvas.focus(); updateHud();
  toast(matchMedia('(pointer:coarse)').matches?'Left thumb move · buttons attack · swipe to look · pinch to zoom':'WASD move · U I O attack · J dodge · K jump · Esc pause');
}
function onOnlineRoom(room: RoomView | null) {
  menu.syncRoom(room);
  if (!room) {
    if(started&&playMode==='online'){
      releaseInputs();onlineBanner.hidden=true;$('result-title').textContent='MATCH INTERRUPTED';
      $('result-text').textContent='This session could not restore its match. Return to the hub to start another duel.';
      $('result-hint').textContent='CHECK YOUR DUEL RECORD IF YOU HAD A FUNDED MATCH';$('result').hidden=false;
    }
    return;
  }
  if (onlineLobby?.loaded && (room.phase==='countdown'||room.phase==='playing'||room.phase==='reconnecting') && !started) menu.playOnline();
  if (started && playMode==='online') {
    $('round-mode').textContent=room.mode==='paid'?'PRIZE DUEL':'FREE ONLINE';
    const waiting = room.phase==='countdown'||room.phase==='reconnecting'||!onlineLobby?.client.connected;
    onlineBanner.hidden = !waiting;
    onlineBanner.textContent = room.phase==='countdown' ? `GET READY · ${room.countdown}` : `RIVAL RECONNECTING · ${room.reconnectSeconds}s`;
    const seconds=Math.ceil(room.remaining);$('round-mark').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    if (room.result) {
      $('result-title').textContent = room.result.winner===null ? 'MATCH VOID' : room.result.winner===room.seat ? 'YOU WIN!' : 'NEXT ROUND?';
      $('result-text').textContent = room.mode==='paid'?`${room.result.reason} Result ready for contract verification. Credits are available after settlement.`:`${room.result.reason} Free online practice · no entry fee or prize.`;
      $('result-hint').textContent=room.mode==='paid'?'AWAITING CONTRACT SETTLEMENT':'FREE ONLINE PRACTICE · NO PRIZE';
      $('result').hidden = false; onlineBanner.hidden=true; releaseInputs();
    }
    if (onlineLobby?.client.snapshot) applyOnlineSnapshot(onlineLobby.client.snapshot);
  }
}
function applyOnlineSnapshot(s: OnlineSnapshot) {
  const room=onlineLobby?.client.room;
  if (!room || playMode!=='online' || !started) return;
  const map=(seat:number)=>seat===room.seat?0:1;
  combat.actors=s.actors.map(a=>({...structuredClone(a),seat:map(a.seat)})).sort((a,b)=>a.seat-b.seat);
  combat.projectiles=s.projectiles.map(p=>({...p,owner:map(p.owner)}));
  combat.tick=s.tick;combat.time=s.time;combat.hitstop=s.hitstop;
  combat.hits=s.stats[room.seat].hits;combat.totalDamage=s.stats[room.seat].damage;
  for(const e of s.events)if(e.id>lastOnlineEvent){lastOnlineEvent=e.id;onEvent({...e,source:map(e.source),...(e.target===undefined?{}:{target:map(e.target)})});}
  if(!onlineCameraReady){orbit.recenter(combat.actors[0].yaw);cameraInitialized=false;onlineCameraReady=true;}
  const seconds=Math.ceil(s.remaining);
  $('round-mark').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
function openPause() {
  if (!started || roster.busy || roster.isOpen || helpDialog.open) return;
  releaseInputs(); if (!pauseDialog.open) pauseDialog.showModal();
}
function openHelp() { releaseInputs(); if (!helpDialog.open) helpDialog.showModal(); }
function toast(text: string) { $('toast').textContent = text; $('toast').classList.add('visible'); toastUntil = performance.now() + 1800; }
function updateFighterLabels(){
  for(const [seat,name] of ['player','dummy'].entries()) {
    const fighter=roster.current[seat];if(!fighter)continue;
    $(`name-${name}`).textContent=fighter.name.toUpperCase();$(`role-${name}`).textContent=fighter.role.toUpperCase();
    $(`name-${name}`).parentElement!.classList.toggle('long',fighter.name.length>10);
  }
  const original=roster.current[0]?.id==='yot';
  $('action-attack').querySelector('strong')!.textContent=original?'LINK CHAIN':'BASIC CHAIN';
  $('action-skill').querySelector('strong')!.textContent=original?'PARTNER PING':'RANGED SKILL';
  $('action-stomp').querySelector('strong')!.textContent=original?'COLLAB STOMP':'GROUND SLAM';
}
function setMode(mode: DummyMode) {
  combat.mode = mode;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => { b.classList.toggle('selected', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  $('mode-help').textContent = mode === 'idle' ? 'A patient punching partner.' : mode === 'strafe' ? 'Keep up. Your rival is circling.' : 'Your rival will approach and fight back.';
}
function releaseInputs() {
  if(joyPointer!==null&&$('joystick').hasPointerCapture(joyPointer))$('joystick').releasePointerCapture(joyPointer);
  held.clear(); Object.keys(pulses).forEach(k => delete pulses[k as keyof InputFrame]); joyX = joyZ = 0;
  $('joystick-thumb').style.transform = 'translate(-50%, -50%)'; joyPointer = null;
  for (const id of cameraPointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  cameraPointers.clear(); cameraHolds.clear(); canvas.classList.remove('orbiting');
}
function reset() {
  if (!combat) return; viewOverride=null;combat.reset(); effects.reset(); avatars.forEach(a => a.reset()); chipHp = [200, 200];
  $('result').hidden = true; $('combo').hidden = true;
  floating.forEach(f => f.el.remove()); floating.length = 0; inspectClip = ''; $<HTMLSelectElement>('animation').value = '';
  accumulator = 0; releaseInputs(); toast('Fresh start. Make it count.'); updateHud();
}
function toggleLock() { combat.lockOn = !combat.lockOn; $<HTMLInputElement>('lock-toggle').checked = combat.lockOn; toast(combat.lockOn ? 'Rival locked. Circle and strike.' : 'Free movement. Face your next move.'); }
function gatherInput(): InputFrame {
  const forward = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) + joyZ;
  const right = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0) + joyX;
  // Right-handed camera right = forward × up, so screen-right is world -X at yaw 0.
  const x = Math.sin(orbit.yaw) * forward - Math.cos(orbit.yaw) * right;
  const z = Math.cos(orbit.yaw) * forward + Math.sin(orbit.yaw) * right;
  const input: InputFrame = { x, z, run: held.has('ShiftLeft') || held.has('ShiftRight'), ...pulses };
  for (const k of Object.keys(pulses)) delete pulses[k as keyof InputFrame];
  return input;
}
function onEvent(e: CombatEvent) {
  effects.event(e, fullFx); audio.cue(e);
  if (e.type === 'hit') {
    const el = document.createElement('span'); el.className = `damage-number ${e.target === 0 ? 'received' : ''} ${e.heavy ? 'heavy' : ''}`;
    el.textContent = String(e.damage); $('floating-numbers').append(el); floating.push({ el, x: e.x, y: e.y + 0.5, z: e.z, life: 0.85 });
    $('hint').textContent = e.target === 0 ? 'Feel that? Try a dodge with Q.' : e.heavy ? 'A little more impact. Nicely done.' : 'Nice contact. Keep the chain going.';
  }
  if (e.type === 'ko' && playMode !== 'online') {
    $('result-title').textContent = playMode === 'versus' ? (e.source === 1 ? 'YOU WIN!' : 'NEXT ROUND?') : (e.source === 1 ? 'K.O.' : 'DOWN, NOT OUT.');
    $('result-text').textContent = playMode === 'versus' ? (e.source === 1 ? `${roster.current[0].name} takes the alley. Good friends, great rivals.` : `${roster.current[1].name} takes this one. Ready for a rematch?`) : (e.source === 1 ? `${combat.hits} hits. ${combat.totalDamage} damage. Your spirit is showing.` : 'Shake it off. Your next round starts here.');
  }
}
function step(input = gatherInput()) { if(playMode==='online')return; combat.step(input); for (const e of combat.drainEvents()) onEvent(e); }
function updateHud() {
  if (!combat) return;
  for (const [i, name] of ['player', 'dummy'].entries()) {
    const a = combat.actors[i];
    $(`hp-${name}`).innerHTML = `${Math.ceil(a.hp)} <em>/ 200</em>`;
    $(`health-${name}`).style.transform = `scaleX(${a.hp / 200})`;
    $(`chip-${name}`).style.transform = `scaleX(${chipHp[i] / 200})`;
    $(`state-${name}`).textContent = a.state.toUpperCase();
  }
  const a = combat.actors[0];
  $('stat-hits').textContent = String(combat.hits).padStart(2, '0'); $('stat-damage').textContent = String(combat.totalDamage);
  for (const [kind, cooldown, max] of [['skill', a.skillCooldown, 2.5], ['stomp', a.stompCooldown, 4.5]] as const) {
    const b = $<HTMLButtonElement>(`action-${kind}`); b.style.setProperty('--cooldown', String(cooldown / max));
    b.classList.toggle('on-cooldown', cooldown > 0); b.disabled = cooldown > 0 || combat.roundOver;
    $(`${kind}-ready`).textContent = cooldown > 0 ? `${cooldown.toFixed(1)}s TO RECHARGE` : kind === 'skill' ? 'RANGED SKILL' : 'HEAVY SKILL';
  }
  $<HTMLButtonElement>('action-attack').disabled = combat.roundOver;
  $<HTMLButtonElement>('action-dodge').disabled = combat.roundOver || a.dodgeCooldown > 0;
  $('lock-label').classList.toggle('unlocked', !combat.lockOn); $('lock-label').querySelector('span')!.textContent = combat.lockOn ? 'RIVAL LOCKED' : 'FREE MOVEMENT';
  $('diag-fps').textContent = `${Math.round(engine.getFps())} FPS`;
  $('diag-state').textContent = `${avatars[0].boneCount} BONES · ${a.state.toUpperCase()}`; $('diag-fx').textContent = `${effects.activeCount} FX`;
  $('camera-mode-name').textContent = orbit.mode.toUpperCase();
  $('camera-mode').setAttribute('aria-pressed', String(orbit.mode === 'follow'));
  const combo = $('combo'); const recent = combat.time - combat.lastHitTime < 1.25 && combat.comboDamage > 9;
  combo.hidden = !recent || combat.roundOver;
  if (recent) { combo.querySelector('strong')!.textContent = String(combat.comboDamage); combo.querySelector('span')!.textContent = 'COMBO DAMAGE'; }
}
function updateCamera(dt: number) {
  if(viewOverride){camera.position.copyFrom(viewOverride.position);camera.setTarget(viewOverride.target);arena.updateCamera(viewOverride.cutaways?camera.position:Vector3.Zero(),dt);return;}
  const p = combat.actors[0], target = combat.actors[1], distance = Math.hypot(p.x - target.x, p.z - target.z);
  const keyboardOrbit = (held.has('KeyX') ? 1 : 0) - (held.has('KeyZ') ? 1 : 0);
  const buttonOrbit = [...cameraHolds.values()].reduce((sum, value) => sum + (performance.now() - value.since > 220 ? value.direction : 0), 0);
  orbit.update(dt, p.yaw, Math.max(-1, Math.min(1, keyboardOrbit + buttonOrbit)));
  const { yaw: orbitYaw, pitch: orbitPitch, zoom } = orbit;
  const framingPitch=Math.max(0,orbitPitch);
  const playerWeight = combat.lockOn ? 0.55 : 1;
  const focus = new Vector3(p.x * playerWeight + target.x * (1 - playerWeight), 1.15, p.z * playerWeight + target.z * (1 - playerWeight));
  let radius = zoom + Math.min(2.3, Math.max(0, distance - 4) * 0.3);
  // Fit the locked pair across narrow portrait screens as the camera orbits.
  const tanV = Math.tan(camera.fov / 2), tanH = tanV * engine.getAspectRatio(camera);
  const forward = new Vector3(Math.sin(orbitYaw) * Math.cos(framingPitch), -Math.sin(framingPitch), Math.cos(orbitYaw) * Math.cos(framingPitch));
  const right = new Vector3(-Math.cos(orbitYaw), 0, Math.sin(orbitYaw));
  const up = new Vector3(Math.sin(orbitYaw) * Math.sin(framingPitch), Math.cos(framingPitch), Math.cos(orbitYaw) * Math.sin(framingPitch));
  for (const actor of combat.lockOn ? [p, target] : [p]) for (const height of [0.15, 2.2]) {
    const relative = new Vector3(actor.x, actor.y + height, actor.z).subtract(focus);
    const depth = Vector3.Dot(relative, forward);
    radius = Math.max(radius, (Math.abs(Vector3.Dot(relative, right)) + 0.65) / (tanH * 0.82) - depth,
      (Math.abs(Vector3.Dot(relative, up)) + 0.5) / (tanV * 0.68) - depth);
  }
  const desired = focus.add(new Vector3(-Math.sin(orbitYaw) * Math.cos(framingPitch) * radius,
    Math.sin(framingPitch) * radius + 0.5, -Math.cos(orbitYaw) * Math.cos(framingPitch) * radius));
  // Rise over blocking furniture without shortening the radius needed to fit
  // both fighters. Moving inward could put a nearby fighter below the screen.
  for(let attempt=0;attempt<3;attempt++){
    const diff=desired.subtract(focus),length=diff.length();
    const pick=scene.pickWithRay(new Ray(focus,diff.scale(1/length),length),mesh=>arena.cameraOccluders.includes(mesh as typeof arena.cameraOccluders[number]));
    if(!pick?.hit||pick.distance<=.5)break;
    const top=pick.pickedMesh!.getBoundingInfo().boundingBox.maximumWorld.y;
    desired.y=Math.max(desired.y,focus.y+(top+.6-focus.y)/Math.max(.08,pick.distance/length));
  }
  desired.y = Math.max(1.5, desired.y);
  const shake = shakeEnabled ? effects.shake : 0;
  desired.addInPlace(new Vector3(Math.sin(performance.now() * 0.07) * shake, Math.cos(performance.now() * 0.09) * shake * 0.6, 0));
  if (!cameraInitialized) { camera.position.copyFrom(desired); cameraInitialized = true; }
  else Vector3.LerpToRef(camera.position, desired, 1 - Math.exp(-dt * 18), camera.position);
  // Upward dragging changes the gaze while keeping the camera above the floor.
  const gaze=focus.clone();if(orbitPitch<0)gaze.y=camera.position.y+Math.tan(-orbitPitch)*radius;
  camera.setTarget(gaze);
  arena.updateCamera(camera.position, dt);
}
function renderFrame(dt: number) {
  if (!ready) { scene.render(); return; }
  debugStageShapes.forEach(mesh => mesh.setEnabled(showHitboxes));
  for (const [i, a] of combat.actors.entries()) {
    let actor = playMode==='online' ? onlineLobby!.client.sample(a,dt,performance.now()) : a;
    if (inspectClip && i === 0) actor = { ...a, state: inspectClip as typeof a.state, action: null, stateTime: performance.now() / 1000 % 3, traveled: performance.now() / 500, vx: inspectClip.includes('left') ? -2 : inspectClip.includes('right') ? 2 : 0, vz: inspectClip.includes('back') ? -2 : 2 };
    avatars[i].update(actor, dt * (combat.hitstop > 0 ? 0 : timeScale), combat.lockOn);
    audio.footstep(i, a.traveled, a.speed, a.grounded, a.x);
    debugShapes[i].setEnabled(showHitboxes); debugShapes[i].position.set(a.x, a.y + 0.84, a.z);
    chipHp[i] += (a.hp - chipHp[i]) * Math.min(1, dt * 2.8);
  }
  const a = combat.actors[0], action = a.action;
  const active = !!action && action.fired && action.time < MOVES[action.kind].contact + 0.06 && action.kind !== 'skill' && action.kind !== 'dodge';
  debugReach.setEnabled(showHitboxes && active);
  if (action) { const r = MOVES[action.kind].reach; debugReach.scaling.set(r, 1, r); debugReach.position.set(a.x + Math.sin(a.yaw) * r * 0.45, a.y + 0.9, a.z + Math.cos(a.yaw) * r * 0.45); }
  effects.update(dt * timeScale, combat.projectiles); updateCamera(dt);
  if (playMode!=='online' && combat.roundOver && combat.actors.some(a => a.hp <= 0 && a.stateTime > 0.85)) $('result').hidden = false;
  for (let i = floating.length - 1; i >= 0; i--) {
    const f = floating[i]; f.life -= dt;
    if (f.life <= 0) { f.el.remove(); floating.splice(i, 1); continue; }
    const screen = Vector3.Project(new Vector3(f.x, f.y + (0.85 - f.life) * 1.4, f.z), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    f.el.style.left = `${screen.x / engine.getRenderWidth() * 100}%`; f.el.style.top = `${screen.y / engine.getRenderHeight() * 100}%`; f.el.style.opacity = String(Math.min(1, f.life * 4));
  }
  if (performance.now() > lastHud + 70) { updateHud(); lastHud = performance.now(); }
  if (toastUntil && performance.now() > toastUntil) { $('toast').classList.remove('visible'); toastUntil = 0; }
  scene.render();
}

function activateAction(action: string) {
  if (!ready || blockedInput() || combat.roundOver || inspectClip) return;
  audio.unlock(); (pulses as Record<string, boolean>)[action] = true;
}
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
  button.addEventListener('pointerdown', event => { event.preventDefault(); activateAction(button.dataset.action!); });
  button.addEventListener('click', event => { if (event.detail === 0) activateAction(button.dataset.action!); });
});
window.addEventListener('keydown', e => {
  if(e.code==='Escape'&&e.repeat){e.preventDefault();return;}
  if (roster.isOpen || helpDialog.open || duelLobby.isOpen) return; // Native dialogs own Escape and keyboard focus.
  if (e.code === 'Escape' && started) {
    if (pauseDialog.open) return;
    e.preventDefault();
    openPause();
    return;
  }
  const target=e.target as HTMLElement;
  if (blockedInput() || target.matches('input,select,textarea,[contenteditable=true]')) return;
  if(e.ctrlKey||e.altKey||e.metaKey)return;
  // Space activates a focused button normally; letter shortcuts remain available
  // after a click or an immediately closed fighter dialog.
  if(e.code==='Space'&&target.closest('button,a'))return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyR') { if (playMode === 'training') reset(); return; }
  if (e.code === 'KeyP' && combat) { toggleLock(); return; }
  if (e.code === 'KeyC' && ready) { recenterCamera(); return; }
  if (e.code === 'KeyF' && ready) { if(playMode==='online')return; if (playMode === 'training') void roster.open(); else { menu.setup(playMode); } return; }
  held.add(e.code); if (inputButtons.has(e.code)) activateAction(activeKeys[e.code]);
});
window.addEventListener('keyup', e => held.delete(e.code));
window.addEventListener('blur', releaseInputs);
document.addEventListener('visibilitychange', () => {
  releaseInputs(); accumulator = 0; last = performance.now();
  if (document.hidden) { paused = true; audio.suspend(); }
  else { paused = false; if (started && !audio.muted && !pauseDialog.open && !helpDialog.open) audio.unlock(); }
});
canvas.addEventListener('pointerdown', e => {
  if (blockedInput() || cameraPointers.size >= 2 || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
  e.preventDefault(); audio.unlock(); canvas.focus(); canvas.setPointerCapture(e.pointerId);
  cameraPointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.classList.add('orbiting');
});
canvas.addEventListener('pointermove', e => {
  const pointer = cameraPointers.get(e.pointerId); if (!pointer) return;
  const oldPair = [...cameraPointers.values()].slice(0, 2).map(p => ({ ...p }));
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  pointer.x = e.clientX; pointer.y = e.clientY;
  const pair = [...cameraPointers.values()].slice(0, 2);
  if (pair.length === 2) {
    const before = Math.hypot(oldPair[0].x - oldPair[1].x, oldPair[0].y - oldPair[1].y);
    const after = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
    if (before > 8 && after > 8) orbit.pinch(before / after);
    orbit.drag(dx * 0.5, dy * 0.5);
  } else orbit.drag(dx, dy);
});
const releaseCamera = (e: PointerEvent) => {
  cameraPointers.delete(e.pointerId); if (!cameraPointers.size) canvas.classList.remove('orbiting');
};
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, releaseCamera as EventListener);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  if (blockedInput()) return; e.preventDefault();
  const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
  orbit.zoomBy(Math.max(-3, Math.min(3, pixels * 0.008)));
}, { passive: false });
function recenterCamera() { if (!ready) return; orbit.recenter(combat.actors[0].yaw); toast('Camera centered. Drag to explore.'); }
$('camera-reset').onclick = recenterCamera;
$('camera-mode').onclick = () => {
  orbit.mode = orbit.mode === 'orbit' ? 'follow' : 'orbit'; updateHud();
  toast(orbit.mode === 'follow' ? 'Following your fighter. Drag to return to orbit.' : 'Free orbit. Find your angle.');
};
document.querySelectorAll<HTMLButtonElement>('[data-camera-orbit]').forEach(button => {
  button.addEventListener('pointerdown', e => {
    if (!ready || !started || arena.busy || roster.isOpen) return; e.preventDefault(); button.setPointerCapture(e.pointerId);
    const direction = Number(button.dataset.cameraOrbit);
    orbit.rotate(direction * Math.PI / 6); cameraHolds.set(e.pointerId, { direction, since: performance.now() });
  });
  const release = (e: PointerEvent) => { cameraHolds.delete(e.pointerId); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, release);
  button.addEventListener('click', e => { if (e.detail === 0 && ready && started && !arena.busy && !roster.isOpen) orbit.rotate(Number(button.dataset.cameraOrbit) * Math.PI / 6); });
});
const joystick = $('joystick');
const moveJoystick = (e: PointerEvent) => {
  if (joyPointer !== e.pointerId) return;
  const rect = joystick.getBoundingClientRect(), max = rect.width * 0.31;
  const x = e.clientX - rect.left - rect.width / 2, y = e.clientY - rect.top - rect.height / 2;
  const length = Math.hypot(x, y), divisor = Math.max(max, length);
  joyX = x / divisor; joyZ = -y / divisor;
  $('joystick-thumb').style.transform = `translate(calc(-50% + ${joyX * max}px), calc(-50% + ${-joyZ * max}px))`;
};
joystick.addEventListener('pointerdown', e => { if (blockedInput()) return; e.preventDefault(); joyPointer = e.pointerId; joystick.setPointerCapture(e.pointerId); audio.unlock(); moveJoystick(e); });
joystick.addEventListener('pointermove', moveJoystick);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(type, () => { joyPointer = null; joyX = joyZ = 0; $('joystick-thumb').style.transform = 'translate(-50%, -50%)'; });
$('reset').onclick = reset; $('result-reset').onclick = () => { if(playMode==='online'){const mode=onlineLobby?.client.room?.mode??'free';onlineLobby?.leave();onlineLobby?.open(undefined,mode);}else reset(); };
$('training-toggle').onclick = () => { const panel = $('training-panel'); panel.hidden = !panel.hidden; $('training-toggle').setAttribute('aria-expanded', String(!panel.hidden)); };
$('panel-close').onclick = () => { $('training-panel').hidden = true; $('training-toggle').setAttribute('aria-expanded', 'false'); };
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => { if (combat) { setMode(b.dataset.mode as DummyMode); audio.unlock(); } });
$<HTMLInputElement>('lock-toggle').onchange = () => { if (combat) combat.lockOn = $<HTMLInputElement>('lock-toggle').checked; };
$<HTMLInputElement>('hitbox-toggle').onchange = () => showHitboxes = $<HTMLInputElement>('hitbox-toggle').checked;
$<HTMLInputElement>('shake-toggle').onchange = () => shakeEnabled = $<HTMLInputElement>('shake-toggle').checked;
$<HTMLInputElement>('fx-toggle').onchange = () => fullFx = $<HTMLInputElement>('fx-toggle').checked;
$<HTMLSelectElement>('speed').onchange = () => timeScale = Number($<HTMLSelectElement>('speed').value);
$<HTMLSelectElement>('animation').onchange = () => { inspectClip = $<HTMLSelectElement>('animation').value; releaseInputs(); toast(inspectClip ? 'Animation inspection · gameplay paused' : 'Back to training.'); };
$('sound').onclick = () => { audio.unlock(); audio.setMuted(!audio.muted); $('sound').innerHTML = icon(audio.muted ? 'mute' : 'sound')+`<span>Sound ${audio.muted?'off':'on'}</span>`; $('sound').setAttribute('aria-label', audio.muted ? 'Enable sound' : 'Mute sound'); };
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Full screen is unavailable in this browser.'); } };
document.addEventListener('fullscreenchange',()=>{const active=!!document.fullscreenElement;$('fullscreen').innerHTML=icon('expand')+`<span>${active?'Exit full screen':'Full screen'}</span>`;$('fullscreen').setAttribute('aria-label',active?'Exit full screen':'Full screen');});
$('test-hit').onclick = () => { if (combat) { combat.forceHit(0); combat.drainEvents().forEach(onEvent); } };
$('test-down').onclick = () => { if (combat) { combat.forceHit(0, 18, true); combat.drainEvents().forEach(onEvent); } };
$('test-ko').onclick = () => { if (combat) { combat.forceHit(1, 200, true); combat.drainEvents().forEach(onEvent); } };
$('game-menu').onclick = openPause;
$('resume').onclick = () => { pauseDialog.close(); canvas.focus(); };
$('pause-close').onclick = () => pauseDialog.close();
$('pause-restart').onclick = () => { pauseDialog.close(); reset(); canvas.focus(); };
$('pause-fighters').onclick = () => { menu.setup(playMode); $('roster-done').textContent = 'Back to match setup →'; };
$('pause-home').onclick = () => menu.home();
$('result-home').onclick = () => menu.home();
$('menu-help').onclick = openHelp; $('game-help').onclick = openHelp;
$('help-close').onclick = () => helpDialog.close();
function restoreGameFocus(){
  if(!started)return;
  if(pauseDialog.open){if(!pauseDialog.contains(document.activeElement))$('resume').focus();}
  else if(!helpDialog.open&&!roster.isOpen)canvas.focus();
}
for(const dialog of [pauseDialog,helpDialog]){
  dialog.addEventListener('cancel',releaseInputs);
  // close is queued by the browser: clearing keys here would erase fresh input
  // pressed immediately after Resume. Old input is cleared when opening/cancelling.
  dialog.addEventListener('close',()=>{accumulator=0;restoreGameFocus();});
}
$<HTMLDialogElement>('fighter-dialog').addEventListener('close',restoreGameFocus);
$('retry').onclick = () => location.reload();
window.addEventListener('resize', () => engine.resize());

async function initialize() {
  try {
    const [simulation] = await Promise.all([Combat.create(), arena.ready]);
    combat = simulation;
    $('loading-progress').style.width = '30%'; $('loading-status').textContent = 'Getting Yot ready for a friendly fight…';
    await roster.initialize(fraction=>{$('loading-progress').style.width=`${30+fraction*60}%`;});
    await roster.select(1, 'benja');
    await scene.whenReadyAsync();
    updateFighterLabels();
    ready = true; setMode('idle'); updateHud();
    menu.updateFighters(roster.current,roster.entries); menu.ready();
    $('loading-progress').style.width = '100%'; $('loading-status').textContent = 'CWO Alley is ready. Make some noise.';
    $('loading').hidden = true;
    const params = new URLSearchParams(location.search);
    if (params.has('autostart')) { menu.setup('training'); $<HTMLButtonElement>('start').click(); }
    if (params.has('qa')) manual = true;
    const room=params.get('room');if(room&&/^[A-Z2-9]{6}$/i.test(room))onlineLobby?.open(room.toUpperCase(),params.get('mode')==='paid'?'paid':'free');
  } catch (error) {
    $('loading-status').textContent = error instanceof Error ? error.message : 'Could not load the arena.';
    menu.error('Could not open the alley. Try reloading.'); $('loading').hidden = false; $('loading').classList.add('load-error'); $('retry').hidden = false;
    console.error(error);
  }
}
engine.runRenderLoop(() => {
  const now = performance.now(), elapsed = Math.min(0.1, (now - last) / 1000); last = now;
  if (ready && started && playMode==='online' && now-onlineSendAt>=45) {
    onlineLobby?.client.input(blockedInput()?neutralInput():gatherInput(),combat.lockOn);onlineSendAt=now;
  }
  if (ready && playMode!=='online' && !blockedInput() && !manual && !inspectClip) {
    accumulator += elapsed * timeScale;
    while (accumulator >= 1 / 60) { step(); accumulator -= 1 / 60; }
  }
  audio.updateAmbience(ready && started && !blockedInput());
  const presentation = roster.isOpen ? 'picker' : menu.screen;
  showcase.show(presentation);
  if (presentation !== 'game' && ready) {
    debugShapes.forEach(mesh=>mesh.setEnabled(false)); debugStageShapes.forEach(mesh=>mesh.setEnabled(false)); debugReach.setEnabled(false);
    showcase.render(now,combat.actors[0]);
  } else if (!ready || started || !scene.isReady()) renderFrame(elapsed);
});
void initialize();

// A narrow, deterministic inspection surface for the training panel and browser acceptance.
declare global { interface Window { __arena: ReturnType<typeof diagnostics>; } }
function diagnostics() {
  return {
    get ready() { return ready; },
    menuInfo: () => ({screen:menu.screen,mode:playMode,setupMode:menu.mode,paused:pauseDialog.open,help:helpDialog.open,started,timeScale,showHitboxes,inspectClip}),
    onlineInfo:()=>({connected:onlineLobby?.client.connected,room:onlineLobby?.client.room,snapshot:onlineLobby?.client.snapshot}),
    rosterInfo:()=>roster.info(),
    postureInfo:(geometry=false)=>avatars.map(a=>a.postureInfo(geometry)),
    selectStage:(id:StageId)=>menu.selectStage(id),
    showcaseInfo:()=>showcase.info(),
    previewFighter:(id:string)=>roster.preview(id),
    selectFighter:(seat:number,id:string)=>roster.select(seat,id),
    ambienceInfo:()=>audio.ambienceInfo(),
    environmentCoverage:(origin:number[],directions:number[][])=>arena.coverage(origin,directions),
    viewportCoverage:()=>{
      const forward=camera.getTarget().subtract(camera.position).normalize(),right=Vector3.Cross(forward,Vector3.Up()).normalize(),up=Vector3.Cross(right,forward).normalize();
      const tanV=Math.tan(camera.fov/2),tanH=tanV*engine.getAspectRatio(camera),directions:number[][]=[];
      for(const x of [-.96,-.5,0,.5,.96])for(const y of [-.96,-.5,0,.5,.96])directions.push(forward.add(right.scale(x*tanH)).add(up.scale(y*tanV)).normalize().asArray());
      return arena.coverage(camera.position.asArray(),directions);
    },
    inspectEnvironment:(position:number[]|null,target:number[]=[0,2,0],cutaways=true)=>{manual=true;viewOverride=position?{position:Vector3.FromArray(position),target:Vector3.FromArray(target),cutaways}:null;cameraInitialized=false;renderFrame(1);},
    cameraInfo: () => ({ ...orbit.info(),position:camera.position.asArray(),target:camera.getTarget().asArray(), pointers: cameraPointers.size, holds: cameraHolds.size }),
    stageInfo: () => ({ ...arena.info(), camera: camera.position.asArray(),
      rendering: {
        backgroundGroups: [...new Set(scene.meshes.filter(m=>m.metadata?.environmentLayer==='background').map(m=>m.renderingGroupId))],
        architecturalGroups: [...new Set(scene.meshes.filter(m=>m.metadata?.environmentLayer==='venue').map(m=>m.renderingGroupId))],
        fighterGroups: avatars.map(a=>[...new Set(a.meshes.map(m=>m.renderingGroupId))]),
        venueDepthClear: scene.getAutoClearDepthStencilSetup(1).depth,
      },
      fighters: combat.actors.map(a => {
        const p = Vector3.Project(new Vector3(a.x, a.y + 1, a.z), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
        return { x: p.x / engine.getRenderWidth(), y: p.y / engine.getRenderHeight(), depth: p.z };
      }),
    }),
    snapshot: () => ({ ...combat.snapshot(), assets: avatars.map(a => ({ id:a.fighterId,prop:a.propKind,ready: a.ready, bones: a.boneCount, clip: a.currentClip,motion:a.motionInfo() })), independentRigs: avatars[0].meshes.find(m => m.skeleton)?.skeleton !== avatars[1].meshes.find(m => m.skeleton)?.skeleton, effects: effects.activeCount, fps: engine.getFps(), audio: audio.context?.state || 'locked' }),
    visualInfo: () => avatars.map(a => ({ root: a.root.position.asArray(), offset: a.tilt.position.asArray(), sign: a.signInfo(), posture:a.postureInfo(), meshes: a.meshes.map(m => ({ name: m.name, enabled: m.isEnabled(), visible: m.isVisible, visibility: m.visibility, vertices: m.getTotalVertices(), scaling: m.scaling.asArray(), world: m.getAbsolutePosition().asArray(), minimum: m.getBoundingInfo().boundingBox.minimumWorld.asArray(), maximum: m.getBoundingInfo().boundingBox.maximumWorld.asArray() })), groups: [...a.groups.keys()] })),
    advance: (seconds: number, input: InputFrame = neutralInput()) => { manual = true; for (let i = 0; i < Math.round(seconds * 60); i++) step(i === 0 ? input : { ...input, attack: false, skill: false, stomp: false, dodge: false, jump: false }); renderFrame(1 / 60); updateHud(); return combat.snapshot(); },
    advanceControls: (seconds: number) => { manual = true; for (let i = 0; i < Math.round(seconds * 60); i++) step(); renderFrame(1 / 60); updateHud(); return combat.snapshot(); },
    teleport: (seat: number, x: number, z: number) => combat.teleport(seat, x, z),
    setMode, reset, hit: (seat: number, damage = 14, down = false) => { const result = combat.forceHit(seat, damage, down); combat.drainEvents().forEach(onEvent); return result; },
    manual: (value: boolean) => { manual = value; accumulator = 0; },
    inspect: (name: string) => { inspectClip = name; $<HTMLSelectElement>('animation').value = name; },
    orbit: (yaw: number, pitch: number) => { viewOverride=null;orbit.place(yaw, pitch); cameraInitialized = false; },
    dispose: () => { engine.stopRenderLoop(); effects.reset(); combat.dispose(); audio.dispose(); roster.dispose(); showcase.dispose();arena.dispose();scene.dispose(); engine.dispose(); },
  };
}
window.__arena = diagnostics();
