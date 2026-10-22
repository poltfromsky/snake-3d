/**
 * Заставка при входе — по образцу ролика «Claude banner»: чёрный фон, слева и справа руки
 * со «Сотворения Адама» Микеланджело, между ними медленно вращается значок игры — настоящая
 * 3D-змейка движка (SceneRenderer), та же, что на значке приложения. Под заставку играет
 * тихая синтезированная музыка (src/audio/splash-music.js).
 *
 * Вращение — вокруг вертикальной оси, как монета; поле и змейка стоят на месте,
 * по кругу ходит камера (так рендер игры не нужно менять).
 * Руки — фрагмент фрески (общественное достояние, Wikimedia Commons; см. CREDITS.md).
 *
 * В игру пока не подключена: когда и где показывать — решит Егор.
 * Посмотреть отдельно — tools/splash/preview.html.
 *
 *   const splash = showSplash({ minDuration: 6000, volume: 0.5 });
 *   await splash.done;        // заставка исчезла (по времени, по hide() или по нажатию)
 *   splash.hide();            // убрать раньше, например когда игра загрузилась
 */
import { SceneRenderer } from '../render/scene.js';
import { startSplashMusic } from '../audio/splash-music.js';

/**
 * Тот же изгиб змейки, что на значке приложения (tools/art/scenes.js, APP_ICON), сдвинутый
 * в угол: поле ровно под змейку (3×4), чтобы значок был компактной «фигуркой» в пустоте.
 */
const ICON_SNAKE = [[2, 3], [2, 2], [2, 1], [1, 1], [0, 1], [0, 0], [1, 0]];
const FIELD = [3, 4];
const ICON_SIZE = 5.2; // наибольший размах значка при повороте, единиц сцены (диагональ поля с бортом)
const SPIN_PERIOD = 6; // секунд на полный оборот — как в ролике-образце
const TILT = 0.42; // высота камеры над полем относительно расстояния до змейки
const FADE_MS = 600;

const HANDS = {
  adam: new URL('../../assets/splash/hand-adam.webp', import.meta.url).href,
  god: new URL('../../assets/splash/hand-god.webp', import.meta.url).href,
};
// Где в картинках кончики пальцев (доля ширины/высоты) и пропорции картинок — для раскладки.
const ADAM = { tipX: 0.965, tipY: 0.652, ratio: 290 / 680 };
const GOD = { tipX: 0.024, tipY: 0.5, ratio: 410 / 740 };

/**
 * Ширина каждой руки — доля ширины экрана. На узком экране (телефон) руки меньше и частью уходят
 * за край (handInset): просвет между пальцами вдвое шире, змейка встаёт ровно на линию рук.
 */
const handShare = (aspect) => (aspect < 0.8 ? 0.3 : 0.36);
const handInset = (aspect) => (aspect < 0.8 ? 0.04 : 0);

/** Состояние, которое SceneRenderer читает у Game: поле и одна змейка. */
function iconView() {
  const body = ICON_SNAKE.map(([x, y]) => ({ x, y }));
  return {
    opts: { width: FIELD[0], height: FIELD[1], mode: 'classic' },
    snakes: [{
      body, prevBody: body, direction: { x: 0, y: 1 }, alive: true, ghost: false,
    }],
    items: [],
    obstacles: [],
    stepProgress: 1,
    over: false,
  };
}

