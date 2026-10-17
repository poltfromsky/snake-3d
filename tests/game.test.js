import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DIRECTIONS, Game, ITEM, MODES } from '../src/core/game.js';

/** Предсказуемый генератор: всегда возвращает одно и то же число. */
const fixedRng = (value = 0) => () => value;

/** Игра без случайных предметов, кроме тех, что тест кладёт сам. */
function makeGame(options = {}) {
  const game = new Game({ width: 10, height: 8, ...options }, fixedRng(0.99));
  game.items = [];
  return game;
}

test('змейка стартует в центре длиной 3 и смотрит вправо', () => {
  const game = makeGame();
  assert.deepEqual(game.head, { x: 5, y: 4 });
  assert.equal(game.length, 3);
  assert.deepEqual(game.direction, DIRECTIONS.RIGHT);
});

test('шаг сдвигает голову на одну клетку, длина не меняется', () => {
  const game = makeGame();
  game.step();
  assert.deepEqual(game.head, { x: 6, y: 4 });
  assert.equal(game.length, 3);
});

test('нельзя развернуться назад', () => {
  const game = makeGame();
  assert.equal(game.turn(DIRECTIONS.LEFT), false);
  game.step();
  assert.deepEqual(game.direction, DIRECTIONS.RIGHT);
});

test('два быстрых поворота применяются по очереди', () => {
  const game = makeGame();
  assert.equal(game.turn(DIRECTIONS.UP), true);
  assert.equal(game.turn(DIRECTIONS.LEFT), true);
  game.step();
  assert.deepEqual(game.direction, DIRECTIONS.UP);
  game.step();
  assert.deepEqual(game.direction, DIRECTIONS.LEFT);
});

test('классический режим: проход сквозь стену', () => {
  const game = makeGame();
  game.snake = [{ x: 9, y: 4 }];
  game.step();
  assert.deepEqual(game.head, { x: 0, y: 4 });
  assert.equal(game.over, false);
});

test('режим «стены»: выход за поле заканчивает игру', () => {
  const game = makeGame({ mode: MODES.WALLS });
  game.snake = [{ x: 9, y: 4 }];
  const events = game.step();
  assert.equal(game.over, true);
  assert.equal(game.overReason, 'wall');
  assert.ok(events.some((e) => e.type === 'gameOver'));
});

test('яблоко: +1 сегмент на следующем шаге, +10 очков, новое яблоко', () => {
  const game = makeGame();
  game.items = [{ kind: ITEM.APPLE, x: 6, y: 4, ttl: null }];
  game.step();
  assert.equal(game.score, 10);
  assert.equal(game.length, 3);
  game.step();
  assert.equal(game.length, 4);
  assert.equal(game.items.filter((i) => i.kind === ITEM.APPLE).length, 1);
});

test('плохая еда укорачивает змейку на один сегмент', () => {
  const game = makeGame();
  game.items = [{ kind: ITEM.BAD, x: 6, y: 4, ttl: 5000 }];
  game.step();
  assert.equal(game.length, 2);
  assert.equal(game.score, 0, 'счёт не уходит в минус');
});

test('столкновение с собой заканчивает игру', () => {
  const game = makeGame();
  // Кольцо: голова в (5,4) идёт вниз в (5,5), где уже лежит тело.
  game.snake = [
    { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 },
  ];
  game.direction = DIRECTIONS.DOWN;
  game.step();
  assert.equal(game.over, true);
  assert.equal(game.overReason, 'self');
});

test('голова может зайти в клетку, которую на этом шаге освобождает хвост', () => {
  const game = makeGame();
  game.snake = [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 5, y: 5 }];
  game.direction = DIRECTIONS.DOWN;
  game.step();
  assert.equal(game.over, false);
});

test('бонус «призрак» позволяет пройти сквозь себя', () => {
  const game = makeGame();
  game.snake = [
    { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 },
  ];
  game.direction = DIRECTIONS.DOWN;
  game.effects.ghost = 3000;
  game.step();
  assert.equal(game.over, false);
});

test('камень заканчивает игру', () => {
  const game = makeGame();
  game.obstacles = [{ x: 6, y: 4 }];
  game.step();
  assert.equal(game.overReason, 'stone');
});

test('уровень растёт каждые 5 яблок и добавляет камни', () => {
  const game = makeGame();
  for (let i = 0; i < 5; i += 1) {
    game.items = [{ kind: ITEM.APPLE, ...game.nextHead(), ttl: null }];
    game.step();
  }
  assert.equal(game.level, 2);
  assert.equal(game.obstacles.length, 2);
});

test('скорость растёт с длиной, бонус «замедление» её снижает', () => {
  const game = makeGame();
  const base = game.ticksPerSecond;
  game.snake.push({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 });
  assert.ok(game.ticksPerSecond > base);
  const fast = game.ticksPerSecond;
  game.effects.slow = 1000;
  assert.ok(game.ticksPerSecond < fast);
});

test('режим на время заканчивается, когда время вышло', () => {
  const game = makeGame({ mode: MODES.TIMED, timedDurationMs: 1000 });
  const events = game.update(1001);
  assert.equal(game.over, true);
  assert.equal(game.overReason, 'time');
  assert.ok(events.some((e) => e.type === 'gameOver'));
});

test('временные предметы исчезают', () => {
  const game = makeGame();
  game.items = [{ kind: ITEM.SLOW, x: 0, y: 0, ttl: 100 }];
  game.tickTimers(150, []);
  assert.equal(game.items.length, 0);
});

test('после зависания вкладки змейка не делает больше трёх шагов', () => {
  const game = makeGame();
  game.update(10_000);
  assert.deepEqual(game.head, { x: 8, y: 4 });
});

test('предмет не появляется на змейке и камнях', () => {
  const game = new Game({ width: 4, height: 1 }, fixedRng(0));
  game.snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  game.obstacles = [{ x: 2, y: 0 }];
  game.items = [];
  assert.deepEqual(game.freeCell(), { x: 3, y: 0 });
});
