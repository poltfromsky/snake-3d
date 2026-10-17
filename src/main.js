/**
 * Точка входа: связывает логику, 3D-сцену, звук, сеть и интерфейс.
 *
 * Виды партий (kind):
 *   solo  — одиночная игра (Game);
 *   local — двое за одной клавиатурой (Duel);
 *   host  — хозяин онлайн-комнаты: считает Duel и рассылает снимки;
 *   guest — гость: рисует снимки хозяина и отправляет свои повороты.
 */
import { DIRECTIONS, Game, MODES } from './core/game.js';
import { Duel } from './core/duel.js';
import { SceneRenderer, THEMES } from './render/scene.js';
import { AudioManager, MUSIC_LICENSE, MUSIC_TRACKS } from './audio/audio.js';
import { normalizeRoomCode, OnlineLink, roomLink } from './net/online.js';
import { Leaderboard } from './net/leaderboard.js';
import { APP_VERSION, SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';
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

const STATE_SEND_INTERVAL_MS = 33; // ~30 снимков в секунду гостю
const COUNTDOWN_MS = 3000;

const settings = loadSettings();
const audio = new AudioManager();
audio.setVolumes(settings);
const renderer = new SceneRenderer($('#scene'));
const leaderboard = new Leaderboard(SUPABASE_URL, SUPABASE_ANON_KEY);

let kind = 'solo';
let game = createGame();
let state = 'menu'; // menu | lobby | countdown | playing | paused | over
let previousScreen = 'menu';
let lastTime = performance.now();

// Онлайн
let link = null;
let leaving = false;
let remote = null; // { snap, receivedAt } — последний снимок у гостя
let remoteNeedsSetup = false;
let lastStateSent = 0;
let countdownLeft = 0;
let lastCountdownShown = 0;
const rematchVotes = new Set();

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
const myIndex = () => (kind === 'guest' ? 1 : 0);

/** То, что рисует сцена: сама игра или вид из снимка хозяина. */
function currentView() {
  if (kind !== 'guest' || !remote) return game;
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
  $('#btn-pause').classList.toggle('hidden', kind === 'host' || kind === 'guest');
}

function beginPlaying() {
  state = 'playing';
  show(null);
  const timed = (kind === 'guest' ? remote?.snap.mode : game.opts.mode) === MODES.TIMED;
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
  if (state !== 'playing' || kind === 'host' || kind === 'guest') return;
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
    const loser = deathReasons.findIndex(Boolean);
    if (loser >= 0) why = `${playerName(loser)}: ${DUEL_REASONS[deathReasons[loser]]}`;
  }
  $('#duel-title').textContent = title;
  $('#duel-reason').textContent = why;
  $('#duel-s0').textContent = `${playerName(0)} ${scores[0]}`;
  $('#duel-s1').textContent = `${scores[1]} ${playerName(1)}`;
  $('#duel-status').textContent = '';
  rematchVotes.clear();
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
    const scores = kind === 'guest'
      ? (remote?.snap.players.map((p) => p.score) ?? [0, 0])
      : game.players.map((p) => p.score);
    const timeLeft = kind === 'guest' ? remote?.snap.timeLeft : game.timeLeftMs;
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
        else if (kind === 'guest') duelOver(e, e.scores, e.deaths);
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

  if (kind === 'host' && state === 'countdown') tickCountdown(dt);

  if (state === 'playing' && kind !== 'guest') {
    const events = game.update(dt);
    if (kind === 'host' && events.length) {
      // Гостю нужны итоговые очки и причины прямо в событии конца игры.
      const outgoing = events.map((e) => (e.type === 'gameOver'
        ? { ...e, scores: game.players.map((p) => p.score), deaths: game.players.map((p) => p.deathReason) }
        : e));
      link.send({ t: 'events', list: outgoing });
    }
    handleEvents(events);
    const { baseTicksPerSecond, maxTicksPerSecond } = game.opts;
    audio.setIntensity((game.ticksPerSecond - baseTicksPerSecond) / (maxTicksPerSecond - baseTicksPerSecond));
  }
  if (kind === 'host' && link?.connected && now - lastStateSent > STATE_SEND_INTERVAL_MS) {
    link.send({ t: 'state', s: game.snapshot() });
    lastStateSent = now;
  }
  if (state === 'playing' || state === 'countdown') updateHud();

  if (kind === 'guest' && remoteNeedsSetup && remote) {
    setupScene();
    remoteNeedsSetup = false;
  }
  if (kind !== 'guest' || remote) renderer.render(currentView(), myIndex());
  requestAnimationFrame(frame);
}

/* ---------------- Онлайн ---------------- */

