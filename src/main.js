/**
 * Точка входа: связывает логику, 3D-сцену, звук, сеть и интерфейс.
 *
 * Виды партий (kind):
 *   solo   — одиночная игра (Game);
 *   local  — двое за одной клавиатурой (Duel);
 *   online — партия на сервере (server/): рисуем его снимки, шлём свои повороты.
 */
import { DIRECTIONS, Game, MODES } from './core/game.js';
import { Duel } from './core/duel.js';
import { SceneRenderer, THEMES } from './render/scene.js';
import { AudioManager, MUSIC_LICENSE, MUSIC_TRACKS } from './audio/audio.js';
import {
  createRoom as requestRoom, normalizeRoomCode, RoomConnection, roomLink,
} from './net/online.js';
import { Leaderboard } from './net/leaderboard.js';
import { API_BASE, APP_VERSION } from './config.js';
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

const DUEL_REASONS = {
  self: 'укусил сам себя',
  wall: 'врезался в стену',
  stone: 'врезался в камень',
  rival: 'врезался в соперника',
  headOn: 'Столкновение лоб в лоб',
  time: 'Время вышло — решили очки',
};

const ARROWS = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
};
const WASD = {
  KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT',
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setVolumes(settings);
const renderer = new SceneRenderer($('#scene'));
const leaderboard = new Leaderboard(API_BASE);

let kind = 'solo';
let game = createGame();
let state = 'menu'; // menu | lobby | countdown | playing | paused | over
let previousScreen = 'menu';
let lastTime = performance.now();

// Онлайн
let conn = null;
let leaving = false;
let remote = null; // { snap, receivedAt } — последний снимок от сервера
let remoteNeedsSetup = false;
let mySlot = 0;
// Во время партии сервер шлёт снимок минимум раз в полсекунды. Если данных нет
// дольше, связь оборвалась где-то в сети (так бывает без VPN) — честно говорим об этом.
const STALL_MS = 3000;
const VPN_HINT = 'Для онлайн-игры включите VPN.';

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

function createDuel() {
  // Поле дуэли одинаковое у обоих игроков, поэтому не зависит от экрана.
  return new Duel({
    width: 26,
    height: 16,
    mode: settings.mode,
    speedFactor: SPEED_FACTORS[settings.speed] ?? 1,
  });
}

const isDuel = () => kind !== 'solo';
const myIndex = () => (kind === 'online' ? mySlot : 0);

/** То, что рисует сцена: сама игра или вид из снимка сервера. */
function currentView() {
  if (kind !== 'online' || !remote) return game;
  const { snap, receivedAt } = remote;
  const elapsed = performance.now() - receivedAt;
  return {
    opts: { width: snap.w, height: snap.h, mode: snap.mode },
    snakes: snap.players.map((p, i) => ({
      body: p.body, prevBody: p.prev, direction: p.dir, ghost: false, palette: i, alive: p.alive,
    })),
    items: snap.items,
    obstacles: snap.obstacles,
    // Между снимками досчитываем движение сами, чтобы змейки шли плавно.
    stepProgress: snap.over ? 1 : Math.min(snap.progress + elapsed / snap.interval, 1),
    over: snap.over,
  };
}

/** Пересобирает сцену и подстраивает цвета интерфейса под тему. */
function setupScene(view = currentView()) {
  document.documentElement.dataset.theme = settings.theme;
  renderer.setup(view, settings, myIndex());
}

/* ---------------- Экраны ---------------- */

const screens = ['menu', 'pause', 'over', 'records', 'settings', 'online', 'duel', 'feedback'];

function show(name) {
  for (const s of screens) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  const hudVisible = name === null || name === 'pause' || name === 'over' || name === 'duel';
  $('#hud').classList.toggle('hidden', !hudVisible);
  document.body.classList.toggle('duel', isDuel());
  // В онлайне паузы нет: игра у обоих общая.
  $('#btn-pause').classList.toggle('hidden', kind === 'online');
}

function beginPlaying() {
  state = 'playing';
  show(null);
  const timed = (kind === 'online' ? remote?.snap.mode : game.opts.mode) === MODES.TIMED;
  $('#hud-timer-box').classList.toggle('hidden', !timed);
  audio.startMusic();
  lastTime = performance.now();
  updateHud();
}

function startSolo() {
  kind = 'solo';
  game = createGame();
  setupScene();
  beginPlaying();
}

function startLocalDuel() {
  kind = 'local';
  game = createDuel();
  setupScene();
  beginPlaying();
  toast('WASD против стрелок!');
}

function pause() {
  if (state !== 'playing' || kind === 'online') return;
  state = 'paused';
  audio.pauseMusic();
  show('pause');
}

function resume() {
  if (state !== 'paused') return;
  show(null);
  beginPlaying();
}

function toMenu() {
  leaveRoom();
  kind = 'solo';
  state = 'menu';
  audio.pauseMusic();
  game = createGame();
  setupScene();
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
  // В общую таблицу можно отправить любой ненулевой результат, даже не личный рекорд.
  const canSave = record || (leaderboard.enabled && game.score > 0);
  $('#record-form').classList.toggle('hidden', !canSave);
  $('#record-label').textContent = record ? 'Новый рекорд! Ваше имя:' : 'Ваше имя для общей таблицы:';
  $('#record-name').value = settings.playerName ?? '';
  $('#record-comment').value = '';
  $('#record-status').textContent = '';
  $('#record-form button[type=submit]').disabled = false;
  if (record) setTimeout(() => audio.play('record'), 700);
  // Небольшая задержка, чтобы игрок увидел момент столкновения.
  setTimeout(() => {
    if (state !== 'over') return;
    show('over');
    if (canSave) $('#record-name').focus();
  }, 900);
}

function playerName(index) {
  if (kind === 'local') return `Игрок ${index + 1}`;
  return index === myIndex() ? 'Вы' : 'Друг';
}

function duelOver({ winner, reason }, scores, deathReasons) {
  state = 'over';
  audio.setIntensity(0);
  renderer.shakeCamera(0.8);
  const me = myIndex();
  let title;
  if (winner === null) title = 'Ничья';
  else if (kind === 'local') title = `Победил игрок ${winner + 1}!`;
  else title = winner === me ? 'Победа!' : 'Поражение';
  audio.play(winner === null || (kind !== 'local' && winner !== me) ? 'die' : 'record');

  let why = DUEL_REASONS[reason] ?? '';
  if (!['headOn', 'time'].includes(reason)) {
    const losers = [0, 1].filter((i) => deathReasons[i]);
    if (losers.length === 2) why = 'Оба выбыли одновременно';
    else if (losers.length === 1) why = `${playerName(losers[0])}: ${DUEL_REASONS[deathReasons[losers[0]]]}`;
  }
  $('#duel-title').textContent = title;
  $('#duel-reason').textContent = why;
  $('#duel-s0').textContent = `${playerName(0)} ${scores[0]}`;
  $('#duel-s1').textContent = `${scores[1]} ${playerName(1)}`;
  $('#duel-status').textContent = '';
  setTimeout(() => { if (state === 'over') show('duel'); }, 900);
}

/* ---------------- HUD ---------------- */

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setHtml(el, html) {
  if (el.innerHTML !== html) el.innerHTML = html;
}

function updateHud() {
  if (isDuel()) {
    const scores = kind === 'online'
      ? (remote?.snap.players.map((p) => p.score) ?? [0, 0])
      : game.players.map((p) => p.score);
    const timeLeft = kind === 'online' ? remote?.snap.timeLeft : game.timeLeftMs;
    const theme = THEMES[settings.theme] ?? THEMES.neon;
    const color = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
    setHtml($('#hud-duel'), `<span style="color:${color(theme.head)}">● ${playerName(0)} <b>${scores[0]}</b></span>`
      + `<span style="color:${color(theme.rivalHead)}"><b>${scores[1]}</b> ${playerName(1)} ●</span>`);
    if (timeLeft != null) $('#hud-timer').textContent = formatTime(timeLeft);
    return;
  }
  $('#hud-score').textContent = game.score;
  $('#hud-length').textContent = game.length;
  $('#hud-level').textContent = game.level;
  if (game.timeLeftMs != null) $('#hud-timer').textContent = formatTime(game.timeLeftMs);
  const effects = [];
  if (game.effects.slow > 0) effects.push(`<span class="effect slow">🐢 ${Math.ceil(game.effects.slow / 1000)}</span>`);
  if (game.effects.ghost > 0) effects.push(`<span class="effect ghost">👻 ${Math.ceil(game.effects.ghost / 1000)}</span>`);
  setHtml($('#hud-effects'), effects.join(''));
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
        if (!isDuel()) gameOver(e.reason);
        else if (kind === 'online') duelOver(e, e.scores, e.deaths);
        else duelOver(e, game.players.map((p) => p.score), game.players.map((p) => p.deathReason));
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

  if (kind === 'online' && state === 'playing' && remote && !remote.snap.over
    && now - remote.receivedAt > STALL_MS) {
    connectionLost();
  }

  if (state === 'playing' && kind !== 'online') {
    const events = game.update(dt);
    handleEvents(events);
    const { baseTicksPerSecond, maxTicksPerSecond } = game.opts;
    audio.setIntensity((game.ticksPerSecond - baseTicksPerSecond) / (maxTicksPerSecond - baseTicksPerSecond));
  }
  if (state === 'playing' || state === 'countdown') updateHud();

  if (kind === 'online' && remoteNeedsSetup && remote) {
    setupScene();
    remoteNeedsSetup = false;
  }
  if (kind !== 'online' || remote) renderer.render(currentView(), myIndex());
  requestAnimationFrame(frame);
}

/* ---------------- Онлайн ---------------- */

function setOnlineStatus(text, isError = false) {
  const el = $('#online-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function setBusy(selector, busy, busyText, idleText) {
  const button = $(selector);
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

function openOnlineScreen() {
  leaveRoom();
  state = 'lobby';
  $('#online-start').classList.remove('hidden');
  $('#online-room').classList.add('hidden');
  setOnlineStatus('');
  show('online');
}

/** Подключается к комнате на сервере; общая часть для создателя и друга. */
async function connectToRoom(code) {
  leaveRoom();
  leaving = false;
  remote = null;
  const connection = new RoomConnection(API_BASE, code, {
    onMessage: handleNetMessage,
    onClose: () => {
      if (leaving || conn !== connection) return;
      connectionLost();
    },
  });
  conn = connection;
  const joined = await connection.connect();
  kind = 'online';
  mySlot = joined.slot;
  return joined;
}

async function createRoomFlow() {
  setBusy('[data-action="create-room"]', true, 'Создаём…', 'Создать комнату');
  setOnlineStatus('Создаём комнату…');
  try {
    const code = await requestRoom(API_BASE, { mode: settings.mode, speed: settings.speed });
    await connectToRoom(code);
    $('#online-start').classList.add('hidden');
    $('#online-room').classList.remove('hidden');
    $('#room-link').value = roomLink(code);
    $('#room-code').textContent = code;
    setOnlineStatus('Ждём друга… Отправьте ему ссылку.');
  } catch (err) {
    leaveRoom();
    setOnlineStatus(err?.message || 'Не удалось создать комнату.', true);
  } finally {
    setBusy('[data-action="create-room"]', false, '', 'Создать комнату');
  }
}

async function joinRoom(rawCode) {
  const code = normalizeRoomCode(rawCode);
  if (code.length < 4) {
    setOnlineStatus('Введите код комнаты из ссылки друга.', true);
    return;
  }
  setBusy('#join-form button[type=submit]', true, 'Подключаемся…', 'Войти');
  setOnlineStatus(`Подключаемся к комнате ${code}…`);
  try {
    await connectToRoom(code);
    setOnlineStatus('Подключено! Начинаем…');
  } catch (err) {
    leaveRoom();
    setOnlineStatus(err?.message || 'Не удалось подключиться.', true);
  } finally {
    setBusy('#join-form button[type=submit]', false, '', 'Войти');
  }
}

/** Связь с сервером пропала: выходим из комнаты и объясняем, что делать. */
function connectionLost() {
  if (kind !== 'online') return;
  leaveRoom();
  state = 'lobby';
  $('#online-start').classList.remove('hidden');
  $('#online-room').classList.add('hidden');
  show('online');
  setOnlineStatus(`Связь с сервером прервалась. ${VPN_HINT}`, true);
  audio.pauseMusic();
}

function leaveRoom() {
  if (!conn) return;
  leaving = true;
  conn.close();
  conn = null;
  remote = null;
  if (kind === 'online') kind = 'solo';
}

function showCountdown(n) {
  toast(n > 0 ? String(n) : 'Вперёд!');
  audio.play(n > 0 ? 'click' : 'levelUp');
}

/** Сообщения сервера (протокол описан в src/core/room.js). */
function handleNetMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'state':
      remote = { snap: msg.s, receivedAt: performance.now() };
      if (Array.isArray(msg.events) && msg.events.length) handleEvents(msg.events);
      break;
    case 'round':
      remoteNeedsSetup = true;
      state = 'countdown';
      show(null);
      audio.startMusic();
      break;
    case 'countdown':
      showCountdown(msg.n);
      break;
    case 'go':
      showCountdown(0);
      beginPlaying();
      break;
    case 'rematch': {
      const mine = msg.votes?.[mySlot];
      $('#duel-status').textContent = mine ? 'Ждём ответа друга…' : 'Друг хочет реванш!';
      break;
    }
    case 'opponent':
      // Второй игрок подключился — партию запустит сам сервер.
      if (!msg.connected && state !== 'lobby') {
        toast('Друг вышел из игры');
        toMenu();
      }
      break;
    case 'error':
      setOnlineStatus(msg.text, true);
      break;
    default:
      break;
  }
}

function voteRematch() {
  if (kind === 'local') {
    startLocalDuel();
    return;
  }
  conn?.send({ t: 'rematch' });
}

/* ---------------- Управление ---------------- */

function steer(index, dirName) {
  if (state !== 'playing') return;
  if (kind === 'solo') game.turn(DIRECTIONS[dirName]);
  else if (kind === 'local') game.turn(index, DIRECTIONS[dirName]);
  else if (kind === 'online') conn?.send({ t: 'turn', dir: dirName });
}

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.target instanceof HTMLInputElement) return;
  const arrow = ARROWS[e.code];
  const wasd = WASD[e.code];
  if ((arrow || wasd) && state === 'playing') {
    e.preventDefault();
    // За одной клавиатурой: WASD — первый игрок, стрелки — второй.
    if (kind === 'local') steer(wasd ? 0 : 1, wasd ?? arrow);
    else steer(myIndex(), wasd ?? arrow);
    return;
  }
  if (e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
    else if (state === 'menu' && e.code === 'Space') startSolo();
  }
  if (e.code === 'Enter' && state === 'menu') startSolo();
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
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dy > 0 ? 'DOWN' : 'UP');
  steer(myIndex(), dir);
});

