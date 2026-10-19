import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SwipeTracker } from '../src/ui/swipe.js';

/** Ведёт «палец» по точкам и собирает сработавшие повороты. */
function drag(points, tracker = new SwipeTracker()) {
  const [first, ...rest] = points;
  tracker.begin(first[0], first[1]);
  return rest.map(([x, y]) => tracker.move(x, y)).filter(Boolean);
}

/** Точки движения из (0, 0) под углом к оси: шаг по 4 px вдоль оси, перекос в градусах. */
function line(axis, sign, tiltDeg, length = 80) {
  const tilt = Math.tan((tiltDeg * Math.PI) / 180);
  const pts = [[0, 0]];
  for (let s = 4; s <= length; s += 4) {
    const along = s * sign;
    const across = s * tilt;
    pts.push(axis === 'y' ? [across, along] : [along, across]);
  }
  return pts;
}

test('прямой свайп в каждую сторону даёт один поворот', () => {
  assert.deepEqual(drag(line('y', -1, 0)), ['UP']);
  assert.deepEqual(drag(line('y', 1, 0)), ['DOWN']);
  assert.deepEqual(drag(line('x', -1, 0)), ['LEFT']);
  assert.deepEqual(drag(line('x', 1, 0)), ['RIGHT']);
});

test('небольшой увод пальца в сторону (5–25°) не даёт лишнего поворота', () => {
  for (const tilt of [5, 10, 20, 25]) {
    assert.deepEqual(drag(line('y', 1, tilt)), ['DOWN'], `вниз с уводом ${tilt}°`);
    assert.deepEqual(drag(line('x', -1, -tilt)), ['LEFT'], `влево с уводом ${tilt}°`);
  }
});

test('движение под 45° ждёт, пока станет понятно направление', () => {
  assert.deepEqual(drag([[0, 0], [10, 10], [20, 20], [30, 30], [40, 40]]), []);
  // Палец «выровнялся» вниз — поворот сработал.
  assert.deepEqual(drag([[0, 0], [10, 10], [20, 20], [30, 30], [32, 60]]), ['DOWN']);
});

test('короткое движение — ещё не свайп', () => {
  assert.deepEqual(drag([[100, 100], [100, 92], [103, 86]]), []);
});

test('«вверх, потом вправо» одним движением — два поворота', () => {
  const up = line('y', -1, 0, 40);
  const right = [[0, -40], [10, -40], [20, -41], [30, -41], [40, -41]];
  assert.deepEqual(drag([...up, ...right.slice(1)]), ['UP', 'RIGHT']);
});

test('если палец продолжает вести вверх с уводом, новых поворотов нет', () => {
  // 200 px вверх с постоянным уводом ~20° вправо: один поворот, а не «вверх, вправо, вверх…».
  assert.deepEqual(drag(line('y', -1, 20, 200)), ['UP']);
});

test('после поворота слабый боковой дрейф не считается следующим поворотом', () => {
  const pts = [...line('y', -1, 0, 40), [8, -40], [14, -41], [20, -41]];
  assert.deepEqual(drag(pts), ['UP']);
});

test('отпустили палец — новое касание отсчитывается заново', () => {
  const t = new SwipeTracker();
  assert.deepEqual(drag(line('y', -1, 0), t), ['UP']);
  t.end();
  assert.equal(t.move(999, 999), null, 'без касания движение игнорируется');
  assert.deepEqual(drag(line('x', 1, 0), t), ['RIGHT']);
});

test('пороги можно менять', () => {
  const sensitive = new SwipeTracker({ start: 6 });
  assert.deepEqual(drag([[0, 0], [0, -8]], sensitive), ['UP']);
});
