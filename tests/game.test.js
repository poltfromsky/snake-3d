import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aheadCells, CLEAR_AHEAD, DIRECTIONS, EFFECT_WARN_MS, effectBlinkOn, Game, ITEM, MAX_QUEUED_TURNS, MODES, SLOW_EASE_IN_MS,
  SLOW_FACTOR, SLOW_MIN_SCORE,
} from '../src/core/game.js';

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

test('очередь поворотов вмещает три быстрых поворота подряд, четвёртый не принимается', () => {
  assert.equal(MAX_QUEUED_TURNS, 3);
  const game = makeGame();
  assert.equal(game.turn(DIRECTIONS.UP), true);
  assert.equal(game.turn(DIRECTIONS.LEFT), true);
  assert.equal(game.turn(DIRECTIONS.DOWN), true);
  assert.equal(game.turn(DIRECTIONS.RIGHT), false, 'очередь заполнена');
  for (const expected of [DIRECTIONS.UP, DIRECTIONS.LEFT, DIRECTIONS.DOWN]) {
    game.step();
    assert.deepEqual(game.direction, expected);
  }
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
  game.effects.slow = 5000;
  game.tickTimers(300, []);
  assert.ok(game.ticksPerSecond < fast);
});

test('«замедление» кончается плавно: последнюю секунду скорость растёт постепенно, без рывка', () => {
  const game = makeGame();
  const normal = game.ticksPerSecond;
  game.effects.slow = 5000;
  game.tickTimers(500, []); // вошли в замедление
  assert.ok(Math.abs(game.ticksPerSecond - normal * SLOW_FACTOR) < 1e-9, 'посередине — ровно ×0.6');
  let prev = game.ticksPerSecond;
  let biggestJump = 0;
  for (let t = 0; t < 5000; t += 20) {
    game.tickTimers(20, []);
    biggestJump = Math.max(biggestJump, Math.abs(game.ticksPerSecond - prev));
    prev = game.ticksPerSecond;
  }
  assert.ok(Math.abs(game.ticksPerSecond - normal) < 1e-9, 'после конца — обычная скорость');
  // Раньше скачок был весь разом: 40 % скорости. Теперь за кадр — доли процента.
  assert.ok(biggestJump < normal * 0.02, `рывок ${biggestJump.toFixed(3)} шага/с за кадр`);
});

test('«замедление» начинается плавно и не сбрасывается, если съесть второе подряд', () => {
  const game = makeGame();
  const normal = game.ticksPerSecond;
  game.effects.slow = 5000;
  game.tickTimers(100, []);
  const early = game.ticksPerSecond;
  assert.ok(early < normal && early > normal * SLOW_FACTOR, 'за 0,1 с ещё не полностью замедлилась');
  game.tickTimers(SLOW_EASE_IN_MS, []);
  assert.ok(Math.abs(game.ticksPerSecond - normal * SLOW_FACTOR) < 1e-9);
  game.effects.slow = 5000; // съели второе — замедление продолжается без скачков
  game.tickTimers(20, []);
  assert.ok(Math.abs(game.ticksPerSecond - normal * SLOW_FACTOR) < 1e-9);
});

test('перед концом статуса змейка мерцает, и всё чаще', () => {
  // Пока до конца больше EFFECT_WARN_MS — не мерцает.
  for (let ms = EFFECT_WARN_MS + 1; ms < 5000; ms += 37) assert.equal(effectBlinkOn(ms), true);
  // Считаем переключения в первой и в последней трети предупреждения.
  const flips = (from, to) => {
    let count = 0;
    let last = effectBlinkOn(from);
    for (let ms = from; ms >= to; ms -= 2) {
      const on = effectBlinkOn(ms);
      if (on !== last) count += 1;
      last = on;
    }
    return count;
  };
  const third = EFFECT_WARN_MS / 3;
  const early = flips(EFFECT_WARN_MS, EFFECT_WARN_MS - third);
  const late = flips(third, 1);
  assert.ok(early >= 2, `в начале мерцает (${early})`);
  assert.ok(late > early * 2, `к концу чаще: ${early} → ${late}`);
});

