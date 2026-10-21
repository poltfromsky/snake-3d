/**
 * Студия: снимает значок приложения и медали достижений настоящим рендером игры
 * (SceneRenderer из src/render/scene.js — те же змейки, яблоко, поле, свет и свечение).
 * Сцены описаны в scenes.js, запуск — tools/render-art.mjs.
 *
 * window.shot(name, size) → PNG (data URL) нужного размера.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import { SceneRenderer, THEMES } from '../../src/render/scene.js';
import { SCENES } from './scenes.js';

const canvas = document.getElementById('c');
const renderer = new SceneRenderer(canvas, { maxPixelRatio: 1 });
const gl = renderer.renderer;
const pmrem = new THREE.PMREMGenerator(gl);
const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const extras = new THREE.Group();
renderer.scene.add(extras);

/** Металл по редкости: обычная — сталь, редкая — синий анодированный, легендарная — золото. */
export const METALS = {
  common: { color: 0x8f98ad, metalness: 1, roughness: 0.4 },
  rare: { color: 0x5b8cff, metalness: 0.85, roughness: 0.22, emissive: 0x1b3dff, emissiveIntensity: 0.25 },
  legendary: { color: 0xffc44d, metalness: 1, roughness: 0.18, emissive: 0x7a4a00, emissiveIntensity: 0.2 },
  // Эпическая: рубин — между синей редкой и золотой легендарной.
  epic: { color: 0xff3d5e, metalness: 0.9, roughness: 0.2, emissive: 0x8a0018, emissiveIntensity: 0.3 },
  // Мифическая (черновик): перламутр — металл с радужной плёнкой.
  mythic: {
    color: 0xd8c4ff, metalness: 1, roughness: 0.22, iridescence: 1, iridescenceIOR: 2.2, iridescenceThicknessRange: [300, 1200],
  },
};
const GLOW = { rare: 0x7fb0ff, epic: 0xff7a90, legendary: 0xffd27a, mythic: 0xd9b8ff };

// Отражения окружения — только у металла: змейка и поле остаются такими же, как в игре.
const metal = (rarity) => new THREE.MeshPhysicalMaterial({ ...METALS[rarity], envMap: environment, envMapIntensity: 1 });

/** Шахматная текстура клеток в цветах поля темы — для круглой «шайбы» медали. */
function checkerTexture(theme, cells) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const light = new THREE.Color(theme.board).lerp(new THREE.Color(theme.grid), 0.55).getStyle();
  const dark = new THREE.Color(theme.board).lerp(new THREE.Color(theme.grid), 0.25).getStyle();
  const step = 512 / cells;
  ctx.fillStyle = new THREE.Color(theme.board).getStyle();
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? light : dark;
      const pad = step * 0.02;
      ctx.fillRect(x * step + pad, y * step + pad, step - pad * 2, step - pad * 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Фон кадра: мягкий радиальный градиент. */
function gradientBackground(inner, outer, cx = 0.5, cy = 0.42) {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(cx * 1024, cy * 1024, 0, cx * 1024, cy * 1024, 820);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Состояние, которое SceneRenderer читает у Game: поле, змейки, предметы. */
function makeView({ field, snakes = [], items = [], stones = [] }) {
  // Рендеру нужна хотя бы одна змейка (за ней следит камера и свет) — в сцене без змеек она скрыта.
  if (!snakes.length) snakes = [{ cells: [[0, 0]], dir: [1, 0], hidden: true }];
  return {
    opts: { width: field[0], height: field[1], mode: field[2] ?? 'classic' },
    snakes: snakes.map((s) => {
      const body = s.cells.map(([x, y]) => ({ x, y }));
      return {
        body, prevBody: body, direction: { x: s.dir[0], y: s.dir[1] }, alive: s.alive ?? true, ghost: false, hidden: s.hidden,
      };
    }),
    items: items.map(([kind, x, y]) => ({ kind, x, y })),
    obstacles: stones.map(([x, y]) => ({ x, y })),
    stepProgress: 1,
    over: false,
  };
}

/** Круглая «шайба» медали: металлический обод по редкости и поле игры внутри. */
function medalPuck({ rarity, radius, cells, theme }) {
  const group = new THREE.Group();
  const rimMat = metal(rarity);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.45, radius + 0.55, 0.9, 96), rimMat);
  body.position.y = -0.45;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.22, 0.24, 24, 128), rimMat);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.02;
  lip.castShadow = true;
  group.add(lip);
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 96),
    new THREE.MeshStandardMaterial({ map: checkerTexture(theme, cells), roughness: 0.85 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.006;
  face.receiveShadow = true;
  group.add(face);
  if (rarity !== 'common') {
    // Светящаяся нить по ободу: редкую и легендарную видно издалека.
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 0.5, 0.05, 12, 160),
      new THREE.MeshBasicMaterial({ color: GLOW[rarity] }),
    );
    glow.rotation.x = Math.PI / 2;
    glow.position.y = -0.02;
    group.add(glow);
  }
  return group;
}

/** Корона из простых фигур — в цветах золота. */
function crown({ scale = 1 }) {
  const group = new THREE.Group();
  const mat = metal('legendary');
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.26, 48, 1, true), mat);
  band.material.side = THREE.DoubleSide;
  group.add(band);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 16), mat);
    spike.position.set(Math.cos(a) * 0.42, 0.28, Math.sin(a) * 0.42);
    group.add(spike);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshStandardMaterial({
      color: 0xff3355, emissive: 0xff3355, emissiveIntensity: 0.6, roughness: 0.1,
    }));
    gem.position.set(Math.cos(a) * 0.43, 0.48, Math.sin(a) * 0.43);
    group.add(gem);
  }
  group.traverse((m) => { m.castShadow = true; });
  group.scale.setScalar(scale);
  return group;
}

