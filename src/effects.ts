import { Color3, MeshBuilder, StandardMaterial, Vector3, type Mesh, type Scene } from './babylon.ts';
import type { CombatEvent, Projectile } from './combat.ts';

interface Burst { mesh: Mesh; life: number; total: number; velocity: Vector3; ring: boolean; }
export class Effects {
  private bursts: Burst[] = [];
  private projectiles = new Map<number, Mesh>();
  private mats: StandardMaterial[];
  shake = 0;
  constructor(private scene: Scene) {
    this.mats = ['#ffd89a', '#d6ed91', '#b490ef', '#f19a7b'].map((c, i) => {
      const m = new StandardMaterial('fx' + i, scene); m.diffuseColor = Color3.FromHexString(c);
      m.emissiveColor = Color3.FromHexString(c).scale(0.8); m.disableLighting = true; return m;
    });
  }
  event(e: CombatEvent, full = true) {
    if (e.type === 'hit' || e.type === 'blocked') {
      const count = full ? e.heavy ? 17 : 10 : 5;
      for (let i = 0; i < count && this.bursts.length < 120; i++) {
        const mesh = MeshBuilder.CreateBox('impact spark', { size: 0.08 + (i % 3) * 0.028 }, this.scene);
        mesh.material = this.mats[i % 3]; mesh.position.set(e.x, e.y, e.z); mesh.isPickable = false;
        const angle = i / count * Math.PI * 2;
        this.bursts.push({ mesh, life: 0.23 + (i % 3) * 0.08, total: 0.4,
          velocity: new Vector3(Math.cos(angle) * 3.3, 1 + Math.sin(angle) * 2.6, Math.sin(angle * 2) * 2.4), ring: false });
      }
      this.shake = Math.max(this.shake, e.heavy ? 0.24 : 0.11);
    }
    if (e.type === 'release' && e.kind === 'stomp') this.ring(e.x, 0.05, e.z, 6.2, 0.4);
    if (e.type === 'land') this.ring(e.x, 0.035, e.z, 1.4, 0.26);
    if (e.type === 'action' && e.kind?.startsWith('attack')) this.ring(e.x, e.y, e.z, 1.4, 0.16, true);
  }
  private ring(x: number, y: number, z: number, diameter: number, life: number, vertical = false) {
    if (this.bursts.length >= 120) return;
    const mesh = MeshBuilder.CreateTorus('impact ring', { diameter, thickness: vertical ? 0.035 : 0.06, tessellation: 40 }, this.scene);
    mesh.position.set(x, y, z); mesh.material = this.mats[vertical ? 0 : 1]; mesh.isPickable = false;
    if (vertical) mesh.rotation.x = Math.PI / 2;
    this.bursts.push({ mesh, life, total: life, velocity: Vector3.Zero(), ring: true });
  }
  update(dt: number, projectiles: Projectile[]) {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]; b.life -= dt;
      if (b.life <= 0) { b.mesh.dispose(); this.bursts.splice(i, 1); continue; }
      const k = b.life / b.total;
      if (b.ring) { b.mesh.scaling.setAll(1 - k * 0.65); b.mesh.scaling.y *= 0.4; }
      else { b.velocity.y -= dt * 7; b.mesh.position.addInPlace(b.velocity.scale(dt)); b.mesh.rotation.addInPlace(new Vector3(dt * 4, dt * 7, dt * 2)); b.mesh.scaling.setAll(k); }
    }
    const live = new Set(projectiles.map(p => p.id));
    for (const [id, mesh] of this.projectiles) if (!live.has(id)) { mesh.dispose(); this.projectiles.delete(id); }
    for (const p of projectiles) {
      let mesh = this.projectiles.get(p.id);
      if (!mesh) {
        mesh = MeshBuilder.CreatePolyhedron('partner ping', { type: 1, size: 0.22 }, this.scene);
        mesh.material = this.mats[p.owner ? 3 : 1]; mesh.isPickable = false; this.projectiles.set(p.id, mesh);
      }
      mesh.position.set(p.x, p.y, p.z); mesh.rotation.y += dt * 8; mesh.rotation.z += dt * 5;
    }
  }
  reset() {
    for (const b of this.bursts) b.mesh.dispose(); this.bursts = [];
    for (const p of this.projectiles.values()) p.dispose(); this.projectiles.clear(); this.shake = 0;
  }
  get activeCount() { return this.bursts.length + this.projectiles.size; }
}
