import { Color3, DynamicTexture, Mesh, MeshBuilder, Quaternion, StandardMaterial, Texture, TransformNode, Vector3,
  type Scene, type ShadowGenerator } from './babylon.ts';
import { material } from './arena.ts';
import { ARENA, type StageDefinition } from './stage.ts';

type Zone = 'fixed' | 'back' | 'front' | 'left' | 'right' | 'ceiling';
const zones: Zone[] = ['back','front','left','right','ceiling'];
const smooth = (a: number,b: number,x: number) => {const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Small batched geometry vocabulary. Coordinates are shared with stage collision data. */
class SetBuilder {
  pending: Promise<void>[]=[];
  textures: Texture[]=[];
  cameraOccluders: Mesh[]=[];
  batches=new Map<string,{meshes:Mesh[];zone:Zone;cast:boolean}>();
  walls=new Map<Zone,Mesh[]>();
  cutaway: Record<string,number>={back:1,front:1,left:1,right:1,ceiling:1};
  dynamic: ((time:number)=>void)[]=[];
  private time=0;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  constructor(readonly scene:Scene,readonly shadows:ShadowGenerator,readonly stage:StageDefinition){for(const zone of zones)this.walls.set(zone,[]);}
  color(name:string,hex:string,glow=false){return material(this.scene,this.stage.id+' / '+name,hex,glow);}
  add(mesh:Mesh,mat:StandardMaterial,zone:Zone='fixed',cast=true,dynamic=false){
    mesh.material=mat;mesh.isPickable=false;mesh.receiveShadows=!mat.disableLighting;
    if(dynamic){if(zone!=='fixed')this.walls.get(zone)!.push(mesh);if(cast)this.shadows.addShadowCaster(mesh);}
    else{const key=zone+'/'+mat.uniqueId+'/'+cast;if(!this.batches.has(key))this.batches.set(key,{meshes:[],zone,cast});this.batches.get(key)!.meshes.push(mesh);}
    return mesh;
  }
  box(name:string,x:number,y:number,z:number,w:number,h:number,d:number,mat:StandardMaterial,zone:Zone='fixed',cast=true){
    const mesh=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},this.scene);mesh.position.set(x,y,z);return this.add(mesh,mat,zone,cast);
  }
  blob(name:string,x:number,y:number,z:number,w:number,h:number,d:number,mat:StandardMaterial,zone:Zone='fixed',segments=10){
    const mesh=MeshBuilder.CreateSphere(name,{diameter:1,segments},this.scene);mesh.position.set(x,y,z);mesh.scaling.set(w,h,d);return this.add(mesh,mat,zone);
  }
  cyl(name:string,x:number,y:number,z:number,diameter:number,height:number,mat:StandardMaterial,zone:Zone='fixed',top=diameter){
    const mesh=MeshBuilder.CreateCylinder(name,{diameterTop:top,diameterBottom:diameter,height,tessellation:16},this.scene);mesh.position.set(x,y,z);return this.add(mesh,mat,zone);
  }
  rod(name:string,a:number[],b:number[],radius:number,mat:StandardMaterial,zone:Zone='fixed'){
    const from=Vector3.FromArray(a),to=Vector3.FromArray(b),delta=to.subtract(from);
    const mesh=MeshBuilder.CreateCylinder(name,{height:delta.length(),diameter:radius*2,tessellation:6},this.scene);mesh.position.copyFrom(from.add(to).scale(.5));mesh.rotationQuaternion=Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(),delta.normalize(),mesh.rotationQuaternion);return this.add(mesh,mat,zone);
  }
  tube(name:string,points:number[][],radius:number,mat:StandardMaterial,zone:Zone='fixed'){
    return this.add(MeshBuilder.CreateTube(name,{path:points.map(p=>Vector3.FromArray(p)),radius,tessellation:6,cap:Mesh.CAP_ALL},this.scene),mat,zone);
  }
  torus(name:string,x:number,y:number,z:number,diameter:number,thickness:number,mat:StandardMaterial,zone:Zone='fixed',vertical=false){
    const mesh=MeshBuilder.CreateTorus(name,{diameter,thickness,tessellation:40},this.scene);mesh.position.set(x,y,z);if(vertical)mesh.rotation.x=Math.PI/2;return this.add(mesh,mat,zone);
  }
  plane(name:string,x:number,y:number,z:number,w:number,h:number,mat:StandardMaterial,zone:Zone='fixed',yaw=0){
    const mesh=MeshBuilder.CreatePlane(name,{width:w,height:h,sideOrientation:Mesh.DOUBLESIDE},this.scene);mesh.position.set(x,y,z);mesh.rotation.y=yaw;return this.add(mesh,mat,zone,false);
  }
  painted(name:string,draw:(ctx:CanvasRenderingContext2D)=>void,size=256){
    const tex=new DynamicTexture(this.stage.id+' / '+name,{width:size,height:size},this.scene,false);tex.hasAlpha=true;
    const ctx=tex.getContext() as CanvasRenderingContext2D;ctx.clearRect(0,0,size,size);draw(ctx);tex.update();this.textures.push(tex);
    const mat=this.color(name,'#ffffff');mat.diffuseTexture=tex;mat.useAlphaFromDiffuseTexture=true;mat.backFaceCulling=false;return mat;
  }
  texture(name:string,file:string,u=1,v=1,glow=false){
    let loaded!:()=>void,failed!:(error:Error)=>void;
    this.pending.push(new Promise<void>((resolve,reject)=>{loaded=resolve;failed=reject;}));
    const tex=new Texture(`/assets/stages/${this.stage.id}/${file}.webp`,this.scene,false,true,Texture.TRILINEAR_SAMPLINGMODE,loaded,()=>failed(new Error(`Could not load ${this.stage.name}: ${file}`)));
    tex.uScale=u;tex.vScale=v;tex.anisotropicFilteringLevel=4;this.textures.push(tex);
    const mat=this.color(name,'#ffffff');mat.diffuseTexture=tex;if(glow){mat.emissiveTexture=tex;mat.emissiveColor.set(.6,.6,.6);}return mat;
  }
  logo(name:string,background:string,fill:string,text=''){
    return this.painted(name,ctx=>{
      ctx.fillStyle=background;ctx.fillRect(0,0,256,256);ctx.fillStyle=fill;ctx.beginPath();
      for(let i=0;i<28;i++){const angle=i*Math.PI/14-Math.PI/2,r=i%2?64:84;const x=128+Math.cos(angle)*r,y=108+Math.sin(angle)*r;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.closePath();ctx.fill();
      ctx.fillStyle=background;for(const x of [103,151]){ctx.beginPath();ctx.ellipse(x,108,8,13,0,0,Math.PI*2);ctx.fill();}
      if(text){ctx.fillStyle=fill;ctx.font='900 42px sans-serif';ctx.textAlign='center';ctx.fillText(text,128,229);}
    });
  }
  floor(kind:'wood'|'tiles'|'street'|'plaza'){
    const size=512,mat=this.painted('ground '+kind,ctx=>{
      const colors=kind==='wood'?['#b7784b','#c88a59','#be8053','#ad7047']:kind==='tiles'?['#bb925e','#cda870','#d3b47e','#c59e67']:kind==='street'?['#48405b','#554665','#51415f','#5f4a6b']:['#837398','#917ca5','#a28cb4','#9582a9'];
      ctx.fillStyle=colors[0];ctx.fillRect(0,0,size,size);
      const height=kind==='wood'?48:128,width=kind==='wood'?256:128;
      for(let row=0;row<size/height;row++)for(let col=-1;col<size/width+1;col++){
        const x=col*width+(row%2?width/2:0);ctx.fillStyle=colors[(row*3+col+12)%colors.length];ctx.fillRect(x+1,row*height+1,width-2,height-2);
        ctx.fillStyle='#fff2';ctx.fillRect(x+3,row*height+2,width-6,1);
        if(kind==='wood'){ctx.strokeStyle='#643b2522';ctx.lineWidth=1;for(let n=0;n<4;n++){ctx.beginPath();ctx.moveTo(x+8,row*height+8+n*9);ctx.lineTo(x+width-15,row*height+10+n*9);ctx.stroke();}}
      }
    },size);const tex=mat.diffuseTexture as Texture;tex.wrapU=tex.wrapV=Texture.WRAP_ADDRESSMODE;tex.uScale=4;tex.vScale=3.4;
    mat.specularColor=Color3.FromHexString(kind==='street'?'#b086dc':kind==='tiles'?'#dec396':'#765e7f');mat.specularPower=kind==='street'?72:48;
    const ground=MeshBuilder.CreateGround(this.stage.name+' floor',{width:ARENA.width,height:ARENA.depth},this.scene);this.add(ground,mat,'fixed',false);
    const outside=this.color('outside foundation',kind==='street'?'#2b2742':kind==='wood'?'#927480':'#645577');
    this.box('foundation',0,-.27,0,kind==='street'?20:20.6,.5,kind==='street'?17:17.6,outside,'fixed',false);return ground;
  }
  plant(x:number,z:number,scale:number,zone:Zone='fixed'){
    const pot=this.color('pot '+x+' '+z,'#ab7a68'),leaf=this.color('leaves '+x+' '+z,'#7b9b62'),stem=this.color('stems '+x+' '+z,'#5c704d');
    this.cyl('plant pot',x,.32*scale,z,.85*scale,.64*scale,pot,zone,1.05*scale);
    for(let n=0;n<5;n++){const a=n*2.4;this.rod('plant stem',[x,.55*scale,z],[x+Math.sin(a)*.38*scale,(1.3+n*.12)*scale,z+Math.cos(a)*.3*scale],.025*scale,stem,zone);const mesh=this.blob('broad leaf',x+Math.sin(a)*.42*scale,(1.2+n*.12)*scale,z+Math.cos(a)*.32*scale,.6*scale,.13*scale,.38*scale,leaf,zone,6);mesh.rotation.z=Math.sin(a)*.35;}
  }
  bunting(from:number[],to:number[],mat:StandardMaterial,zone:Zone='back',count=12){
    const string=this.color('bunting cord '+this.batches.size,'#745f81');const a=Vector3.FromArray(from),b=Vector3.FromArray(to),points=[];
    for(let i=0;i<=count;i++){const t=i/count,p=Vector3.Lerp(a,b,t);p.y-=Math.sin(t*Math.PI)*.45;points.push(p.asArray());if(i<count){const flag=this.plane('pennant',p.x,p.y-.16,p.z,.28,.42,mat,zone);flag.rotation.z=.14*Math.sin(i);}}
    this.tube('bunting string',points,.014,string,zone);
  }
  finish(ground:Mesh){
    for(const batch of this.batches.values()){
      const mesh=batch.meshes.length===1?batch.meshes[0]:Mesh.MergeMeshes(batch.meshes,true,true)!;
      mesh.name=this.stage.name+' / batch '+batch.zone+' / '+mesh.material?.name;mesh.isPickable=false;mesh.receiveShadows=true;mesh.freezeWorldMatrix();
      if(batch.cast)this.shadows.addShadowCaster(mesh);if(batch.zone!=='fixed')this.walls.get(batch.zone)!.push(mesh);
    }
    for(const o of this.stage.obstacles){
      const hull=MeshBuilder.CreateBox('camera hull / '+o.id,{width:o.w,height:o.h,depth:o.d},this.scene);hull.position.set(o.x,o.h/2,o.z);hull.visibility=0;hull.isPickable=true;this.cameraOccluders.push(hull);
    }
    return {ground,cameraOccluders:this.cameraOccluders,ready:Promise.all(this.pending),updateCamera:(position:Vector3,dt:number)=>{
      const target:Record<string,number>={back:1-smooth(7.45,8.7,position.z),front:1-smooth(7.1,8.5,-position.z),left:1-smooth(8.7,10,position.x),right:1-smooth(8.7,10,-position.x),ceiling:1-smooth(6.1,7.4,position.y)};
      for(const zone of zones){this.cutaway[zone]+=(target[zone]-this.cutaway[zone])*Math.min(1,dt*14);for(const mesh of this.walls.get(zone)!){mesh.visibility=this.cutaway[zone];mesh.setEnabled(mesh.visibility>.012);}}
      if(!this.reduced.matches)this.time+=dt;for(const update of this.dynamic)update(this.time);
    },info:()=>({...this.stage,width:ARENA.width,depth:ARENA.depth,texturesReady:this.textures.every(t=>t.isReady()),cutaway:{...this.cutaway},staticBatches:this.batches.size+this.cameraOccluders.length,cameraSolids:this.cameraOccluders.length,reference:'Metropolis '+this.stage.name})};
  }
}