// Свернули вкладку — ставим паузу, чтобы змейка не разбилась без игрока.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

window.addEventListener('beforeunload', () => conn?.close());

$('#btn-pause').addEventListener('click', pause);

document.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  audio.unlock();
  audio.play('click');
  switch (action) {
    case 'play': startSolo(); break;
    case 'local': startLocalDuel(); break;
    case 'online': openOnlineScreen(); break;
    case 'create-room': createRoomFlow(); break;
    case 'copy-link':
      try {
        await navigator.clipboard.writeText($('#room-link').value);
        setOnlineStatus('Ссылка скопирована — отправьте её другу. Ждём…');
      } catch {
        $('#room-link').select();
        setOnlineStatus('Скопируйте ссылку вручную (Ctrl+C).');
      }
      break;
    case 'rematch': voteRematch(); break;
    case 'leave': toMenu(); break;
    case 'resume': resume(); break;
    case 'menu': toMenu(); break;
    case 'records':
      previousScreen = 'menu';
      renderRecords(settings.mode);
      show('records');
      break;
    case 'feedback':
      previousScreen = 'menu';
      $('#feedback-status').textContent = '';
      $('#feedback-name').value = $('#feedback-name').value || (settings.playerName ?? '');
      show('feedback');
      $('#feedback-message').focus();
      break;
    case 'settings':
      previousScreen = state === 'paused' ? 'pause' : 'menu';
      renderSettings();
      show('settings');
      break;
    case 'back':
      show(previousScreen);
      if (previousScreen === 'menu') {
        game = createGame();
        setupScene();
      }
      break;
    default: break;
  }
});

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom($('#join-code').value);
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
  setupScene();
});

