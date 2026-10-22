/**
 * Вступление для нового игрока (запускает boot.js, пока игра грузится позади):
 *
 *   1. «Нажми, чтобы начать» — браузер разрешает звук только после действия игрока;
 *   2. заставка (src/ui/splash.js): руки «Сотворения Адама», между ними вращается змейка;
 *      играет музыка вступления (src/audio/intro-music.js);
 *   3. на дропе музыки — вспышка и резкая склейка на обложку: значок игры и название;
 *   4. нажатие на змейку — карточка «Обучение — 1 минута»: «Начать обучение» или «Пропустить» (в меню).
 *   «Пропустить» вверху — на любом шаге, тоже в меню.
 *
 * Пока музыка переделывается (MUSIC = false), шагов 1 и музыки нет: заставка идёт сразу и без звука,
 * обложка — через SILENT_SECONDS.
 *
 *   const choice = await playIntro();   // 'tutorial' | 'menu'
 *
 * returning: true — для вернувшегося игрока: сразу обложка (без заставки и музыки),
 *   нажатие на неё — в меню.
 * fast: true — короткая заставка без ожидания дропа (для автотестов).
 */
import { BPM, INTRO_BARS, startIntroMusic } from '../audio/intro-music.js';
import { loadSettings } from '../storage.js';

const COVER_SNAKE = new URL('../../assets/splash/cover-snake.webp', import.meta.url).href;
const HANDS = ['hand-adam', 'hand-god'].map((n) => new URL(`../../assets/splash/${n}.webp`, import.meta.url).href);
const FADE_MS = 600;
// Музыка вступления выключена, пока её переделываем (решение Егора 22.10): без звука не нужен
// и экран «Нажми, чтобы начать». Вернуть — MUSIC = true.
const MUSIC = false;
const SILENT_SECONDS = 7; // заставка без музыки: чуть больше полного оборота змейки