function house(b:SetBuilder){
  const ground=b.floor('wood'),wall=b.color('dusty rose plaster','#b68c99'),trim=b.color('warm timber','#805948'),wood=b.color('walnut shelves','#987052'),orange=b.color('orange upholstery','#dc8a39'),cushion=b.color('seat cushions','#ed9c47'),purple=b.color('purple fabric','#806099'),cream=b.color('cream fabric','#e5c5a2'),dark=b.color('desk metal','#4e455b');
  b.box('window wall below sill',0,.6,8.75,20.5,1.2,.4,wall,'back');b.box('window wall above',0,5.35,8.75,20.5,1.4,.4,wall,'back');
  for(const x of [-8.4,8.4])b.box('window wall pier',x,3,8.75,3.5,4.8,.4,wall,'back');
  for(const [x,zone] of [[10.2,'left'],[-10.2,'right']] as const){b.box('room side wall',x,3,0,.4,6,17.8,wall,zone);b.box('side skirting',x-(x>0?.23:-.23),.15,0,.08,.25,17.2,trim,zone);}
  b.box('reverse wall',0,2.8,-8.8,20.5,5.6,.4,wall,'front');
  for(const x of [-6.65,0,6.65])b.box('window mullion',x,3.05,8.48,.15,3.8,.2,trim,'back');
  for(const y of [1.2,4.9])b.box('window frame',0,y,8.43,13.6,.18,.3,trim,'back');
  for(let i=0;i<6;i++)b.box('wooden blinds',0,5.02+i*.12,8.22,14,.09,.22,wood,'back');
  const roof=b.color('neighborhood roofs','#745568'),plaster=b.color('neighbor houses','#ac889a'),windows=b.color('sunset windows','#f3c373',true);
  for(let i=0;i<7;i++){const x=-16+i*5.2,h=2.3+(i%3)*.5;b.box('neighbor house',x,h/2,18+(i%2)*2,4.1,h,3.7,plaster,'back',false);const r=b.box('neighbor roof',x,h+.4,18+(i%2)*2,4.8,.85,4.1,roof,'back',false);r.rotation.z=(i%2?1:-1)*.08;for(let n=0;n<3;n++)b.box('neighbor lit window',x-1+n,.95,15.98+(i%2)*2,.42,.55,.03,windows,'back',false);}
  b.box('sofa lower base',0,.55,6.65,8.2,.9,2.1,orange,'back');b.box('sofa back',0,1.45,7.35,7.9,1.3,.55,orange,'back');
  for(const x of [-3.7,3.7])b.blob('sofa rolled arm',x,1.08,6.55,1.05,1.5,2.1,orange,'back');
  for(const x of [-2.35,0,2.35])b.blob('sofa cushion',x,.99,6.45,2.5,.4,1.65,cushion,'back');
  b.blob('banana pillow',1.8,1.55,6.65,2.3,.55,.5,b.color('banana yellow','#f3cb56'),'back');
  const mascot=b.logo('mascot pillow print','#8960a1','#d0acd3');b.blob('mascot pillow',-1.4,1.64,6.72,1.2,1,.35,purple,'back');b.plane('pillow face',-1.4,1.64,6.51,.9,.85,mascot,'back');
  b.box('blanket across cushion',.7,1.23,6.38,1.6,.06,1.6,purple,'back');b.box('blanket drape',.7,.65,5.59,1.6,1.1,.06,purple,'back');
  const rug=b.painted('purple woven rug',ctx=>{ctx.fillStyle='#cfab91';ctx.fillRect(0,0,256,256);ctx.strokeStyle='#96709e';ctx.lineWidth=12;ctx.strokeRect(16,16,224,224);ctx.strokeStyle='#ac8aa9';ctx.lineWidth=5;for(let i=0;i<9;i++){ctx.beginPath();ctx.arc(128,128,15+i*10,0,Math.PI*1.7);ctx.stroke();}});
  b.box('sofa woven rug',0,.024,3.8,11,.035,2.9,rug,'fixed',false);
  b.box('drawing desk top',8.1,1.35,5.8,3.2,.16,2.2,wood,'left');for(const x of [6.8,9.4])b.box('desk leg',x,.65,5.8,.15,1.3,1.9,dark,'left');
  b.box('drawer cabinet',8.85,.62,5.8,.9,1.2,1.9,purple,'left');for(let y=.3;y<1.2;y+=.3)b.box('drawer handle',8.85,y,4.82,.3,.035,.04,cream,'left');
  const drawing=b.texture('desk screen','drawing');b.box('monitor body',8.75,2.14,6.3,1.25,.88,.13,dark,'left');b.plane('CHOG drawing on monitor',8.75,2.14,6.22,1.13,.76,drawing,'left');b.cyl('monitor stand',8.75,1.64,6.3,.12,.55,dark,'left');
  const tablet=b.box('pen tablet',7.2,1.54,5.65,1.15,.12,.84,dark,'left');tablet.rotation.x=.15;b.rod('desk stylus',[6.9,1.7,5.6],[7.55,1.7,5.6],.025,cream,'left');
  b.cyl('chair seat',8.1,.68,3.9,1.1,.2,purple,'left');b.box('chair back',8.1,1.2,3.45,1.05,.9,.18,purple,'left');b.cyl('chair stem',8.1,.34,3.9,.13,.6,dark,'left');for(const dx of [-.5,.5])b.rod('chair feet',[8.1,.12,3.9],[8.1+dx,.12,4.2],.045,dark,'left');
  b.plant(5.5,6.7,1.4,'back');b.blob('purple beanbag',-8.1,.6,5.85,2.5,1.25,2.1,purple,'right');b.blob('beanbag cushion',-8.1,1.05,6.15,1.8,.7,1.1,purple,'right');
  b.box('tall bookcase backing',-9.7,2,1.6,.3,4.1,4.6,trim,'right');for(const y of [.15,1.25,2.35,3.45,4.05])b.box('bookcase shelf',-9.25,y,1.6,1.1,.12,4.6,wood,'right');
  const books=['#8f649f','#e2bb67','#688d87','#ce8d78'].map((c,i)=>b.color('book '+i,c));
  for(let row=0;row<3;row++)for(let j=0;j<12;j++)b.box('shelf book',-9.15,.62+row*1.1,-.45+j*.34,.7,.7+(j%3)*.08,.22,books[j%4],'right');
  b.box('TV cabinet',-7.7,.65,-5.9,3.6,1.3,1.1,wood,'front');b.box('TV frame',-7.7,2,-6.1,3.3,1.9,.16,dark,'front');b.plane('TV idle CHOG',-7.7,2,-5.99,3.04,1.64,b.logo('television logo','#665276','#b398bd','CHOG'),'front',Math.PI);
  const poster=b.texture('wall poster','poster');b.plane('reference poster',-5.8,3.15,8.49,1.25,1.9,poster,'back');
  b.plane('reverse wall drawings',.5,2.8,-8.54,1.8,1.8,drawing,'front',Math.PI);b.plane('side wall drawing',10,2.9,-1,1.25,1.25,drawing,'left',Math.PI/2);
  for(const x of [-6,5.8]){b.box('ceiling beam',x,5.8,0,.25,.35,17.6,wood,'ceiling');b.plant(x,7.6,.65,'back');b.tube('hanging vine',[[x,5.5,7.8],[x+.2,4.8,7.6],[x-.1,4.1,7.7]],.045,books[2],'back');}
  return b.finish(ground);
}

