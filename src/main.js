/**
 * Точка входа: связывает логику, 3D-сцену, звук и интерфейс.
 */
import { DIRECTIONS, Game, MODES } from './core/game.js';
import { SceneRenderer } from './render/scene.js';
import { AudioManager } from './audio/audio.js';
import {
  addRecord, isRecord, loadRecords, loadSettings, saveSettings, SPEED_FACTORS,
} from './storage.js';

const $ = (sel) => document.querySelector(sel);

const REASONS = {
  self: 'Змейка укусила себя',
  wall: 'Врезались в стену',
  stone: 'Врезались в камень',
  poison: 'Отравились гнилью',
  time: 'Время вышло',
};

const KEYMAP = {
  ArrowUp: DIRECTIONS.UP, KeyW: DIRECTIONS.UP,
  ArrowDown: DIRECTIONS.DOWN, KeyS: DIRECTIONS.DOWN,
  ArrowLeft: DIRECTIONS.LEFT, KeyA: DIRECTIONS.LEFT,
  ArrowRight: DIRECTIONS.RIGHT, KeyD: DIRECTIONS.RIGHT,
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setVolumes(settings);
const renderer = new SceneRenderer($('#scene'));

let game = createGame();
let state = 'menu'; // menu | playing | paused | over
let previousScreen = 'menu';
let lastTime = performance.now();

function createGame() {
  const narrow = window.innerWidth < window.innerHeight;
  return new Game({
    // На вертикальном экране поле тоже вертикальное.
    width: narrow ? 14 : 24,
    height: narrow ? 20 : 16,
    mode: settings.mode,
    speedFactor: SPEED_FACTORS[settings.speed] ?? 1,
  });
}

/* ---------------- Экраны ---------------- */

const screens = ['menu', 'pause', 'over', 'records', 'settings'];

function show(name) {
  for (const s of screens) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  $('#hud').classList.toggle('hidden', name !== null && name !== 'pause' && name !== 'over');
}

function startGame() {
  game = createGame();
  renderer.setup(game, settings);
  state = 'playing';
  show(null);
  $('#hud').classList.remove('hidden');
  $('#hud-timer-box').classList.toggle('hidden', settings.mode !== MODES.TIMED);
  audio.startMusic();
  updateHud();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  audio.pauseMusic();
  show('pause');
}

function resume() {
  if (state !== 'paused') return;
  state = 'playing';
  show(null);
  $('#hud').classList.remove('hidden');
  audio.startMusic();
  lastTime = performance.now();
}

function toMenu() {
  state = 'menu';
  audio.pauseMusic();
  game = createGame();
  renderer.setup(game, settings);
  show('menu');
}

function gameOver(reason) {
  state = 'over';
  audio.play('die');
  audio.setIntensity(0);
  renderer.shakeCamera(0.8);
  renderer.burst(game.head.x, game.head.y, 0xff3355, 40);

  $('#over-title').textContent = reason === 'time' ? 'Финиш!' : 'Игра окончена';
  $('#over-reason').textContent = REASONS[reason] ?? '';
  $('#over-score').textContent = game.score;
  const record = isRecord(settings.mode, game.score);
  $('#record-form').classList.toggle('hidden', !record);
  if (record) setTimeout(() => audio.play('record'), 700);
  // Небольшая задержка, чтобы игрок увидел момент столкновения.
  setTimeout(() => {
    if (state !== 'over') return;
    show('over');
    if (record) $('#record-name').focus();
  }, 900);
}

/* ---------------- HUD ---------------- */

function updateHud() {
  $('#hud-score').textContent = game.score;
  $('#hud-length').textContent = game.length;
  $('#hud-level').textContent = game.level;
  if (game.timeLeftMs != null) {
    const s = Math.ceil(game.timeLeftMs / 1000);
    $('#hud-timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const effects = [];
  if (game.effects.slow > 0) effects.push(`<span class="effect slow">🐢 ${Math.ceil(game.effects.slow / 1000)}</span>`);
  if (game.effects.ghost > 0) effects.push(`<span class="effect ghost">👻 ${Math.ceil(game.effects.ghost / 1000)}</span>`);
  const html = effects.join('');
  if ($('#hud-effects').innerHTML !== html) $('#hud-effects').innerHTML = html;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth; // перезапуск CSS-анимации
  el.classList.add('show');
}

/* ---------------- События игры ---------------- */

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'eat':
        renderer.burstAt(e.kind, e.x, e.y);
        if (e.kind === 'apple') audio.play('eat');
        else if (e.kind === 'bad') { audio.play('bad'); renderer.shakeCamera(0.3); }
        else { audio.play('bonus'); toast(e.kind === 'slow' ? 'Замедление!' : 'Призрак!'); }
        break;
      case 'levelUp':
        audio.play('levelUp');
        toast(`Уровень ${e.level}`);
        break;
      case 'gameOver':
        gameOver(e.reason);
        break;
      default:
        break;
    }
  }
}

/* ---------------- Цикл ---------------- */

