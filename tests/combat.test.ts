import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, neutralInput, type InputFrame } from '../src/combat.ts';
import { ARENA, OBSTACLES } from '../src/stage.ts';

async function setup() { return Combat.create(); }
function advance(sim: Combat, seconds: number, input: InputFrame = neutralInput()) {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(i ? { ...input, attack: false, skill: false, stomp: false, dodge: false, jump: false } : input);
}

test('movement uses both arena axes and cannot pass perimeter walls', async () => {
  const sim = await setup();
  try {
    advance(sim, 6, { x: 1, z: -1 });
    assert.ok(sim.actors[0].x > 5 && sim.actors[0].z < -5);
    assert.ok(sim.actors[0].x < 9.8 && sim.actors[0].z > -8.3);
    assert.ok(sim.actors[0].y < 0.1);
  } finally { sim.dispose(); }
});

test('diagonal movement is normalized', async () => {
  const a = await setup(), b = await setup();
  try {
    a.teleport(0, -4, -5); b.teleport(0, -4, -5);
    advance(a, 0.8, { x: 1, z: 0 }); advance(b, 0.8, { x: 1, z: 1 });
    const d1 = Math.hypot(a.actors[0].x + 4, a.actors[0].z + 5);
    const d2 = Math.hypot(b.actors[0].x + 4, b.actors[0].z + 5);
    assert.ok(Math.abs(d1 - d2) < 0.1, `${d1} / ${d2}`);
  } finally { a.dispose(); b.dispose(); }
});

test('a melee action damages once at contact, and a distant whiff causes no damage', async () => {
  const sim = await setup();
  try {
    advance(sim, 0.8, { x: 0, z: 0, attack: true });
    assert.equal(sim.actors[1].hp, 200);
    sim.reset(); sim.teleport(0, 0, 0.4);
    advance(sim, 0.8, { x: 0, z: 0, attack: true });
    assert.equal(sim.actors[1].hp, 191);
    assert.equal(sim.hits, 1);
  } finally { sim.dispose(); }
});

test('projectile release, cooldown and impact are independent', async () => {
  const sim = await setup();
  try {
    sim.step({ x: 0, z: 0, skill: true });
    assert.equal(sim.actors[1].hp, 200);
    advance(sim, 0.7);
    assert.equal(sim.actors[1].hp, 182);
    assert.equal(sim.hits, 1);
    const cooldown = sim.actors[0].skillCooldown;
    sim.step({ x: 0, z: 0, skill: true });
    assert.ok(sim.actors[0].skillCooldown <= cooldown);
    advance(sim, 0.4);
    assert.equal(sim.hits, 1);
  } finally { sim.dispose(); }
});

test('hit interrupts a cast before its projectile releases', async () => {
  const sim = await setup();
  try {
    sim.step({ x: 0, z: 0, skill: true });
    assert.equal(sim.forceHit(0, 10), true);
    advance(sim, 1);
    assert.equal(sim.projectiles.length, 0);
    assert.equal(sim.actors[1].hp, 200);
    assert.equal(sim.actors[0].hp, 190);
  } finally { sim.dispose(); }
});

test('living knockdown recovers; KO never gets up until reset', async () => {
  const sim = await setup();
  try {
    sim.forceHit(0, 12, true); assert.equal(sim.actors[0].state, 'down');
    advance(sim, 2); assert.equal(sim.actors[0].state, 'idle'); assert.equal(sim.actors[0].hp, 188);
    sim.forceHit(0, 200, true); advance(sim, 4);
    assert.equal(sim.actors[0].state, 'ko'); assert.equal(sim.actors[0].hp, 0);
    sim.reset(); assert.equal(sim.actors[0].hp, 200); assert.equal(sim.actors[0].state, 'idle');
  } finally { sim.dispose(); }
});

test('dodge has a bounded invulnerability window', async () => {
  const sim = await setup();
  try {
    sim.step({ x: 0, z: 0, dodge: true });
    assert.equal(sim.forceHit(0), false);
    advance(sim, 0.4);
    assert.equal(sim.forceHit(0), true);
  } finally { sim.dispose(); }
});