/** Стили слоя — в модуле, чтобы заставку можно было подключить одной строкой. */
const CSS = `
.splash { position: fixed; inset: 0; z-index: 10000; background: #000; opacity: 0; overflow: hidden;
  transition: opacity ${FADE_MS}ms ease; cursor: pointer; touch-action: none; user-select: none; }
.splash-visible { opacity: 1; }
.splash-leaving { opacity: 0; pointer-events: none; }
.splash-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.splash-hand { position: absolute; z-index: 1; width: var(--hand-w); pointer-events: none; -webkit-user-drag: none;
  filter: drop-shadow(0 0 18px rgba(255, 214, 170, 0.08)); }
.splash-hand-adam { left: calc(var(--hand-in, 0vw) * -1); top: calc(52% - var(--hand-w) * ${(ADAM.tipY * ADAM.ratio).toFixed(4)});
  animation: splash-reach-l 5s ease-in-out infinite alternate; }
.splash-hand-god { right: calc(var(--hand-in, 0vw) * -1); top: calc(52% - var(--hand-w) * ${(GOD.tipY * GOD.ratio).toFixed(4)});
  animation: splash-reach-r 5s ease-in-out infinite alternate; }
@keyframes splash-reach-l { from { transform: translateX(-0.6%); } to { transform: translateX(0.6%); } }
@keyframes splash-reach-r { from { transform: translateX(0.6%); } to { transform: translateX(-0.6%); } }
.splash .splash-sound { position: absolute; z-index: 2; margin: 0; box-shadow: none; text-transform: none; letter-spacing: normal; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom));
  font: 500 14px/1 system-ui, sans-serif; color: #e9edf7; background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 999px; padding: 10px 16px; cursor: pointer; }
.splash .splash-sound[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .splash-hand { animation: none; } }
`;

function injectStyles() {
  if (document.getElementById('splash-styles')) return;
  const style = document.createElement('style');
  style.id = 'splash-styles';
  style.textContent = CSS;
  document.head.append(style);
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function handImage(src, side) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.className = `splash-hand splash-hand-${side}`;
  return img;
}

/**
 * Показывает заставку поверх страницы.
 * @param {{ minDuration?: number, skippable?: boolean, music?: boolean, volume?: number,
 *   parent?: HTMLElement }} [options]
 *   minDuration — сколько держать заставку, мс (0 — до вызова hide());
 *   skippable — убирать по нажатию или клавише; music/volume — музыка и её громкость 0…1.
 * @returns {{ hide: () => void, done: Promise<void> }}
 */
