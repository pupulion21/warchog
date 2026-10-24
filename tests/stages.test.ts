import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat } from '../src/combat.ts';
import { STAGES, ARENA } from '../src/stage.ts';

for(const stage of STAGES){
  test(`${stage.name}: shared prop footprints stop grounded movement and projectiles`,async()=>{
    const sim=await Combat.create(stage.id);
    try{
      assert.equal(sim.snapshot().stageId,stage.id);
      for(const prop of stage.obstacles){
        sim.reset();const direction=prop.z>=0?1:-1;
        const start=prop.z-direction*(prop.d/2+1.25);
        sim.teleport(0,prop.x,start);sim.teleport(1,0,0);
        for(let i=0;i<90;i++)sim.step({x:0,z:direction});
        const edge=(prop.z-sim.actors[0].z)*direction-prop.d/2;
        assert.ok(edge>=ARENA.radius-.055,`${prop.id} crossed its visible footprint: ${edge}`);
        assert.ok(sim.physics.blocked(prop.x,prop.z),`${prop.id} failed projectile blocking`);
        assert.ok(sim.actors[0].y<.15,`${prop.id} incorrectly lifted grounded movement`);
      }
    }finally{sim.dispose();}
  });
  test(`${stage.name}: central fighting lane and perimeter remain playable`,async()=>{
    const sim=await Combat.create(stage.id);
    try{
      sim.teleport(0,0,.5);for(let i=0;i<40;i++)sim.step({x:0,z:0,attack:i===0});assert.equal(sim.actors[1].hp,191);
      sim.reset();sim.teleport(0,9.3,0);sim.teleport(1,6,0);sim.forceHit(0,28,true);
      for(let i=0;i<84;i++)sim.step({x:0,z:0});
      assert.ok(sim.actors[0].x<=ARENA.width/2-ARENA.radius+.03);assert.ok(Number.isFinite(sim.actors[0].y));
    }finally{sim.dispose();}
  });
}
test('changing arenas replaces collision data, clears the bout and retains CPU settings',async()=>{
  const sim=await Combat.create();
  try{
    sim.mode='spar';sim.forceHit(0,20);sim.step({x:0,z:0,skill:true});
    sim.setStage('rayj-house');assert.equal(sim.mode,'spar');assert.equal(sim.actors[0].hp,200);assert.equal(sim.projectiles.length,0);
    assert.ok(sim.physics.blocked(0,6.65));sim.setStage('cwo-alley');assert.equal(sim.physics.blocked(0,6.65),false);
    sim.setStage('house-cup');assert.ok(sim.physics.blocked(0,7));sim.setStage('neon-street');assert.equal(sim.physics.blocked(0,7),false);
  }finally{sim.dispose();}
});
