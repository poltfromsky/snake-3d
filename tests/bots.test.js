import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BOT_LEVELS, BOT_ORDER, chooseMove, HungerTracker, simulateStep } from '../src/core/bot.js';
import { Duel } from '../src/core/duel.js';
import { series, seeded } from './bot-arena.js';

const W = 10;
const H = 8;
const at = (x, y) => y * W + x;

/** Ручная позиция для проверки отдельных решений. */
function board({ me, opp, wrap = false, apples = [], blocked = [] }) {
  return {
    w: W,
    h: H,
    wrap,
    timed: false,
    blocked,
    apples,
    bad: [],
    snakes: [
      { body: me.body, dir: me.dir, growth: 0, score: 0, hunger: 0 },
      { body: opp.body, dir: opp.dir, growth: 0, score: 0, hunger: 0 },
    ],
  };
}

const SMART = ['medium', 'hard', 'claude'];
const noMistakes = { mistake: 0, timeBudgetMs: 0 };
const UP = 0;
const DOWN = 1;
const LEFT = 2;
const RIGHT = 3;

test('уровни описаны и идут от слабого к сильному', () => {
  assert.deepEqual(BOT_ORDER, ['easy', 'medium', 'hard', 'claude']);
  for (const id of BOT_ORDER) assert.ok(BOT_LEVELS[id].name);
  assert.equal(BOT_LEVELS.claude.name, 'Claude');
});

test('симуляция шага повторяет правила дуэли: лоб в лоб убивает обоих', () => {
  const s = board({ me: { body: [at(3, 3)], dir: RIGHT }, opp: { body: [at(5, 3)], dir: LEFT } });
  const r = simulateStep(s, [RIGHT, LEFT]);
  assert.deepEqual(r.dead, [true, true]);
});

test('симуляция: хвост освобождает клетку на том же шаге', () => {
  // Змейка-«кольцо»: голова входит в клетку, которую уходящий хвост освобождает.
  const s = board({
    me: { body: [at(2, 2), at(3, 2), at(3, 3), at(2, 3)], dir: LEFT },
    opp: { body: [at(8, 6)], dir: LEFT },
  });
  const r = simulateStep(s, [DOWN, LEFT]);
  assert.ok(r.state, 'змейка жива');
});

for (const level of SMART) {
  test(`${level}: не врезается в стену, если можно свернуть`, () => {
    const s = board({ me: { body: [at(9, 4), at(8, 4)], dir: RIGHT }, opp: { body: [at(1, 1)], dir: DOWN } });
    const move = chooseMove(s, 0, level, seeded(1), noMistakes);
    assert.notEqual(move, 'RIGHT');
  });

  test(`${level}: не въезжает в тело соперника`, () => {
    const s = board({
      me: { body: [at(4, 3), at(3, 3)], dir: RIGHT },
      opp: { body: [at(5, 1), at(5, 2), at(5, 3), at(5, 4), at(5, 5)], dir: UP },
    });
    const move = chooseMove(s, 0, level, seeded(2), noMistakes);
    assert.notEqual(move, 'RIGHT');
  });
}

for (const level of ['medium', 'hard', 'claude']) {
  test(`${level}: не заезжает в тупик, где не поместится тело`, () => {
    // Слева от головы — карман из 2 клеток, справа — свободное поле. Тело длиной 5.
    const blocked = [at(0, 2), at(1, 2), at(0, 4), at(1, 4)];
    const s = board({
      me: { body: [at(2, 3), at(3, 3), at(4, 3), at(5, 3), at(6, 3)], dir: LEFT },
      opp: { body: [at(9, 7)], dir: LEFT },
      blocked,
    });
    const move = chooseMove(s, 0, level, seeded(3), noMistakes);
    assert.notEqual(move, 'LEFT');
  });
}

test('claude в игровом режиме (думает по времени) укладывается в бюджет и не врезается', () => {
  const s = board({ me: { body: [at(9, 4), at(8, 4), at(7, 4)], dir: RIGHT }, opp: { body: [at(2, 2), at(2, 3)], dir: UP } });
  const started = Date.now();
  const move = chooseMove(s, 0, 'claude', seeded(9), { timeBudgetMs: 30 });
  const spent = Date.now() - started;
  assert.notEqual(move, 'RIGHT', 'впереди стена');
  assert.ok(spent < 200, `думал ${spent} мс`);
});