/** Кубок: профиль, выточенный вокруг оси (как на токарном станке), и две ручки. */
function trophy({ scale = 1, rarity = 'legendary' }) {
  const group = new THREE.Group();
  const mat = metal(rarity);
  mat.roughness += 0.12; // чуть матовее обода, чтобы блик не съедал форму
  const profile = [
    [0, 0], [0.62, 0], [0.62, 0.12], [0.5, 0.18], [0.46, 0.26], [0.2, 0.32], [0.12, 0.45], [0.1, 0.75],
    [0.16, 0.86], [0.3, 0.94], [0.5, 1.08], [0.64, 1.32], [0.7, 1.62], [0.72, 1.86], [0.66, 1.86],
    [0.63, 1.62], [0.57, 1.36], [0.44, 1.14], [0.2, 1.0], [0, 0.98],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 96), mat));
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.065, 16, 48, Math.PI * 1.15), mat);
    handle.position.set(side * 0.68, 1.42, 0);
    handle.rotation.z = side > 0 ? -Math.PI * 0.57 : Math.PI * 0.43;
    group.add(handle);
  }
  // Звезда-самоцвет на чаше.
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshStandardMaterial({
    color: 0x3cffa4, emissive: 0x3cffa4, emissiveIntensity: 0.7, roughness: 0.1, flatShading: true,
  }));
  gem.position.set(0, 1.42, 0.62);
  gem.scale.set(1, 1.25, 0.5);
  group.add(gem);
  group.traverse((m) => { m.castShadow = true; });
  group.scale.setScalar(scale);
  return group;
}

/** Капля яда: светящаяся фиолетовая капля (цвет «гнили» из игры) — понятный знак «яд». */
function poisonDrop({ scale = 1 }) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb05cff, emissive: 0x7a1fd6, emissiveIntensity: 0.7, roughness: 0.15, transparent: true, opacity: 0.92,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), mat);
  body.position.y = 0.34;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.235, 0.42, 32), mat);
  tip.position.y = 0.78;
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf3e6ff }));
  shine.position.set(-0.13, 0.48, 0.24);
  group.add(body, tip, shine);
  group.traverse((m) => { m.castShadow = true; });
  group.scale.setScalar(scale);
  return group;
}

const BUILDERS = { medalPuck, crown, trophy, poisonDrop, roundedBox: (o) => new THREE.Mesh(new RoundedBoxGeometry(...o.size, 4, o.radius), metal(o.rarity)) };

function render(spec, size) {
  // SceneRenderer подстраивается под окно: окно студии — ровно квадрат кадра (его задаёт render-art.mjs).
  if (window.innerWidth !== size) throw new Error(`окно ${window.innerWidth}, а кадр ${size}`);
  renderer.resize();

  const view = makeView(spec);
  renderer.setup(view, { theme: spec.theme ?? 'neon', camera: 'angled' }, 0);
  const theme = THEMES[spec.theme ?? 'neon'];
  renderer.boardGroup.visible = spec.board !== false;
  extras.clear();
  for (const extra of spec.extras ?? []) {
    const obj = BUILDERS[extra.type]({ theme, ...extra });
    if (extra.position) obj.position.set(...extra.position);
    if (extra.rotation) obj.rotation.set(...extra.rotation);
    extras.add(obj);
  }

  const bg = spec.background ?? ['#18244a', '#070b18'];
  renderer.scene.background = gradientBackground(...bg);
  renderer.scene.fog = null;
  renderer.bloom.strength = spec.bloom?.[0] ?? 0.45;
  renderer.bloom.radius = spec.bloom?.[1] ?? 0.5;
  renderer.bloom.threshold = spec.bloom?.[2] ?? 0.9;

  renderer.render(view);
  view.snakes.forEach((snake, i) => { if (snake.hidden) renderer.snakeViews[i].hide(); });
  // Предметы в игре «вырастают» при появлении — в кадре они сразу целые и неподвижные.
  for (const [key, mesh] of renderer.itemMeshes) {
    const [, cell] = key.split(':');
    const [x, y] = cell.split(',').map(Number);
    const p = renderer.cellToWorld(x, y);
    mesh.scale.setScalar(spec.itemScale ?? 1);
    mesh.visible = true;
    mesh.position.set(p.x, 0.5, p.z);
    mesh.rotation.y = spec.itemSpin ?? 0.6;
  }
  const cam = renderer.camera;
  cam.clearViewOffset();
  cam.aspect = 1;
  cam.fov = spec.camera.fov ?? 35;
  cam.up.set(...(spec.camera.up ?? [0, 1, 0]));
  cam.position.set(...spec.camera.position);
  cam.lookAt(...spec.camera.target);
  cam.updateProjectionMatrix();
  renderer.headLight.intensity = spec.headLight ?? 1.6;
  renderer.composer.render(0.016);
  return canvas.toDataURL('image/png');
}

/** Рендер в 2× и уменьшение — края гладкие без «лесенки». */
window.shot = async (name, size) => {
  const spec = SCENES[name];
  if (!spec) throw new Error(`нет сцены ${name}`);
  const big = window.innerWidth;
  const url = render(spec, big);
  const img = new Image();
  img.src = url;
  await img.decode();
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);
  return out.toDataURL('image/png');
};
window.sceneNames = Object.keys(SCENES);
window.studioReady = true;
