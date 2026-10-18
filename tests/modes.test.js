import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DIRECTIONS, MODES } from '../src/core/game.js';
import {
  BotDuelMode, LocalDuelMode, OnlineMode, SoloMode,
} from '../src/modes/modes.js';

const FIELD = { mode: MODES.CLASSIC, speedFactor: 1 };

function fakeBot() {
  const bot = { updates: 0, disposed: false };
  bot.update = () => { bot.updates += 1; };
  bot.dispose = () => { bot.disposed = true; };
  return bot;
}

function fakeConnection() {
  return {
    sent: [],
    closed: false,
    send(msg) { this.sent.push(msg); },
    close() { this.closed = true; },
  };
}

function snapshot(overrides = {}) {
  return {
    w: 26,
    h: 16,
    mode: MODES.CLASSIC,
    players: [
      { body: [{ x: 3, y: 8 }], prev: [{ x: 2, y: 8 }], dir: DIRECTIONS.RIGHT, alive: true, score: 4 },
      { body: [{ x: 22, y: 8 }], prev: [{ x: 23, y: 8 }], dir: DIRECTIONS.LEFT, alive: true, score: 7 },
    ],
    items: [],
    obstacles: [],
    progress: 0.25,
    interval: 100,
    over: false,
    timeLeft: null,
    ...overrides,
  };
}

const lastTurn = (snake) => snake.turnQueue.at(-1);

test('у всех режимов один и тот же интерфейс', () => {
  const modes = [
    new SoloMode({ ...FIELD, narrow: false }),
    new LocalDuelMode(FIELD),
    new BotDuelMode({ ...FIELD, level: 'easy', createBot: fakeBot }),
    new OnlineMode({ connection: fakeConnection(), slot: 0 }),
  ];
  const fields = ['kind', 'isDuel', 'canPause', 'restartable', 'myIndex'];
  const methods = ['update', 'steer', 'playerName', 'hud', 'intensity', 'setSpeedFactor', 'dispose'];
  for (const m of modes) {
    for (const f of fields) assert.notEqual(m[f], undefined, `${m.constructor.name}.${f}`);
    for (const f of methods) assert.equal(typeof m[f], 'function', `${m.constructor.name}.${f}()`);
    assert.ok('view' in m && 'timed' in m && 'game' in m, m.constructor.name);
    if (m.isDuel) assert.equal(typeof m.duelResult, 'function', `${m.constructor.name}.duelResult()`);
  }
  assert.deepEqual(modes.map((m) => m.kind), ['solo', 'local', 'bot', 'online']);
});

test('одиночная игра: поле повторяет ориентацию экрана', () => {
  const wide = new SoloMode({ ...FIELD, narrow: false });
  const tall = new SoloMode({ ...FIELD, narrow: true });
  assert.deepEqual([wide.game.opts.width, wide.game.opts.height], [24, 16]);
  assert.deepEqual([tall.game.opts.width, tall.game.opts.height], [14, 20]);
  assert.equal(wide.view, wide.game);
});

test('одиночная игра: любое устройство управляет единственной змейкой', () => {
  const solo = new SoloMode({ ...FIELD, narrow: false });
  solo.steer('arrows', 'UP');
  assert.deepEqual(lastTurn(solo.game), DIRECTIONS.UP);
  solo.steer('wasd', 'LEFT');
  assert.deepEqual(lastTurn(solo.game), DIRECTIONS.LEFT);
});

test('одиночная игра: HUD, таймер и скорость', () => {
  const solo = new SoloMode({ ...FIELD, narrow: false });
  const hud = solo.hud();
  assert.equal(hud.duel, false);
  assert.equal(hud.score, 0);
  assert.equal(hud.length, solo.game.length);
  assert.equal(solo.timed, false);
  assert.equal(new SoloMode({ ...FIELD, mode: MODES.TIMED, narrow: false }).timed, true);
  assert.equal(solo.intensity(), 0);
  solo.setSpeedFactor(1.5);
  assert.equal(solo.game.opts.speedFactor, 1.5);
});