/* ---------------- Рекорды ---------------- */

let recordsScope = leaderboard.enabled ? 'global' : 'local';
let recordsMode = settings.mode;
let recordsRequest = 0;

function recordsMessage(text, className = 'empty') {
  const li = document.createElement('li');
  li.className = className;
  li.textContent = text;
  $('#records-list').replaceChildren(li);
}

function renderRecordRows(rows) {
  const ol = $('#records-list');
  ol.replaceChildren();
  if (!rows.length) {
    recordsMessage('Пока пусто — станьте первым!');
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = r.name;
    const score = document.createElement('b');
    score.textContent = r.score;
    const meta = document.createElement('small');
    const date = new Date(r.created_at ?? r.date).toLocaleDateString('ru-RU');
    meta.textContent = `длина ${r.length} · ${date}`;
    li.append(name, score, meta);
    if (r.comment) {
      // textContent, а не innerHTML: комментарии пишут посторонние люди.
      const comment = document.createElement('small');
      comment.className = 'comment';
      comment.textContent = `«${r.comment}»`;
      li.append(comment);
    }
    ol.append(li);
  }
}

async function renderRecords(mode = recordsMode) {
  recordsMode = mode;
  markActive($('#records-tabs'), 'mode', mode);
  markActive($('#records-scope'), 'scope', recordsScope);
  if (recordsScope === 'local') {
    renderRecordRows(loadRecords()[mode] ?? []);
    return;
  }
  const request = ++recordsRequest;
  recordsMessage('Загружаем…', 'loading');
  try {
    const rows = await leaderboard.top(mode);
    if (request === recordsRequest) renderRecordRows(rows);
  } catch {
    if (request === recordsRequest) recordsMessage('Не удалось загрузить общую таблицу. Проверьте интернет.');
  }
}

