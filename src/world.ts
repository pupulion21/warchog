import { Color3, Color4, type AbstractMesh, type Scene, type ShadowGenerator } from './babylon.ts';
import { createArena } from './arena.ts';
import { buildWorld } from './world-builders.ts';
import { createEnvironment } from './environment.ts';
import { Ray, Vector3 } from './babylon.ts';
import { getStage, type StageId, type StageDefinition } from './stage.ts';

type Runtime = ReturnType<typeof createArena> | ReturnType<typeof buildWorld>;
function snapshot(scene:Scene){return {meshes:new Set(scene.meshes),materials:new Set(scene.materials),textures:new Set(scene.textures),nodes:new Set(scene.transformNodes)};}
function capture(scene:Scene,before:ReturnType<typeof snapshot>,shadows:ShadowGenerator){
  const meshes=scene.meshes.filter(m=>!before.meshes.has(m)),materials=scene.materials.filter(m=>!before.materials.has(m)),textures=scene.textures.filter(t=>!before.textures.has(t)),nodes=scene.transformNodes.filter(n=>!before.nodes.has(n));
  let disposed=false;
  return {meshes,materials,textures,
    enable:(enabled:boolean)=>{for(const mesh of meshes)mesh.setEnabled(enabled);},
    dispose:()=>{if(disposed)return;disposed=true;for(const mesh of meshes){shadows.removeShadowCaster(mesh);mesh.dispose(false,false);}for(const node of nodes)node.dispose(true);for(const mat of materials)mat.dispose(false,false);for(const texture of textures)texture.dispose();},
  };
}

/** One active arena. New geometry loads offscreen; failure preserves the previous arena. */
export class ArenaWorld {
  stage:StageDefinition=getStage('cwo-alley');
  busy=false;
  readonly ready:Promise<unknown>;
  private active:ReturnType<ArenaWorld['build']>;
  private pending:ReturnType<ArenaWorld['build']>|null=null;
  private disposed=false;
  constructor(private scene:Scene,private shadows:ShadowGenerator,private theme:(stage:StageDefinition)=>void){
    this.active=this.build(this.stage);this.ready=this.active.runtime.ready;this.applyTheme();
  }
  private build(stage:StageDefinition){
    const before=snapshot(this.scene);let runtime:Runtime;
    try{runtime=stage.id==='cwo-alley'?createArena(this.scene,this.shadows):buildWorld(this.scene,this.shadows,stage);}
    catch(error){capture(this.scene,before,this.shadows).dispose();throw error;}
    let environment:ReturnType<typeof createEnvironment>;
    try{environment=createEnvironment(this.scene,stage);}catch(error){capture(this.scene,before,this.shadows).dispose();throw error;}
    return {runtime,environment,owned:capture(this.scene,before,this.shadows)};
  }
  private applyTheme(){this.scene.clearColor=Color4.FromHexString(this.stage.sky+'ff');this.scene.fogColor=Color3.FromHexString(this.stage.fog);this.theme(this.stage);}
  get cameraOccluders(){return this.active.runtime.cameraOccluders;}
  updateCamera=(position:Parameters<Runtime['updateCamera']>[0],dt:number)=>{this.active.runtime.updateCamera(position,dt);this.active.environment.updateCamera(position,dt);};
  async select(id:StageId){
    const next=getStage(id);if(this.disposed)throw new Error('The arena has closed.');
    if(this.busy)throw new Error('An arena is already loading.');
    if(next.id===this.stage.id){await this.active.runtime.ready;return;}
    this.busy=true;
    try{
      const candidate=this.build(next);this.pending=candidate;candidate.owned.enable(false);
      await candidate.runtime.ready;
      if(this.disposed){candidate.owned.dispose();return;}
      const old=this.active;this.active=candidate;this.pending=null;this.stage=next;candidate.owned.enable(true);this.applyTheme();old.owned.dispose();
    }catch(error){this.pending?.owned.dispose();this.pending=null;throw error;}
    finally{this.busy=false;}
  }
  info(){
    const owned=this.active.owned,venue=this.active.runtime.info(),environment=this.active.environment.info();
    return {...this.stage,...venue,features:this.stage.features,busy:this.busy,environment,
      venueBatches:venue.staticBatches,staticBatches:venue.staticBatches+environment.meshes,texturesReady:owned.textures.every(t=>t.isReady()),
      geometry:{meshes:owned.meshes.length,materials:owned.materials.length,textures:owned.textures.length,
        triangles:owned.meshes.reduce((sum,mesh)=>sum+Math.floor(mesh.getTotalIndices()/3),0)},
      resources:{meshes:this.scene.meshes.length,materials:this.scene.materials.length,textures:this.scene.textures.length},
    };
  }
  coverage(origin:number[],directions:number[][]){
    const owned=new Set(this.active.owned.meshes);
    return directions.map(direction=>{
      const ray=new Ray(Vector3.FromArray(origin),Vector3.FromArray(direction).normalize(),440);
      const hit=this.scene.pickWithRay(ray,mesh=>owned.has(mesh)&&mesh.isEnabled()&&mesh.isVisible&&mesh.visibility>.02);
      return {hit:!!hit?.hit,name:hit?.pickedMesh?.name||'',role:hit?.pickedMesh?.metadata?.environmentRole||'venue',group:hit?.pickedMesh?.renderingGroupId??null,distance:hit?.distance??null};
    });
  }
  dispose(){this.disposed=true;this.pending?.owned.dispose();this.pending=null;this.active.owned.dispose();}
}