export function showSplash({
  minDuration = 6000, skippable = true, music = true, volume = 0.5, parent = document.body,
} = {}) {
  injectStyles();
  const overlay = document.createElement('div');
  overlay.className = 'splash';
  overlay.setAttribute('role', 'presentation');
  const canvas = document.createElement('canvas');
  canvas.className = 'splash-canvas';
  const sound = document.createElement('button');
  sound.type = 'button';
  sound.className = 'splash-sound';
  sound.textContent = 'Включить звук';
  sound.hidden = true;
  overlay.append(handImage(HANDS.adam, 'adam'), handImage(HANDS.god, 'god'), canvas, sound);
  parent.append(overlay);

  let finish;
  const done = new Promise((resolve) => { finish = resolve; });

  let renderer;
  try {
    renderer = new SceneRenderer(canvas);
  } catch {
    // Нет WebGL — заставку пропускаем, игра покажет свой экран «нет 3D».
    overlay.remove();
    finish();
    return { hide() {}, done };
  }

  const view = iconView();
  renderer.setup(view, { theme: 'neon', camera: 'angled' }, 0);
  renderer.scene.background = null; // фон — у самого слоя (чёрный); руки лежат поверх холста
  renderer.renderer.setClearColor(0x000000, 0);
  renderer.scene.fog = null;
  renderer.bloom.strength = 0.6;
  renderer.bloom.radius = 0.55;
  renderer.bloom.threshold = 0.85;
  renderer.headLight.intensity = 1.6;
  // Рендер всегда держит змейку соперника и искры — в заставке они стояли бы в центре поля.
  renderer.snakeViews.slice(1).forEach((sv) => sv.hide());
  renderer.particles.visible = false;
  // Игровая камера подстраивается под окно сама — здесь ракурс задаём мы.
  renderer.resize = () => {
    renderer.renderer.setSize(innerWidth, innerHeight, false);
    renderer.composer.setSize(innerWidth, innerHeight);
    const aspect = innerWidth / innerHeight;
    overlay.style.setProperty('--hand-w', `${handShare(aspect) * 100}vw`);
    overlay.style.setProperty('--hand-in', `${handInset(aspect) * 100}vw`);
  };
  renderer.resize();

  // Центр вращения — середина поля: значок крутится на месте.
  const cells = ICON_SNAKE.map(([x, y]) => renderer.cellToWorld(x, y));
  const corner = renderer.cellToWorld(0, 0);
  const far = renderer.cellToWorld(FIELD[0] - 1, FIELD[1] - 1);
  const cx = (corner.x + far.x) / 2;
  const cz = (corner.z + far.z) / 2;
  const snake = view.snakes[0];
  const points = () => snake.body.map((_, i) => renderer.segmentPosition(snake, i, 1));

  const still = prefersReducedMotion();
  const cam = renderer.camera;
  const start = performance.now();
  let frame = 0;
  let stopped = false;

  function placeCamera(t) {
    const aspect = innerWidth / innerHeight;
    cam.aspect = aspect;
    cam.fov = 30;
    // Змейка — небольшая, как значок в ролике: занимает ~70 % просвета между пальцами
    // (в долях ширины экрана: от кончика пальца Адама до кончика пальца Бога).
    const hand = handShare(aspect);
    const inset = handInset(aspect);
    const gap = (1 - hand + inset + hand * GOD.tipX) - (hand * ADAM.tipX - inset);
    const share = gap * 0.7;
    cam.clearViewOffset();
    const visibleWidth = ICON_SIZE / share;
    const halfH = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * aspect);
    const dist = visibleWidth / (2 * Math.tan(halfH));
    const angle = still ? 0.38 : 0.38 + (t / SPIN_PERIOD) * Math.PI * 2;
    // Лёгкое «дыхание» по высоте, чтобы значок не казался картинкой.
    const bob = still ? 0 : Math.sin(t * 1.3) * 0.05 * (dist / 10);
    cam.position.set(cx + Math.sin(angle) * dist, dist * TILT + bob, cz + Math.cos(angle) * dist);
    cam.lookAt(cx, 0.1 + bob * 0.5, cz);
    cam.updateProjectionMatrix();
  }

  function tick(now) {
    if (stopped) return;
    const t = (now - start) / 1000;
    renderer.snakeViews[0].draw(snake, points(), t);
    renderer.headLight.position.set(cells[0].x, 1.6, cells[0].z);
    placeCamera(t);
    renderer.composer.render(0.016);
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  requestAnimationFrame(() => overlay.classList.add('splash-visible'));

  // Музыка. Без нажатия браузер обычно не даёт звук — тогда показываем кнопку,
  // нажатие на неё включает звук и не закрывает заставку.
  const tune = music ? startSplashMusic({ volume }) : null;
  if (tune && !tune.playing) {
    sound.hidden = false;
    sound.addEventListener('pointerdown', (e) => e.stopPropagation());
    sound.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await tune.resume()) sound.hidden = true;
    });
  }

  /** @param {{ instant?: boolean }} [opts] instant — убрать сразу, без затухания (резкая склейка). */
  function hide(opts) {
    if (stopped || overlay.classList.contains('splash-leaving')) return;
    const instant = opts?.instant === true;
    overlay.classList.add('splash-leaving');
    if (instant) overlay.style.transition = 'none';
    removeEventListener('keydown', onKey);
    tune?.stop(instant ? 150 : FADE_MS + 200);
    setTimeout(() => {
      stopped = true;
      cancelAnimationFrame(frame);
      renderer.renderer.dispose();
      renderer.renderer.forceContextLoss();
      overlay.remove();
      finish();
    }, instant ? 0 : FADE_MS);
  }
  function onKey(e) {
    if (e.target === sound) return;
    hide();
  }

  if (minDuration > 0) setTimeout(hide, minDuration);
  if (skippable) {
    overlay.addEventListener('pointerdown', hide);
    addEventListener('keydown', onKey);
  }
  return { hide, done };
}