function hall(b:SetBuilder){
  const ground=b.floor('tiles'),purple=b.color('royal purple','#755098'),gold=b.color('gilded trim','#e6ba5b'),stone=b.color('ivory stone','#dcc39d'),dark=b.color('gallery shadow','#614d7c'),lime=b.color('lime pennants','#c7d968'),bulb=b.color('gold lamps','#ffe3a1',true);
  gold.specularColor.set(.9,.7,.35);gold.specularPower=80;
  b.box('rear hall wall',0,4.2,9,21,8.4,.4,dark,'back');b.box('front hall wall',0,4,-9,21,8,.4,dark,'front');
  for(const [x,zone] of [[10.3,'left'],[-10.3,'right']] as const){b.box('side hall wall',x,4,0,.4,8,18.4,dark,zone);b.box('gallery balcony deck',x-(x>0?1.2:-1.2),4.4,0,2.4,.25,18,stone,zone);b.box('gallery railing',x-(x>0?2.3:-2.3),4.94,0,.12,.12,18,gold,zone);for(let z=-8;z<9;z+=1)b.cyl('gallery baluster',x-(x>0?2.3:-2.3),4.75,z,.07,.7,gold,zone);}
  const windowMat=b.logo('arched window glow','#8d68ae','#c7a0d7');
  for(const z of [-6,0,6])for(const [x,zone] of [[9.97,'left'],[-9.97,'right']] as const){
    const arch=b.plane('arched gallery window',x,2.6,z,2.4,3.2,windowMat,zone,x>0?Math.PI/2:-Math.PI/2);void arch;
    const points=[];for(let n=0;n<=14;n++){const a=n*Math.PI/14;points.push([x-(x>0?.04:-.04),3.25+Math.sin(a)*1.05,z+Math.cos(a)*1.1]);}b.tube('gilded window arch',points,.095,gold,zone);for(const dz of [-1.1,1.1])b.rod('window arch jamb',[x,1,z+dz],[x,3.25,z+dz],.09,gold,zone);
    b.cyl('stone gallery column',x-(x>0?.4:-.4),2,z+1.65,.48,4,stone,zone);b.box('column capital',x-(x>0?.4:-.4),4,z+1.65,.85,.25,.85,gold,zone);
  }
  b.box('rear balcony',0,4.5,8.2,20,.3,1.6,stone,'back');b.box('rear balcony rail',0,5.05,7.4,20,.1,.12,gold,'back');for(let x=-9.5;x<10;x+=.8)b.cyl('rear rail baluster',x,4.9,7.4,.07,.7,gold,'back');
  for(let i=0;i<3;i++)b.box('ceremonial steps',0,.15+i*.24,5.65+i*.45,7.4-i*.65,.3+i*.47,.55,purple,'back');
  b.box('trophy dais',0,.75,7.05,7.4,1.5,3.2,purple,'back');b.box('dais gold rim',0,1.53,7.05,7.6,.12,3.3,gold,'back');
  b.cyl('trophy plinth',0,1.9,7.1,2.3,.65,stone,'back');b.cyl('gold trophy foot',0,2.31,7.1,1.75,.18,gold,'back');b.cyl('gold trophy stem',0,2.73,7.1,.38,.75,gold,'back');
  const points=[[.35,0],[.5,.1],[.85,.5],[1.15,1.25],[1.18,1.55],[1.1,1.65],[1,1.65],[.95,1.45],[.68,.6],[.24,.15]].map(([x,y])=>new Vector3(x,y,0));
  const bowl=MeshBuilder.CreateLathe('great House Cup trophy',{shape:points,tessellation:40,sideOrientation:Mesh.DOUBLESIDE},b.scene);bowl.position.set(0,3.04,7.1);b.add(bowl,gold,'back');
  for(const x of [-1.15,1.15])b.torus('trophy handle',x,3.9,7.1,1.5,.16,gold,'back',true);
  b.plane('cup CHOG seal',0,3.85,5.94,.83,.83,b.logo('trophy seal','#e5ba58','#aa7a39'),'back');
  const banner=b.texture('original CHOG banner','banner');for(const x of [-8,-4.5,4.5,8])b.plane('hanging championship banner',x,5.9,8.65,1.55,3.4,banner,'back');
  b.plane('dais banner',0,.85,5.43,1.9,1.55,b.logo('dais emblem','#77519e','#e5b95f'),'back');
  for(const [x,z,zone] of [[7.2,5.2,'back'],[-7.2,5.2,'back'],[8.6,-2,'left'],[-8.6,-2,'right']] as const){
    b.box('ceremonial display',x,.8,z,1.4,1.6,1.4,purple,zone);b.box('display gold cap',x,1.65,z,1.6,.18,1.6,gold,zone);
    if(z>0){b.cyl('flower column',x,2.5,z,.55,1.7,stone,zone);b.blob('ivory flowers',x,3.35,z,1.4,.55,1.4,stone,zone);for(let n=0;n<5;n++)b.blob('gold flower',x+Math.sin(n*2)*.45,3.58,z+Math.cos(n*2)*.4,.32,.25,.32,gold,zone,5);}
    else{b.cyl('small prize foot',x,1.9,z,.5,.4,gold,zone);b.blob('small prize cup',x,2.25,z,.75,.65,.75,gold,zone);}
  }
  for(const x of [-8.8,-5.2,5.2,8.8]){b.cyl('lamp post',x,1.7,7.4,.16,2.8,gold,'back');b.blob('gold orb lamp',x,3.2,7.4,.5,.5,.5,bulb,'back');}
  b.bunting([9,5.8,6.6],[-9,5.8,6.6],lime,'back',22);
  const emblem=b.painted('floor medallion',ctx=>{ctx.fillStyle='#b58a43';ctx.beginPath();ctx.arc(128,128,124,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ead297';ctx.lineWidth=6;ctx.beginPath();ctx.arc(128,128,114,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#92729e';ctx.beginPath();for(let i=0;i<24;i++){const a=i*Math.PI/12,r=i%2?54:73;const x=128+Math.cos(a)*r,y=117+Math.sin(a)*r;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.closePath();ctx.fill();ctx.fillStyle='#ead297';for(const x of [108,148]){ctx.beginPath();ctx.ellipse(x,117,6,11,0,0,Math.PI*2);ctx.fill();}ctx.font='700 19px sans-serif';ctx.textAlign='center';ctx.fillText('HOUSE CUP',128,209);});const seal=b.plane('floor CHOG medallion',0,.018,0,5,5,emblem);seal.rotation.x=Math.PI/2;seal.rotation.z=Math.PI;
  for(const x of [-9.6,9.6])b.box('gold floor border',x,.025,0,.1,.02,17,gold,'fixed',false);for(const z of [-8.1,8.1])b.box('gold end border',0,.025,z,19.3,.02,.1,gold,'fixed',false);
  for(const [x,z] of [[-7,-6],[7,-6]])b.plant(x,z,.9,'front');
  return b.finish(ground);
}

function street(b:SetBuilder){
  const ground=b.floor('street'),brick=b.color('night masonry','#554365'),dark=b.color('street metal','#302d40'),purple=b.color('neon violet','#a76be7',true),pink=b.color('neon pink','#f09ace',true),lime=b.color('neon chartreuse','#c6e572',true),warm=b.color('shop amber','#f5bd76',true),wood=b.color('shop wood','#a16d65');
  for(const [x,zone] of [[10.7,'left'],[-10.7,'right']] as const){
    b.box('street shop block',x,4.1,2,2.2,8.2,15,brick,zone);b.box('shop cornice',x-(x>0?1.2:-1.2),5.4,2,.3,.26,14.6,dark,zone);
    for(const z of [-2.8,1.5,5.7]){b.box('illuminated storefront window',x-(x>0?1.12:-1.12),1.85,z,.05,2.3,2.7,warm,zone);b.box('shop window sill',x-(x>0?1.3:-1.3),.6,z,.4,.18,3,wood,zone);b.box('striped awning',x-(x>0?1.5:-1.5),3.25,z,1.4,.2,3.5,purple,zone);}
    for(let z=-5;z<9;z+=2.5){b.box('upper shop window',x-(x>0?1.12:-1.12),6.3,z,.03,1.2,.8,pink,zone);b.rod('drainpipe',[x-(x>0?1.25:-1.25),.3,z+.8],[x-(x>0?1.25:-1.25),7.7,z+.8],.06,dark,zone);}
  }
  b.box('noodle stall counter',-8.5,.85,5.5,2.1,1.7,3.6,wood,'right');b.box('noodle stall canopy',-8.5,3.5,5.5,2.6,.18,4.2,warm,'right');
  const noodle=b.texture('original noodle sign','noodle-sign',1,1,true);b.plane('noodle signboard',-7.36,3.13,5.5,3.9,.85,noodle,'right',-Math.PI/2);
  b.plane('CWO shop sign',8.45,4.4,4.8,4.2,1.7,b.texture('original CWO sign','store-sign',1,1,true),'left',Math.PI/2);
  b.plane('city CWO billboard',-9.2,5.8,-3,1.2,2.8,b.texture('original tower billboard','billboard',1,1,true),'right',-Math.PI/2);
  b.plant(8.4,5.5,1,'left');b.plant(-8.5,-6,1,'front');
  b.box('sandwich sign legs',6.8,.65,6.9,1.1,1.3,.25,dark,'back');b.plane('street CHOG sign',6.8,.8,6.72,.86,1.1,b.logo('sidewalk sign','#3b2a54','#c4dc75','CWO'),'back');
  b.cyl('street bin',-8.3,.65,-4.4,1.1,1.3,dark,'front');b.cyl('street bin lid',-8.3,1.34,-4.4,1.2,.12,purple,'front');
  for(const x of [-9,-4.9,0,4.9,9]){b.cyl('canal railing post',x,.65,8.2,.2,1.3,dark,'back');b.blob('railing lamp',x,1.4,8.2,.25,.25,.25,warm,'back');}
  for(const y of [.3,.9])b.rod('canal railing',[-10,y,8.2],[10,y,8.2],.06,dark,'back');b.cyl('canal bollard',4.9,.55,7.7,.8,1.1,dark,'back');
  const water=b.painted('canal water',ctx=>{ctx.fillStyle='#433768';ctx.fillRect(0,0,256,256);for(let i=0;i<60;i++){ctx.fillStyle=['#b578ce88','#d49bc477','#83a7cb77'][i%3];ctx.fillRect((i*71)%256,(i*37)%256,8+i%25,1+i%3);}});water.emissiveColor.set(.3,.22,.4);const tex=water.diffuseTexture as Texture;tex.wrapU=tex.wrapV=Texture.WRAP_ADDRESSMODE;tex.uScale=5;tex.vScale=3;b.dynamic.push(t=>{tex.uOffset=t*.012;});
  const canal=MeshBuilder.CreateGround('canal beyond the promenade',{width:55,height:15},b.scene);canal.position.set(0,-.55,16);b.add(canal,water,'back',false);
  b.box('raised bridge deck',0,1.35,20,45,.6,2.4,dark,'back',false);for(let x=-20;x<=20;x+=5){b.box('bridge pier',x,.15,20,.8,2.2,1.3,brick,'back',false);b.cyl('bridge light post',x,2.5,19,.08,1.8,dark,'back');b.blob('bridge light',x,3.4,19,.22,.22,.22,warm,'back');}
  b.rod('bridge neon edge',[-22,1.76,18.7],[22,1.76,18.7],.045,pink,'back');
  for(let i=0;i<17;i++){
    const x=-32+i*4,h=3.5+(i*7%9),z=28+(i%3)*3;b.box('night skyline tower',x,h/2,z,3,h,3,brick,'back',false);
    for(let row=0;row<Math.floor(h);row++)for(let col=0;col<3;col++)if((row+col+i)%3)b.box('lit skyline window',x-1+col,row+.5,z-1.53,.36,.45,.025,[purple,lime,pink][(row+i)%3],'back',false);
    if(i%3===0)b.plane('tower CHOG billboard',x,h*.62,z-1.58,1.3,2,b.logo('tower '+i,'#543572',i%2?'#c7e275':'#e1a4d3','CWO'),'back');
  }
  for(const z of [-6,4]){const points=[];for(let n=0;n<=10;n++){const x=-10+n*2;points.push([x,6-Math.sin(n/10*Math.PI)*.8,z]);if(n%2)b.blob('string light bulb',x,5.85-Math.sin(n/10*Math.PI)*.8,z,.2,.3,.2,warm,'fixed',6);}b.tube('overhead festoon cable',points,.025,dark,'fixed');}
  const reflectionMats=[pink,purple,warm].map((mat,i)=>{const m=b.color('wet pavement glow '+i,mat.emissiveColor.toHexString(),true);m.alpha=.16;m.disableDepthWrite=true;return m;});
  for(let i=0;i<20;i++){const p=b.plane('wet light reflection',-8+(i*3.7)%16,.024+i*.0001,-7+(i*2.1)%14,.5+(i%3)*.5,1.1+(i%4)*.4,reflectionMats[i%3]);p.rotation.x=Math.PI/2;p.rotation.z=.2*Math.sin(i);}
  b.box('reverse sidewalk',0,-.23,-10,26,.4,4,brick,'front',false);
  b.box('reverse storefront',0,2.4,-11,22,4.8,2.2,brick,'front',false);for(let x=-9;x<10;x+=3)b.box('reverse shop glow',x,2,-9.86,1.8,2.2,.04,purple,'front',false);
  return b.finish(ground);
}

function rally(b:SetBuilder){
  const ground=b.floor('plaza'),metal=b.color('stage truss','#554b66'),dark=b.color('speaker cabinets','#383140'),purple=b.color('festival purple','#9769bd'),lime=b.color('festival lime','#c6df76',true),pink=b.color('stage pink','#d59ada',true),cream=b.color('ivory flags','#e6ccaa'),black=b.color('speaker cones','#22232e');
  b.box('DJ stage',0,.7,7.2,8,1.4,2.6,dark,'back');b.box('stage purple fascia',0,.9,5.86,8,.8,.1,purple,'back');for(const x of [-3.5,3.5])b.box('stage lime edge',x,1.44,7.2,.08,.05,2.6,lime,'back');
  b.box('DJ booth',0,2.05,7.4,4.8,1.2,1.2,purple,'back');b.box('DJ desk top',0,2.7,7.4,5,.15,1.4,metal,'back');for(const x of [-1.3,1.3])b.cyl('turntable',x,2.81,7.4,.8,.05,black,'back');
  const emblem=b.texture('original rally LED artwork','led-wall',1,1,true);b.plane('main LED wall',0,4.8,9.8,8.7,5,emblem,'back');
  b.torus('great circular festival truss',0,4.45,9.55,9.5,.23,metal,'back',true);b.torus('festival ring LED',0,4.45,9.4,9.15,.09,lime,'back',true);
  function truss(x:number,z:number,zone:Zone){for(const dx of [-.3,.3])for(const dz of [-.3,.3])b.rod('upright truss chord',[x+dx,.1,z+dz],[x+dx,7.6,z+dz],.065,metal,zone);for(let y=.2;y<7.2;y+=.75){b.rod('truss cross brace',[x-.3,y,z-.3],[x+.3,y+.75,z-.3],.035,metal,zone);b.rod('truss side brace',[x+.3,y,z-.3],[x+.3,y+.75,z+.3],.035,metal,zone);}}
  for(const [x,z,zone] of [[9,6.5,'left'],[-9,6.5,'right'],[9,-5.9,'front'],[-9,-5.9,'front']] as const)truss(x,z,zone);
  for(const z of [6.5,-5.9])for(const y of [7.35,7.8])b.rod('overhead lighting truss',[-9,y,z],[9,y,z],.08,metal,'fixed');
  for(const x of [-8.15,8.15]){const zone=x>0?'left':'right';b.box('speaker stack',x,2,5.6,1.65,4,1.65,dark,zone);for(let y=.7;y<4;y+=1.2){const cone=b.cyl('speaker driver',x,y,4.75,1.1,.08,black,zone);cone.rotation.x=Math.PI/2;b.torus('speaker LED rim',x,y,4.68,1.1,.035,lime,zone,true);}}
  for(const x of [-8.8,8.8]){const zone=x>0?'left':'right';for(const z of [-4.55,-1.05])b.rod('barricade upright',[x,.05,z],[x,1.25,z],.055,metal,zone);for(const y of [.15,1.2])b.rod('barricade horizontal',[x,y,-4.55],[x,y,-1.05],.055,metal,zone);for(let z=-4.3;z<-1;z+=.4)b.rod('barricade bar',[x,.15,z],[x,1.2,z],.03,metal,zone);}
  for(const y of [.2,1.2])b.rod('crowd barrier',[-10,y,8.7],[10,y,8.7],.06,metal,'back');for(let x=-10;x<=10;x+=.7)b.rod('crowd barrier vertical',[x,.15,8.7],[x,1.2,8.7],.035,metal,'back');
  const heads=[b.color('crowd violet','#654780'),b.color('crowd lavender','#9470ad'),b.color('crowd plum','#77538d')];
  for(let i=0;i<42;i++){const row=Math.floor(i/21),x=-10+(i%21),z=10.5+row*.9,y=.9+(i%3)*.09;b.blob('crowd CHOG head',x,y,z,.65,.72,.58,heads[i%3],'back',5);for(const dx of [-.23,.23]){const ear=b.cyl('crowd horn',x+dx,y+.4,z,.19,.3,heads[i%3],'back',0);ear.rotation.z=dx>0?-.3:.3;}if(i%2)b.rod('crowd glow stick',[x+.3,y-.1,z-.35],[x+.45,y+.6,z-.35],.025,i%3?lime:pink,'back');}
  const banner=b.texture('reference concert flag','banner');for(const x of [-7,7])b.plane('festival CHOG banner',x,4.5,6.35,1.4,3.2,banner,'back');b.bunting([-9,5.3,-5],[9,5.3,-5],lime,'ceiling',23);
  const beamMats=[b.color('purple light shafts','#d19ee6',true),b.color('gold light shafts','#e6d9a3',true)];for(const m of beamMats){m.alpha=.055;m.backFaceCulling=false;m.disableDepthWrite=true;}
  for(let i=0;i<6;i++){
    const x=-7.5+i*3;b.blob('stage lamp',x,7.2,6.3,.42,.42,.42,i%2?lime:pink,'fixed',6);
    const node=new TransformNode('moving light beam '+i,b.scene);node.position.set(x,7,6.1);
    const beam=MeshBuilder.CreateCylinder('soft concert light',{height:8,diameterTop:.15,diameterBottom:3,tessellation:12,sideOrientation:Mesh.DOUBLESIDE},b.scene);beam.parent=node;beam.position.y=-4;b.add(beam,beamMats[i%2],'fixed',false,true);
    b.dynamic.push(t=>{node.rotation.z=Math.sin(t*.35+i)*.22;node.rotation.x=.23+Math.cos(t*.28+i)*.08;});
  }
  const confetti=[lime,purple,cream,pink];for(let i=0;i<45;i++){const mesh=b.plane('confetti',-9+(i*3.37)%18,.025+(i%3)*.002,-7+(i*2.17)%14,.12,.22,confetti[i%4]);mesh.rotation.x=Math.PI/2;mesh.rotation.z=i*.7;}
  b.box('reverse festival hoarding',0,1.1,-10,24,2.2,.3,purple,'front',false);
  return b.finish(ground);
}

export function buildWorld(scene:Scene,shadows:ShadowGenerator,stage:StageDefinition){
  const b=new SetBuilder(scene,shadows,stage);
  switch(stage.id){case'rayj-house':return house(b);case'house-cup':return hall(b);case'neon-street':return street(b);case'cwo-rally':return rally(b);default:throw new Error('Use the original CWO Alley builder.');}
}
