import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRun, FASTEST_SPEED_FACTOR, minRunMs, RUN_TTL_MS,
} from '../src/core/fair-play.js';
import {
  DIRECTIONS, Game, ITEM, MODES,
} from '../src/core/game.js';

/** Повторяемый генератор случайных чисел (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * «Идеальный» игрок: на каждом шаге идёт кратчайшим безопасным путём (BFS) к ближайшему
 * яблоку или бонусу, гнилую еду обходит. Играет на самой быстрой скорости и без пауз —
 * быстрее очки не набрать. Возвращает пары (очки, время партии) после каждого съеденного предмета.
 */
function perfectRun(seed, mode = MODES.CLASSIC, maxSteps = 4000) {
  const game = new Game({ width: 24, height: 16, mode, speedFactor: FASTEST_SPEED_FACTOR }, seeded(seed));
  const { width: W, height: H } = game.opts;
  const wrap = mode !== MODES.WALLS;
  const samples = [];
  for (let s = 0; s < maxSteps && !game.over; s += 1) {
    const blocked = new Set([...game.snake.slice(0, -1), ...game.obstacles].map((c) => `${c.x},${c.y}`));
    const targets = new Set(game.items.filter((i) => i.kind !== ITEM.BAD).map((i) => `${i.x},${i.y}`));
    const bad = new Set(game.items.filter((i) => i.kind === ITEM.BAD).map((i) => `${i.x},${i.y}`));
    // Поиск в ширину от головы; запоминаем, каким был первый ход на пути.
    const start = game.head;
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = Object.entries(DIRECTIONS).map(([name, d]) => ({ x: start.x + d.x, y: start.y + d.y, first: name }));
    let choice = null;
    let fallback = null;
    while (queue.length) {
      const node = queue.shift();
      let { x, y } = node;
      if (wrap) {
        x = (x + W) % W;
        y = (y + H) % H;
      } else if (x < 0 || y < 0 || x >= W || y >= H) {
        continue;
      }
      const key = `${x},${y}`;
      if (seen.has(key) || blocked.has(key) || bad.has(key)) continue;
      seen.add(key);
      fallback ??= node.first;
      if (targets.has(key)) {
        choice = node.first;
        break;
      }
      for (const d of Object.values(DIRECTIONS)) queue.push({ x: x + d.x, y: y + d.y, first: node.first });
    }
    const dir = DIRECTIONS[choice ?? fallback ?? 'UP'];
    game.turnQueue = [];
    game.turn(dir);
    const before = game.score;
    game.update(game.stepIntervalMs + 0.001);
    if (game.score > before) samples.push({ score: game.score, elapsedMs: game.elapsedMs });
  }
  return samples;
}

test('«идеальный» робот на самой быстрой скорости проходит проверку с запасом', () => {
  let tightest = Infinity;
  let maxScore = 0;
  for (let seed = 1; seed <= 25; seed += 1) {
    for (const mode of [MODES.CLASSIC, MODES.WALLS]) {
      for (const { score, elapsedMs } of perfectRun(seed, mode)) {
        assert.deepEqual(checkRun({ score, elapsedMs }), { ok: true }, `seed ${seed}, ${mode}: ${score} очков за ${elapsedMs.toFixed(0)} мс`);
        tightest = Math.min(tightest, elapsedMs / minRunMs(score));
        maxScore = Math.max(maxScore, score);
      }
    }
  }
  assert.ok(maxScore >= 300, `робот должен набирать заметные очки, набрал ${maxScore}`);
  // Честная игра идёт как минимум вдвое дольше нижней границы.
  assert.ok(tightest > 1.5, `запас всего ×${tightest.toFixed(2)}`);
  console.log(`  запас честной игры: ×${tightest.toFixed(2)} (макс. ${maxScore} очков)`);
});

test('накрутка «из консоли» не проходит: много очков за короткое время', () => {
  assert.deepEqual(checkRun({ score: 5000, elapsedMs: 10_000 }), { ok: false, reason: 'too_fast' });
  assert.deepEqual(checkRun({ score: 1000, elapsedMs: 3_000 }), { ok: false, reason: 'too_fast' });
  assert.deepEqual(checkRun({ score: 200, elapsedMs: 500 }), { ok: false, reason: 'too_fast' });
  // Даже самый быстрый мыслимый темп требует больше 40 секунд на 5000 очков.
  assert.ok(minRunMs(5000) > 40_000, `${minRunMs(5000)} мс`);
});

test('несколько очков за пару секунд — нормально; просроченный билет — нет', () => {
  assert.deepEqual(checkRun({ score: 10, elapsedMs: 800 }), { ok: true });
  assert.deepEqual(checkRun({ score: 0, elapsedMs: 0 }), { ok: true });
  assert.deepEqual(checkRun({ score: 10, elapsedMs: RUN_TTL_MS + 1 }), { ok: false, reason: 'expired' });
  assert.deepEqual(checkRun({ score: 10, elapsedMs: Number.NaN }), { ok: false, reason: 'expired' });
});

test('на медленной скорости проверка строже: то же время, что на быстрой, — уже подозрительно', () => {
  const score = 400;
  const fastMin = minRunMs(score, 1.35);
  const slowMin = minRunMs(score, 0.75);
  assert.ok(slowMin > fastMin * 1.7, 'медленная скорость — заметно больше минимального времени');
  // Время, правдоподобное для быстрой скорости, на медленной не проходит.
  const t = fastMin;
  assert.equal(checkRun({ score, elapsedMs: t, speed: 'fast' }).ok, true);
  assert.equal(checkRun({ score, elapsedMs: t, speed: 'slow' }).ok, false);
  // Без скорости — проверка по самой быстрой, как раньше.
  assert.equal(checkRun({ score, elapsedMs: t }).ok, true);
});