test('у змейки в данных для отрисовки — сколько осталось до конца ближайшего статуса', () => {
  const game = makeGame();
  assert.equal(game.snakes[0].endingIn, null);
  game.effects.ghost = 3000;
  game.effects.slow = 1200;
  assert.equal(game.snakes[0].endingIn, 1200);
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

/** Игра с настоящим генератором случайных чисел — для проверки «на тысячах генераций». */
const randomGame = (options, seed) => {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const game = new Game({ width: 24, height: 16, ...options }, rng);
  game.items = [];
  return game;
};

test('путь змейки: клетки прямо по курсу, с переходом через край только там, где стен нет', () => {
  const field = { width: 10, height: 6 };
  const walls = aheadCells({ x: 7, y: 2 }, [DIRECTIONS.RIGHT], { ...field, wrap: false }, 8);
  assert.deepEqual([...walls].sort(), ['8,2', '9,2'], 'у стены путь кончается стеной');
  const wrap = aheadCells({ x: 7, y: 2 }, [DIRECTIONS.RIGHT], { ...field, wrap: true }, 8);
  assert.equal(wrap.size, 8);
  assert.ok(wrap.has('0,2') && wrap.has('5,2'), 'сквозь стену путь продолжается с другого края');
  assert.equal(CLEAR_AHEAD, 8);
});

for (const mode of [MODES.CLASSIC, MODES.WALLS, MODES.TIMED]) {
  test(`камни и гниль никогда не появляются в ${CLEAR_AHEAD} клетках прямо по курсу (режим ${mode}), 2000 генераций`, () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const game = randomGame({ mode }, seed);
      // Случайная позиция и курс; змейка не в углу, чтобы был простор.
      const dirs = Object.values(DIRECTIONS);
      game.direction = dirs[seed % 4];
      const x = 4 + (seed * 7) % 16;
      const y = 3 + (seed * 5) % 10;
      game.snake = [{ x, y }, { x: x - game.direction.x, y: y - game.direction.y }, { x: x - 2 * game.direction.x, y: y - 2 * game.direction.y }]
        .map((c) => ({ x: (c.x + 24) % 24, y: (c.y + 16) % 16 }));
      game.turnQueue = seed % 3 === 0 ? [dirs[(seed + 1) % 4]].filter((d) => d.x !== -game.direction.x || d.y !== -game.direction.y) : [];
      game.obstacles = [];
      const way = aheadCells(game.head, [game.direction, game.turnQueue.at(-1)].filter(Boolean),
        { width: 24, height: 16, wrap: mode !== MODES.WALLS });
      game.spawnItem(ITEM.BAD, 5000);
      for (let i = 0; i < 2; i += 1) {
        const cell = game.freeCell({ awayFromHead: 4, clearAhead: CLEAR_AHEAD });
        if (cell) game.obstacles.push(cell);
      }
      const dangerous = [...game.obstacles, ...game.items.filter((it) => it.kind === ITEM.BAD)];
      for (const c of dangerous) assert.ok(!way.has(`${c.x},${c.y}`), `seed ${seed}: ${c.x},${c.y} на пути`);
      for (const c of game.obstacles) {
        assert.ok(Math.abs(c.x - game.head.x) + Math.abs(c.y - game.head.y) >= 4, 'и по-прежнему не ближе 4 клеток');
      }
    }
  });
}

test('яблоко и бонусы на путь змейки попасть могут (хорошее перед носом — не беда)', () => {
  let ahead = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    const game = randomGame({ mode: MODES.CLASSIC }, seed);
    const apple = game.spawnItem(ITEM.APPLE);
    const way = aheadCells(game.head, [game.direction], { width: 24, height: 16, wrap: true });
    if (way.has(`${apple.x},${apple.y}`)) ahead += 1;
  }
  assert.ok(ahead > 0, 'яблоко иногда прямо по курсу');
});

test('«Замедление» не выпадает до 120 очков, после — выпадает', () => {
  const kinds = (score) => {
    const seen = new Set();
    for (let seed = 1; seed <= 3000; seed += 1) {
      const game = randomGame({}, seed);
      game.score = score;
      game.maybeSpawnExtras();
      for (const it of game.items) if (it.kind === ITEM.SLOW || it.kind === ITEM.GHOST) seen.add(it.kind);
    }
    return seen;
  };
  assert.deepEqual([...kinds(SLOW_MIN_SCORE - 10)], [ITEM.GHOST], 'до порога — только «Призрак»');
  assert.ok(kinds(SLOW_MIN_SCORE).has(ITEM.SLOW), 'с порога — и «Замедление»');
  assert.equal(SLOW_MIN_SCORE, 120);
});

test('дуэль: камни и гниль не появляются на пути ни одной из двух змеек', async () => {
  const { Duel } = await import('../src/core/duel.js');
  for (const mode of [MODES.CLASSIC, MODES.WALLS]) {
    for (let seed = 1; seed <= 800; seed += 1) {
      const duel = new Duel({ mode, width: 26, height: 16 }, randomGame({}, seed).rng);
      duel.items = [];
      duel.obstacles = [];
      const ways = duel.players.flatMap((p) => [...aheadCells(p.body[0], [p.direction], { width: 26, height: 16, wrap: mode !== MODES.WALLS })]);
      duel.spawnItem(ITEM.BAD, 5000);
      for (let i = 0; i < 2; i += 1) {
        const cell = duel.freeCell(4, CLEAR_AHEAD);
        if (cell) duel.obstacles.push(cell);
      }
      for (const c of [...duel.obstacles, ...duel.items.filter((it) => it.kind === ITEM.BAD)]) {
        assert.ok(!ways.includes(`${c.x},${c.y}`), `${mode} seed ${seed}`);
      }
    }
  }
});