test('одна клавиатура: WASD — первый игрок, стрелки — второй, свайп — первый', () => {
  const duel = new LocalDuelMode(FIELD);
  const [a, b] = duel.game.players;
  duel.steer('wasd', 'UP');
  duel.steer('arrows', 'DOWN');
  assert.deepEqual(lastTurn(a), DIRECTIONS.UP);
  assert.deepEqual(lastTurn(b), DIRECTIONS.DOWN);
  duel.steer('touch', 'LEFT');
  assert.deepEqual(lastTurn(a), DIRECTIONS.LEFT);
  assert.equal(b.turnQueue.length, 1);
  assert.deepEqual([duel.playerName(0), duel.playerName(1)], ['Игрок 1', 'Игрок 2']);
  assert.equal(duel.restartable, true);
  assert.equal(duel.canPause, true);
});

test('дуэль: итог берётся из логики — очки и причины выбывания', () => {
  const duel = new LocalDuelMode(FIELD);
  duel.game.players[0].score = 3;
  duel.game.players[1].deathReason = 'wall';
  assert.deepEqual(duel.duelResult(), { scores: [3, 0], deaths: [null, 'wall'] });
  assert.deepEqual(duel.hud(), { duel: true, scores: [3, 0], timeLeft: null });
});

test('против бота: бот ведёт вторую змейку и думает после каждого шага', () => {
  const created = [];
  const mode = new BotDuelMode({
    ...FIELD,
    level: 'easy',
    createBot: (level, index) => {
      created.push([level, index]);
      return fakeBot();
    },
  });
  assert.deepEqual(created, [['easy', 1]]);
  mode.update(16);
  mode.update(16);
  assert.equal(mode.bot.updates, 2);
  // Любое устройство игрока управляет его змейкой (индекс 0).
  mode.steer('arrows', 'UP');
  assert.deepEqual(lastTurn(mode.game.players[0]), DIRECTIONS.UP);
  assert.equal(mode.game.players[1].turnQueue.length, 0);
  assert.deepEqual([mode.playerName(0), mode.playerName(1)], ['Вы', 'Ужик']);
});

test('против бота: после конца партии бот молчит, dispose останавливает его поток', () => {
  const mode = new BotDuelMode({ ...FIELD, level: 'hard', createBot: fakeBot });
  mode.game.over = true;
  mode.update(16);
  assert.equal(mode.bot.updates, 0);
  mode.dispose();
  assert.equal(mode.bot.disposed, true);
});

test('онлайн: до первого снимка рисовать нечего, сцену надо собрать', () => {
  const online = new OnlineMode({ connection: fakeConnection(), slot: 1 });
  assert.equal(online.view, null);
  assert.equal(online.game, null);
  assert.equal(online.needsSetup, true);
  assert.equal(online.canPause, false);
  assert.equal(online.restartable, false);
  assert.equal(online.myIndex, 1);
  assert.deepEqual(online.hud(), { duel: true, scores: [0, 0], timeLeft: null });
});

test('онлайн: снимок превращается в вид, движение досчитывается между снимками', () => {
  let now = 1000;
  const online = new OnlineMode({ connection: fakeConnection(), slot: 0, now: () => now });
  const action = online.receive({ t: 'state', s: snapshot(), events: [{ type: 'eat' }] });
  assert.deepEqual(action, { type: 'events', events: [{ type: 'eat' }] });

  assert.equal(online.view.stepProgress, 0.25);
  now += 50; // половина интервала шага (100 мс)
  assert.equal(online.view.stepProgress, 0.75);
  now += 500;
  assert.equal(online.view.stepProgress, 1, 'дальше конца шага не убегаем');

  const { view } = online;
  assert.deepEqual(view.opts, { width: 26, height: 16, mode: MODES.CLASSIC });
  assert.deepEqual(view.snakes.map((s) => s.palette), [0, 1]);
  assert.deepEqual(view.snakes[1].prevBody, [{ x: 23, y: 8 }]);
  assert.deepEqual(online.hud().scores, [4, 7]);
});

test('онлайн: обрыв связи — страница работает, а снимков нет дольше порога', () => {
  const online = new OnlineMode({ connection: fakeConnection(), slot: 0 });
  online.update(5000);
  assert.equal(online.isStalled(3000), false, 'без снимков — ещё ждём начала');
  online.receive({ t: 'state', s: snapshot() });
  for (let t = 0; t < 2900; t += 100) online.update(100);
  assert.equal(online.isStalled(3000), false);
  for (let t = 0; t < 200; t += 100) online.update(100);
  assert.equal(online.isStalled(3000), true);
  online.receive({ t: 'state', s: snapshot() });
  assert.equal(online.isStalled(3000), false, 'новый снимок — связь есть');
});

