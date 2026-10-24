import type { CombatEvent } from './combat.ts';

/** Small, original synthesized foley bank. No external media/autoplay dependency. */
export class GameAudio {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  volume = 0.35;
  private lastStep = [0, 0];
  private ambience: HTMLAudioElement | null = null;
  private ambienceId = '';
  private ambienceActive = false;
  setAmbience(id: string) {
    if (id === this.ambienceId) return;
    this.ambience?.pause(); this.ambience ||= new Audio();
    this.ambienceId = id; this.ambience.loop = true; this.ambience.preload = 'none';
    this.ambience.volume = .18; this.ambience.muted = this.muted;
    this.ambience.src = `/assets/stages/${id}/ambience.mp3`;
    if (this.ambienceActive && !this.muted) void this.ambience.play().catch(() => {});
  }
  updateAmbience(active: boolean) {
    if (active === this.ambienceActive) return;
    this.ambienceActive = active;
    if (!active) this.ambience?.pause();
    else if (this.ambience && !this.muted) void this.ambience.play().catch(() => {});
  }
  ambienceInfo() { return { id: this.ambienceId, active: this.ambienceActive, paused: this.ambience?.paused ?? true, ready: this.ambience?.readyState ?? 0, muted: this.muted }; }
  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12; limiter.ratio.value = 8;
      this.master.connect(limiter); limiter.connect(this.context.destination);
    }
    this.master!.gain.value = this.muted ? 0 : this.volume;
    void this.context.resume();
  }
  setMuted(muted: boolean) { this.muted = muted; if (this.ambience) { this.ambience.muted = muted; if (!muted && this.ambienceActive) void this.ambience.play().catch(() => {}); } if (this.master) this.master.gain.value = muted ? 0 : this.volume; }
  private tone(frequency: number, end: number, duration: number, volume: number, pan = 0, type: OscillatorType = 'sine', delay = 0) {
    const c = this.context; if (!c || c.state !== 'running' || this.muted) return;
    const start = c.currentTime + delay, osc = c.createOscillator(), gain = c.createGain(), stereo = c.createStereoPanner();
    osc.type = type; osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, end), start + duration);
    gain.gain.setValueAtTime(0.001, start); gain.gain.linearRampToValueAtTime(volume, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    stereo.pan.value = Math.max(-0.7, Math.min(0.7, pan));
    osc.connect(gain); gain.connect(stereo); stereo.connect(this.master!);
    osc.start(start); osc.stop(start + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); stereo.disconnect(); };
  }
  private noise(duration: number, volume: number, filter: number, pan = 0) {
    const c = this.context; if (!c || c.state !== 'running' || this.muted) return;
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate), channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = (Math.random() * 2 - 1) * Math.exp(-i / channel.length * 7);
    const src = c.createBufferSource(), gain = c.createGain(), low = c.createBiquadFilter(), stereo = c.createStereoPanner();
    src.buffer = buffer; low.type = 'lowpass'; low.frequency.value = filter; gain.gain.value = volume; stereo.pan.value = Math.max(-0.7, Math.min(0.7, pan));
    src.connect(low); low.connect(gain); gain.connect(stereo); stereo.connect(this.master!); src.start();
    src.onended = () => { src.disconnect(); gain.disconnect(); low.disconnect(); stereo.disconnect(); };
  }
  cue(e: CombatEvent) {
    const pan = e.x / 12;
    if (e.type === 'action') {
      if (e.kind === 'skill') { this.tone(320, 800, 0.17, 0.12, pan, 'triangle'); }
      else if (e.kind === 'stomp') { this.tone(160, 75, 0.25, 0.18, pan); }
      else { this.noise(0.1, 0.16, 2200, pan); this.tone(180, 85, 0.07, 0.08, pan); }
    }
    if (e.type === 'release' && e.kind === 'skill') { this.tone(900, 300, 0.21, 0.13, pan, 'triangle'); this.noise(0.12, 0.1, 4200, pan); }
    if (e.type === 'release' && e.kind === 'stomp') { this.noise(0.4, 0.35, 650, pan); this.tone(100, 28, 0.36, 0.6, pan); }
    if (e.type === 'hit') {
      this.tone(e.heavy ? 120 : 190, 32, e.heavy ? 0.24 : 0.12, e.heavy ? 0.65 : 0.4, pan);
      this.noise(0.14, 0.4, e.heavy ? 1700 : 2800, pan);
      this.tone(340 + Math.random() * 70, 170, 0.13, 0.08, pan, 'triangle');
    }
    if (e.type === 'land') { this.noise(0.12, 0.2, 500, pan); this.tone(75, 35, 0.1, 0.18, pan); }
    if (e.type === 'jump') this.noise(0.11, 0.13, 1600, pan);
    if (e.type === 'ko') { this.tone(180, 44, 0.6, 0.4, pan); this.tone(360, 110, 0.6, 0.1, pan, 'triangle', 0.08); }
    if (e.type === 'blocked') this.noise(0.1, 0.14, 3000, pan);
  }
  footstep(seat: number, traveled: number, speed: number, grounded: boolean, x: number) {
    if (speed < 0.8 || !grounded) return;
    const step = Math.floor(traveled / 0.65);
    if (step !== this.lastStep[seat]) { this.lastStep[seat] = step; this.noise(0.055, seat ? 0.035 : 0.08, 550, x / 12); }
  }
  suspend() { void this.context?.suspend(); }
  dispose() { this.ambience?.pause(); this.ambience?.removeAttribute('src'); this.ambience?.load(); void this.context?.close(); }
}
