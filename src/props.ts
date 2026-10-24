import {
  Color3, DynamicTexture, MeshBuilder, StandardMaterial, TransformNode, Vector3,
  type Scene, type ShadowGenerator,
} from './babylon.ts';
import { material } from './arena.ts';
import type { Actor } from './combat.ts';

/** Rigid props stay separate from the skinned body. Geometry is authored in grip space. */
export function createFighterProp(scene: Scene, shadows: ShadowGenerator, kind: string, seat: number, golden = false) {
  const root = new TransformNode(`${kind} prop ${seat}`, scene);
  const mats: StandardMaterial[] = [];
  const mat = (name: string, hex: string, glow = false) => {
    const m = material(scene, `${kind}/${seat}/${name}`, hex, glow); mats.push(m); return m;
  };
  const purple = mat('purple', '#7546a2'), dark = mat('dark', '#393244'), cream = mat('ivory', '#f6e6c1');
  const pink = mat('pink', '#dd6cb0'), cyan = mat('cyan', '#78cde6', true), gold = mat('gold', '#efba52');
  function box(name: string, x: number, y: number, z: number, w: number, h: number, d: number, m: StandardMaterial) {
    const mesh = MeshBuilder.CreateBox(name, { width:w, height:h, depth:d }, scene);
    mesh.position.set(x,y,z); mesh.parent = root; mesh.material = m; return mesh;
  }
  function ball(name: string, x: number, y: number, z: number, w: number, h: number, d: number, m: StandardMaterial) {
    const mesh = MeshBuilder.CreateSphere(name, { diameter:1, segments:7 }, scene);
    mesh.position.set(x,y,z); mesh.scaling.set(w,h,d); mesh.parent = root; mesh.material = m; return mesh;
  }
  function cylinder(name: string, x: number, y: number, z: number, h: number, diameter: number, m: StandardMaterial, top = diameter) {
    const mesh = MeshBuilder.CreateCylinder(name, { height:h, diameterTop:top, diameterBottom:diameter, tessellation:12 }, scene);
    mesh.position.set(x,y,z); mesh.parent = root; mesh.material = m; return mesh;
  }
  const green = mat('stems', '#6c9e57');
  const moving: TransformNode[] = [];
  const sparkles:TransformNode[]=[];
  if (kind === 'sign') {
    cylinder('sign pole',0,.12,0,1.8,.055,mat('metal','#847b86'));
    const rim = cylinder('sign rim',0,1.04,0,.045,.72,cream); rim.rotation.x = Math.PI/2;
    const tex = new DynamicTexture('Yot sign '+seat,{width:512,height:512},scene,false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle='#ec785f';ctx.beginPath();ctx.arc(256,256,235,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#34263f';ctx.lineWidth=14;ctx.stroke();
    ctx.fillStyle='#fff4dc';ctx.textAlign='center';ctx.font='900 68px sans-serif';ctx.fillText('NO',256,230);ctx.fillText('FARMERS',256,308);
    ctx.strokeStyle='#39283f';ctx.lineWidth=34;ctx.beginPath();ctx.moveTo(104,104);ctx.lineTo(408,408);ctx.stroke();tex.update();
    const m=mat('print','#ffffff');m.diffuseTexture=tex;tex.hasAlpha=true;
    const face=MeshBuilder.CreateDisc('sign print',{radius:.345,tessellation:32,sideOrientation:2},scene);
    face.parent=root;face.position.set(0,1.04,.027);face.material=m;root.scaling.setAll(.65);
  } else if (kind === 'megaphone') {
    cylinder('megaphone handle',0,-.08,0,.38,.09,purple);
    const cone=cylinder('megaphone cone',0,.15,.13,.48,.55,cream,.2);cone.rotation.x=Math.PI/2;
    const lip=cylinder('megaphone rim',0,.15,.39,.06,.58,gold);lip.rotation.x=Math.PI/2;
    const inner=cylinder('megaphone opening',0,.15,.425,.012,.45,dark);inner.rotation.x=Math.PI/2;
  } else if (kind === 'staff' || kind === 'brush' || kind === 'bonk') {
    cylinder('weapon shaft',0,.27,0,1.5,kind==='bonk'?.1:.055,kind==='brush'?gold:purple);
    if (kind==='staff') {
      const crystal=MeshBuilder.CreatePolyhedron('staff spirit crystal',{type:1,size:.25},scene);
      crystal.parent=root;crystal.position.y=1.16;crystal.scaling.y=1.4;crystal.material=cyan;
      cylinder('staff crystal collar',0,.98,0,.12,.22,gold);
    } else if (kind==='brush') {
      cylinder('brush ferrule',0,1.02,0,.24,.16,dark);
      ball('brush bristles',0,1.23,0,.27,.42,.25,pink);
      cylinder('wet ink tip',0,1.42,0,.12,.21,purple,.04);
    } else {
      box('foam bonk head',0,1.01,0,.72,.37,.35,cyan);
      box('bonk padded edge',-.39,1.01,0,.08,.42,.4,purple);
      box('bonk padded edge',.39,1.01,0,.08,.42,.4,purple);
    }
  } else if (kind === 'ribbon') {
    cylinder('ribbon wand',0,.1,0,.48,.045,purple);
    const path=Array.from({length:21},(_,i)=>new Vector3(Math.sin(i/20*Math.PI*2)*.26,.34+i*.045,Math.cos(i/20*Math.PI*2)*.16));
    const ribbon=MeshBuilder.CreateTube('patrol ribbon',{path,radius:.035,tessellation:6},scene);ribbon.parent=root;ribbon.material=pink;
    ball('ribbon bow',0,.35,0,.2,.15,.12,gold);
  } else if (kind === 'controller' || kind === 'keyboard') {
    box('device body',0,.15,.04,kind==='keyboard'?.95:.66,.3,.24,purple);
    if (kind==='controller') {
      box('controller screen',0,.2,.175,.25,.19,.02,cyan);
      for (const x of [-.23,.23]) ball('controller grip',x,.07,.04,.24,.22,.27,dark);
      for (const [x,m] of [[-.23,gold],[.23,pink]] as const) ball('controller button',x,.24,.18,.075,.075,.04,m);
    } else for(let row=0;row<3;row++) for(let col=0;col<9;col++)
      box('reply key',-.39+col*.097,.315,.12-row*.077,.077,.05,.057,(row+col)%3?cream:gold);
  } else if (kind === 'flowers') {
    for(let i=0;i<3;i++) {
      const x=(i-1)*.15,y=.51+(i%2)*.15;
      const stem=cylinder('flower stem',x,y/2,0,y,.025,green);stem.rotation.z=(i-1)*-.1;
      ball('flower center',x,y,.01,.09,.09,.08,gold);
      for(let p=0;p<5;p++) {const a=p/5*Math.PI*2;ball('flower petal',x+Math.sin(a)*.1,y+Math.cos(a)*.1,0,.13,.14,.055,i===1?cream:pink);}
    }
  } else if (kind === 'microphone') {
    cylinder('microphone handle',0,.13,0,.38,.075,dark);
    ball('microphone mesh head',0,.4,0,.19,.22,.19,mat('mic silver','#aeb3c1'));
    for(const y of [.34,.4,.45]) {const ring=MeshBuilder.CreateTorus('mic grille',{diameter:.182,thickness:.012,tessellation:12},scene);ring.parent=root;ring.position.y=y;ring.material=dark;}
  } else if (kind === 'bugs') {
    for(let i=0;i<3;i++) {
      const bug=new TransformNode('code bug '+i,scene);bug.parent=root;moving.push(bug);
      const body=ball('bug body',0,0,0,.12,.14,.17,gold);body.parent=bug;
      for(const side of [-1,1]) {const wing=ball('bug wing',side*.09,.05,0,.16,.035,.1,cream);wing.parent=bug;}
    }
  } else if (kind === 'mount') {
    const horse=mat('mount coat',golden?'#edbf61':'#c78745'),mane=mat('mount mane','#864b39');
    ball('toy horse body',0,.59,0,.83,.64,1.26,horse);
    ball('toy horse neck',0,.91,.6,.42,.78,.42,horse);
    ball('toy horse head',0,1.25,.76,.46,.5,.65,horse);
    ball('toy horse muzzle',0,1.1,1,.4,.28,.3,gold);
    for(const x of [-.17,.17]) {
      const ear=cylinder('horse ear',x,1.59,.63,.3,.12,horse,.025);ear.rotation.z=x*1.6;
      ball('horse eye',x*1.35,1.33,.86,.04,.09,.09,dark);
    }
    box('saddle',0,.94,-.08,.84,.11,.59,purple);
    box('saddle blanket',0,.9,-.08,.88,.14,.67,gold);
    for(const x of [-.29,.29]) for(const z of [-.45,.4]) {
      const leg=new TransformNode('mount leg',scene);leg.parent=root;leg.position.set(x,.48,z);moving.push(leg);
      const limb=cylinder('horse leg',0,-.23,0,.46,.12,horse);limb.parent=leg;
      const hoof=box('horse hoof',0,-.47,.035,.18,.14,.22,mane);hoof.parent=leg;
    }
    for(let i=0;i<5;i++) ball('horse mane',0,1.5-i*.12,.53-i*.02,.13,.16,.19,mane);
    const tail=ball('horse tail',0,.68,-.76,.16,.57,.18,mane);tail.rotation.x=-.5;
    root.scaling.setAll(.78);
    if(golden){
      const aura=mat('awakened aura','#ffd36c',true);aura.alpha=.65;
      const ring=MeshBuilder.CreateTorus('golden awakening ring',{diameter:1.85,thickness:.025,tessellation:32},scene);
      ring.parent=root;ring.position.y=.32;ring.material=aura;ring.metadata={noShadow:true};
      for(let i=0;i<6;i++){
        const mote=MeshBuilder.CreatePolyhedron('golden awakening sparkle',{type:1,size:.035},scene);
        mote.parent=root;mote.material=aura;mote.metadata={noShadow:true};sparkles.push(mote);
      }
    }
  }
  if(kind!=='sign'&&kind!=='mount') root.scaling.setAll(['staff','brush','bonk'].includes(kind)?.75:.9);
  for(const mesh of root.getChildMeshes()) {mesh.isPickable=false;if(!mesh.metadata?.noShadow)shadows.addShadowCaster(mesh);}
  return {
    root, kind,
    update(actor:Actor) {
      if(kind==='bugs') for(const [i,node] of moving.entries()) {
        const t=actor.traveled*2+actor.stateTime*2+i*Math.PI*2/3;
        node.position.set(Math.cos(t)*.28,.25+Math.sin(t*1.4)*.12,Math.sin(t)*.22);
      }
      if(kind==='mount') {
        const fallen=actor.state==='down'||actor.state==='ko';
        root.rotation.z=fallen?Math.min(1,actor.stateTime*3)*1.15:0;
        for(const [i,node] of moving.entries()) node.rotation.x=fallen?0:Math.sin(actor.traveled*4+i%2*Math.PI)*Math.min(.65,actor.speed*.13);
        for(const [i,node] of sparkles.entries()) {const t=actor.stateTime*.7+i*Math.PI/3;node.position.set(Math.sin(t)*.68,.8+(i%3)*.42,Math.cos(t)*.68);}
      }
    },
    dispose() {
      for(const mesh of root.getChildMeshes()) shadows.removeShadowCaster(mesh);
      root.dispose(); for(const m of mats) m.dispose(false,true);
    },
  };
}
