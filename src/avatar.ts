import {
  AnimationGroup, Color3, DynamicTexture, MeshBuilder, StandardMaterial, TransformNode, Vector3,
  type AssetContainer, type AbstractMesh, type Scene, type ShadowGenerator,
} from './babylon.ts';
import type { Actor } from './combat.ts';
import { material } from './arena.ts';
import { createFighterProp } from './props.ts';
import { correctReadyPosture } from './posture.ts';
import type { Material } from '@babylonjs/core/Materials/material';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Bone } from '@babylonjs/core/Bones/bone';

export interface FighterManifest { id?: string; characterId?: string; name?: string; prop?: string; form?: string; appearance?: string; model: string; height: number; clips: Record<string, string>; source: string; }
export class Avatar {
  root: TransformNode;
  tilt: TransformNode;
  meshes: AbstractMesh[] = [];
  groups = new Map<string, AnimationGroup>();
  ready = false;
  boneCount = 0;
  currentClip = '';
  motionInfo(){return {source:this.current?.name||'',targets:this.current?.targetedAnimations.length||0,from:this.current?.from||0,to:this.current?.to||0};}
  fighterId = 'yot';
  propKind = 'sign';
  private entries: ReturnType<AssetContainer['instantiateModelsToScene']> | null = null;
  private ownedMaterials = new Set<Material>();
  private ownedTextures = new Set<BaseTexture>();
  private fighterProp: ReturnType<typeof createFighterProp> | null = null;
  private current: AnimationGroup | null = null;
  private previous: AnimationGroup | null = null;
  private fade = 1;
  private posture:ReturnType<typeof correctReadyPosture>|null=null;
  postureInfo(includeGeometry=false){
    if(!this.entries||!this.posture)return null;
    const nodes=this.entries.rootNodes.flatMap(n=>n.getDescendants()) as TransformNode[];
    const point=(name:string)=>{const n=nodes.find(n=>n.name.replace(/^p\d+_/,'').toLowerCase()===name.toLowerCase());n?.computeWorldMatrix(true);return n?.getAbsolutePosition()||Vector3.Zero();};
    const gaze=point('headfront').subtract(point('Head')).normalize(),torso=point('neck').subtract(point('Hips'));
    const local=Vector3.TransformNormal(gaze,this.root.getWorldMatrix().clone().invert());
    let floor:number|null=null;
    if(includeGeometry){
      let min=Infinity;
      for(const mesh of this.meshes){mesh.computeWorldMatrix(true);mesh.skeleton?.prepare(true);const data=mesh.getPositionData(true,false);if(!data)continue;
        for(let i=0;i<data.length;i+=3){const p=Vector3.TransformCoordinates(new Vector3(data[i],data[i+1],data[i+2]),mesh.getWorldMatrix());min=Math.min(min,p.y);}}
      if(Number.isFinite(min))floor=min-this.root.position.y;
    }
    return {...this.posture,gazePitch:Math.atan2(gaze.y,Math.hypot(gaze.x,gaze.z))*180/Math.PI,gazeYaw:Math.atan2(local.x,local.z)*180/Math.PI,
      torsoLean:Math.atan2(Math.hypot(torso.x,torso.z),torso.y)*180/Math.PI,feet:[point('LeftFoot').asArray(),point('RightFoot').asArray()],floor};
  }
  private actionId = -1;
  private lastState = '';
  private sign: TransformNode;
  private handSocket: TransformNode | null = null;
  private handBone: Bone | null = null;
  private handMesh: AbstractMesh | null = null;
  private gripSamples:{position:number[];indices:number[];weights:number[]}[]=[];
  signInfo() { const prop=this.fighterProp?.root||this.sign;return { kind:this.propKind,enabled:prop.isEnabled(),parent:prop.parent?.name,position:prop.getAbsolutePosition().asArray() }; }
  private placeholder: AbstractMesh;
  private lastHp = 200;
  private flash = 0;
  private materials: { material: { emissiveColor: Color3 }; base: Color3 }[] = [];
  readonly marker: AbstractMesh;
  private shadow: AbstractMesh;

