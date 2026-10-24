import { Color3, DynamicTexture, Mesh, MeshBuilder, Plane, Quaternion, StandardMaterial, Texture, Vector3,
  type Scene } from './babylon.ts';
import type { StageDefinition } from './stage.ts';

type Policy = 'fixed' | 'ceiling' | 'back' | 'front' | 'left' | 'right';
type Role = 'terrain' | 'city' | 'gardens' | 'details' | 'ceiling' | 'roof';
const smooth=(a:number,b:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);};
const rgb=(hex:string)=>{const c=Color3.FromHexString(hex);return [Math.round(c.r*255),Math.round(c.g*255),Math.round(c.b*255)];};

/** Geometry beyond the fighting boundary, with a complete sky and an indoor roof cutaway. */
export function createEnvironment(scene:Scene,stage:StageDefinition){
  const night=stage.id==='neon-street',festival=stage.id==='cwo-rally',home=stage.id==='rayj-house',hall=stage.id==='house-cup';
  let seed=stage.id.split('').reduce((n,c)=>Math.imul(n+1,31)+c.charCodeAt(0),17);
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const batches=new Map<string,{meshes:Mesh[];role:Role;policy:Policy}>();
  const groups: {mesh:Mesh;role:Role;policy:Policy}[]=[];
  let buildings=0,trees=0,details=0,facadePanels=0;
  const facadeSides={front:0,back:0,left:0,right:0};
  const color=(name:string,hex:string,glow=false)=>{
    const m=new StandardMaterial(stage.id+' / environment / '+name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor.set(.025,.025,.025);
    if(glow)m.emissiveColor=Color3.FromHexString(hex).scale(.5);return m;
  };
  const painted=(name:string,w:number,h:number,draw:(ctx:CanvasRenderingContext2D)=>void)=>{
    const tex=new DynamicTexture(stage.id+' / environment / '+name,{width:w,height:h},scene,false);const ctx=tex.getContext() as CanvasRenderingContext2D;draw(ctx);tex.update();
    tex.wrapU=tex.wrapV=Texture.WRAP_ADDRESSMODE;
    const mat=color(name,'#ffffff');mat.diffuseTexture=tex;return {mat,tex};
  };
  const add=(mesh:Mesh,mat:StandardMaterial,role:Role='details',policy:Policy='fixed')=>{
    mesh.material=mat;mesh.isPickable=false;mesh.receiveShadows=false;mesh.renderingGroupId=0;
    const key=mat.uniqueId+'/'+role+'/'+policy;if(!batches.has(key))batches.set(key,{meshes:[],role,policy});batches.get(key)!.meshes.push(mesh);return mesh;
  };
  const box=(name:string,x:number,y:number,z:number,w:number,h:number,d:number,mat:StandardMaterial,role:Role='details',policy:Policy='fixed')=>{
    const mesh=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);mesh.position.set(x,y,z);return add(mesh,mat,role,policy);
  };
  const blob=(name:string,x:number,y:number,z:number,w:number,h:number,d:number,mat:StandardMaterial,role:Role='gardens',policy:Policy='fixed')=>{
    const mesh=MeshBuilder.CreateSphere(name,{diameter:1,segments:6},scene);mesh.position.set(x,y,z);mesh.scaling.set(w,h,d);return add(mesh,mat,role,policy);
  };
  const cylinder=(name:string,x:number,y:number,z:number,diameter:number,height:number,mat:StandardMaterial,role:Role='details',policy:Policy='fixed')=>{
    const mesh=MeshBuilder.CreateCylinder(name,{diameter,height,tessellation:12},scene);mesh.position.set(x,y,z);return add(mesh,mat,role,policy);
  };
  const rod=(name:string,a:number[],b:number[],radius:number,mat:StandardMaterial,role:Role='details',policy:Policy='fixed')=>{
    const from=Vector3.FromArray(a),to=Vector3.FromArray(b),delta=to.subtract(from);
    const mesh=MeshBuilder.CreateCylinder(name,{height:delta.length(),diameter:radius*2,tessellation:6},scene);mesh.position.copyFrom(from.add(to).scale(.5));mesh.rotationQuaternion=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(Vector3.Up(),delta.normalize(),mesh.rotationQuaternion);return add(mesh,mat,role,policy);
  };
  const plane=(name:string,x:number,y:number,z:number,w:number,h:number,mat:StandardMaterial,yaw=0,policy:Policy='fixed')=>{
    const mesh=MeshBuilder.CreatePlane(name,{width:w,height:h,sideOrientation:Mesh.DOUBLESIDE},scene);mesh.position.set(x,y,z);mesh.rotation.y=yaw;return add(mesh,mat,'details',policy);
  };

  // A single opaque panoramic dome covers every direction, including below the horizon.
  const skyW=2048,skyH=1024;
  const sky=painted('complete panoramic sky',skyW,skyH,ctx=>{
    const gradient=ctx.createLinearGradient(0,0,0,skyH);
    gradient.addColorStop(0,night?'#11152f':festival?'#302253':home?'#795a91':hall?'#93b4cc':'#719ebf');
    gradient.addColorStop(.29,night?'#343263':festival?'#745084':home?'#d8889b':'#bad2df');
    gradient.addColorStop(.5,stage.fog);gradient.addColorStop(.7,stage.fog);gradient.addColorStop(1,stage.fog);ctx.fillStyle=gradient;ctx.fillRect(0,0,skyW,skyH);
    if(night||festival){
      for(let i=0;i<420;i++){const x=random()*skyW,y=25+random()*430,r=.55+random()*1.4;ctx.fillStyle=`rgba(244,231,255,${.28+random()*.65})`;ctx.beginPath();ctx.ellipse(x,y,r/Math.max(.12,Math.sin(y/skyH*Math.PI)),r,0,0,Math.PI*2);ctx.fill();}
      const moonX=skyW*.67,moonY=skyH*.22;const halo=ctx.createRadialGradient(moonX,moonY,10,moonX,moonY,110);halo.addColorStop(0,'#e6dcfb60');halo.addColorStop(1,'#c9b9ed00');ctx.fillStyle=halo;ctx.fillRect(moonX-110,moonY-110,220,220);ctx.fillStyle='#eee6fa';ctx.beginPath();ctx.arc(moonX,moonY,28,0,Math.PI*2);ctx.fill();ctx.fillStyle='#beb4d54d';for(let n=0;n<7;n++){ctx.beginPath();ctx.arc(moonX-15+random()*30,moonY-16+random()*32,2+random()*4,0,Math.PI*2);ctx.fill();}
    }else{
      const x=skyW*.67,y=home?skyH*.43:skyH*.22,r=home?43:27,halo=ctx.createRadialGradient(x,y,r*.6,x,y,r*4);halo.addColorStop(0,home?'#ffeabf99':'#fff6d880');halo.addColorStop(1,'#fff2d000');ctx.fillStyle=halo;ctx.fillRect(x-r*4,y-r*4,r*8,r*8);ctx.fillStyle=home?'#ffedb2':'#fff6d9';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
    const cloud=(cx:number,cy:number,w:number,h:number,alpha:number)=>{
      for(const offset of [-skyW,0,skyW]){ctx.fillStyle=night?`rgba(129,123,177,${alpha*.6})`:festival?`rgba(215,163,194,${alpha})`:home?`rgba(255,188,151,${alpha})`:`rgba(255,247,233,${alpha})`;
        ctx.beginPath();for(let i=0;i<8;i++)ctx.ellipse(cx+offset+(i-3.5)*w/8,cy-Math.sin(i/7*Math.PI)*h*.28,w*.18,h*(.22+Math.sin(i+1)*.035),0,0,Math.PI*2);ctx.fill();}
    };
    for(let i=0;i<48;i++)cloud(random()*skyW,260+random()*220,100+random()*220,22+random()*45,.13+random()*.28);
    if(!night)for(let i=0;i<12;i++)cloud(random()*skyW,105+random()*125,240+random()*260,22+random()*24,.1+random()*.12);
    if(festival){for(let fire=0;fire<3;fire++){const x=260+fire*570,y=180+(fire%2)*60;ctx.strokeStyle=['#e2c1e57a','#d9eab777','#f6d3a97a'][fire];ctx.lineWidth=1.5;for(let j=0;j<18;j++){const a=j*Math.PI/9;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*14,y+Math.sin(a)*14);ctx.lineTo(x+Math.cos(a)*52,y+Math.sin(a)*52+6);ctx.stroke();}}}
  });
  sky.tex.vScale=-1;sky.tex.vOffset=1;sky.tex.wrapV=Texture.CLAMP_ADDRESSMODE;
  sky.mat.disableLighting=true;sky.mat.diffuseColor.set(0,0,0);sky.mat.emissiveColor.set(1,1,1);sky.mat.emissiveTexture=sky.tex;sky.mat.fogEnabled=false;sky.mat.disableDepthWrite=true;
  const dome=MeshBuilder.CreateSphere(stage.name+' / continuous sky dome',{diameter:520,segments:28,sideOrientation:Mesh.BACKSIDE},scene);
  dome.material=sky.mat;dome.renderingGroupId=0;dome.infiniteDistance=true;dome.isPickable=false;dome.alwaysSelectAsActiveMesh=true;dome.metadata={environmentRole:'sky',environmentLayer:'background'};

  const groundHex=night?'#333045':festival?'#69725d':home?'#8c9a67':hall?'#8b9b7c':'#8b9294';
  const terrain=painted('terrain beyond arena',512,512,ctx=>{
    ctx.fillStyle=groundHex;ctx.fillRect(0,0,512,512);
    for(let i=0;i<1800;i++){const [r,g,b]=rgb(groundHex),d=(random()-.5)*24;ctx.fillStyle=`rgba(${r+d},${g+d},${b+d},.28)`;ctx.fillRect(random()*512,random()*512,2+random()*7,1+random()*4);}
    if(!home&&!hall&&!festival){ctx.strokeStyle='#b2aabd26';ctx.lineWidth=2;for(let n=0;n<=8;n++){ctx.beginPath();ctx.moveTo(n*64,0);ctx.lineTo(n*64,512);ctx.moveTo(0,n*64);ctx.lineTo(512,n*64);ctx.stroke();}}
  });terrain.tex.uScale=terrain.tex.vScale=45;
  const ground=MeshBuilder.CreateGround('continuous surrounding terrain',{width:380,height:380},scene);ground.position.y=night?-1.2:-.12;add(ground,terrain.mat,'terrain');
  const road=color('neighborhood asphalt',night?'#2d2b42':'#777783'),pavement=color('continuous sidewalks',night?'#655b77':home?'#baaa93':'#b4a8ad'),line=color('street markings',night?'#9994a5':'#d5c7a3');
  const roof=color('roof tiles',night?'#3d354e':home?'#785766':'#6f617d'),roofTrim=color('roof edges and fittings',night?'#554461':'#b7a2aa');
  const trunk=color('tree trunks',night?'#554257':'#7a655a'),leaf=color('tree canopies',night?'#425369':home?'#84985c':'#718968'),leafDark=color('hills and deep foliage',night?'#383a56':festival?'#655377':'#71836f');
  const metal=color('street furniture',night?'#454056':'#6a626e'),lamp=color('district lamps',night?'#f3c998':'#e9d6ad',true);
  for(const x of [-25,25]){box('district road',x,night?-.045:-.025,0,7,.07,140,road,'terrain');for(let z=-65;z<=65;z+=5)box('road center dash',x,.02,z,.12,.02,1.6,line,'terrain');}
  for(const z of [-25,26]){box('cross street',0,-.025,z,140,.07,7,road,'terrain');for(let x=-65;x<=65;x+=5)box('cross street dash',x,.02,z,1.6,.02,.12,line,'terrain');}
  for(const x of [-14,14])box('venue approach sidewalk',x,.02,0,6,.13,26,pavement,'terrain');
  if(stage.id!=='cwo-alley')box('front entrance paving',0,.02,-13.2,22,.13,8,pavement,'terrain');
  if(!night)box('rear entrance paving',0,.02,13.4,22,.13,8,pavement,'terrain');
  if(night){
    // This continues the original canal beyond both ends, without placing terrain over its water.
    const water=color('extended canal','#4e466e',true);water.specularColor.set(.4,.3,.65);water.specularPower=80;
    box('canal across the city',0,-.64,16.1,320,.06,14.7,water,'terrain');
    for(let x=-150;x<=150;x+=2.8)box('distant canal reflection',x,-.6,13+(Math.floor(x)+150)%6,1.2,.008,.08,lamp,'terrain');
    box('opposite canal promenade',0,-.09,24.6,320,.3,2.6,pavement,'terrain');
  }

  const facadeColors=night?['#39344d','#463a57','#363b55']:home?['#c19a8d','#a99a98','#a696af']:hall?['#b1a4a1','#bca691','#b09db5']:['#a792a4','#bf9b8d','#8e9b9a'];
  const facades=facadeColors.map((hex,index)=>{
    const material=painted('district facade '+index,256,512,ctx=>{
      ctx.fillStyle=hex;ctx.fillRect(0,0,256,512);
      for(let y=0;y<512;y+=home?256:64){ctx.fillStyle=night?'#241f354d':'#59475a25';ctx.fillRect(0,y,256,3);
        const offset=home?70:14,height=home?100:38;
        for(let x=16;x<250;x+=64){ctx.fillStyle=night?'#211f32':'#6b637e';ctx.fillRect(x,y+offset,37,height);ctx.fillStyle=night?(random()>.35?['#e5cda6','#c79cd8','#b9d58b'][(index+y/64)%3]:'#46405b'):'#bec5c6';ctx.fillRect(x+4,y+offset+4,29,height-8);ctx.fillStyle=night?'#3b304977':'#e2c9af';ctx.fillRect(x+17,y+offset+4,3,height-8);ctx.fillRect(x+4,y+offset+height/2,29,2);}
      }
    });
    if(night){material.mat.emissiveTexture=material.tex;material.mat.emissiveColor.set(.34,.34,.38);}return material.mat;
  });
  const clearCanal=(x:number,z:number,w:number,d:number)=>!night||z-d/2>25||z+d/2<8||Math.abs(x)>160;
  const building=(x:number,z:number,w:number,h:number,d:number,index:number,near=false)=>{
    if(!clearCanal(x,z,w,d))return;
    buildings++;box('surrounding building',x,h/2-.03,z,w,h,d,facades[index%3],'city');
    box('building roof',x,h+.08,z,w+.35,.2,d+.35,roof,'city');
    if(home){for(const side of [-1,1]){const slope=box('pitched residential roof',x+side*w*.25,h+.7,z,w*.6,.2,d+.8,roof,'city');slope.rotation.z=-side*.34;}
      box('house chimney',x+w*.24,h+1.15,z+d*.2,.55,1.6,.55,roofTrim,'city');}
    else if(near){
      for(const sx of [-1,1])box('rooftop parapet',x+sx*w*.49,h+.35,z,.15,.65,d,roofTrim,'city');
      box('roof ventilation',x,h+.5,z,1.3,.8,1,metal,'city');
      if(index%3===0){cylinder('rooftop water tank',x+w*.2,h+1.2,z,1.6,1.8,roofTrim,'city');for(const dx of [-.6,.6])rod('tank foot',[x+w*.2+dx,h,z],[x+w*.2+dx,h+.8,z],.055,metal,'city');}
    }
  };
  for(const [radius,count] of [[35,16],[56,22],[83,28],[119,34]]){
    for(let i=0;i<count;i++){const angle=i*Math.PI*2/count+.04*Math.sin(i*3),x=Math.sin(angle)*radius,z=Math.cos(angle)*radius;
      const width=home?5+random()*3:4+random()*5,height=home?3.5+random()*3:night?7+random()*24:festival?5+random()*11:6+random()*14;
      building(x,z,width,height,5+random()*4,i+count,radius===35);
    }
  }
  // Low gardens, trees and street furniture bridge the arena and the district beyond it.
  const tree=(x:number,z:number,scale:number)=>{
    if(!clearCanal(x,z,2,2))return;trees++;cylinder('tree trunk',x,scale*.8,z,.22*scale,1.6*scale,trunk,'gardens');
    for(let n=0;n<3;n++)blob('leafy tree crown',x+Math.sin(n*2.1)*scale*.45,scale*(1.6+n*.22),z+Math.cos(n*2.1)*scale*.35,scale*1.7,scale*1.4,scale*1.5,n%2?leaf:leafDark);
  };
  for(let i=0;i<36;i++){const a=i*Math.PI/18,r=home||hall?19+(i%3)*2:19.5+(i%4)*2;tree(Math.sin(a)*r,Math.cos(a)*r,1.15+(i%3)*.3);}
  for(let i=0;i<46;i++){const a=i*Math.PI/23,r=62+(i%4)*7;tree(Math.sin(a)*r,Math.cos(a)*r,1.8+(i%3)*.5);}
  for(let i=0;i<15;i++){const a=i*Math.PI*2/15,r=153,x=Math.sin(a)*r,z=Math.cos(a)*r;blob('horizon ridge',x,1,z,34+random()*20,15+random()*22,30,leafDark,'gardens');}
  for(const x of [-17,17])for(const z of [-15,-5,5,15]){
    if(!clearCanal(x,z,1,1))continue;details++;
    rod('neighborhood streetlight',[x,.1,z],[x,5.4,z],.065,metal);rod('streetlight arm',[x,5.4,z],[x+(x>0?-1:1),5.4,z],.055,metal);blob('streetlight lantern',x+(x>0?-1:1),5.34,z,.5,.18,.48,lamp,'details');
    if(z<0){box('bench seat',x,.58,z+1.7,2.1,.14,.62,roofTrim);box('bench back',x,.98,z+2,2.1,.7,.1,roofTrim);for(const dx of [-.75,.75])box('bench foot',x+dx,.28,z+1.7,.1,.55,.5,metal);}
  }
  if(home||hall){for(const side of [-1,1]){
    const x=side*15;box('garden flower bed',x,.12,0,2.4,.3,15,roofTrim,'gardens');for(let z=-6;z<=6;z+=.8){blob('flower bed shrub',x,.55,z,1.5,.75,.8,leaf);if(z%1.6===0)blob('garden blossoms',x,.85,z,.5,.3,.4,lamp);}
  }}
  if(festival){
    const canopy=color('festival tent fabric','#9274aa'),tentAccent=color('festival tent trim','#bfd280');
    const menu=painted('festival kiosk menu',256,256,ctx=>{ctx.fillStyle='#604976';ctx.fillRect(0,0,256,256);ctx.strokeStyle='#d6d79c';ctx.lineWidth=8;ctx.strokeRect(8,8,240,240);ctx.textAlign='center';ctx.fillStyle='#f3dfbc';ctx.font='900 58px sans-serif';ctx.fillText('CWO',128,87);ctx.font='700 24px sans-serif';ctx.fillText('FESTIVAL',128,135);ctx.font='700 31px sans-serif';ctx.fillText('SNACKS',128,204);});
    for(let i=0;i<10;i++){const a=(i/10)*Math.PI*2,x=Math.sin(a)*18.5,z=Math.cos(a)*18.5;
      box('festival kiosk counter',x,.65,z,3.5,1.3,2.6,roofTrim);plane('festival kiosk menu',x,1,z-1.33,.9,.9,menu.mat);
      for(const dx of [-1.65,1.65])for(const dz of [-1.2,1.2])rod('tent upright',[x+dx,.1,z+dz],[x+dx,3.1,z+dz],.04,metal);
      for(const side of [-1,1]){const panel=box('festival tent canopy',x+side*.9,3.45,z,2.1,.12,3,canopy);panel.rotation.z=-side*.35;}
      box('festival stall fascia',x,2.9,z-1.35,3.6,.35,.1,tentAccent);details++;
    }
    for(const z of [-13.5,13.5]){rod('festival bunting cable',[-19,5.8,z],[19,5.8,z],.02,metal);for(let x=-18;x<19;x+=1.2){const flag=plane('festival pennant',x,5.5,z,.45,.6,tentAccent);flag.rotation.z=.12*Math.sin(x);}}
  }

  // One atlas adds readable front, rear and side details without a material
  // for every sign. Wall-mounted details share the venue's depth and cutaway.
  const atlas=painted('venue facade atlas',1024,1024,ctx=>{
    const titles=["RAY J'S HOUSE",'HOUSE CUP','CWO ALLEY','NEON CWO','CWO RALLY','TONIGHT / LIVE','ART STUDIO','THE GALLERY'];
    for(let tile=0;tile<16;tile++){
      ctx.save();ctx.translate(tile%4*256,Math.floor(tile/4)*256);
      ctx.fillStyle=tile===8?'#92705f':tile===10?'#777f98':tile===11?'#b58997':'#554367';ctx.fillRect(0,0,256,256);
      ctx.strokeStyle='#d4bf9b';ctx.lineWidth=8;ctx.strokeRect(10,10,236,236);
      if(tile<8){
        ctx.fillStyle='#c6d583';ctx.beginPath();for(let n=0;n<24;n++){const a=n*Math.PI/12,r=n%2?40:52;const x=128+Math.cos(a)*r,y=78+Math.sin(a)*r;if(n)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.closePath();ctx.fill();ctx.fillStyle='#554367';ctx.fillRect(110,65,10,20);ctx.fillRect(136,65,10,20);
        ctx.textAlign='center';ctx.fillStyle='#f0dec0';ctx.font='900 24px sans-serif';ctx.fillText(titles[tile],128,169,222);ctx.font='700 13px sans-serif';ctx.fillText(tile===5?'GOOD FRIENDS. BIG ENERGY.':'METROPOLIS / THE CHOG CREW',128,208,222);
      }else if(tile===8){
        ctx.fillStyle='#6f5151';ctx.fillRect(32,26,192,203);ctx.strokeStyle='#ba987d';ctx.lineWidth=4;ctx.strokeRect(39,34,178,184);for(const y of [49,139])ctx.strokeRect(56,y,143,62);ctx.fillStyle='#e3c794';ctx.beginPath();ctx.arc(195,129,7,0,Math.PI*2);ctx.fill();
      }else if(tile===9){
        ctx.fillStyle='#796c81';ctx.fillRect(27,25,202,205);for(let y=36;y<226;y+=13){ctx.fillStyle='#393648';ctx.fillRect(37,y,182,5);ctx.fillStyle='#aaa0a2';ctx.fillRect(37,y-3,182,2);}
      }else if(tile===10){
        ctx.fillStyle=night?'#ce9bb8':'#c1ccd1';ctx.fillRect(26,26,204,204);ctx.fillStyle='#65516e';ctx.fillRect(122,24,12,208);ctx.fillRect(24,121,208,12);ctx.fillStyle='#f5e4be40';ctx.beginPath();ctx.moveTo(30,30);ctx.lineTo(120,30);ctx.lineTo(30,115);ctx.fill();
      }else if(tile===11){
        ctx.fillStyle='#d9bda3';ctx.fillRect(27,26,202,204);ctx.fillStyle='#9e6c8c';for(const x of [27,178])ctx.fillRect(x,26,51,204);ctx.fillStyle='#d4b39a';for(const x of [35,50,65,185,200,215])ctx.fillRect(x,27,4,202);ctx.fillStyle='#80617a';ctx.fillRect(122,27,10,202);ctx.fillRect(27,122,202,10);
      }else if(tile===12){
        ctx.fillStyle='#e5d3b6';ctx.fillRect(25,24,206,207);ctx.textAlign='center';ctx.fillStyle='#665076';ctx.font='900 23px sans-serif';ctx.fillText('THE HOUSE CUP',128,62);ctx.font='700 15px sans-serif';for(const [i,t] of ['FIGHT NIGHT','CREW MEETUP','ART CORNER','EVERYONE WELCOME'].entries())ctx.fillText(t,128,105+i*29);
      }else if(tile===13){
        ctx.fillStyle='#c4b998';ctx.fillRect(26,26,204,204);ctx.strokeStyle='#7c8f85';ctx.lineWidth=19;for(const x of [72,180]){ctx.beginPath();ctx.moveTo(x,38);ctx.lineTo(x,218);ctx.stroke();}for(const y of [80,176]){ctx.beginPath();ctx.moveTo(38,y);ctx.lineTo(218,y);ctx.stroke();}ctx.fillStyle='#815899';ctx.fillRect(101,102,57,52);ctx.textAlign='center';ctx.font='900 13px sans-serif';ctx.fillStyle='#fff2cb';ctx.fillText('YOU ARE HERE',128,148,50);
      }else if(tile===14){
        ctx.fillStyle='#9a929d';ctx.fillRect(26,26,204,204);ctx.fillStyle='#6b626f';for(let x=45;x<220;x+=22)ctx.fillRect(x,42,8,74);ctx.fillStyle='#d4bd7d';ctx.beginPath();ctx.moveTo(128,137);ctx.lineTo(170,201);ctx.lineTo(87,201);ctx.closePath();ctx.fill();ctx.fillStyle='#5c5167';ctx.font='900 42px sans-serif';ctx.textAlign='center';ctx.fillText('!',128,191);
      }else{
        ctx.fillStyle='#a58bb2';ctx.beginPath();for(let n=0;n<24;n++){const a=n*Math.PI/12,r=n%2?74:93;const x=128+Math.cos(a)*r,y=125+Math.sin(a)*r;if(n)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.closePath();ctx.fill();ctx.fillStyle='#e5dab6';for(const x of [93,147]){ctx.beginPath();ctx.ellipse(x,119,9,16,0,0,Math.PI*2);ctx.fill();}ctx.strokeStyle='#e5dab6';ctx.lineWidth=4;ctx.beginPath();ctx.arc(128,141,18,0,Math.PI);ctx.stroke();
      }
      ctx.restore();
    }
  });
  const panel=(name:string,side:Exclude<Policy,'fixed'|'ceiling'>,along:number,y:number,depth:number,w:number,h:number,tile:number)=>{
    const lateral=side==='left'||side==='right',sign=side==='front'||side==='right'?-1:1;
    const mesh=plane(name,lateral?depth*sign:along,y,lateral?along:depth*sign,w,h,atlas.mat,lateral?sign*Math.PI/2:sign<0?Math.PI:0,side);
    const uv=mesh.getVerticesData('uv')!;for(let i=0;i<uv.length;i+=2){const u=i<8?1-uv[i]:uv[i];uv[i]=((tile%4)+(u*.94+.03))/4;uv[i+1]=(3-Math.floor(tile/4)+(uv[i+1]*.94+.03))/4;}mesh.setVerticesData('uv',uv);
    facadePanels++;facadeSides[side]++;return mesh;
  };
  const edgeBox=(name:string,side:Exclude<Policy,'fixed'|'ceiling'>,along:number,y:number,depth:number,w:number,h:number,d:number,mat:StandardMaterial)=>{
    const lateral=side==='left'||side==='right',sign=side==='front'||side==='right'?-1:1;
    return box(name,lateral?depth*sign:along,y,lateral?along:depth*sign,lateral?d:w,h,lateral?w:d,mat,'details',side);
  };
  const identity=home?0:hall?1:night?3:festival?4:2;
  // Continuous kerbs and paving tie each arena to its neighborhood.
  for(const x of [-11.2,11.2])box('venue perimeter kerb',x,.09,0,.18,.18,19.2,roofTrim,'terrain');
  if(!night)box('rear perimeter kerb',0,.09,9.8,22.6,.18,.18,roofTrim,'terrain');
  box('entrance threshold and kerb',0,.06,-9.4,22.6,.12,.2,roofTrim,'terrain');
  for(const x of [-3.7,3.7]){
    cylinder('entrance bollard',x,.52,-12,.18,1,metal);blob('bollard cap',x,1.03,-12,.22,.12,.22,lamp,'details');
  }
  // Facades on all four sides, using each venue's actual wall extents.
  if(home||hall){
    const outer=home?10.44:10.54,front=home?9.04:9.25,back=home?8.99:9.25,height=home?6:8.5;
    for(const side of ['left','right'] as const){
      for(const u of [-5.6,0,5.6]){
        panel('exterior framed window',side,u,home?3.25:5.65,outer,1.7,home?2.1:2.8,home?11:10);
        edgeBox('exterior window lintel',side,u,home?4.4:7.15,outer+.03,2,.13,.23,roofTrim);
        edgeBox('exterior window sill',side,u,home?2.13:4.18,outer+.12,2,.16,.42,roofTrim);
      }
      for(const u of [-7.7,-2.8,2.8,7.7])edgeBox('exterior pilaster',side,u,height/2,outer+.05,.22,height,.18,roofTrim);
      edgeBox('exterior plinth',side,0,.34,outer,17.8,.6,.2,roofTrim);
    }
    panel('venue exterior name plaque','front',0,home?4.5:6.7,front,4,home?1:1.5,identity);
    for(const u of [-5.8,5.8])panel('front exterior window','front',u,home?3.1:5.9,front,1.8,2.2,home?11:10);
    panel('exterior entrance door','front',home?3.5:0,1.92,front+.01,home?1.9:3.5,3.8,8);
    panel('rear venue plaque','back',0,home?5.5:6.9,back,2.2,.7,identity);
    for(const u of [-7,7]){edgeBox('rear service downpipe','back',u,2.8,back+.12,.13,5.5,.13,metal);panel('rear service hatch','back',u,1.2,back+.15,.8,1.1,14);}
  }else if(!festival){
    for(const side of ['left','right'] as const){
      const depth=night?11.84:13.14;
      for(const u of [1.4,5.4]){
        panel('outer service louver',side,u,3.1,depth,1.5,1.35,9);
        edgeBox('service vent casing',side,u,3.1,depth-.18,1.7,1.55,.22,metal);
      }
      panel('outer electrical cabinet',side,-.6,1.35,depth+.03,1.15,1.65,14);
      edgeBox('outer utility riser',side,-1.5,3.1,depth+.1,.11,6,.11,metal);
      panel('side district plaque',side,4.1,6.5,depth,1.7,.85,identity);
    }
    if(night){
      for(const u of [-6,0,6])panel('front shop notice','front',u,3.9,12.14,2.1,1.3,u===0?identity:12);
      for(const u of [-6.7,6.7])panel('front shop shutter','front',u,1.65,12.15,2.1,2.6,9);
      for(const u of [-6,0,6])panel('inner reverse shop sign','front',u,4,9.81,2.1,.85,u===0?3:5);
      for(const u of [-4.5,4.5])panel('inner reverse shop door','front',u,1.55,9.8,1.05,2.8,8);
      panel('canal district information','back',7.8,1.6,8.29,1.1,1.2,13);
    }else{
      panel('front gate street plaque','front',-4.8,1.4,8.86,2,.65,identity);
      panel('front gate community notice','front',4.8,1.25,8.86,1.3,1.1,12);
      panel('back wall service hatch','back',-2.8,1.5,8.91,1.3,1.8,14);
      panel('rear tenement window','back',8.2,6.8,12.44,1.7,2.1,10);
    }
  }else{
    // The back of the stage gets a complete service facade and access doors.
    edgeBox('festival stage rear wall','back',0,2.1,10.04,9,4.2,.2,roofTrim);
    panel('backstage crew sign','back',0,3.1,10.17,3.8,1.1,4);
    for(const u of [-3.1,3.1])panel('backstage access door','back',u,1.55,10.18,1.35,2.8,8);
    for(const side of ['left','right'] as const){
      for(const u of [-4,0,4])panel('festival side barrier artwork',side,u,.8,10.4,2.4,1.15,u===0?4:15);
      edgeBox('festival side barrier',side,0,.65,10.48,14,1.3,.12,metal);
    }
    panel('festival gate name','front',0,3.8,12.6,4,1.2,4);
    for(const u of [-9,-4.5,0,4.5,9])panel('inner festival hoarding artwork','front',u,1.3,9.76,1.7,1.7,u===0?4:15);
    for(const x of [-3,3])rod('festival entry gate upright',[x,.1,-12.6],[x,4.6,-12.6],.08,metal);
    rod('festival entry header',[-3,4.5,-12.6],[3,4.5,-12.6],.08,metal);
  }

  let ceilingHeight:number|null=home?6.1:hall?8.65:null;
  if(ceilingHeight!==null){
    const plaster=color('interior ceiling plaster',home?'#dfc9b5':'#c7b0c9'),beam=color('interior roof framing',home?'#8e6954':'#9f7da9'),gilding=color('ceiling fixtures',home?'#b89876':'#d4b777');
    plaster.emissiveColor=plaster.diffuseColor.scale(.2);
    for(const side of ['front','back','left','right'] as const){
      const lateral=side==='left'||side==='right',depth=home?(lateral?10.2:side==='front'?8.8:8.75):(lateral?10.3:9);
      edgeBox('continuous upper wall infill',side,0,ceilingHeight-.4,depth,lateral?18.6:20.9,1,.46,beam);
      edgeBox('continuous ceiling cornice',side,0,ceilingHeight-.15,depth-.05,lateral?18.6:20.9,.2,.65,plaster);
      edgeBox('cornice lower moulding',side,0,ceilingHeight-.72,depth-.14,lateral?18.6:20.9,.1,.2,gilding);
    }
    box('complete indoor ceiling',0,ceilingHeight,0,20.5,.18,17.7,plaster,'ceiling','ceiling');
    for(let x=-9;x<=9;x+=3)box('ceiling coffer beam',x,ceilingHeight-.18,0,.16,.25,17.5,beam,'ceiling','ceiling');
    for(let z=-7.5;z<=7.5;z+=3)box('ceiling cross beam',0,ceilingHeight-.23,z,20.4,.21,.16,beam,'ceiling','ceiling');
    for(const z of [-3.2,3.2]){cylinder('ceiling rose',0,ceilingHeight-.3,z,.65,.12,gilding,'ceiling','ceiling');rod('hanging lamp cable',[0,ceilingHeight-.35,z],[0,ceilingHeight-1,z],.025,metal,'ceiling','ceiling');blob('pendant lamp shade',0,ceilingHeight-1,z,home?1.1:1.8,.42,home?1.1:1.8,gilding,'ceiling','ceiling');blob('pendant lamp diffuser',0,ceilingHeight-1.16,z,.7,.1,.7,lamp,'ceiling','ceiling');}
    if(home){cylinder('central ceiling light frame',0,5.82,0,1.45,.14,gilding,'ceiling','ceiling');blob('central warm ceiling diffuser',0,5.72,0,1.28,.12,1.28,lamp,'ceiling','ceiling');}
    if(hall){
      const chandelier=MeshBuilder.CreateTorus('central Hall chandelier',{diameter:3.3,thickness:.12,tessellation:36},scene);chandelier.position.set(0,7,0);add(chandelier,gilding,'ceiling','ceiling');
      for(let n=0;n<10;n++){const a=n*Math.PI/5;rod('chandelier chain',[0,8.5,0],[Math.sin(a)*1.6,7,Math.cos(a)*1.6],.02,gilding,'ceiling','ceiling');blob('chandelier lamp',Math.sin(a)*1.6,7.05,Math.cos(a)*1.6,.23,.4,.23,lamp,'ceiling','ceiling');}
    }
    for(const side of [-1,1]){const panel=box('exterior roof slope',side*5.2,ceilingHeight+1.3,0,10.8,.22,19,roof,'roof','ceiling');panel.rotation.z=-side*.23;}
    for(const [sign,policy] of [[-1,'front'],[1,'back']] as const){
      const z=sign*(home?9.02:9.23),base=ceilingHeight+.1,top=ceilingHeight+2.53;
      const gable=new Mesh('closed triangular roof gable',scene);
      gable.setVerticesData('position',[-10.5,base,z,10.5,base,z,0,top,z,0,top,z,10.5,base,z,-10.5,base,z]);
      gable.setVerticesData('uv',[0,0,1,0,.5,1,.5,1,1,0,0,0]);
      gable.setVerticesData('normal',[0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1]);gable.setIndices([0,1,2,3,4,5]);
      add(gable,roofTrim,'roof',policy);
    }
    for(const [x,policy] of [[-10.35,'right'],[10.35,'left']] as const)box('roof eaves',x,ceilingHeight+.1,0,.38,.4,18.3,roofTrim,'roof',policy);
    for(const [z,policy] of [[-8.9,'front'],[8.9,'back']] as const)box('gable fascia',0,ceilingHeight+.1,z,20.9,.4,.3,roofTrim,'roof',policy);
    if(home){
      const picture=painted('wall prints',256,256,ctx=>{ctx.fillStyle='#ddc3b0';ctx.fillRect(0,0,256,256);ctx.strokeStyle='#8b699f';ctx.lineWidth=10;ctx.strokeRect(12,12,232,232);ctx.fillStyle='#a07db0';ctx.beginPath();for(let n=0;n<16;n++){const a=n*Math.PI/8,r=n%2?62:85;if(n)ctx.lineTo(128+Math.cos(a)*r,128+Math.sin(a)*r);else ctx.moveTo(128+Math.cos(a)*r,128+Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.fillStyle='#ebddca';ctx.fillRect(99,112,12,23);ctx.fillRect(145,112,12,23);});
      for(const [x,policy,yaw] of [[9.96,'left',Math.PI/2],[-9.96,'right',-Math.PI/2]] as const)for(const z of [-5,-1,3])plane('framed wall art',x,3.3,z,1.35,1.6,picture.mat,yaw,policy);
      box('entry door',3.5,1.9,-8.57,1.9,3.8,.15,roofTrim,'details','front');panel('entry wooden door panel','front',3.5,1.9,8.43,1.5,3.35,8);blob('entry door handle',3.98,1.9,-8.35,.12,.12,.12,lamp,'details','front');
      for(const x of [-6,-2])plane('front gallery print',x,3.2,-8.55,1.4,1.5,picture.mat,Math.PI,'front');
    }else{
      for(const x of [-5,5]){box('Hall front door leaf',x*.25,2.3,-8.7,2.3,4.6,.18,roof,'details','front');for(const dx of [-1,1])box('Hall door gilding',x*.25+dx,2.3,-8.57,.07,4.3,.06,gilding,'details','front');}
      for(const x of [-7,-4,4,7])cylinder('Hall entrance column',x,3.3,-8.6,.45,6.6,gilding,'details','front');
      box('Hall front gallery',0,4.55,-8.15,20.5,.25,1.4,plaster,'details','front');rod('Hall front gallery rail',[-10,5.2,-7.5],[10,5.2,-7.5],.055,gilding,'details','front');
      for(let x=-9.5;x<=9.5;x+=.8)rod('Hall front gallery baluster',[x,4.7,-7.5],[x,5.2,-7.5],.035,gilding,'details','front');
      for(const x of [-8.4,-5.6,5.6,8.4]){
        panel('Hall entrance gallery banner','front',x,6.55,8.73,1.35,1.65,x<0?1:7);
        for(const dx of [-.8,.8])box('Hall front wall gilded panel',x+dx,2.3,-8.73,.05,3.6,.06,gilding,'details','front');
        for(const y of [.5,4.1])box('Hall front panel cross rail',x,y,-8.73,1.65,.05,.06,gilding,'details','front');
      }
      for(const side of ['left','right'] as const)for(const u of [-6,0,6])panel('upper Hall clerestory',side,u,6.6,10.04,1.4,1.65,10);
    }
  }

  for(const group of batches.values()){
    const mesh=group.meshes.length===1?group.meshes[0]:Mesh.MergeMeshes(group.meshes,true,true)!;
    const layer=group.policy!=='fixed'?'venue':'background';
    mesh.name=stage.name+' / environment / '+group.role+' / '+group.policy+' / '+mesh.material?.name;mesh.renderingGroupId=layer==='venue'?1:0;mesh.isPickable=false;mesh.metadata={environmentRole:group.role,environmentLayer:layer};mesh.freezeWorldMatrix();groups.push({mesh,role:group.role,policy:group.policy});
  }
  // Outside buildings on the camera side use an architectural cutaway when a
  // wide combat shot backs into the district. Terrain and the full sky remain.
  const foregroundPlane=new Plane(0,0,0,-1);
  for(const group of groups)if(group.role==='city'||group.role==='gardens'||(group.role==='details'&&group.policy==='fixed'))(group.mesh.material as StandardMaterial).clipPlane=foregroundPlane;
  let foregroundCutaway=false;
  const skyKind=night?'moon, stars and nocturnal clouds':festival?'festival dusk, stars and distant fireworks':home?'sunset, warm clouds and sun':'daylight, clouds and sun';
  const state={ceiling:1,back:1,front:1,left:1,right:1};
  return {
    sky:dome,skyTexture:sky.tex,
    updateCamera:(position:Vector3,dt:number)=>{
      const horizontal=new Vector3(position.x,0,position.z),radius=horizontal.length(),forward=scene.activeCamera?.getForwardRay().direction;
      foregroundCutaway=radius>28&&!!forward&&Vector3.Dot(horizontal.scale(-1/radius),forward)>.6;
      foregroundPlane.normal.copyFrom(foregroundCutaway?horizontal.scale(1/radius):Vector3.Zero());foregroundPlane.d=foregroundCutaway?-17:-1;
      const roofVisible=ceilingHeight===null?1:1-smooth(ceilingHeight-.4,ceilingHeight+.5,position.y);
      const indoors=1-smooth(9.2,11,Math.max(Math.abs(position.x)*.88,Math.abs(position.z)));
      const targets={ceiling:roofVisible*indoors,back:1-smooth(7.45,8.7,position.z),front:1-smooth(7.1,8.5,-position.z),left:1-smooth(8.7,10,position.x),right:1-smooth(8.7,10,-position.x)};
      for(const policy of Object.keys(state) as (keyof typeof state)[])state[policy]+=(targets[policy]-state[policy])*Math.min(1,dt*14);
      for(const group of groups)if(group.policy!=='fixed'){group.mesh.visibility=state[group.policy];group.mesh.setEnabled(group.mesh.visibility>.012);}
    },
    info:()=>({sky:skyKind,enclosedSky:true,terrainExtent:380,buildings,trees,details,facadePanels,facadeSides:{...facadeSides},closedCornices:ceilingHeight!==null,ceilingHeight,roofCutaway:state.ceiling,foregroundCutaway,meshes:groups.length+1,panoramaSize:[skyW,skyH]}),
  };
}
