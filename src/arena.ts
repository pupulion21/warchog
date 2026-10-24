import {
  Color3, DynamicTexture, Mesh, MeshBuilder, Quaternion, StandardMaterial, Texture, TransformNode, Vector3,
  type Scene, type ShadowGenerator,
} from './babylon.ts';
import { ALLEY_PROPS, ARENA, OBSTACLES, STAGE } from './stage.ts';

export const PALETTE = { ink: '#292337', cream: '#eee8da', purple: '#7650b4', lilac: '#b398d7', coral: '#ed876b', lime: '#d9ed8b' };
export function material(scene: Scene, name: string, color: string, emissive = false) {
  const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(color);
  m.specularColor = new Color3(0.07, 0.06, 0.08);
  if (emissive) m.emissiveColor = Color3.FromHexString(color).scale(0.8);
  return m;
}

type Zone = 'fixed' | 'back' | 'left' | 'right' | 'front';
export function createArena(scene: Scene, shadows: ShadowGenerator) {
  const stageRoot = new TransformNode('CWO Alley reference coordinates', scene);
  stageRoot.scaling.x = -1;
  stageRoot.freezeWorldMatrix();
  const pending: Promise<void>[] = [];
  const textures: Texture[] = [];
  const batches = new Map<string, { meshes: Mesh[]; zone: Zone; cast: boolean }>();
  const cameraOccluders: Mesh[] = [];
  const walls: Record<Exclude<Zone, 'fixed'>, { meshes: Mesh[]; visibility: number }> = {
    back: { meshes: [], visibility: 1 }, left: { meshes: [], visibility: 1 },
    right: { meshes: [], visibility: 1 }, front: { meshes: [], visibility: 1 },
  };
  let seed = 268;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const color = (name: string, hex: string, glow = false) => material(scene, 'alley / ' + name, hex, glow);
  function textured(name: string, file: string, u = 1, v = 1, alpha = false) {
    const m = color(name, '#ffffff');
    let loaded!: () => void, failed!: (error: Error) => void;
    pending.push(new Promise<void>((resolve, reject) => { loaded = resolve; failed = reject; }));
    const texture = new Texture('/assets/alley/' + file, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE,
      loaded, () => failed(new Error('Could not load CWO Alley texture: ' + file)));
    texture.uScale = u; texture.vScale = v; texture.anisotropicFilteringLevel = 4;
    texture.hasAlpha = alpha; textures.push(texture); m.diffuseTexture = texture;
    if (alpha) { m.useAlphaFromDiffuseTexture = true; m.backFaceCulling = false; m.zOffset = -1; }
    return m;
  }
  function add(mesh: Mesh, m: StandardMaterial, zone: Zone = 'fixed', cast = true, cameraSolid = false) {
    mesh.material = m; mesh.receiveShadows = !m.disableLighting; mesh.isPickable = cameraSolid;
    if (cameraSolid) {
      mesh.parent = stageRoot;
      cameraOccluders.push(mesh); if (cast) shadows.addShadowCaster(mesh);
      if (zone !== 'fixed') walls[zone].meshes.push(mesh);
    } else {
      const key = `${zone}/${m.name}/${cast}`;
      if (!batches.has(key)) batches.set(key, { meshes: [], zone, cast });
      batches.get(key)!.meshes.push(mesh);
    }
    return mesh;
  }
  function box(name: string, x: number, y: number, z: number, w: number, h: number, d: number,
    m: StandardMaterial, zone: Zone = 'fixed', cast = true, cameraSolid = false) {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z); return add(mesh, m, zone, cast, cameraSolid);
  }
  function rod(name: string, from: number[], to: number[], radius: number, m: StandardMaterial, zone: Zone = 'fixed', cast = true) {
    const a = Vector3.FromArray(from), b = Vector3.FromArray(to), delta = b.subtract(a);
    const mesh = MeshBuilder.CreateCylinder(name, { height: delta.length(), diameter: radius * 2, tessellation: 8 }, scene);
    mesh.position.copyFrom(a.add(b).scale(0.5));
    mesh.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), delta.normalize(), mesh.rotationQuaternion);
    return add(mesh, m, zone, cast);
  }
  function tube(name: string, points: number[][], radius: number, m: StandardMaterial, zone: Zone = 'fixed', cast = true) {
    return add(MeshBuilder.CreateTube(name, { path: points.map(p => Vector3.FromArray(p)), radius, tessellation: 7, cap: Mesh.CAP_ALL }, scene), m, zone, cast);
  }
  function blob(name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    m: StandardMaterial, zone: Zone = 'fixed', cast = true) {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 5 }, scene);
    mesh.position.set(x, y, z); mesh.scaling.set(sx, sy, sz); return add(mesh, m, zone, cast);
  }
  function decal(name: string, x: number, y: number, z: number, w: number, h: number,
    m: StandardMaterial, zone: Zone = 'back', yaw = 0, tilt = 0) {
    const mesh = MeshBuilder.CreatePlane(name, { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.position.set(x, y, z); mesh.rotation.set(0, yaw, tilt); return add(mesh, m, zone, false);
  }
  function painted(name: string, draw: (context: CanvasRenderingContext2D) => void, w = 512, h = 512) {
    const tex = new DynamicTexture(name, { width: w, height: h }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D; ctx.clearRect(0, 0, w, h); draw(ctx); tex.update();
    const m = color(name, '#ffffff'); m.diffuseTexture = tex; m.useAlphaFromDiffuseTexture = true;
    m.specularColor = Color3.Black(); m.zOffset = -2; return m;
  }

  const brick = textured('salmon brick', 'brick.webp', 6, 1.8);
  const paving = textured('patched pavement', 'pavement.webp', 4, 3.4);
  const mural = textured('original Metropolis mural', 'mural.webp', 1, 1, true);
  const posterMats = ['skull', 'crown', 'doodle'].map(name => {
    return textured(name + ' poster', name + '.webp');
  });
  const plaster = color('old cream plaster', '#d3b39a'), cap = color('sandstone caps', '#d9bb9c');
  const dark = color('warm charcoal', '#3b3445'), steel = color('weathered iron', '#615a67');
  const wood = [color('cedar', '#9d6b49'), color('cedar faded', '#aa7753'), color('cedar dark', '#8e6045')];
  const woodDark = color('timber frame', '#644638'), terra = color('terracotta', '#b97653');
  const purple = color('purple wheelie bin', '#795394'), green = color('green wheelie bin', '#547a64');
  const leafMats = [color('ivy shaded', '#657249'), color('ivy green', '#849549'), color('ivy sunlight', '#abb750')];
  const gold = color('bike orange', '#edab53'), cream = color('sticker paper', '#f2e1b9');
  const glass = color('dusty lavender glass', '#72718c'), warmGlass = color('sunlit glass', '#dfc28f');
  const bulb = color('warm lamp bulb', '#ffe2a1', true);

  box('street foundation', 0, -0.3, 0, 20.6, 0.5, 17.6, color('surrounding street', '#9f91a6'), 'fixed', false);
  const ground = MeshBuilder.CreateGround('CWO Alley walkable pavement', { width: ARENA.width, height: ARENA.depth }, scene);
  add(ground, paving, 'fixed', false);
  const curbMat = [cap, color('curb dark', '#bb9e8d')];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 18; i++) box('side curb', side * 10.13, 0.12, -8.05 + i * 0.95, 0.32, 0.24, 0.91, curbMat[i % 2], side < 0 ? 'left' : 'right', false);
    for (let i = 0; i < 21; i++) box('end curb', -9.5 + i * 0.95, 0.12, side * 8.63, 0.91, 0.24, 0.3, curbMat[i % 2], side < 0 ? 'front' : 'back', false);
  }

  // Three built walls and a low front railing form a courtyard, with an open fighting center.
  box('mural brick wall', 0, 2.65, 8.8, 20.6, 5.3, 0.6, brick, 'back');
  box('back coping', 0, 5.33, 8.78, 20.8, 0.23, 0.83, cap, 'back');
  for (const [x, zone] of [[-10.3, 'left'], [10.3, 'right']] as const) {
    box('side brick wall', x, 2.25, 0, 0.6, 4.5, 17.7, brick, zone);
    box('side coping', x, 4.55, 0, 0.82, 0.18, 17.8, cap, zone);
    box('side plaster band', x + (x < 0 ? 0.315 : -0.315), 3.25, 1, 0.025, 1.7, 13, plaster, zone, false);
  }
  box('front low brick wall', 0, 0.35, -8.8, 20.6, 0.7, 0.6, brick, 'front');
  box('front coping', 0, 0.75, -8.8, 20.8, 0.16, 0.8, cap, 'front', false);
  for (let x = -9.8; x < 10; x += 0.62) rod('front fence upright', [x, 0.8, -8.8], [x, 1.95, -8.8], 0.025, dark, 'front', false);
  for (const y of [1.05, 1.85]) rod('front fence rail', [-10.1, y, -8.8], [10.1, y, -8.8], 0.04, dark, 'front', false);

  decal('CWO original graffiti mural', 0.7, 2.62, 8.478, 13.1, 5.52, mural);
  decal('skull poster', -5.8, 3.7, 8.46, 0.48, 0.62, posterMats[0], 'back', 0, 0.07);
  decal('crown poster', 8.35, 3.7, 8.46, 0.7, 0.85, posterMats[1], 'back', 0, -0.14);
  decal('green doodle poster', 7.4, 2.7, 8.46, 0.56, 0.72, posterMats[2], 'back', 0, 0.09);
  decal('left wall crown poster', -9.978, 2.5, 0.7, 0.7, 0.85, posterMats[1], 'left', -Math.PI / 2, 0.08);
  decal('right wall doodle poster', 9.978, 2.55, -0.6, 0.56, 0.72, posterMats[2], 'right', Math.PI / 2, -0.06);

  // Recessed wooden door and the distinctive bent drainpipe from the 2D reference.
  box('door deep frame', -7.8, 1.85, 8.36, 2, 3.7, 0.34, woodDark, 'back');
  for (let i = 0; i < 7; i++) box('individual door board', -8.57 + i * 0.255, 1.78, 8.15, 0.247, 3.36, 0.1, wood[i % 3], 'back', false);
  for (const y of [0.24, 3.39]) box('door crosspiece', -7.8, y, 8.08, 1.8, 0.12, 0.13, woodDark, 'back');
  box('door mail slot rim', -7.8, 1.31, 8.045, 0.72, 0.22, 0.13, steel, 'back');
  box('door mail slot', -7.8, 1.31, 7.97, 0.57, 0.1, 0.015, dark, 'back', false);
  blob('door knob', -7.16, 1.65, 8.02, 0.12, 0.12, 0.12, steel, 'back');
  tube('bent rain downpipe', [[-6.4, 7.4, 8.25], [-6.4, 1, 8.25], [-6.4, 0.42, 8.25], [-6.4, 0.24, 7.84], [-6.4, 0.24, 7.59]], 0.13, steel, 'back');
  for (const y of [1.45, 3.1, 4.7, 6.3]) {
    const ring = MeshBuilder.CreateTorus('pipe collar', { diameter: 0.29, thickness: 0.048, tessellation: 10 }, scene);
    ring.position.set(-6.4, y, 8.25); add(ring, dark, 'back');
  }
  tube('lamp gooseneck', [[-7.8, 4.3, 8.42], [-7.8, 4.3, 7.96], [-7.8, 4.14, 7.77]], 0.045, dark, 'back');
  const shade = MeshBuilder.CreateCylinder('door lamp shade', { height: 0.3, diameterTop: 0.2, diameterBottom: 0.72, tessellation: 16 }, scene);
  shade.position.set(-7.8, 4.06, 7.77); add(shade, dark, 'back');
  blob('door lamp warm globe', -7.8, 3.93, 7.77, 0.3, 0.25, 0.3, bulb, 'back', false);

  // Surrounding facades have depth, side faces, windows and roof hardware.
  box('left rear tenement', -8.2, 4.9, 10.7, 4.8, 9.8, 3.4, plaster, 'back');
  box('left rear roof', -8.2, 9.85, 10.7, 5.1, 0.22, 3.7, terra, 'back');
  for (const x of [-9.1, -7.15]) {
    box('back window iron frame', x, 7, 8.94, 1.3, 1.9, 0.12, dark, 'back');
    box('back window glass', x, 7, 8.86, 1.1, 1.7, 0.025, glass, 'back', false);
    box('back window mullion', x, 7, 8.82, 0.065, 1.75, 0.06, cap, 'back');
    box('back window sill', x, 6.03, 8.72, 1.55, 0.17, 0.5, cap, 'back');
  }
  box('old air conditioner', -5.95, 6.3, 9.1, 0.95, 0.65, 0.5, steel, 'back');
  for (let i = 0; i < 5; i++) box('AC vent', -5.95, 6.08 + i * 0.1, 8.83, 0.76, 0.035, 0.025, dark, 'back', false);
  for (const [x, zone] of [[-11.7, 'left'], [11.7, 'right']] as const) {
    const sign = x < 0 ? 1 : -1;
    box('side tenement upper', x, 5, 3.6, 2.8, 10, 9.3, plaster, zone);
    box('side roof', x, 10.05, 3.6, 3.1, 0.23, 9.6, terra, zone);
    for (const z of [0.5, 3.4, 6.3]) {
      box('side window frame', x + sign * 1.43, 6.8, z, 0.12, 1.7, 1.15, dark, zone);
      box('side window glass', x + sign * 1.5, 6.8, z, 0.025, 1.5, 0.95, z === 3.4 ? warmGlass : glass, zone, false);
      box('side window mullion', x + sign * 1.53, 6.8, z, 0.04, 1.5, 0.06, cap, zone);
      box('side window sill', x + sign * 1.62, 5.91, z, 0.5, 0.12, 1.5, cap, zone);
    }
  }
  const distant = [color('distant lilac', '#a79ab6'), color('distant rose', '#c5aaa9'), color('distant blue', '#9e9fb8')];
  for (let i = 0; i < 8; i++) {
    const x = -17 + i * 5, h = 5 + random() * 5;
    box('neighborhood skyline', x, h / 2, 18 + i % 2 * 3, 3.4, h, 4, distant[i % 3], 'back', false);
    for (let row = 0; row < 3; row++) for (let column = 0; column < 2; column++)
      box('distant window', x - 0.7 + column * 1.3, h - 1.1 - row * 1.25, 15.98 + i % 2 * 3, 0.45, 0.62, 0.035, glass, 'back', false);
  }
  for (const x of [-4.4, -2.8]) for (const z of [15, 16.6]) rod('water tower legs', [x, 6, z], [x, 10, z], 0.065, steel, 'back');
  const tank = MeshBuilder.CreateCylinder('neighborhood water tower', { height: 2.25, diameter: 2.5, tessellation: 12 }, scene);
  tank.position.set(-3.6, 10.4, 15.8); add(tank, wood[1], 'back');
  const tankRoof = MeshBuilder.CreateCylinder('water tower cap', { height: 0.55, diameterTop: 0, diameterBottom: 2.8, tessellation: 12 }, scene);
  tankRoof.position.set(-3.6, 11.79, 15.8); add(tankRoof, terra, 'back');
  for (const y of [9.5, 11.2]) {
    const band = MeshBuilder.CreateTorus('water tower metal band', { diameter: 2.51, thickness: 0.065, tessellation: 16 }, scene);
    band.position.set(-3.6, y, 15.8); add(band, steel, 'back');
  }
  for (const x of [-9.8, 9.8]) {
    rod('utility pole', [x, 0, 9.35], [x, 8.2, 9.35], 0.12, woodDark, 'back');
    rod('utility crossarm', [x - 0.65, 7.7, 9.35], [x + 0.65, 7.7, 9.35], 0.065, wood[1], 'back');
  }
  for (const offset of [0, 0.42]) {
    const points = Array.from({ length: 17 }, (_, i) => {
      const t = i / 16; return [-9.8 + t * 19.6, 7.8 - Math.sin(t * Math.PI) * 1.3, 9.35 + offset];
    });
    tube('sagging overhead cable', points, 0.024, dark, 'back', false);
  }
  for (let x = -4.5; x <= 9.5; x += 0.6) rod('back iron railing', [x, 5.45, 8.8], [x, 6.13, 8.8], 0.024, dark, 'back');
  rod('back top rail', [-4.6, 6.03, 8.8], [9.7, 6.03, 8.8], 0.035, dark, 'back');

  const crownPaint = painted('bin painted crown', ctx => {
    ctx.strokeStyle = '#e3d0d9'; ctx.lineWidth = 20; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(95, 330); ctx.lineTo(75, 175); ctx.lineTo(192, 256);
    ctx.lineTo(258, 125); ctx.lineTo(324, 256); ctx.lineTo(438, 171); ctx.lineTo(412, 330); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(105, 374); ctx.lineTo(405, 374); ctx.stroke();
  });
  function bin(x: number, z: number, m: StandardMaterial, height: number) {
    box('wheelie bin body', x, height / 2 + 0.06, z, 1.13, height - 0.12, 1.12, m, 'fixed', true, true);
    box('wheelie bin top rim', x, height - 0.02, z, 1.27, 0.15, 1.24, dark);
    box('wheelie bin lid', x, height + 0.09, z - 0.025, 1.3, 0.12, 1.28, m);
    box('bin lid grip', x, height + 0.19, z - 0.37, 0.5, 0.08, 0.1, dark);
    for (const side of [-1, 1]) {
      rod('bin wheel', [x + side * 0.5 - 0.07, 0.17, z + 0.41], [x + side * 0.5 + 0.07, 0.17, z + 0.41], 0.17, dark);
      box('bin side stiffener', x + side * 0.48, height / 2, z - 0.57, 0.035, height * 0.72, 0.04, dark, 'fixed', false);
    }
    decal('bin crown graffiti', x, height * 0.57, z - 0.569, 0.75, 0.74, crownPaint, 'fixed');
  }
  for (const o of ALLEY_PROPS) {
    if (o.kind === 'bins') {
      bin(o.x - 0.72, o.z, green, 1.45); bin(o.x + 0.67, o.z, purple, 1.85);
    } else if (o.kind === 'planter') {
      box(o.id + ' stone planter', o.x, o.h / 2, o.z, o.w, o.h, o.d, terra, 'fixed', true, true);
      box(o.id + ' planter rim', o.x, o.h, o.z, o.w + 0.06, 0.14, o.d + 0.06, cap);
      box(o.id + ' soil', o.x, o.h + 0.08, o.z, o.w - 0.18, 0.03, o.d - 0.18, woodDark, 'fixed', false);
      for (let i = 0; i < 10; i++) {
        const x = o.x + (random() - 0.5) * 0.9, z = o.z + (random() - 0.5) * 0.8;
        const leaf = blob('planter pointed leaf', x, o.h + 0.4 + random() * 0.5, z, 0.3, 0.9, 0.2, leafMats[i % 3]);
        leaf.rotation.z = (random() - 0.5) * 1.5;
      }
    } else if (o.kind === 'crates') {
      box('delivery crate collision body', o.x, o.h / 2, o.z, o.w, o.h, o.d, wood[0], 'fixed', true, true);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          box('crate horizontal slat', o.x, 0.14 + i * 0.27, o.z + side * (o.d / 2 + 0.03), o.w + 0.07, 0.16, 0.07, wood[1]);
          box('crate side slat', o.x + side * (o.w / 2 + 0.03), 0.14 + i * 0.27, o.z, 0.07, 0.16, o.d, wood[1]);
        }
        for (const end of [-1, 1]) box('crate vertical brace', o.x + side * 0.58, 0.55, o.z + end * (o.d / 2 + 0.08), 0.13, 1.1, 0.08, woodDark);
      }
      box('crate shipping label', o.x + 0.1, 0.65, o.z - o.d / 2 - 0.095, 0.36, 0.24, 0.015, cream, 'fixed', false);
    }
  }
  const bikeProp = ALLEY_PROPS.find(o => o.kind === 'bike')!;
  const bx = bikeProp.x, bz = bikeProp.z;
  const bike = (p: number[]) => [bx + p[0], p[1], bz + p[2]];
  for (const x of [-0.78, 0.78]) {
    for (const [diameter, thickness, m] of [[1.22, 0.095, dark], [1.12, 0.026, cap]] as const) {
      const wheel = MeshBuilder.CreateTorus('bicycle wheel', { diameter, thickness, tessellation: 24 }, scene);
      wheel.position.set(bx + x, 0.68, bz); wheel.rotation.x = Math.PI / 2; add(wheel, m, 'back');
    }
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2;
      rod('bicycle spoke', bike([x, 0.68, 0]), bike([x + Math.sin(angle) * 0.55, 0.68 + Math.cos(angle) * 0.55, 0]), 0.009, steel, 'back', false);
    }
  }
  const rear = [-0.78, 0.68, 0], crank = [-0.02, 0.66, 0], saddle = [-0.28, 1.45, 0], head = [0.46, 1.48, 0], front = [0.78, 0.68, 0];
  for (const [a, b] of [[rear, crank], [rear, saddle], [crank, saddle], [saddle, head], [crank, head], [head, front]]) rod('orange bicycle frame', bike(a), bike(b), 0.045, gold, 'back');
  rod('bike saddle post', bike(saddle), bike([-0.32, 1.67, 0]), 0.035, steel, 'back');
  box('bike saddle', bx - 0.34, 1.71, bz, 0.4, 0.1, 0.22, dark, 'back');
  tube('bike handlebars', [bike(head), bike([0.4, 1.79, 0]), bike([0.4, 1.82, 0.28]), bike([0.53, 1.78, 0.3])], 0.035, steel, 'back');
  rod('bike crank', bike([0.02, 0.68, -0.14]), bike([0.02, 0.46, -0.14]), 0.025, dark, 'back');
  box('bike pedal', bx + 0.02, 0.46, bz - 0.2, 0.22, 0.065, 0.18, dark, 'back');

  // Ivy has actual depth and wraps onto side walls instead of facing the camera.
  function ivy(x: number, y: number, z: number, zone: Zone, length: number, direction = 0) {
    const points: number[][] = [];
    for (let i = 0; i <= 5; i++) {
      const sway = Math.sin(i * 1.8 + x) * 0.13;
      points.push([x + (direction ? 0 : sway), y - length * i / 5, z + (direction ? sway : 0)]);
    }
    tube('ivy hanging vine', points, 0.023, leafMats[0], zone, false);
    for (let i = 0; i < 8; i++) {
      const t = i / 8, side = i % 2 ? -1 : 1;
      const leaf = MeshBuilder.CreatePolyhedron('ivy pointed leaf', { type: 1, size: 0.5 }, scene);
      leaf.position.set(x + (direction ? 0 : side * 0.16), y - length * t, z + (direction ? side * 0.16 : -0.03));
      leaf.scaling.set(direction ? 0.07 : 0.4, 0.46, direction ? 0.4 : 0.07);
      add(leaf, leafMats[i % 3], zone, false);
      leaf.rotation.z = direction ? 0 : side * 0.6;
      leaf.rotation.x = direction ? side * 0.6 : 0;
    }
  }
  for (const x of [-9.6, -8.9, -7.8, -6.7, -5.5, -4.6, 4.8, 6, 7, 8.2, 9.4]) ivy(x, 5.5 + random() * 0.3, 8.31, 'back', 0.7 + random() * 1.7);
  for (const x of [-9.6, -8.9, -7]) ivy(x, 9.6, 8.93, 'back', 1.1 + random() * 1.5);
  for (const [x, zone] of [[-9.92, 'left'], [9.92, 'right']] as const)
    for (const z of [-5.3, -2.7, 0.4, 3, 5.5, 7.4]) ivy(x, 4.65, z, zone, 0.7 + random() * 1.7, 1);
  for (const { x, z } of ALLEY_PROPS.filter(o => o.kind === 'pot')) {
    const pot = MeshBuilder.CreateCylinder('door terracotta pot', { height: 0.7, diameterTop: 0.75, diameterBottom: 0.5, tessellation: 10 }, scene);
    pot.position.set(x, 0.35, z); add(pot, terra, 'back');
    for (let i = 0; i < 6; i++) {
      const leaf = blob('door plant', x + (random() - 0.5) * 0.5, 0.9 + random() * 0.4, z, 0.24, 0.8, 0.22, leafMats[i % 3], 'back');
      leaf.rotation.z = (i - 3) * 0.3;
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = -15 + random() * 31, y = 4 + random() * 3, z = 14 + random() * 5;
    blob('neighborhood treetop', x, y, z, 3.5 + random() * 2, 3 + random() * 2, 3, leafMats[i % 3], 'back', false);
  }
  for (const x of [-6, 5.5]) {
    box('storm drain surround', x, 0.006, -7.95, 1.3, 0.012, 0.47, steel, 'fixed', false);
    for (let i = 0; i < 10; i++) box('storm drain slot', x - 0.54 + i * 0.12, 0.015, -7.95, 0.045, 0.007, 0.35, dark, 'fixed', false);
  }
  for (let i = 0; i < 24; i++) {
    const x = -9.4 + random() * 18.8, z = i % 2 ? 8.25 : -8.2;
    const leaf = blob('curb weed', x, 0.15, z, 0.11, 0.36, 0.12, leafMats[i % 3], 'fixed', false);
    leaf.rotation.z = (random() - 0.5) * 0.8;
  }
  const streetSign = painted('CWO alley street sign', ctx => {
    ctx.fillStyle = '#49334f'; ctx.fillRect(0, 0, 768, 192);
    ctx.strokeStyle = '#e9d6b9'; ctx.lineWidth = 5; ctx.strokeRect(9, 9, 750, 174);
    ctx.fillStyle = '#f5e3ba'; ctx.textAlign = 'center'; ctx.font = '900 76px sans-serif'; ctx.fillText('CWO ALLEY', 384, 110);
    ctx.font = '20px monospace'; ctx.fillText('GOOD FRIENDS. FRIENDLY FIGHTS.', 384, 151);
  }, 768, 192);
  decal('street name sign', -7.8, 5.05, 8.1, 2.6, 0.65, streetSign);

  // The unseen reverse of the 2D drawing becomes a street beyond the courtyard fence.
  box('street outside front gate', 0, -0.035, -12.4, 50, 0.06, 6.1, color('street asphalt', '#82788e'), 'front', false);
  box('opposite pavement', 0, 0.04, -15.5, 45, 0.16, 1.7, cap, 'front', false);
  const shopColors = [color('opposite shop plum', '#9b809c'), color('opposite shop peach', '#c99a83'), color('opposite shop sage', '#8e9b86')];
  for (let i = 0; i < 5; i++) {
    const x = -16 + i * 8, height = 6 + (i % 3) * 1.5;
    box('opposite shop building', x, height / 2, -19.2, 7.7, height, 5.7, shopColors[i % 3], 'front', false);
    box('shop cornice', x, height + 0.05, -19.2, 8, 0.2, 6, cream, 'front', false);
    box('shop front window frame', x + 0.85, 1.7, -16.31, 4.6, 2.6, 0.13, dark, 'front', false);
    box('shop front window', x + 0.85, 1.7, -16.23, 4.35, 2.35, 0.025, glass, 'front', false);
    box('shop window mullion', x + 0.85, 1.7, -16.19, 0.07, 2.4, 0.04, cream, 'front', false);
    box('shop door', x - 2.55, 1.5, -16.24, 1.4, 3, 0.14, woodDark, 'front', false);
    box('shop door glass', x - 2.55, 1.9, -16.15, 1.05, 1.65, 0.03, warmGlass, 'front', false);
    for (let j = 0; j < 8; j++) {
      const awning = box('striped shop awning', x - 2.8 + j * 0.81, 3.5, -15.85, 0.8, 0.12, 1.55,
        j % 2 ? cream : purple, 'front', false);
      awning.rotation.x = -0.12;
    }
    for (const offset of [-2.1, 0, 2.1]) {
      box('shop upper window frame', x + offset, 5.05, -16.31, 1.25, 1.5, 0.1, cream, 'front', false);
      box('shop upper window', x + offset, 5.05, -16.24, 1.05, 1.3, 0.025, glass, 'front', false);
    }
  }
  for (const x of [-11.5, 11.5]) {
    rod('street light pole', [x, 0, -14.8], [x, 5.8, -14.8], 0.065, dark, 'front', false);
    tube('street light arm', [[x, 5.8, -14.8], [x, 5.8, -14.2], [x, 5.6, -14]], 0.045, dark, 'front', false);
    blob('street lamp', x, 5.55, -14, 0.5, 0.18, 0.5, bulb, 'front', false);
  }

  // Batch by material and cutaway side; camera-solid props keep their own bounds.
  for (const [name, batch] of batches) {
    const merged = batch.meshes.length === 1 ? batch.meshes[0] : Mesh.MergeMeshes(batch.meshes, true, true)!;
    merged.name = 'CWO Alley / ' + name; merged.isPickable = false;
    merged.parent = stageRoot;
    merged.receiveShadows = true; merged.freezeWorldMatrix();
    if (batch.cast) shadows.addShadowCaster(merged);
    if (batch.zone !== 'fixed') walls[batch.zone].meshes.push(merged);
  }
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const cutaway = { back: 1, left: 1, right: 1, front: 1 };
  function updateCamera(position: Vector3, dt: number) {
    const target = {
      back: 1 - smooth(7.5, 8.7, position.z), front: 1 - smooth(7.1, 8.5, -position.z),
      left: 1 - smooth(8.7, 10, position.x), right: 1 - smooth(8.7, 10, -position.x),
    };
    for (const side of Object.keys(walls) as (keyof typeof walls)[]) {
      const wall = walls[side]; wall.visibility += (target[side] - wall.visibility) * Math.min(1, dt * 14);
      cutaway[side] = wall.visibility;
      for (const mesh of wall.meshes) { mesh.visibility = wall.visibility; mesh.setEnabled(wall.visibility > 0.012); }
    }
  }
  return {
    ground, cameraOccluders, updateCamera, ready: Promise.all(pending),
    info: () => ({ ...STAGE, width: ARENA.width, depth: ARENA.depth, obstacles: OBSTACLES,
      texturesReady: textures.every(t => t.isReady()), cutaway: { ...cutaway },
      staticBatches: batches.size + cameraOccluders.length, cameraSolids: cameraOccluders.length,
      reference: 'Metropolis CWO Alley',
    }),
  };
}