const CSS = `
.intro { position: fixed; inset: 0; z-index: 10001; color: #eef2ff; font-family: Inter, system-ui, sans-serif;
  -webkit-tap-highlight-color: transparent; user-select: none; }
.intro-start { background: #000; display: grid; place-items: center; cursor: pointer; transition: opacity ${FADE_MS}ms ease; }
.intro-start .intro-press { font: 600 clamp(18px, 2.4vw, 28px)/1.3 Inter, system-ui, sans-serif; letter-spacing: 0.04em;
  text-align: center; animation: intro-pulse 2.2s ease-in-out infinite; }
.intro-start .intro-sound { display: block; margin-top: 12px; font-weight: 400; font-size: 0.62em; opacity: 0.6; letter-spacing: 0.02em; }
.intro-gone { opacity: 0; pointer-events: none; }
@keyframes intro-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }

.intro .intro-skip { position: absolute; top: max(16px, env(safe-area-inset-top)); right: max(16px, env(safe-area-inset-right));
  z-index: 3; margin: 0; padding: 9px 16px; font: 500 14px/1 Inter, system-ui, sans-serif; color: #dfe5f7;
  background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 999px; cursor: pointer;
  box-shadow: none; text-transform: none; }

.intro-base { position: fixed; inset: 0; z-index: 9999; background: #000; transition: opacity ${FADE_MS}ms ease; }

.intro-dim { position: absolute; inset: 0; z-index: 2; background: rgba(3, 6, 14, 0.62); display: grid; place-items: center;
  padding: 20px; animation: intro-fade-in 260ms ease-out; cursor: default; }
.intro-card { width: min(440px, 100%); box-sizing: border-box; padding: 26px 24px 22px; border-radius: 20px; text-align: left;
  background: rgba(14, 20, 40, 0.96); border: 1px solid rgba(60, 255, 164, 0.35);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(60, 255, 164, 0.08); animation: intro-pop 260ms ease-out; }
.intro-card h3 { margin: 0 0 8px; font: 800 24px/1.15 Unbounded, Inter, sans-serif; color: #f2f5ff; }
.intro-card p { margin: 0 0 20px; font: 400 16px/1.45 Inter, sans-serif; color: #aab6da; }
.intro-card .intro-actions { display: grid; grid-template-columns: 1.4fr 1fr; gap: 10px; }
.intro .intro-card button { margin: 0; min-height: 48px; padding: 12px 14px; border-radius: 14px; cursor: pointer;
  font: 600 16px/1.2 Inter, sans-serif; box-shadow: none; text-transform: none; }
.intro .intro-card .intro-go { border: 0; color: #04120b; background: linear-gradient(90deg, #3cffa4, #5ef0ff); }
.intro .intro-card .intro-later { color: #e9edf7; background: transparent; border: 1px solid rgba(255, 255, 255, 0.22); }
@keyframes intro-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes intro-pop { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: none; } }

.intro-flash { position: fixed; inset: 0; z-index: 10003; background: #fff; pointer-events: none;
  animation: intro-flash 380ms ease-out forwards; }
@keyframes intro-flash { from { opacity: 0.95; } to { opacity: 0; } }

/* Вернувшийся игрок: обложка видна сразу (под ней грузится меню), уходит плавно. */
.intro-cover-back { cursor: pointer; }
.intro-cover { z-index: 10002; display: grid; grid-template-columns: auto auto; align-items: center; justify-content: center;
  gap: clamp(16px, 3vw, 64px); padding: 24px; box-sizing: border-box; transition: opacity ${FADE_MS}ms ease;
  background: radial-gradient(ellipse 70% 90% at 32% 50%, #1b2a55 0%, #0b1226 55%, #050812 100%); }
.intro .intro-snake { margin: 0; padding: 0; border: 0; background: none; box-shadow: none; cursor: pointer; border-radius: 50%;
  width: min(62vh, 46vw); aspect-ratio: 1; filter: drop-shadow(0 0 42px rgba(60, 255, 164, 0.22));
  animation: intro-breathe 2.35s ease-in-out infinite; transition: transform 220ms ease, filter 220ms ease; }
.intro .intro-snake:hover, .intro .intro-snake:focus-visible { filter: drop-shadow(0 0 60px rgba(60, 255, 164, 0.5)); outline: none; }
.intro .intro-snake img { display: block; width: 100%; height: 100%; pointer-events: none;
  -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 50%, transparent 70%);
          mask-image: radial-gradient(circle at 50% 50%, #000 50%, transparent 70%); }
.intro .intro-snake.intro-chosen { animation: none; transform: scale(1.12); filter: drop-shadow(0 0 90px rgba(60, 255, 164, 0.8)); }
@keyframes intro-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }
.intro-title { margin: 0; font: 800 clamp(44px, 7.6vw, 150px)/0.98 Unbounded, Inter, sans-serif; letter-spacing: -0.02em; color: #f2f5ff; }
.intro-title span { background: linear-gradient(90deg, #3cffa4, #1b6dff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.intro-sub { margin: 0.8em 0 0 0.15em; font: 400 clamp(16px, 1.9vw, 38px)/1.3 Inter, sans-serif; color: #aab6da; }
.intro-hint { margin: 1.4em 0 0 0.15em; font: 600 clamp(15px, 1.5vw, 26px)/1.3 Inter, sans-serif; color: #3cffa4;
  animation: intro-pulse 2.35s ease-in-out infinite; }
.intro-hint .intro-up { display: none; }
@media (max-aspect-ratio: 4/5) {
  .intro-cover { grid-template-columns: 1fr; justify-items: center; text-align: center; align-content: center; }
  .intro .intro-snake { width: min(80vw, 46vh); }
  .intro-sub, .intro-hint { margin-left: 0; }
  .intro-hint .intro-left { display: none; }
  .intro-hint .intro-up { display: inline; }
}
@media (prefers-reduced-motion: reduce) {
  .intro-start .intro-press, .intro .intro-snake, .intro-hint { animation: none; }
  .intro-flash { animation-duration: 1ms; }
  .intro-dim, .intro-card { animation: none; }
}
`;