test('knockback moves away from the hit source in world space', async () => {
  const sim = await setup();
  try {
    sim.teleport(0, 2, 0); sim.teleport(1, 0, 0);
    sim.forceHit(0); advance(sim, 0.2);
    assert.ok(sim.actors[0].x > 2.1);
    assert.ok(Math.abs(sim.actors[0].z) < 0.1);
  } finally { sim.dispose(); }
});

test('fight-back dummy approaches and deals damage using the same combat rules', async () => {
  const sim = await setup();
  try {
    sim.mode = 'spar'; advance(sim, 6);
    assert.ok(sim.actors[0].hp < 200);
    assert.equal(sim.actors[1].hp, 200);
  } finally { sim.dispose(); }
});

test('reset clears action, projectiles, hitstop, buffers and damage counters', async () => {
  const sim = await setup();
  try {
    advance(sim, 0.3, { x: 0, z: 0, skill: true }); assert.ok(sim.projectiles.length > 0);
    sim.reset();
    assert.equal(sim.projectiles.length, 0); assert.equal(sim.hits, 0); assert.equal(sim.totalDamage, 0);
    assert.equal(sim.hitstop, 0); assert.equal(sim.actors[0].action, null); assert.equal(sim.actors[0].buffer, null);
    assert.equal(sim.actors[0].skillCooldown, 0);
  } finally { sim.dispose(); }
});

test('repeated fixed inputs produce the same simulation state', async () => {
  const a = await setup(), b = await setup();
  try {
    a.mode = b.mode = 'spar';
    for (let i = 0; i < 420; i++) {
      const input = { x: i < 60 ? 0.3 : 0, z: i < 50 ? 1 : 0,
        attack: i % 70 === 0, skill: i % 200 === 40, stomp: i === 280 };
      a.step(input); b.step(input);
    }
    assert.deepEqual(a.snapshot(), b.snapshot());
  } finally { a.dispose(); b.dispose(); }
});

test('alley planters, bins and crates stop grounded movement at their visible footprints', async () => {
  const sim = await setup();
  try {
    for (const prop of OBSTACLES.filter(o => ['planter', 'bins', 'crates'].includes(o.kind))) {
      sim.reset();
      const direction = prop.z > 0 ? 1 : -1;
      sim.teleport(0, prop.x, prop.z - direction * (prop.d / 2 + 1.4));
      advance(sim, 1.5, { x: 0, z: direction });
      const remaining = (prop.z - sim.actors[0].z) * direction - prop.d / 2;
      assert.ok(remaining >= ARENA.radius - 0.05, `${prop.id}: body crossed the prop`);
      assert.ok(remaining < 0.5, `${prop.id}: collider does not match the visible edge`);
      assert.ok(sim.actors[0].y < 0.1);
    }
  } finally { sim.dispose(); }
});

test('an alley crate blocks a projectile before it can hit the fighter behind it', async () => {
  const sim = await setup();
  try {
    const crate = OBSTACLES.find(o => o.kind === 'crates')!;
    sim.teleport(0, crate.x, crate.z - 2.2);
    sim.teleport(1, crate.x, crate.z + 2.2);
    advance(sim, 1, { x: 0, z: 0, skill: true });
    assert.equal(sim.actors[1].hp, 200);
    assert.equal(sim.projectiles.length, 0);
    assert.ok(sim.drainEvents().some(e => e.type === 'blocked'));
  } finally { sim.dispose(); }
});

test('knockdown against the alley perimeter stays in the arena', async () => {
  const sim = await setup();
  try {
    sim.teleport(0, 9.3, 0); sim.teleport(1, 6, 0);
    sim.forceHit(0, 28, true); advance(sim, 1.4);
    assert.ok(sim.actors[0].x <= ARENA.width / 2 - ARENA.radius + 0.02);
    assert.ok(sim.actors[0].x > 9.3);
    assert.ok(Number.isFinite(sim.actors[0].y));
  } finally { sim.dispose(); }
});
