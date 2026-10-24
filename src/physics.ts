import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA, getStage, type StageDefinition, type StageId } from './stage.ts';
export { ARENA, OBSTACLES } from './stage.ts';

let initialization: Promise<void> | undefined;
export class ArenaPhysics {
  world: RAPIER.World;
  bodies: RAPIER.RigidBody[] = [];
  colliders: RAPIER.Collider[] = [];
  controller: RAPIER.KinematicCharacterController;
  stage: StageDefinition;
  private obstacleColliders: RAPIER.Collider[] = [];
  constructor(stageId: StageId = 'cwo-alley') {
    this.stage = getStage(stageId);
    this.world = new RAPIER.World({ x: 0, y: -22, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(16, 0.15, 14).setTranslation(0, -0.15, 0));
    for (const [x, z, w, d] of [
      [-ARENA.width / 2 - 0.2, 0, 0.2, ARENA.depth / 2 + 0.2], [ARENA.width / 2 + 0.2, 0, 0.2, ARENA.depth / 2 + 0.2],
      [0, -ARENA.depth / 2 - 0.2, ARENA.width / 2 + 0.4, 0.2], [0, ARENA.depth / 2 + 0.2, ARENA.width / 2 + 0.4, 0.2],
    ]) this.world.createCollider(RAPIER.ColliderDesc.cuboid(w, 2, d).setTranslation(x, 1, z));
    this.setStage(stageId);
    this.controller = this.world.createCharacterController(0.015);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    for (let i = 0; i < 2; i++) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(0, ARENA.centerHeight + 0.02, i ? 2 : -2));
      this.bodies.push(body);
      this.colliders.push(this.world.createCollider(RAPIER.ColliderDesc.capsule(0.49, ARENA.radius), body));
    }
    this.world.step();
  }
  static async create(stageId: StageId = 'cwo-alley') {
    initialization ??= RAPIER.init();
    await initialization;
    return new ArenaPhysics(stageId);
  }
  setStage(id: StageId) {
    const next = getStage(id);
    for (const collider of this.obstacleColliders) this.world.removeCollider(collider, true);
    this.obstacleColliders = next.obstacles.map(o => this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(o.w / 2, o.h / 2, o.d / 2).setTranslation(o.x, o.h / 2, o.z)));
    this.stage = next;
  }
  reset(seat: number, x: number, z: number) {
    const p = { x, y: ARENA.centerHeight + 0.02, z };
    this.bodies[seat].setTranslation(p, true);
    this.bodies[seat].setNextKinematicTranslation(p);
  }
  move(seat: number, x: number, y: number, z: number) {
    const collider = this.colliders[seat];
    this.controller.computeColliderMovement(collider, { x, y, z }, undefined, undefined,
      (c) => !this.colliders.some(other => other.handle === c.handle));
    const delta = this.controller.computedMovement();
    const p = this.bodies[seat].translation();
    this.bodies[seat].setNextKinematicTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z });
    return this.controller.computedGrounded();
  }
  step() { this.world.step(); }
  position(seat: number) {
    const p = this.bodies[seat].translation();
    return { x: p.x, y: Math.max(0, p.y - ARENA.centerHeight - 0.015), z: p.z };
  }
  blocked(x: number, z: number, radius = 0.12) {
    return Math.abs(x) > ARENA.width / 2 - radius || Math.abs(z) > ARENA.depth / 2 - radius || this.stage.obstacles.some(o =>
      Math.abs(x - o.x) < o.w / 2 + radius && Math.abs(z - o.z) < o.d / 2 + radius);
  }
  dispose() { this.world.free(); }
}