$('#records-tabs').addEventListener('click', (e) => {
  const mode = e.target.closest('button')?.dataset.mode;
  if (mode) renderRecords(mode);
});

$('#records-scope').addEventListener('click', (e) => {
  const scope = e.target.closest('button')?.dataset.scope;
  if (!scope) return;
  recordsScope = scope;
  renderRecords();
});

$('#record-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#record-form button[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  const name = $('#record-name').value.trim() || 'Игрок';
  settings.playerName = name;
  saveSettings(settings);
  const entry = { name, score: game.score, length: game.length };
  if (isRecord(settings.mode, game.score)) addRecord(settings.mode, { ...entry, date: Date.now() });

  const toGlobal = leaderboard.enabled && $('#record-public').checked;
  if (toGlobal) {
    $('#record-status').textContent = 'Отправляем…';
    try {
      await leaderboard.submitRecord({ ...entry, mode: settings.mode, comment: $('#record-comment').value });
    } catch (err) {
      // Сервер объясняет отказ сам (например, «слишком часто») — показываем его слова.
      const reason = err?.message && !/^HTTP|fetch|network|abort/i.test(err.message) ? err.message : 'Нет связи с сервером.';
      $('#record-status').textContent = `${reason} У вас результат сохранён.`;
      button.disabled = false;
      return;
    }
  }
  $('#record-form').classList.add('hidden');
  previousScreen = 'menu';
  recordsScope = toGlobal ? 'global' : 'local';
  renderRecords(settings.mode);
  show('records');
});