test('голод растёт без еды и сбрасывается, когда змейка съела яблоко', () => {
  const duel = new Duel({ width: 12, height: 8 }, seeded(5));
  const tracker = new HungerTracker();
  tracker.update(duel);
  duel.step();
  assert.deepEqual(tracker.update(duel), [1, 1]);
  duel.players[0].growth += 1;
  assert.equal(tracker.update(duel)[0], 0);
});

// Лестница сложности, измеренная турниром (полный замер — tools/bot-ladder.mjs).
// Партии детерминированы: при неизменном коде результат одинаковый.
const claudeFixed = { timeBudgetMs: 0, depth: 3 };
const ladder = [
  ['medium', 'easy', {}],
  ['hard', 'medium', {}],
  ['claude', 'hard', claudeFixed],
];
for (const [strong, weak, strongOptions] of ladder) {
  test(`лестница: ${strong} уверенно обыгрывает ${weak}`, () => {
    const r = series(strong, weak, 6, { strongOptions });
    assert.ok(r.wins >= 4, `${strong} против ${weak}: ${JSON.stringify(r)}`);
  });
}

/**
 * Партия бота на поле, как на телефоне (14×20, «Классика»), против змейки, которая едет прямо.
 * worker — как отвечает поток бота: 'never' (ответ всегда опаздывает), 'instant' или null (без потока).
 * Возвращает, сколько бот съел и сколько раз сменил направление.
 */
async function phoneMatch(level, worker, seed = 5, steps = 400) {
  const { BotPlayer } = await import('../src/bot-player.js');
  const duel = new Duel({ mode: 'classic', width: 14, height: 20 }, seeded(seed));
  const fake = worker === null ? null : {
    postMessage(msg) {
      if (worker === 'instant') queueMicrotask(() => this.onmessage({ data: { id: msg.id, move: chooseMove(msg.state, msg.me, msg.level, seeded(msg.id), msg.options), spentMs: 1 } }));
    },
    terminate() {},
  };
  const bot = new BotPlayer(level, 1, { createWorker: () => fake });
  let turns = 0;
  let last = duel.players[1].direction;
  for (let i = 0; i < steps && !duel.over; i += 1) {
    bot.update(duel);
    await Promise.resolve(); // ответ «мгновенного» потока приходит до шага
    duel.step();
    const dir = duel.players[1].direction;
    if (dir !== last) turns += 1;
    last = dir;
  }
  bot.dispose();
  return { eaten: duel.players[1].score / 10, turns, alive: duel.players[1].alive };
}

for (const level of BOT_ORDER) {
  test(`${BOT_LEVELS[level].name}: даже если поток бота ни разу не успел ответить, бот поворачивает и ест`, async () => {
    // Так было на телефоне: Claude вырос, игра ускорилась, ответы опаздывали — бот ехал только прямо
    // (раньше здесь было 0 поворотов). Соперник едет прямо и быстро врезается — считаем по трём партиям.
    let turns = 0;
    let eaten = 0;
    for (const seed of [5, 6, 7]) {
      const r = await phoneMatch(level, 'never', seed);
      turns += r.turns;
      eaten += r.eaten;
    }
    assert.ok(turns >= 8, `поворотов ${turns}`);
    assert.ok(eaten >= 4, `съел ${eaten}`);
  });
}

test('Claude с потоком, который отвечает вовремя, тоже играет: поворачивает и ест', async () => {
  const r = await phoneMatch('claude', 'instant');
  assert.ok(r.turns >= 8, `поворотов ${r.turns}`);
  assert.ok(r.eaten >= 4, `съел ${r.eaten}`);
});

test('бюджет потока бота: опаздываем — думаем короче; успеваем — до 35 мс', async () => {
  const { BotPlayer } = await import('../src/bot-player.js');
  const bot = new BotPlayer('claude', 1, { createWorker: () => null });
  const duel = { stepIntervalMs: 120 };
  assert.equal(bot.budget(duel), 35);
  bot.late = 2;
  assert.ok(bot.budget(duel) < 35, 'опоздали дважды — думаем короче');
  bot.late = 0;
  bot.overhead = 200; // поток отвечает очень медленно — минимум
  assert.equal(bot.budget(duel), 4);
});
