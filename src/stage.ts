// Shared by rendered props, Rapier character collision and projectile blocking.
export const STAGE = { id: 'cwo-alley', name: 'CWO Alley', subtitle: 'METROPOLIS / 002' };
export const ARENA = { width: 20, depth: 17, radius: 0.35, centerHeight: 0.84 };
// Authored coordinates follow the 2D reference (door left, bins right).
export const ALLEY_PROPS = [
  { id: 'back-planter', kind: 'planter', x: -8.55, z: 6.45, w: 1.5, d: 1.35, h: 0.85 },
  { id: 'bins', kind: 'bins', x: 7.6, z: 7.1, w: 2.75, d: 1.4, h: 1.85 },
  { id: 'delivery-crates', kind: 'crates', x: -8.55, z: -4.9, w: 1.5, d: 1.35, h: 1.1 },
  { id: 'front-planter', kind: 'planter', x: 8.55, z: -4.9, w: 1.5, d: 1.35, h: 0.85 },
  { id: 'bicycle', kind: 'bike', x: 9, z: 8.1, w: 2.25, d: 0.65, h: 1.85 },
  { id: 'door-pot', kind: 'pot', x: -7.25, z: 7.3, w: 0.75, d: 0.75, h: 0.7 },
  { id: 'corner-pot', kind: 'pot', x: -9.25, z: 7.6, w: 0.75, d: 0.75, h: 0.7 },
] as const;
// In a right-handed +Z-facing camera, screen-left is world +X.
export const OBSTACLES = ALLEY_PROPS.map(o => ({ ...o, x: -o.x }));

export type StageId = 'rayj-house' | 'cwo-alley' | 'house-cup' | 'neon-street' | 'cwo-rally';
export interface StageObstacle { id: string; kind: string; x: number; z: number; w: number; d: number; h: number; }
export interface StageDefinition {
  id: StageId; name: string; subtitle: string; tag: string; time: string;
  sky: string; fog: string; sunlight: string; groundLight: string; sunIntensity: number; skyIntensity: number;
  obstacles: readonly StageObstacle[]; features: readonly string[];
}
export const STAGES: readonly StageDefinition[] = [
  { id: 'rayj-house', name: "Ray J's House", subtitle: 'METROPOLIS / 001', tag: 'Where the doodle began', time: 'SUNSET AT HOME',
    sky: '#d8a4a3', fog: '#c7979f', sunlight: '#ffe1a6', groundLight: '#987a9c', sunIntensity: .72, skyIntensity: .7,
    obstacles: [
      {id:'orange-sofa',kind:'sofa',x:0,z:6.65,w:8.2,d:2.1,h:1.75},
      {id:'drawing-desk',kind:'desk',x:8.1,z:5.8,w:3.2,d:2.2,h:1.4},
      {id:'purple-beanbag',kind:'beanbag',x:-8.1,z:5.85,w:2.5,d:2.1,h:1.2},
      {id:'bookcase',kind:'bookcase',x:-9.3,z:1.6,w:1.1,d:4.6,h:3.6},
      {id:'monstera',kind:'plant',x:5.5,z:6.7,w:1.25,d:1.25,h:2.5},
    ],features:['orange sofa','sunset window','drawing desk','wood floor','bookshelves','beanbag','hanging plants'] },
  { id:'cwo-alley', name:'CWO Alley', subtitle:'METROPOLIS / 002', tag:'Leave your mark', time:'AFTERNOON MISCHIEF',
    sky:'#c6bad8',fog:'#c6bad8',sunlight:'#fff1d9',groundLight:'#a393ac',sunIntensity:.65,skyIntensity:.65,
    obstacles:OBSTACLES,features:['graffiti mural','brick courtyard','bicycle','bins','crates','ivy','rooftops'] },
  { id:'house-cup', name:'House Cup Hall', subtitle:'METROPOLIS / 003',tag:'One cup. Twelve challengers.',time:'COMMUNITY CELEBRATION',
    sky:'#b69ac5',fog:'#aa8cbd',sunlight:'#ffe5b0',groundLight:'#9972b3',sunIntensity:.8,skyIntensity:.72,
    obstacles:[
      {id:'trophy-dais',kind:'dais',x:0,z:7.05,w:7.4,d:3.2,h:1.5},
      {id:'flower-column-left',kind:'column',x:7.2,z:5.2,w:1.4,d:1.4,h:3.7},
      {id:'flower-column-right',kind:'column',x:-7.2,z:5.2,w:1.4,d:1.4,h:3.7},
      {id:'left-display',kind:'display',x:8.6,z:-2,w:1.5,d:2,h:1.8},
      {id:'right-display',kind:'display',x:-8.6,z:-2,w:1.5,d:2,h:1.8},
    ],features:['giant golden trophy','ceremonial dais','arched galleries','balconies','CHOG banners','golden tiles','bunting'] },
  {id:'neon-street',name:'Neon CWO Street',subtitle:'METROPOLIS / 004',tag:'The city joins the chaos',time:'NEON NIGHT',
    sky:'#292349',fog:'#3c2c63',sunlight:'#b9bbef',groundLight:'#6d4b96',sunIntensity:.48,skyIntensity:.82,
    obstacles:[
      {id:'noodle-counter',kind:'stall',x:-8.5,z:5.5,w:2.1,d:3.6,h:1.7},
      {id:'shop-planter',kind:'plant',x:8.4,z:5.5,w:1.5,d:1.5,h:1.8},
      {id:'neon-sign',kind:'sign',x:6.8,z:6.9,w:1.1,d:1,h:1.4},
      {id:'street-bin',kind:'bin',x:-8.3,z:-4.4,w:1.1,d:1.1,h:1.3},
      {id:'canal-bollard',kind:'bollard',x:4.9,z:7.7,w:.8,d:.8,h:1.1},
    ],features:['CWO storefront','noodle stall','canal','raised bridge','neon skyline','wet pavement','hanging bulbs'] },
  {id:'cwo-rally',name:'CWO Rally',subtitle:'METROPOLIS / 005',tag:'Turn up the crowd',time:'PURPLE SPOTLIGHTS',
    sky:'#6b4c8d',fog:'#72528b',sunlight:'#ddbded',groundLight:'#8053a5',sunIntensity:.48,skyIntensity:.85,
    obstacles:[
      {id:'dj-stage',kind:'dais',x:0,z:7.2,w:8,d:2.6,h:1.4},
      {id:'left-speaker',kind:'speaker',x:8.15,z:5.6,w:1.65,d:1.65,h:4},
      {id:'right-speaker',kind:'speaker',x:-8.15,z:5.6,w:1.65,d:1.65,h:4},
      {id:'left-barricade',kind:'barrier',x:8.8,z:-2.8,w:.65,d:3.5,h:1.2},
      {id:'right-barricade',kind:'barrier',x:-8.8,z:-2.8,w:.65,d:3.5,h:1.2},
    ],features:['DJ booth','circular truss','speaker stacks','CHOG LED wall','crowd','moving light beams','confetti'] },
];
export function getStage(id: string): StageDefinition {
  const stage = STAGES.find(stage => stage.id === id);
  if (!stage) throw new Error('Unknown arena: ' + id);
  return stage;
}