function frame(now) {
  const dt = Math.min(now - lastTime, 250);
  lastTime = now;
  if (state === 'playing') {
    handleEvents(game.update(dt));
    const { baseTicksPerSecond, maxTicksPerSecond } = game.opts;
    audio.setIntensity((game.ticksPerSecond - baseTicksPerSecond) / (maxTicksPerSecond - baseTicksPerSecond));
    updateHud();
  }
  renderer.render(game);
  requestAnimationFrame(frame);
}

/* ---------------- Управление ---------------- */

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.target instanceof HTMLInputElement) return;
  const dir = KEYMAP[e.code];
  if (dir && state === 'playing') {
    e.preventDefault();
    game.turn(dir);
    return;
  }
  if (e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
    else if (state === 'menu' && e.code === 'Space') startGame();
  }
  if (e.code === 'Enter' && state === 'menu') startGame();
});

// Свайпы на телефоне.
let touchStart = null;
const canvas = $('#scene');
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  touchStart = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!touchStart || state !== 'playing') return;
  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) game.turn(dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT);
  else game.turn(dy > 0 ? DIRECTIONS.DOWN : DIRECTIONS.UP);
});

// Свернули вкладку — ставим паузу, чтобы змейка не разбилась без игрока.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

$('#btn-pause').addEventListener('click', pause);

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  audio.unlock();
  audio.play('click');
  switch (action) {
    case 'play': startGame(); break;
    case 'resume': resume(); break;
    case 'menu': toMenu(); break;
    case 'records':
      previousScreen = 'menu';
      renderRecords(settings.mode);
      show('records');
      break;
    case 'settings':
      previousScreen = state === 'paused' ? 'pause' : 'menu';
      renderSettings();
      show('settings');
      break;
    case 'back':
      show(previousScreen);
      if (previousScreen === 'menu') renderer.setup(game = createGame(), settings);
      break;
    default: break;
  }
});

/* ---------------- Меню режимов ---------------- */

function markActive(container, attr, value) {
  for (const b of container.querySelectorAll('button')) {
    const active = b.dataset[attr] === value;
    b.classList.toggle('active', active);
    b.setAttribute('aria-checked', String(active));
  }
}

$('#mode-select').addEventListener('click', (e) => {
  const mode = e.target.closest('button')?.dataset.mode;
  if (!mode) return;
  settings.mode = mode;
  saveSettings(settings);
  markActive($('#mode-select'), 'mode', mode);
  game = createGame();
  renderer.setup(game, settings);
});

/* ---------------- Рекорды ---------------- */

function renderRecords(mode) {
  markActive($('#records-tabs'), 'mode', mode);
  const list = loadRecords()[mode] ?? [];
  const ol = $('#records-list');
  ol.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Пока пусто — станьте первым!';
    ol.append(li);
    return;
  }
  for (const r of list) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = r.name;
    const score = document.createElement('b');
    score.textContent = r.score;
    const meta = document.createElement('small');
    meta.textContent = `длина ${r.length} · ${new Date(r.date).toLocaleDateString('ru-RU')}`;
    li.append(name, score, meta);
    ol.append(li);
  }
}

$('#records-tabs').addEventListener('click', (e) => {
  const mode = e.target.closest('button')?.dataset.mode;
  if (mode) renderRecords(mode);
});

$('#record-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#record-name').value.trim() || 'Игрок';
  addRecord(settings.mode, {
    name, score: game.score, length: game.length, date: Date.now(),
  });
  $('#record-form').classList.add('hidden');
  previousScreen = 'menu';
  renderRecords(settings.mode);
  show('records');
});

/* ---------------- Настройки ---------------- */

function renderSettings() {
  $('#set-music').value = settings.musicVolume;
  $('#set-sfx').value = settings.sfxVolume;
  markActive($('#set-speed'), 'value', settings.speed);
  markActive($('#set-theme'), 'value', settings.theme);
  markActive($('#set-camera'), 'value', settings.camera);
}

function bindSegmented(id, key, onChange) {
  $(id).addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (!value) return;
    settings[key] = value;
    saveSettings(settings);
    markActive($(id), 'value', value);
    onChange?.(value);
  });
}

bindSegmented('#set-speed', 'speed', (v) => { game.opts.speedFactor = SPEED_FACTORS[v]; });
bindSegmented('#set-theme', 'theme', () => {
  // Тема меняется только в меню, чтобы не сбрасывать текущую партию.
  if (state === 'menu') renderer.setup(game, settings);
});
bindSegmented('#set-camera', 'camera', (v) => { renderer.cameraMode = v; });

for (const [id, key] of [['#set-music', 'musicVolume'], ['#set-sfx', 'sfxVolume']]) {
  $(id).addEventListener('input', (e) => {
    settings[key] = Number(e.target.value);
    audio.setVolumes(settings);
    saveSettings(settings);
  });
}
$('#set-sfx').addEventListener('change', () => audio.play('eat'));

/* ---------------- Старт ---------------- */

function renderCredits() {
  const track = audio.currentTrack;
  $('#music-credits').innerHTML = track
    ? `Музыка: «${track.title}» — ${track.author}. ${track.license}`
    : '';
}

markActive($('#mode-select'), 'mode', settings.mode);
renderCredits();
renderer.setup(game, settings);
show('menu');
requestAnimationFrame(frame);
