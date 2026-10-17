/**
 * 3D-отрисовка на Three.js.
 *
 * Сцена только читает состояние Game и никогда его не меняет. Между шагами
 * змейки сегменты плавно интерполируются по game.stepProgress.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { ITEM, MODES } from '../core/game.js';

export const THEMES = Object.freeze({
  neon: {
    background: 0x070b18, board: 0x10162b, grid: 0x26325e, wall: 0xff2d6f,
    head: 0x3cffa4, tail: 0x1b6dff, apple: 0xff3355, stone: 0x5b6378,
  },
  forest: {
    background: 0x0b140d, board: 0x1b2a1d, grid: 0x30482f, wall: 0xffb703,
    head: 0xb8f36b, tail: 0x2e7d32, apple: 0xe63946, stone: 0x6b705c,
  },
  sunset: {
    background: 0x170a19, board: 0x261330, grid: 0x4a2552, wall: 0x4cc9f0,
    head: 0xffd166, tail: 0xef476f, apple: 0x06d6a0, stone: 0x6d597a,
  },
});

const PARTICLE_COUNT = 120;
const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class SceneRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.cameraTarget = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.shake = 0;
    this.cameraMode = 'angled';
    this.clock = new THREE.Clock();

    this.boardGroup = new THREE.Group();
    this.itemsGroup = new THREE.Group();
    this.stonesGroup = new THREE.Group();
    this.scene.add(this.boardGroup, this.itemsGroup, this.stonesGroup);

    this.itemMeshes = new Map();
    this.stoneKeys = '';
    this.size = null;

    // Свечение ярких объектов (bloom) — неоновый вид без текстур.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.addLights();
    this.createParticles();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1020, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-8, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -18; s.right = 18; s.top = 18; s.bottom = -18; s.far = 60;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.headLight = new THREE.PointLight(0xffffff, 3, 5, 2);
    this.scene.add(this.headLight);
  }

  /** Пересобирает поле, змейку и материалы под размер поля, режим и тему. */
  setup(game, settings) {
    const { width, height, mode } = game.opts;
    this.size = { width, height };
    this.theme = THEMES[settings.theme] ?? THEMES.neon;
    this.cameraMode = settings.camera;

    this.scene.background = new THREE.Color(this.theme.background);
    this.scene.fog = new THREE.Fog(this.theme.background, 28, 60);

    this.boardGroup.clear();
    this.buildBoard(width, height, mode === MODES.WALLS);
    this.buildSnake(width * height);
    this.clearItems();
    this.stoneKeys = '';
    this.stonesGroup.clear();
    this.placeCamera(game, true);
  }

  buildBoard(width, height, deadlyWalls) {
    const t = this.theme;
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(width + 0.6, 0.6, height + 0.6, 4, 0.25),
      new THREE.MeshStandardMaterial({ color: t.board, roughness: 0.85 }),
    );
    base.position.y = -0.3;
    base.receiveShadow = true;
    this.boardGroup.add(base);

    // Шахматная подсветка клеток — чтобы глаз считывал сетку.
    const tiles = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.96, 0.96),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      width * height,
    );
    tiles.rotation.x = -Math.PI / 2;
    tiles.receiveShadow = true;
    const light = new THREE.Color(t.board).lerp(new THREE.Color(t.grid), 0.55);
    const dark = new THREE.Color(t.board).lerp(new THREE.Color(t.grid), 0.25);
    let i = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = this.cellToWorld(x, y);
        tmpMatrix.makeTranslation(p.x, -p.z, 0.005);
        tiles.setMatrixAt(i, tmpMatrix);
        tiles.setColorAt(i, (x + y) % 2 ? light : dark);
        i += 1;
      }
    }
    this.boardGroup.add(tiles);

    // Бортики: в режиме «стены» они светятся и предупреждают об опасности.
    const wallMat = new THREE.MeshStandardMaterial({
      color: deadlyWalls ? t.wall : t.grid,
      emissive: deadlyWalls ? t.wall : 0x000000,
      // Слабее, чем кажется нужным: bloom сам добавляет свечение, иначе яркие стены пересвечивают кадр.
      emissiveIntensity: deadlyWalls ? 0.45 : 0,
      roughness: 0.4,
    });
    const h = deadlyWalls ? 0.6 : 0.25;
    const walls = [
      [width + 0.6, h, 0.3, 0, -(height / 2 + 0.15)],
      [width + 0.6, h, 0.3, 0, height / 2 + 0.15],
      [0.3, h, height + 0.6, -(width / 2 + 0.15), 0],
      [0.3, h, height + 0.6, width / 2 + 0.15, 0],
    ];
    for (const [w, hh, d, x, z] of walls) {
      const wall = new THREE.Mesh(new RoundedBoxGeometry(w, hh, d, 2, 0.1), wallMat);
      wall.position.set(x, hh / 2, z);
      wall.castShadow = true;
      this.boardGroup.add(wall);
    }
  }

  buildSnake(maxSegments) {
    if (this.snakeMesh) this.scene.remove(this.snakeMesh, this.head);
    this.snakeMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.35, metalness: 0.1, transparent: true,
    });
    this.snakeMesh = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.86, 0.7, 0.86, 3, 0.22), this.snakeMaterial, maxSegments,
    );
    this.snakeMesh.castShadow = true;
    this.snakeMesh.count = 0;
    this.scene.add(this.snakeMesh);

    // Перемычки между соседними сегментами — тело выглядит цельным, а не набором кубиков.
    if (this.jointMesh) this.scene.remove(this.jointMesh);
    this.jointMesh = new THREE.InstancedMesh(
      new RoundedBoxGeometry(1, 0.56, 0.62, 2, 0.2), this.snakeMaterial, maxSegments,
    );
    this.jointMesh.castShadow = true;
    this.jointMesh.count = 0;
    this.scene.add(this.jointMesh);

    this.head = new THREE.Group();
    const headMesh = new THREE.Mesh(
      new RoundedBoxGeometry(0.94, 0.8, 0.94, 4, 0.3),
      new THREE.MeshStandardMaterial({
        color: this.theme.head, roughness: 0.3, emissive: this.theme.head, emissiveIntensity: 0.12,
        transparent: true,
      }),
    );
    headMesh.castShadow = true;
    this.headMaterial = headMesh.material;
    this.head.add(headMesh);
    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), eyeWhite);
      eye.position.set(0.3, 0.28, side * 0.22);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), pupil);
      p.position.set(0.12, 0.02, 0);
      eye.add(p);
      this.head.add(eye);
    }
    this.scene.add(this.head);
  }

  cellToWorld(x, y) {
    return { x: x - this.size.width / 2 + 0.5, z: y - this.size.height / 2 + 0.5 };
  }

  /** Плавная позиция сегмента между прошлым и текущим шагом. */
  segmentPosition(game, i, t) {
    const cur = game.snake[i];
    const prev = game.prevSnake[i] ?? cur;
    const jump = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    // При проходе сквозь стену не тянем сегмент через всё поле.
    const k = jump > 1 ? 1 : t;
    const a = this.cellToWorld(prev.x, prev.y);
    const b = this.cellToWorld(cur.x, cur.y);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  }

  render(game) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    const t = game.over ? 1 : easeInOut(game.stepProgress);
    const ghost = game.effects.ghost > 0;

    this.drawSnake(game, t, time, ghost);
    this.syncItems(game, time);
    this.syncStones(game);
    this.updateParticles(dt);
    this.placeCamera(game, false, dt);
    this.composer.render(dt);
  }

  drawSnake(game, t, time, ghost) {
    const n = game.snake.length;
    const head = new THREE.Color(this.theme.head);
    const tail = new THREE.Color(this.theme.tail);
    const points = [];
    for (let i = 0; i < n; i += 1) {
      const p = this.segmentPosition(game, i, t);
      // Лёгкая «волна» по телу, чтобы змейка выглядела живой.
      p.y = 0.35 + (i === 0 ? 0 : Math.sin(time * 6 - i * 0.6) * 0.04);
      p.scale = 1 - (i / n) * 0.25;
      p.color = tmpColor.copy(head).lerp(tail, i / Math.max(n - 1, 1)).clone();
      points.push(p);
    }

    this.snakeMesh.count = Math.max(0, n - 1);
    for (let i = 1; i < n; i += 1) {
      const p = points[i];
      tmpMatrix.makeScale(p.scale, p.scale, p.scale).setPosition(p.x, p.y, p.z);
      this.snakeMesh.setMatrixAt(i - 1, tmpMatrix);
      this.snakeMesh.setColorAt(i - 1, p.color);
    }

    let joints = 0;
    for (let i = 1; i < n; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      // На переходе сквозь стену соседние сегменты на разных краях поля — не соединяем.
      if (dist < 0.05 || dist > 1.5) continue;
      const s = (a.scale + b.scale) / 2;
      tmpQuat.setFromAxisAngle(Y_AXIS, Math.atan2(-dz, dx));
      tmpVec.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      tmpScale.set(dist, s, s);
      tmpMatrix.compose(tmpVec, tmpQuat, tmpScale);
      this.jointMesh.setMatrixAt(joints, tmpMatrix);
      this.jointMesh.setColorAt(joints, tmpColor.copy(a.color).lerp(b.color, 0.5));
      joints += 1;
    }
    this.jointMesh.count = joints;

    for (const mesh of [this.snakeMesh, this.jointMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const opacity = ghost ? 0.4 + Math.sin(time * 12) * 0.15 : 1;
    this.snakeMaterial.opacity = opacity;
    this.headMaterial.opacity = opacity;

    const hp = this.segmentPosition(game, 0, t);
    this.head.position.set(hp.x, 0.4, hp.z);
    const angle = Math.atan2(-game.direction.y, game.direction.x);
    this.head.rotation.y = lerpAngle(this.head.rotation.y, angle, 0.35);
    this.headLight.position.set(hp.x, 1.6, hp.z);
    this.headLight.color.set(this.theme.head);
  }

  syncItems(game, time) {
    const alive = new Set(game.items);
    for (const [item, mesh] of this.itemMeshes) {
      if (!alive.has(item)) {
        this.itemsGroup.remove(mesh);
        this.itemMeshes.delete(item);
      }
    }
    for (const item of game.items) {
      let mesh = this.itemMeshes.get(item);
      if (!mesh) {
        mesh = this.createItemMesh(item.kind);
        this.itemMeshes.set(item, mesh);
        this.itemsGroup.add(mesh);
        mesh.userData.born = time;
      }
      const p = this.cellToWorld(item.x, item.y);
      const appear = Math.min((time - mesh.userData.born) * 4, 1);
      mesh.position.set(p.x, 0.5 + Math.sin(time * 3 + item.x) * 0.12, p.z);
      mesh.rotation.y = time * 1.5;
      // Исчезающий предмет мигает последние 2 секунды.
      const blinking = item.ttl != null && item.ttl < 2000 && Math.sin(time * 20) < 0;
      mesh.visible = !blinking;
      mesh.scale.setScalar(easeOutBack(appear));
    }
  }

  createItemMesh(kind) {
    const group = new THREE.Group();
    const add = (geo, mat) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      group.add(m);
      return m;
    };
    switch (kind) {
      case ITEM.APPLE: {
        add(new THREE.SphereGeometry(0.36, 24, 18), new THREE.MeshStandardMaterial({
          color: this.theme.apple, roughness: 0.25, emissive: this.theme.apple, emissiveIntensity: 0.25,
        }));
        const stem = add(new THREE.CylinderGeometry(0.03, 0.04, 0.2), new THREE.MeshStandardMaterial({ color: 0x5b3a1e }));
        stem.position.y = 0.4;
        const leaf = add(new THREE.SphereGeometry(0.11, 10, 6), new THREE.MeshStandardMaterial({ color: 0x4caf50 }));
        leaf.scale.set(1.4, 0.35, 0.7);
        leaf.position.set(0.12, 0.42, 0);
        break;
      }
      case ITEM.BAD:
        add(new THREE.IcosahedronGeometry(0.34, 0), new THREE.MeshStandardMaterial({
          color: 0x8e44ad, emissive: 0x5b1a7a, emissiveIntensity: 0.8, flatShading: true,
        }));
        break;
      case ITEM.SLOW:
        add(new THREE.TorusGeometry(0.26, 0.09, 12, 32), new THREE.MeshStandardMaterial({
          color: 0x4cc9f0, emissive: 0x4cc9f0, emissiveIntensity: 1.2,
        }));
        break;
      case ITEM.GHOST: {
        add(new THREE.OctahedronGeometry(0.42), new THREE.MeshStandardMaterial({
          color: 0xe8eeff, emissive: 0xb9c8ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.85,
          flatShading: true,
        }));
        // Кольцо-ореол, чтобы бонус было видно издалека.
        const halo = add(new THREE.TorusGeometry(0.5, 0.035, 8, 40), new THREE.MeshBasicMaterial({
          color: 0xb9c8ff, transparent: true, opacity: 0.6,
        }));
        halo.rotation.x = Math.PI / 2;
        halo.castShadow = false;
        break;
      }
      default:
        break;
    }
    return group;
  }

  clearItems() {
    this.itemsGroup.clear();
    this.itemMeshes.clear();
  }

  syncStones(game) {
    const keys = game.obstacles.map((o) => `${o.x},${o.y}`).join('|');
    if (keys === this.stoneKeys) return;
    this.stoneKeys = keys;
    this.stonesGroup.clear();
    const mat = new THREE.MeshStandardMaterial({ color: this.theme.stone, roughness: 0.95, flatShading: true });
    for (const o of game.obstacles) {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), mat);
      const p = this.cellToWorld(o.x, o.y);
      stone.position.set(p.x, 0.38, p.z);
      stone.rotation.set(o.x * 1.3, o.y * 0.7, 0);
      stone.castShadow = true;
      stone.receiveShadow = true;
      this.stonesGroup.add(stone);
    }
  }

  createParticles() {
    this.particles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      PARTICLE_COUNT,
    );
    this.particles.frustumCulled = false;
    this.particleState = Array.from({ length: PARTICLE_COUNT }, () => ({
      life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), color: new THREE.Color(),
    }));
    this.nextParticle = 0;
    this.scene.add(this.particles);
  }

  /** Взрыв частиц в клетке — когда змейка что-то съела или погибла. */
  burst(x, y, color, amount = 24) {
    if (!this.size) return;
    const p = this.cellToWorld(x, y);
    for (let i = 0; i < amount; i += 1) {
      const s = this.particleState[this.nextParticle];
      this.nextParticle = (this.nextParticle + 1) % PARTICLE_COUNT;
      s.life = 0.6 + Math.random() * 0.4;
      s.pos.set(p.x, 0.5, p.z);
      s.vel.set((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6);
      s.color.set(color);
    }
  }

  burstAt(kind, x, y) {
    const colors = {
      [ITEM.APPLE]: this.theme.apple, [ITEM.BAD]: 0x8e44ad,
      [ITEM.SLOW]: 0x4cc9f0, [ITEM.GHOST]: 0xffffff,
    };
    this.burst(x, y, colors[kind] ?? 0xffffff);
  }

  updateParticles(dt) {
    this.particleState.forEach((s, i) => {
      if (s.life > 0) {
        s.life -= dt;
        s.vel.y -= 14 * dt;
        s.pos.addScaledVector(s.vel, dt);
        if (s.pos.y < 0.06) { s.pos.y = 0.06; s.vel.multiplyScalar(0.5); s.vel.y *= -0.4; }
      }
      const scale = Math.max(s.life, 0) * 1.4;
      tmpMatrix.makeScale(scale, scale, scale).setPosition(s.pos);
      this.particles.setMatrixAt(i, tmpMatrix);
      this.particles.setColorAt(i, s.color);
    });
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  shakeCamera(strength = 0.6) {
    this.shake = strength;
  }

  placeCamera(game, instant, dt = 0.016) {
    const { width, height } = this.size;
    // Расстояние, при котором поле целиком помещается в кадр с отступом.
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const fitH = (height + 2) / 2 / Math.tan(halfFov);
    const fitW = (width + 2) / 2 / Math.tan(halfFov) / this.camera.aspect;
    const distance = Math.max(fitH, fitW);
    const lookShift = this.cameraMode === 'top' ? 0 : 1.2;
    if (this.cameraMode === 'top') {
      this.cameraTarget.set(0, distance, 0.01);
    } else {
      // Наклон ~55°: объём читается, а дальний край не уходит в точку.
      this.cameraTarget.set(0, distance * 1.02, distance * 0.62 + lookShift);
    }
    // Камера слегка следует за головой.
    const hp = this.cellToWorld(game.head.x, game.head.y);
    tmpVec.set(hp.x * 0.08, 0, hp.z * 0.08 + lookShift);
    const k = instant ? 1 : 1 - Math.exp(-dt * 3);
    this.camera.position.lerp(this.cameraTarget.clone().add(tmpVec), k);
    this.lookAt.lerp(tmpVec, k);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.lookAt);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // На узком экране отодвигаем камеру, чтобы поле влезало целиком.
    this.camera.fov = w / h < 1 ? 62 : 45;
    this.camera.updateProjectionMatrix();
  }
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeOutBack(t) {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function lerpAngle(a, b, k) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * k;
}