function injectStyles() {
  if (document.getElementById('intro-styles')) return;
  const style = document.createElement('style');
  style.id = 'intro-styles';
  style.textContent = CSS;
  document.head.append(style);
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** Громкость музыки из настроек игры (по умолчанию — как в игре). */
function musicVolume() {
  const v = loadSettings().musicVolume;
  return typeof v === 'number' ? v : 0.5;
}

/**
 * @param {{ fast?: boolean, returning?: boolean }} [options]
 * @returns {Promise<'tutorial' | 'menu'>}
 */
export function playIntro({ fast = false, returning = false } = {}) {
  injectStyles();
  // Заранее грузим картинки и модуль заставки (с 3D-движком), пока игрок читает первый экран.
  for (const src of [COVER_SNAKE, ...HANDS]) new Image().src = src;
  const splashModule = import('./splash.js');

  let finish;
  const result = new Promise((resolve) => { finish = resolve; });
  let music = null;
  let splash = null;
  let done = false;
  const layers = [];

  const skip = el('button', 'intro-skip', 'Пропустить');
  skip.type = 'button';

  function end(choice) {
    if (done) return;
    done = true;
    music?.stop(choice === 'tutorial' ? 1200 : 500);
    splash?.hide({ instant: choice === 'menu' });
    for (const layer of layers) layer.classList.add('intro-gone');
    setTimeout(() => layers.forEach((layer) => layer.remove()), FADE_MS + 50);
    removeEventListener('keydown', onKey);
    finish(choice);
  }

  skip.addEventListener('pointerdown', (e) => e.stopPropagation());
  skip.addEventListener('click', (e) => { e.stopPropagation(); end('menu'); });

  let stage = 'start';
  if (returning) {
    // Вернувшийся игрок: только обложка, нажатие в любом месте — в меню.
    stage = 'splash';
    showCover({ returning: true });
    addEventListener('keydown', onKey);
    return result;
  }

  // Чёрная подложка: пока заставка проявляется, под ней не видно грузящегося меню.
  const base = el('div', 'intro-base');
  document.body.append(base);
  layers.push(base);

  // 1. Первый экран (только с музыкой: звук браузер разрешает после нажатия).
  const start = el('div', 'intro intro-start', '<div class="intro-press">Нажми, чтобы начать'
    + '<span class="intro-sound">лучше со звуком</span></div>');
  start.setAttribute('role', 'button');
  start.setAttribute('aria-label', 'Начать');
  start.append(skip);
  if (MUSIC) {
    document.body.append(start);
    layers.push(start);
  }

  async function begin() {
    if (stage !== 'start' || done) return;
    stage = 'splash';
    // Звук создаём прямо в обработчике нажатия — тогда браузер его разрешает.
    if (MUSIC) music = startIntroMusic({ volume: musicVolume() });
    const { showSplash } = await splashModule;
    if (done) return;
    splash = showSplash({ minDuration: 0, skippable: false, music: false });
    start.classList.add('intro-gone');
    start.style.background = 'transparent';
    // Кнопка «Пропустить» остаётся поверх заставки.
    const skipLayer = el('div', 'intro');
    skipLayer.style.pointerEvents = 'none';
    skip.style.pointerEvents = 'auto';
    skipLayer.append(skip);
    document.body.append(skipLayer);
    layers.push(skipLayer);
    setTimeout(() => start.remove(), FADE_MS + 50);

    if (fast) setTimeout(showCover, 1500);
    else if (music) music.whenDrop(showCover);
    else setTimeout(showCover, SILENT_SECONDS * 1000);
  }
  start.addEventListener('click', begin);
  if (!MUSIC) begin();

  // 3–4. Обложка: вспышка, резкая склейка, нажатие на змейку — обучение.
  function showCover({ returning: back = false } = {}) {
    if (done || stage !== 'splash') return;
    stage = 'cover';
    const cover = el('div', `intro intro-cover${back ? ' intro-cover-back' : ''}`);
    const snake = el('button', 'intro-snake', `<img src="${COVER_SNAKE}" alt="">`);
    snake.type = 'button';
    snake.setAttribute('aria-label', back ? 'Войти в игру' : 'Начать');
    const text = el('div', 'intro-text', '<h2 class="intro-title">Изгиб<br><span>Питона</span> 3D</h2>'
      + '<p class="intro-sub">Классическая змейка<br>в трёх измерениях</p>'
      + `<p class="intro-hint"><span class="intro-left">← </span><span class="intro-up">↑ </span>Нажми на змейку, чтобы ${back ? 'войти' : 'начать'}</p>`);
    cover.append(snake, text);
    if (!back) cover.append(skip);
    document.body.append(cover);
    layers.push(cover);
    const choose = () => {
      if (back) {
        snake.classList.add('intro-chosen');
        setTimeout(() => end('menu'), 180);
      } else {
        offerTutorial(cover);
      }
    };
    snake.addEventListener('click', (e) => { e.stopPropagation(); choose(); });
    if (back) {
      // Вернувшийся: войти — нажатием в любом месте обложки.
      cover.addEventListener('click', choose);
    } else {
      const flash = el('div', 'intro-flash');
      document.body.append(flash);
      setTimeout(() => flash.remove(), 450);
      splash?.hide({ instant: true });
    }
    snake.focus({ preventScroll: true });
  }

  // 4. Выбор перед обучением.
  function offerTutorial(cover) {
    if (stage !== 'cover') return;
    stage = 'card';
    const dim = el('div', 'intro-dim', '<div class="intro-card" role="dialog" aria-modal="true" aria-labelledby="intro-card-title">'
      + '<h3 id="intro-card-title">Обучение — 1 минута</h3>'
      + '<p>Покажем, как поворачивать, что есть и чего избегать. Можно пропустить и пройти потом из меню.</p>'
      + '<div class="intro-actions"><button type="button" class="intro-go">Начать обучение</button>'
      + '<button type="button" class="intro-later">Пропустить</button></div></div>');
    dim.addEventListener('click', (e) => e.stopPropagation());
    dim.querySelector('.intro-go').addEventListener('click', () => end('tutorial'));
    dim.querySelector('.intro-later').addEventListener('click', () => end('menu'));
    cover.querySelector('.intro-skip')?.remove();
    cover.append(dim);
    dim.querySelector('.intro-go').focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key === 'Escape' || (returning && (e.key === 'Enter' || e.key === ' '))) end('menu');
    else if (stage === 'start' && (e.key === 'Enter' || e.key === ' ')) begin();
  }
  addEventListener('keydown', onKey);

  return result;
}

/** Длительность заставки до дропа, с — для подписи в тестах и превью. */
export const INTRO_SECONDS = (INTRO_BARS * 4 * 60) / BPM;