function setOnlineStatus(text, isError = false) {
  const el = $('#online-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function openOnlineScreen() {
  leaveRoom();
  state = 'lobby';
  $('#online-start').classList.remove('hidden');
  $('#online-room').classList.add('hidden');
  setOnlineStatus('');
  show('online');
}

function makeLink() {
  leaving = false;
  return new OnlineLink({
    onOpen: () => {
      if (kind === 'host') {
        setOnlineStatus('Друг подключился! Начинаем…');
        startOnlineRound();
      } else {
        setOnlineStatus('Подключено! Ждём старта…');
      }
    },
    onMessage: handleNetMessage,
    onClose: () => {
      if (leaving) return;
      toast('Друг отключился');
      toMenu();
    },
    onError: (text) => {
      setOnlineStatus(text, true);
      if (state !== 'lobby') {
        toast('Связь потеряна');
        toMenu();
      }
    },
  });
}

async function createRoom() {
  leaveRoom();
  kind = 'host';
  link = makeLink();
  setOnlineStatus('Создаём комнату…');
  try {
    const code = await link.host();
    $('#online-start').classList.add('hidden');
    $('#online-room').classList.remove('hidden');
    $('#room-link').value = roomLink(code);
    $('#room-code').textContent = code;
    setOnlineStatus('Ждём друга… Отправьте ему ссылку.');
  } catch {
    kind = 'solo';
  }
}

async function joinRoom(rawCode) {
  const code = normalizeRoomCode(rawCode);
  if (code.length < 4) {
    setOnlineStatus('Введите код комнаты из ссылки друга.', true);
    return;
  }
  leaveRoom();
  kind = 'guest';
  remote = null;
  link = makeLink();
  setOnlineStatus(`Подключаемся к комнате ${code}…`);
  try {
    await link.join(code);
  } catch {
    kind = 'solo';
  }
}

function leaveRoom() {
  if (!link) return;
  leaving = true;
  link.send({ t: 'bye' });
  link.close();
  link = null;
  remote = null;
}

/** Хозяин: новая партия с отсчётом 3-2-1. */
function startOnlineRound() {
  game = createDuel();
  rematchVotes.clear();
  setupScene();
  link.send({ t: 'round' });
  link.send({ t: 'state', s: game.snapshot() });
  state = 'countdown';
  countdownLeft = COUNTDOWN_MS;
  lastCountdownShown = 0;
  show(null);
  audio.startMusic();
}

function tickCountdown(dt) {
  countdownLeft -= dt;
  const n = Math.ceil(countdownLeft / 1000);
  if (n !== lastCountdownShown && n > 0) {
    lastCountdownShown = n;
    showCountdown(n);
    link.send({ t: 'countdown', n });
  }
  if (countdownLeft <= 0) {
    link.send({ t: 'go' });
    showCountdown(0);
    beginPlaying();
  }
}

function showCountdown(n) {
  toast(n > 0 ? String(n) : 'Вперёд!');
  audio.play(n > 0 ? 'click' : 'levelUp');
}

function handleNetMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'state':
      if (kind !== 'guest') return;
      remote = { snap: msg.s, receivedAt: performance.now() };
      break;
    case 'round':
      if (kind !== 'guest') return;
      remoteNeedsSetup = true;
      state = 'countdown';
      show(null);
      audio.startMusic();
      break;
    case 'countdown':
      if (kind === 'guest') showCountdown(msg.n);
      break;
    case 'go':
      if (kind === 'guest') { showCountdown(0); beginPlaying(); }
      break;
    case 'events':
      if (kind === 'guest' && Array.isArray(msg.list)) handleEvents(msg.list);
      break;
    case 'turn':
      if (kind === 'host' && state === 'playing' && DIRECTIONS[msg.dir]) game.turn(1, DIRECTIONS[msg.dir]);
      break;
    case 'rematch':
      voteRematch(kind === 'host' ? 1 : 0, false);
      break;
    case 'bye':
      leaving = true;
      toast('Друг вышел из игры');
      toMenu();
      break;
    default:
      break;
  }
}

/** Реванш начинается, когда его хотят оба. */
function voteRematch(index, mine) {
  if (kind === 'local') {
    startLocalDuel();
    return;
  }
  rematchVotes.add(index);
  if (mine) link?.send({ t: 'rematch' });
  if (rematchVotes.size >= 2 && kind === 'host') {
    startOnlineRound();
    return;
  }
  $('#duel-status').textContent = mine ? 'Ждём ответа друга…' : 'Друг хочет реванш!';
}

/* ---------------- Управление ---------------- */

function steer(index, dirName) {
  if (state !== 'playing') return;
  if (kind === 'solo') game.turn(DIRECTIONS[dirName]);
  else if (kind === 'local' || kind === 'host') game.turn(index, DIRECTIONS[dirName]);
  else if (kind === 'guest') link?.send({ t: 'turn', dir: dirName });
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

window.addEventListener('beforeunload', () => link?.send({ t: 'bye' }));

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
    case 'create-room': createRoom(); break;
    case 'copy-link':
      try {
        await navigator.clipboard.writeText($('#room-link').value);
        setOnlineStatus('Ссылка скопирована — отправьте её другу. Ждём…');
      } catch {
        $('#room-link').select();
        setOnlineStatus('Скопируйте ссылку вручную (Ctrl+C).');
      }
      break;
    case 'rematch': voteRematch(myIndex(), true); break;
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
    } catch {
      $('#record-status').textContent = 'Не получилось отправить в общую таблицу — у вас результат сохранён.';
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
  } catch {
    status.textContent = 'Не получилось отправить. Проверьте интернет и попробуйте ещё раз.';
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
  if (kind !== 'guest') game.opts.speedFactor = SPEED_FACTORS[v];
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
