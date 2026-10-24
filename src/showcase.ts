import { Color3, MeshBuilder, TransformNode, Vector3, type Engine, type FreeCamera, type Scene, type ShadowGenerator } from './babylon.ts';
import { material } from './arena.ts';
import type { Avatar } from './avatar.ts';
import type { Actor } from './combat.ts';
import type { FighterRoster } from './roster.ts';

export type Presentation = 'home' | 'setup' | 'picker' | 'game';

/** The game and menu share one canvas, scene and body cache, including inside the native dialog. */
export class Showcase {
  mode: Presentation = 'home';
  private exploring = false;
  private targetYaw = .18;
  private yaw = .18;
  private time = .35;
  private lastPaint = 0;
  private pointer: { id: number; x: number } | null = null;
  private pedestalRoot: TransformNode;
  private pedestals: TransformNode[];
  private observer: ResizeObserver;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private restoreFov: number;
  private redraw = true;
  private content = '';
  constructor(private canvas: HTMLCanvasElement, private engine: Engine, private scene: Scene, private camera: FreeCamera,
    private avatars: Avatar[], private roster: FighterRoster, shadows: ShadowGenerator,
    private updateStage: (position: Vector3, dt: number) => void, private stageName: () => string = () => 'CWO Alley') {
    this.restoreFov = camera.fov;
    document.getElementById('stage-tour')!.onclick = () => this.explore(!this.exploring);
    this.pedestalRoot = new TransformNode('menu podiums', scene);
    const base = material(scene, 'podium warm lilac', '#8974a5');
    const top = material(scene, 'podium porcelain', '#ddd0e8');
    const rim = material(scene, 'podium luminous rim', '#b4e9d1', true);
    this.pedestals = [0, 1].map(seat => {
      const root = new TransformNode('showcase podium ' + seat, scene); root.parent = this.pedestalRoot;
      for (const [name, diameter, height, y, mat] of [
        ['base', 2.5, .18, .09, base], ['top', 2.4, .035, .195, top],
      ] as const) {
        const mesh = MeshBuilder.CreateCylinder('podium ' + name, { diameter, height, tessellation: 48 }, scene);
        mesh.parent = root; mesh.position.y = y; mesh.material = mat; mesh.receiveShadows = true; mesh.isPickable = false;
        shadows.addShadowCaster(mesh);
      }
      const ring = MeshBuilder.CreateTorus('podium light', { diameter: 2.44, thickness: .025, tessellation: 48 }, scene);
      ring.parent = root; ring.position.y = .15; ring.material = rim; ring.isPickable = false;
      return root;
    });
    this.pedestalRoot.setEnabled(false);
    this.observer = new ResizeObserver(() => { this.engine.resize(); this.redraw = true; });
    document.querySelectorAll<HTMLButtonElement>('[data-showcase-turn]').forEach(button => button.onclick = () => this.turn(Number(button.dataset.showcaseTurn) * Math.PI / 6));
    document.querySelectorAll<HTMLButtonElement>('[data-showcase-reset]').forEach(button => button.onclick = () => { this.targetYaw = .18; this.redraw = true; });
    canvas.addEventListener('pointerdown', e => {
      if (this.mode === 'game' || this.pointer || e.button !== 0) return;
      this.pointer = { id: e.pointerId, x: e.clientX }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('orbiting');
      if (e.pointerType === 'mouse') { e.preventDefault(); canvas.focus(); }
    });
    canvas.addEventListener('pointermove', e => {
      if (this.mode === 'game' || this.pointer?.id !== e.pointerId) return;
      this.turn((e.clientX - this.pointer.x) * .012); this.pointer.x = e.clientX;
    });
    const release = (e: PointerEvent) => { if (this.pointer?.id === e.pointerId) { this.pointer = null; canvas.classList.remove('orbiting'); } };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, release as EventListener);
    canvas.addEventListener('keydown', e => {
      if (this.mode === 'game') return;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); this.turn(e.code === 'ArrowLeft' ? -.3 : .3); }
    });
  }
  explore(enabled = true) {
    this.exploring = enabled && this.mode === 'setup'; this.redraw = true;
    this.avatars.forEach(a => a.setVisible(!this.exploring)); this.pedestalRoot.setEnabled(!this.exploring && this.mode !== 'game');
    const button = document.getElementById('stage-tour')!; button.setAttribute('aria-pressed', String(this.exploring));
    button.textContent = this.exploring ? 'BACK TO FIGHTERS ↙' : 'EXPLORE ARENA 3D ↗';
    this.canvas.setAttribute('aria-label', this.exploring ? `${this.stageName()} live 3D arena. Drag or use left and right arrows to orbit.` : 'Live 3D fighters. Drag or use left and right arrows to turn.');
    document.querySelector('.setup-fighters .showcase-controls>span')!.textContent = this.exploring ? 'DRAG TO ORBIT THE ARENA' : 'DRAG TO TURN · CHOOSE A SIDE TO CHANGE';
  }
  invalidate() { this.redraw = true; }
  turn(amount: number) { if (this.mode !== 'game') { this.targetYaw += amount; this.redraw = true; } }
  show(mode: Presentation) {
    const host = mode === 'home' ? document.getElementById('home-stage')! : mode === 'setup' ? document.getElementById('setup-stage')! : mode === 'picker' ? document.getElementById('roster-stage')! : document.getElementById('app')!;
    if (this.canvas.parentElement === host) return;
    if (this.pointer && this.canvas.hasPointerCapture(this.pointer.id)) this.canvas.releasePointerCapture(this.pointer.id);
    this.pointer = null; this.canvas.classList.remove('orbiting');
    this.mode = mode; this.exploring = false; document.getElementById('stage-tour')!.setAttribute('aria-pressed','false'); document.getElementById('stage-tour')!.textContent='EXPLORE ARENA 3D ↗'; this.yaw = this.targetYaw = .18; this.redraw = true;
    document.querySelector('.setup-fighters .showcase-controls>span')!.textContent = 'DRAG TO TURN · CHOOSE A SIDE TO CHANGE';
    this.observer.disconnect();
    if (mode === 'game') host.prepend(this.canvas); else host.append(this.canvas);
    this.canvas.style.touchAction = mode === 'game' ? 'none' : 'pan-y';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', mode === 'game' ? `WARCHOG ${this.stageName()} 3D arena` : 'Live 3D fighters. Drag or use left and right arrows to turn.');
    this.camera.fov = mode === 'game' ? this.restoreFov : .64;
    this.pedestalRoot.setEnabled(mode !== 'game');
    this.avatars.forEach(a => a.setVisible(mode !== 'picker'));
    this.observer.observe(host); this.engine.resize();
  }
  render(now: number, base: Actor) {
    if (document.hidden || this.mode === 'game') return;
    const content = this.mode === 'picker' ? `${this.roster.previewAvatar?.fighterId}/${this.roster.previewAvatar?.root.isEnabled()}` : this.avatars.map(a => a.fighterId).join('/');
    if (content !== this.content) { this.content = content; this.redraw = true; }
    const warm = !this.scene.isReady();
    if (now - this.lastPaint < 1000 / 30 && !this.redraw && !warm) return;
    const settling = Math.abs(this.targetYaw - this.yaw) > .002;
    if (this.reduced.matches && !this.redraw && !settling && !warm) return;
    const dt = Math.min(.1, Math.max(.001, (now - this.lastPaint) / 1000)); this.lastPaint = now;
    this.redraw = false;
    if (!this.reduced.matches) this.time += dt;
    this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-dt * 16));
    if (this.exploring) {
      const aspect=this.engine.getAspectRatio(this.camera),distance=Math.max(23,13/(Math.tan(this.camera.fov/2)*aspect));
      this.camera.position.set(Math.sin(this.yaw)*distance,Math.max(11,distance*.47),-Math.cos(this.yaw)*distance);
      this.camera.setTarget(new Vector3(0,1.5,0)); this.updateStage(this.camera.position,this.reduced.matches?1:dt);this.scene.render();return;
    }
    const solo = this.mode === 'picker', list = solo ? [this.roster.previewAvatar] : this.avatars;
    for (const [i, avatar] of list.entries()) {
      if (!avatar) continue;
      const x = solo ? 0 : i === 0 ? 1.25 : -1.25, z = this.mode === 'home' && i === 1 ? .55 : 0;
      const actor: Actor = { ...base, x, z, y: .22, yaw: Math.PI + this.yaw, hp: 200, state: 'idle', stateTime: this.time,
        action: null, speed: 0, traveled: 0, vx: 0, vz: 0, grounded: true };
      avatar.update(actor, .1, false); avatar.marker.setEnabled(false);
      this.pedestals[i].position.set(x, 0, z);
    }
    this.pedestals[1].setEnabled(!solo);
    const aspect = this.engine.getAspectRatio(this.camera), tanV = Math.tan(this.camera.fov / 2);
    const distance = Math.max(solo ? 4.8 : 5.6, (solo ? 1.25 : 2.45) / (tanV * aspect * .86));
    this.camera.position.set(this.reduced.matches ? .4 : .4 + Math.sin(this.time * .22) * .18, 1.5 + distance * .15, -distance);
    this.camera.setTarget(new Vector3(0, 1.4, .1)); this.updateStage(this.camera.position, this.reduced.matches ? 1 : dt);
    this.scene.render();
  }
  info() { return { mode: this.mode, exploring: this.exploring, parent: this.canvas.parentElement?.id, yaw: this.yaw, targetYaw: this.targetYaw,
    time: this.time, pointer: this.pointer?.id ?? null, reducedMotion: this.reduced.matches, contexts: 1,
    modelYaws: (this.mode === 'picker' ? [this.roster.previewAvatar] : this.avatars).map(a => a?.root.rotation.y ?? null),
    renderSize: [this.engine.getRenderWidth(), this.engine.getRenderHeight()] }; }
  dispose() { this.observer.disconnect(); this.pedestalRoot.dispose(false, true); }
}
