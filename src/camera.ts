export type CameraMode = 'orbit' | 'follow';
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Continuous orbit angles keep dragging through 360° smooth, including across ±π. */
export class OrbitRig {
  yaw = -0.52;
  pitch = 0.24;
  zoom: number;
  targetYaw = this.yaw;
  targetPitch = this.pitch;
  targetZoom: number;
  mode: CameraMode = 'orbit';
  readonly initialZoom: number;

  constructor(portrait: boolean) {
    this.zoom = this.targetZoom = this.initialZoom = portrait ? 7.4 : 9.5;
  }
  drag(dx: number, dy: number) {
    this.mode = 'orbit';
    this.targetYaw -= dx * 0.0065;
    this.targetPitch = clamp(this.targetPitch + dy * 0.0045, -0.68, 1.3);
  }
  rotate(angle: number) { this.mode = 'orbit'; this.targetYaw += angle; }
  zoomBy(delta: number) { this.targetZoom = clamp(this.targetZoom + delta, 4, 20); }
  pinch(ratio: number) { this.targetZoom = clamp(this.targetZoom * ratio, 4, 20); }
  recenter(facingYaw: number) {
    this.targetYaw += angleDelta(this.targetYaw, facingYaw - 0.52);
    this.targetPitch = 0.24; this.targetZoom = this.initialZoom;
  }
  update(dt: number, facingYaw: number, rotateInput: number) {
    if (rotateInput) this.rotate(rotateInput * 1.45 * dt);
    if (this.mode === 'follow') this.targetYaw += angleDelta(this.targetYaw, facingYaw - 0.52) * (1 - Math.exp(-dt * 4));
    const angularBlend = 1 - Math.exp(-dt * 16);
    this.yaw += (this.targetYaw - this.yaw) * angularBlend;
    this.pitch += (this.targetPitch - this.pitch) * angularBlend;
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-dt * 12));
  }
  // Direct placement is only used by the deterministic scene inspection tools.
  place(yaw: number, pitch: number) {
    this.mode = 'orbit'; this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = clamp(pitch, -0.68, 1.3);
  }
  info() {
    return { mode: this.mode, yaw: this.yaw, pitch: this.pitch, zoom: this.zoom,
      targetYaw: this.targetYaw, targetPitch: this.targetPitch, targetZoom: this.targetZoom };
  }
}