  constructor(private scene: Scene, readonly seat: number, private shadows: ShadowGenerator) {
    this.root = new TransformNode('actor-' + seat, scene);
    this.tilt = new TransformNode('actor-pose-' + seat, scene); this.tilt.parent = this.root;
    this.placeholder = MeshBuilder.CreateCapsule('loading fighter', { height: 1.7, radius: 0.35 }, scene);
    this.placeholder.position.y = 0.85; this.placeholder.parent = this.tilt;
    this.placeholder.material = material(scene, 'loading material ' + seat, seat ? '#ce927b' : '#8157bf');
    this.sign = this.makeSign(); this.sign.parent = this.tilt; this.sign.setEnabled(false);
    this.marker = MeshBuilder.CreateTorus('fighter ring ' + seat, { diameter: 1.5, thickness: 0.045, tessellation: 48 }, scene);
    this.marker.material = material(scene, 'marker material ' + seat, seat ? '#ed997c' : '#8b62ce', true);
    this.marker.position.y = 0.04; this.marker.isPickable = false;
    const shadowTexture = new DynamicTexture('contact shadow ' + seat, { width: 64, height: 64 }, scene, false);
    const sc = shadowTexture.getContext() as CanvasRenderingContext2D;
    const gradient = sc.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(55,37,65,0.28)'); gradient.addColorStop(1, 'rgba(55,37,65,0)');
    sc.fillStyle = gradient; sc.fillRect(0, 0, 64, 64); shadowTexture.update();
    const shadowMaterial = new StandardMaterial('contact shadow material ' + seat, scene);
    shadowMaterial.diffuseTexture = shadowTexture; shadowTexture.hasAlpha = true;
    shadowMaterial.useAlphaFromDiffuseTexture = true; shadowMaterial.disableLighting = true;
    shadowMaterial.emissiveColor = Color3.White(); shadowMaterial.specularColor = Color3.Black();
    this.shadow = MeshBuilder.CreateGround('contact shadow ' + seat, { width: 1.5, height: 1.2 }, scene);
    this.shadow.material = shadowMaterial; this.shadow.isPickable = false;
  }
  private makeSign() {
    const rig = new TransformNode('Yot sign ' + this.seat, this.scene);
    const pole = MeshBuilder.CreateCylinder('sign pole', { height: 1.8, diameter: 0.055, tessellation: 8 }, this.scene);
    pole.parent = rig; pole.position.y = 0.12;
    pole.material = material(this.scene, 'sign metal ' + this.seat, '#847b86');
    const edge = MeshBuilder.CreateCylinder('sign rim', { diameter: 0.72, height: 0.045, tessellation: 40 }, this.scene);
    edge.parent = rig; edge.rotation.x = Math.PI / 2; edge.position.y = 1.04;
    edge.material = material(this.scene, 'sign rim ivory ' + this.seat, '#fff6df');
    const texture = new DynamicTexture('Yot sign face ' + this.seat, { width: 512, height: 512 }, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D; ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = '#ec785f'; ctx.beginPath(); ctx.arc(256, 256, 235, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#34263f'; ctx.lineWidth = 14; ctx.stroke();
    ctx.fillStyle = '#fff4dc'; ctx.textAlign = 'center'; ctx.font = '900 68px sans-serif'; ctx.fillText('NO', 256, 230); ctx.fillText('FARMERS', 256, 308);
    ctx.strokeStyle = '#39283f'; ctx.lineWidth = 34; ctx.beginPath(); ctx.moveTo(104, 104); ctx.lineTo(408, 408); ctx.stroke(); texture.update();
    const face = MeshBuilder.CreateDisc('sign lettering ' + this.seat, { radius: 0.345, tessellation: 40, sideOrientation: 2 }, this.scene);
    face.parent = rig; face.position.set(0, 1.04, 0.027);
    const fm = new StandardMaterial('sign print ' + this.seat, this.scene); fm.diffuseTexture = texture;
    fm.diffuseTexture.hasAlpha = true; fm.specularColor = Color3.Black(); face.material = fm;
    for (const mesh of [pole, edge, face]) { mesh.isPickable = false; this.shadows.addShadowCaster(mesh); }
    rig.scaling.setAll(0.65); return rig;
  }
  attach(container: AssetContainer, manifest: FighterManifest) {
    this.detach();
    this.root.position.setAll(0);this.root.rotation.setAll(0);this.tilt.position.setAll(0);
    this.fighterId=manifest.id||'yot';this.propKind=manifest.prop||'sign';
    const entries = container.instantiateModelsToScene(name => `p${this.seat}_${name}`, true, { doNotInstantiate: true });
    this.entries=entries;
    for (const n of entries.rootNodes) { n.parent = this.tilt; n.setEnabled(true); }
    for (const g of entries.animationGroups) {
      g.stop(); g.enableBlending = false;
      const baseName = g.name.replace(/^p\d+_/, '');
      this.groups.set(baseName, g);
    }
    for (const [name, raw] of Object.entries(manifest.clips)) {
      const group = this.groups.get(raw) || [...this.groups.values()].find(g => g.name.endsWith(raw));
      if (group) this.groups.set(name, group);
    }
    this.boneCount = entries.skeletons.reduce((sum, s) => sum + s.bones.length, 0);
    this.meshes = entries.rootNodes.flatMap(n => n.getChildMeshes());
    const visual = entries.rootNodes[0];
    visual.computeWorldMatrix(true);
    const bounds = visual.getHierarchyBoundingVectors(true);
    const height = bounds.max.y - bounds.min.y;
    const scale = height > 0.001 ? manifest.height / height : 1;
    // The imported model's rest-space scale/offset are normalized independently of gameplay.
    for (const n of entries.rootNodes) (n as TransformNode).scaling.scaleInPlace(scale);
    this.tilt.position.y = -bounds.min.y * scale;
    for (const mesh of this.meshes) {
      mesh.isPickable = false; mesh.receiveShadows = true; this.shadows.addShadowCaster(mesh);
      if (mesh.material) {
        const m=mesh.material;this.ownedMaterials.add(m);
        for(const texture of m.getActiveTextures()) if(!container.textures.includes(texture)) this.ownedTextures.add(texture);
        if ('emissiveColor' in m) {
          const shaded=m as unknown as {emissiveColor:Color3;albedoColor?:Color3;diffuseColor?:Color3};
          if(manifest.appearance==='golden') {
            (shaded.albedoColor||shaded.diffuseColor)?.scaleInPlace(1.08);
            shaded.emissiveColor=Color3.FromHexString('#ffd77a').scale(.045);
          }
          this.materials.push({material:shaded,base:shaded.emissiveColor.clone()});
        }
      }
    }
    this.placeholder.setEnabled(false); this.ready = true;
    this.posture=correctReadyPosture(this.groups,this.tilt);
    this.choose('idle');
    if(this.propKind!=='sign') {
      this.fighterProp=createFighterProp(this.scene,this.shadows,this.propKind,this.seat,manifest.appearance==='golden');
      this.fighterProp.root.parent=this.root;
    }
    // Parent the rigid sign to the rig's hand socket rather than skinning it into the body.
    const handPattern=this.propKind==='sign'?/lefthand$|hand_l$|hand\.l$|hand_l_0$/i:/righthand$|hand_r$|hand\.r$|hand_r_0$/i;
    const hand = entries.skeletons.flatMap(s => s.bones).find(b => handPattern.test(b.name.replace(/[^\w.]/g, '')));
    const node = hand?.getTransformNode() || entries.rootNodes.flatMap(n => n.getDescendants()).find(n => /lefthand$/i.test(n.name)) as TransformNode | undefined;
    if (node && this.propKind!=='mount') {
      this.handSocket = node;
      this.handBone=hand||null;this.handMesh=this.meshes.find(m=>m.skeleton===hand?.getSkeleton())||null;
      if(hand&&this.handMesh){
        const mesh=this.handMesh,positions=mesh.getVerticesData('position'),indices=mesh.getVerticesData('matricesIndices'),weights=mesh.getVerticesData('matricesWeights');
        if(positions&&indices&&weights){
          const candidates:number[]=[],joint=hand.getIndex();
          for(let vertex=0;vertex<positions.length/3;vertex++)for(let n=0;n<4;n++)if(indices[vertex*4+n]===joint&&weights[vertex*4+n]>.4){candidates.push(vertex);break;}
          for(let n=0;n<Math.min(24,candidates.length);n++){
            const vertex=candidates[Math.floor(n*candidates.length/Math.min(24,candidates.length))];
            this.gripSamples.push({position:Array.from(positions.slice(vertex*3,vertex*3+3)),indices:Array.from(indices.slice(vertex*4,vertex*4+4)),weights:Array.from(weights.slice(vertex*4,vertex*4+4))});
          }
        }
      }
      const prop=this.fighterProp?.root||this.sign;
      prop.parent = this.root;
      // Follow the hand socket while the authored grip keeps the pole upright.
      // A hand's T-pose axes are not the prop's authored up direction.
      prop.position.set(0,0,0);prop.rotationQuaternion=null;prop.setEnabled(true);
    }
    this.reset();
  }
  private detach() {
    this.posture=null;
    this.current=null;this.previous=null;this.groups.clear();this.handSocket=null;this.handBone=null;this.handMesh=null;this.gripSamples=[];
    this.sign.setEnabled(false);this.fighterProp?.dispose();this.fighterProp=null;
    for(const mesh of this.meshes) this.shadows.removeShadowCaster(mesh);
    this.entries?.dispose();this.entries=null;this.meshes=[];
    for(const m of this.ownedMaterials) m.dispose(false,false);
    for(const t of this.ownedTextures) t.dispose();
    this.ownedMaterials.clear();this.ownedTextures.clear();this.materials=[];
    this.ready=false;this.boneCount=0;this.placeholder.setEnabled(true);
  }
  private choose(name: string, force = false) {
    const next = this.groups.get(name) || this.groups.get('idle');
    if (!next || (next === this.current && !force)) { this.currentClip = name; return; }
    if (this.previous && this.previous !== this.current) this.previous.stop();
    this.previous = this.current; this.current = next; this.fade = 0;
    next.start(true); next.pause(); next.weight = 0;
    this.currentClip = name;
  }
  update(actor: Actor, dt: number, locked: boolean) {
    this.root.position.set(actor.x, actor.y, actor.z); this.root.rotation.y = actor.yaw;
    this.marker.position.set(actor.x, 0.045, actor.z);
    this.shadow.position.set(actor.x, 0.027, actor.z);
    this.shadow.scaling.setAll(Math.max(0.55, 1 - actor.y * 0.12));
    this.marker.setEnabled(actor.hp > 0 && (this.seat === 0 || locked));
    if (actor.hp < this.lastHp) this.flash = 0.12;
    this.lastHp = actor.hp; this.flash = Math.max(0, this.flash - dt);
    if (!this.ready) return;
    let name: string = actor.state;
    if (actor.state === 'walk' || actor.state === 'run') {
      const forward = actor.vx * Math.sin(actor.yaw) + actor.vz * Math.cos(actor.yaw);
      const side = actor.vx * Math.cos(actor.yaw) - actor.vz * Math.sin(actor.yaw);
      name = Math.abs(side) > Math.abs(forward) ? side < 0 ? 'walk_left' : 'walk_right' : forward < 0 ? 'walk_back' : actor.state === 'run' ? 'run' : 'walk_forward';
    }
    const actionId = actor.action?.id ?? -1;
    const restart = actionId !== this.actionId && actionId !== -1;
    this.choose(name, restart);
    this.actionId = actionId; this.lastState = actor.state;
    this.fade = Math.min(1, this.fade + dt / (actor.state === 'hurt' ? 0.035 : 0.09));
    if (this.previous && this.previous !== this.current) { this.previous.weight = 1 - this.fade; if (this.fade === 1) { this.previous.stop(); this.previous = null; } }
    if (this.current) {
      this.current.weight = this.fade;
      const loop = ['idle', 'walk_forward', 'walk_back', 'walk_left', 'walk_right', 'run'].includes(name);
      const duration = actor.action ? ({ attack1: 0.4, attack2: 0.46, attack3: 0.63, skill: 0.6, stomp: 0.86, dodge: 0.28 }[actor.action.kind]) :
        actor.state === 'hurt' ? 0.29 : actor.state === 'getup' ? 0.58 : 0.8;
      const time = loop ? actor.traveled / (name === 'run' ? 2 : 1.6) : (actor.action?.time ?? actor.stateTime) / duration;
      let phase = loop ? name === 'idle' ? actor.stateTime / 2.5 % 1 : time % 1 : Math.min(0.999, time);
      if (name === 'walk_right') phase = 1 - phase;
      if (name === 'jump') phase = 0.24 + Math.min(0.15, actor.stateTime * 0.25);
      if (name === 'fall') phase = 0.6 + Math.min(0.18, actor.stateTime * 0.25);
      this.current.goToFrame(this.current.from + (this.current.to - this.current.from) * phase, true);
    }
    if (this.handSocket) {
      const prop=this.fighterProp?.root||this.sign;
      this.root.computeWorldMatrix(true); this.handSocket.computeWorldMatrix(true);
      let position=this.handSocket.getAbsolutePosition();
      if(this.handBone&&this.handMesh?.skeleton){
        this.handMesh.computeWorldMatrix(true);this.handMesh.skeleton.prepare(true);this.handMesh.skeleton.computeAbsoluteMatrices(true);
        position=this.handBone.getAbsolutePosition(this.handMesh);
        // Place the grip on the skinned mitten surface across different proportions,
        // using a few points and the same bone matrices as the renderer.
        if(this.gripSamples.length){
          const matrices=this.handMesh.skeleton.getTransformMatrices(this.handMesh),center=Vector3.Zero();
          for(const sample of this.gripSamples){
            const [x,y,z]=sample.position;
            for(let n=0;n<4;n++){
              const at=sample.indices[n]*16,w=sample.weights[n];
              center.x+=(matrices[at]*x+matrices[at+4]*y+matrices[at+8]*z+matrices[at+12])*w;
              center.y+=(matrices[at+1]*x+matrices[at+5]*y+matrices[at+9]*z+matrices[at+13])*w;
              center.z+=(matrices[at+2]*x+matrices[at+6]*y+matrices[at+10]*z+matrices[at+14])*w;
            }
          }
          center.scaleInPlace(1/this.gripSamples.length);position=Vector3.TransformCoordinates(center,this.handMesh.getWorldMatrix());
        }
      }
      prop.position.copyFrom(Vector3.TransformCoordinates(position, this.root.getWorldMatrix().clone().invert()));
      const grip=this.propKind==='sign'?.75:this.propKind==='staff'||this.propKind==='brush'?.12:0;
      prop.rotation.z = actor.action?.kind.startsWith('attack') ? grip - Math.sin((actor.action.time / 0.4) * Math.PI) * 0.7 : grip;
    }
    this.fighterProp?.update(actor);
    // Short directional pose overlay; physics remains the sole source of root displacement.
    const fall = actor.state === 'ko' || actor.state === 'down' ? Math.min(1, actor.stateTime / 0.55) : 0;
    this.tilt.rotation.z = actor.state === 'dodge' ? Math.sin((actor.action?.time ?? 0) / 0.28 * Math.PI) * -0.18 : 0;
    for (const {material,base} of this.materials) material.emissiveColor.copyFrom(this.flash>0?new Color3(.5,.5,.5):base);
    void fall;
  }
  reset() { this.actionId = -1; this.lastState = ''; this.lastHp = 200; this.flash = 0; this.choose('idle', true); }
  setVisible(visible: boolean) { this.root.setEnabled(visible); this.marker.setEnabled(visible); this.shadow.setEnabled(visible); }
  dispose() {
    this.detach(); this.root.dispose(false, true); this.marker.dispose(false, true); this.shadow.dispose(false, true);
  }
}