test('онлайн: подвисание телефона — не обрыв связи (поймано в CI на медленной машине)', () => {
  const online = new OnlineMode({ connection: fakeConnection(), slot: 0 });
  online.receive({ t: 'state', s: snapshot() });
  // Страница «замерла» на 5 секунд: один кадр длиной 5000 мс. Снимки ждут в очереди.
  online.update(5000);
  assert.equal(online.isStalled(3000), false);
  // После конца партии снимков может не быть сколько угодно.
  online.receive({ t: 'state', s: snapshot({ over: true }) });
  for (let t = 0; t < 10_000; t += 100) online.update(100);
  assert.equal(online.isStalled(3000), false);
});

test('онлайн: повороты и реванш уходят на сервер, dispose закрывает соединение', () => {
  const connection = fakeConnection();
  const online = new OnlineMode({ connection, slot: 0 });
  online.steer('arrows', 'UP');
  online.rematch();
  assert.deepEqual(connection.sent, [{ t: 'turn', dir: 'UP' }, { t: 'rematch' }]);
  assert.deepEqual(online.update(16), [], 'партию считает сервер');
  online.dispose();
  assert.equal(connection.closed, true);
});

test('онлайн: сообщения сервера переводятся в действия', () => {
  const online = new OnlineMode({ connection: fakeConnection(), slot: 1 });
  online.needsSetup = false;
  assert.deepEqual(online.receive({ t: 'round' }), { type: 'round' });
  assert.equal(online.needsSetup, true, 'новый раунд — новая сцена');
  assert.deepEqual(online.receive({ t: 'countdown', n: 2 }), { type: 'countdown', n: 2 });
  assert.deepEqual(online.receive({ t: 'go' }), { type: 'go' });
  assert.deepEqual(online.receive({ t: 'rematch', votes: [true, false] }), { type: 'rematch', mine: false });
  assert.deepEqual(online.receive({ t: 'rematch', votes: [false, true] }), { type: 'rematch', mine: true });
  assert.deepEqual(online.receive({ t: 'opponent', connected: false }), { type: 'opponent', connected: false });
  assert.deepEqual(online.receive({ t: 'error', text: 'Комната занята' }), { type: 'error', text: 'Комната занята' });
  assert.equal(online.receive({ t: 'joined', slot: 1 }), null);
  assert.equal(online.receive(null), null);
  assert.equal(online.receive('мусор'), null);
});

test('онлайн: подписи и итог партии со стороны своего слота', () => {
  const online = new OnlineMode({ connection: fakeConnection(), slot: 1 });
  assert.deepEqual([online.playerName(0), online.playerName(1)], ['Друг', 'Вы']);
  const event = { type: 'gameOver', winner: 1, reason: 'wall', scores: [2, 5], deaths: ['wall', null] };
  assert.deepEqual(online.duelResult(event), { scores: [2, 5], deaths: ['wall', null] });
  assert.equal(online.intensity(), null, 'темп музыки в онлайне не меняется');
});

test('онлайн: ник соперника из входа и из сообщений, свой — всегда «Вы»', () => {
  const online = new OnlineMode({ connection: fakeConnection(), slot: 1, names: ['Питон', 'Удав'] });
  assert.deepEqual([online.playerName(0), online.playerName(1)], ['Питон', 'Вы']);
  assert.deepEqual(online.receive({ t: 'names', names: [null, 'Удав'] }), { type: 'names' });
  assert.equal(online.playerName(0), 'Друг', 'без ника — «Друг»');
  online.receive({ t: 'names', names: ['Кобра', 'Удав'] });
  assert.equal(online.playerName(0), 'Кобра');
});

test('онлайн: ники из сети чистятся и на клиенте', () => {
  const online = new OnlineMode({ connection: fakeConnection(), slot: 0 });
  online.receive({ t: 'names', names: [null, `x\u0007${'y'.repeat(40)}`] });
  assert.equal(online.playerName(1), `x ${'y'.repeat(14)}`);
  online.receive({ t: 'names', names: [null, { html: '<b>' }] });
  assert.equal(online.playerName(1), 'Друг');
  online.receive({ t: 'names', names: 'мусор' });
  assert.deepEqual(online.names, [null, null]);
});

test('онлайн: свой ник уходит на сервер, пустой — не отправляется', () => {
  const connection = fakeConnection();
  const online = new OnlineMode({ connection, slot: 0 });
  online.introduce('');
  online.introduce('Питон');
  assert.deepEqual(connection.sent, [{ t: 'name', name: 'Питон' }]);
});