/* ---------------- Отзыв ---------------- */

let feedbackRating = null;

$('#feedback-rating').addEventListener('click', (e) => {
  const value = e.target.closest('button')?.dataset.value;
  if (!value) return;
  feedbackRating = Number(value);
  markActive($('#feedback-rating'), 'value', value);
});

$('#feedback-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#feedback-form button[type=submit]');
  const status = $('#feedback-status');
  if (button.disabled) return;
  if ($('#feedback-message').value.trim().length < 3) {
    status.textContent = 'Напишите хотя бы пару слов.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Отправляем…';
  try {
    await leaderboard.submitFeedback({
      name: $('#feedback-name').value,
      rating: feedbackRating,
      message: $('#feedback-message').value,
      version: APP_VERSION,
    });
    status.textContent = 'Спасибо! Отзыв отправлен.';
    $('#feedback-message').value = '';
  } catch (err) {
    status.textContent = err?.message && !/^HTTP|fetch|network|abort/i.test(err.message)
      ? err.message
      : 'Не получилось отправить. Проверьте интернет и попробуйте ещё раз.';
  } finally {
    button.disabled = false;
  }
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

bindSegmented('#set-speed', 'speed', (v) => {
  if (kind !== 'online') game.opts.speedFactor = SPEED_FACTORS[v];
});
bindSegmented('#set-theme', 'theme', () => {
  // Тема меняется только в меню, чтобы не сбрасывать текущую партию.
  if (state === 'menu') setupScene();
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

/** Атрибуция по требованию CC BY 4.0: название, автор, источник, лицензия. */
function renderCredits() {
  if (!MUSIC_TRACKS.length) return;
  const titles = MUSIC_TRACKS.map((t) => `«${t.title}»`).join(', ');
  const authors = [...new Set(MUSIC_TRACKS.map((t) => t.author))].join(', ');
  $('#music-credits').innerHTML = `Музыка: ${titles} — ${authors} `
    + '(<a href="https://incompetech.com" target="_blank" rel="noopener">incompetech.com</a>), '
    + `<a href="${MUSIC_LICENSE.url}" target="_blank" rel="noopener">${MUSIC_LICENSE.name}</a>`;
}

markActive($('#mode-select'), 'mode', settings.mode);
// Общая таблица и отзывы появляются, только когда подключена база.
for (const el of document.querySelectorAll('.online-only')) {
  el.classList.toggle('hidden', !leaderboard.enabled);
}
renderCredits();
setupScene();
show('menu');

// Пришли по ссылке друга: сразу подключаемся к его комнате.
const invited = new URLSearchParams(window.location.search).get('room');
if (invited) {
  history.replaceState(null, '', window.location.pathname);
  openOnlineScreen();
  $('#join-code').value = normalizeRoomCode(invited);
  joinRoom(invited);
}

requestAnimationFrame(frame);
