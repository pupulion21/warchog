import { LoadAssetContainerAsync, type AssetContainer, type Scene } from './babylon.ts';
import { type Avatar, type FighterManifest } from './avatar.ts';

export interface FighterEntry {
  id: string; characterId: string; name: string; role: string; color: string; prop: string; height: number;
  form: string; ready: boolean; manifest: string; portrait: string;
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function rosterMarkup() {
  return `<button id="roster-toggle" class="roster-toggle"><span class="roster-icon">✦</span><span>Choose fighters</span><kbd>F</kbd></button>
  <dialog id="fighter-dialog" class="fighter-dialog" aria-labelledby="roster-title"><div class="roster-heading"><div><span class="eyebrow">THE CHOG CREW / EVERY ANGLE</span><h2 id="roster-title">Find your fighter.</h2><p>12 fighters. 13 forms. Step up and take a look.</p></div><button id="roster-close" class="icon-button" aria-label="Close fighter selection">×</button></div><div class="roster-slots" role="group" aria-label="Fighter slot"><button data-roster-seat="0" class="selected" aria-pressed="true"><small>YOU</small><strong id="roster-player">Yot</strong></button><span>VS</span><button data-roster-seat="1" aria-pressed="false"><small>RIVAL</small><strong id="roster-rival">Yot</strong></button></div><div class="roster-body"><div class="roster-collection"><p id="roster-status" class="roster-status" role="status">Choose a fighter to preview.</p><div id="roster-grid" class="roster-grid"></div></div><section class="roster-showcase" aria-label="Live 3D fighter preview"><div id="roster-stage" class="model-stage" aria-label="Rotate the selected 3D fighter"></div><span class="preview-badge">LIVE 3D</span><div class="preview-name"><small id="preview-role">Collab connector</small><h3 id="preview-name">Yot</h3></div><div class="showcase-controls"><span>DRAG TO TURN</span><button data-showcase-turn="-1" aria-label="Turn fighter left">‹</button><button data-showcase-reset aria-label="Reset fighter view">↺</button><button data-showcase-turn="1" aria-label="Turn fighter right">›</button></div><button id="roster-confirm" class="roster-confirm" disabled>GETTING READY…</button></section></div><div class="roster-footnote"><span>Preview a fighter, then lock in your pick.</span><button id="roster-done">Back to the alley →</button></div></dialog>`;
}

export class FighterRoster {
  entries: FighterEntry[] = [];
  current: FighterEntry[] = [];
  busy = false;
  previewAvatar: Avatar | null = null;
  private seat = 0;
  private fixedSeat: number | undefined;
  private dialog = document.getElementById('fighter-dialog') as HTMLDialogElement;
  private cache = new Map<string, AssetContainer>();
  private manifests = new Map<string, FighterManifest>();
  private pending = new Map<string, Promise<AssetContainer>>();
  private candidateId = '';
  private previewReady = false;
  private previewVersion = 0;
  private queued: FighterEntry | null = null;
  private previewTask: Promise<void> | null = null;
  private disposed = false;
  constructor(private scene: Scene, private avatars: Avatar[], private callbacks: {
    change: () => void; release: () => void; error: (message: string) => void; createPreview: () => Avatar;
  }) {
    document.getElementById('roster-toggle')!.onclick = () => void this.open();
    for (const id of ['roster-close', 'roster-done']) document.getElementById(id)!.onclick = () => this.close();
    this.dialog.addEventListener('cancel',()=>{this.callbacks.release();this.clearPreview();});
    this.dialog.addEventListener('close',()=>{if(!this.dialog.open)this.clearPreview();});
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const r = this.dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.close();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-roster-seat]').forEach(button => button.onclick = () => {
      this.seat = Number(button.dataset.rosterSeat); this.preview(this.current[this.seat]?.id || 'yot');
    });
    document.getElementById('roster-confirm')!.onclick = () => {
      if (this.previewReady && !this.busy) void this.select(this.seat, this.candidateId).catch(() => {});
    };
  }
  get isOpen() { return this.dialog.open; }
  private status(text: string) { document.getElementById('roster-status')!.textContent = text; }
  async refresh() {
    const response = await fetch('/assets/roster.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('The fighter catalog could not be loaded.');
    const data = await response.json(); this.entries = data.entries;
  }
  async initialize(progress: (fraction: number) => void) {
    await this.refresh();
    const yot = this.entries.find(c => c.id === 'yot' && c.ready);
    if (!yot) throw new Error('The Yot starter model is not available.');
    const { container, manifest } = await this.load(yot, progress);
    this.avatars.forEach(a => a.attach(container, manifest)); this.current = [yot, yot]; this.render();
  }
  async open(seat = 0, singleSeat = false) {
    this.fixedSeat=singleSeat?seat:undefined;
    this.seat = seat; this.callbacks.release();
    if (!this.dialog.open) this.dialog.showModal();
    this.preview(this.current[seat]?.id || 'yot');
    try { await this.refresh(); if (this.dialog.open) this.render(); }
    catch (error) { this.status(error instanceof Error ? error.message : 'Could not load the roster.'); }
  }
  private close(){
    this.callbacks.release();this.clearPreview();this.dialog.close();
  }
  private async load(entry: FighterEntry, progress?: (fraction: number) => void) {
    let manifest = this.manifests.get(entry.id);
    if (!manifest) {
      const response = await fetch(entry.manifest);
      if (!response.ok) throw new Error(`The ${entry.name} model package is not ready.`);
      manifest = await response.json() as FighterManifest; this.manifests.set(entry.id, manifest);
    }
    let container = this.cache.get(manifest.model);
    if (!container) {
      let loading = this.pending.get(manifest.model);
      if (!loading) {
        loading = LoadAssetContainerAsync(manifest.model, this.scene, { onProgress: event => { if (event.lengthComputable) progress?.(event.loaded / event.total); } });
        this.pending.set(manifest.model, loading);
      }
      try {
        container = await loading;
        if (this.disposed) { container.dispose(); throw new Error('The roster has closed.'); }
        this.cache.set(manifest.model, container);
      } finally { this.pending.delete(manifest.model); }
    } else { this.cache.delete(manifest.model); this.cache.set(manifest.model, container); }
    return { container, manifest };
  }
  preview(id: string) {
    const entry = this.entries.find(c => c.id === id && c.ready);
    if (!entry || this.busy || !this.dialog.open) return;
    this.candidateId = id; this.previewReady = false; this.previewVersion++; this.queued = entry;
    this.previewAvatar?.setVisible(false);
    document.getElementById('preview-name')!.textContent = entry.name;
    document.getElementById('preview-role')!.textContent = entry.role;
    this.status(`Getting ${entry.name} ready to preview…`); this.render();
    if (!this.previewTask) this.previewTask = this.loadPreview().finally(() => { this.previewTask = null; });
  }
  private async loadPreview() {
    // One load at a time; rapid browsing replaces the queued choice instead of loading the whole roster.
    while (this.queued && !this.disposed) {
      const entry = this.queued, version = this.previewVersion; this.queued = null;
      try {
        const { container, manifest } = await this.load(entry);
        if (version !== this.previewVersion || !this.dialog.open || this.disposed) continue;
        this.previewAvatar ||= this.callbacks.createPreview();
        this.previewAvatar.attach(container, manifest); this.previewAvatar.setVisible(true);
        await this.scene.whenReadyAsync();
        if (version !== this.previewVersion || !this.dialog.open || this.disposed) continue;
        this.previewReady = true; this.status(`${entry.name} · drag to see every side, then lock in.`); this.render();
      } catch (error) {
        if (version === this.previewVersion && this.dialog.open && !this.disposed) {
          this.status(error instanceof Error ? error.message : 'Could not preview that fighter. Try another pick.'); this.render();
        }
      } finally { if (!this.disposed) this.prune(); }
    }
  }
  private prune() {
    const protectedModels = new Set(this.current.map(c => this.manifests.get(c.id)?.model));
    if (this.dialog.open) protectedModels.add(this.manifests.get(this.candidateId)?.model);
    for (const [key, old] of this.cache) {
      if (this.cache.size <= 3) break;
      if (!protectedModels.has(key)) { old.dispose(); this.cache.delete(key); }
    }
  }
  private clearPreview() {
    this.queued = null; this.previewVersion++; this.previewReady = false;
    this.previewAvatar?.dispose(); this.previewAvatar = null; this.prune();
  }
  async select(seat: number, id: string) {
    if (this.busy) throw new Error('A fighter is already loading.');
    if (seat !== 0 && seat !== 1) throw new Error('Unknown fighter slot.');
    const entry = this.entries.find(c => c.id === id && c.ready);
    if (!entry) throw new Error('That fighter is still being prepared.');
    if (this.current[seat]?.id === id) { if (this.dialog.open) this.close(); return; }
    this.busy = true; this.callbacks.release(); this.status(`Getting ${entry.name} ready…`); this.render();
    try {
      const { container, manifest } = await this.load(entry, fraction => this.status(`Getting ${entry.name} ready… ${Math.round(fraction * 100)}%`));
      this.avatars[seat].attach(container, manifest); this.current[seat] = entry;
      await this.scene.whenReadyAsync(); this.callbacks.change(); this.prune();
      if (this.dialog.open) this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load that fighter.';
      this.status(message); this.callbacks.error(message); throw error;
    } finally { this.busy = false; this.render(); }
  }
  private render() {
    for (const [i, id] of ['roster-player', 'roster-rival'].entries()) document.getElementById(id)!.textContent = this.current[i]?.name || 'Yot';
    document.querySelectorAll<HTMLButtonElement>('[data-roster-seat]').forEach(button => {
      const selected = Number(button.dataset.rosterSeat) === this.seat;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); button.disabled = this.busy || (this.fixedSeat!==undefined&&Number(button.dataset.rosterSeat)!==this.fixedSeat);
    });
    const confirm = document.getElementById('roster-confirm') as HTMLButtonElement;
    confirm.disabled = !this.previewReady || this.busy;
    confirm.textContent = this.busy ? 'LOCKING IN…' : this.previewReady ? `LOCK IN ${this.seat === 0 ? 'PLAYER' : 'RIVAL'} →` : 'GETTING READY…';
    const grid = document.getElementById('roster-grid')!;
    grid.innerHTML = this.entries.map(c => `<button class="fighter-card ${this.candidateId === c.id ? 'selected' : ''}" data-fighter="${escape(c.id)}" style="--fighter-color:${escape(c.color)}" ${!c.ready || this.busy ? 'disabled' : ''} aria-pressed="${this.candidateId === c.id}" aria-label="Preview ${escape(c.name)} in 3D"><span class="fighter-card-tag">${c.form === 'empowered' ? 'AWAKENED' : this.current[this.seat]?.id === c.id ? 'PICKED' : '3D'}</span><img src="/assets/portraits3d/${escape(c.id)}.webp" alt="" loading="lazy"><strong>${escape(c.name)}</strong><small>${escape(c.role)}</small></button>`).join('');
    grid.querySelectorAll<HTMLButtonElement>('[data-fighter]').forEach(button => button.onclick = () => this.preview(button.dataset.fighter!));
  }
  info() {
    return { entries: this.entries.map(c => ({ id: c.id, ready: c.ready, form: c.form })), selected: this.current.map(c => c.id), busy: this.busy, open: this.isOpen, containers: this.cache.size,
      preview: { id: this.candidateId, ready: this.previewReady, bones: this.previewAvatar?.boneCount || 0, loading: !!this.previewTask, motion: this.previewAvatar?.motionInfo(),posture:this.previewAvatar?.postureInfo() },
      resources: { meshes: this.scene.meshes.length, materials: this.scene.materials.length, textures: this.scene.textures.length, skeletons: this.scene.skeletons.length, animationGroups: this.scene.animationGroups.length } };
  }
  dispose() { this.disposed = true; this.clearPreview(); for (const container of this.cache.values()) container.dispose(); this.cache.clear(); }
}
