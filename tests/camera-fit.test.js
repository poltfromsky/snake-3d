import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  approachPoint, cameraLayout, quarterTurn, screenToField,
} from '../src/render/camera-fit.js';

// Популярные экраны в CSS-пикселях: телефоны, планшет, ноутбуки, телефон боком.
const SCREENS = {
  'iPhone SE': [375, 667],
  'iPhone 14': [390, 844],
  'Pixel 7': [412, 915],
  'Galaxy S8': [360, 740],
  'iPad': [768, 1024],
  'ноутбук': [1366, 768],
  'Full HD': [1920, 1080],
  'телефон боком': [844, 390],
};
const FIELDS = {
  'соло, широкое': { width: 24, height: 16 },
  'соло, вертикальное': { width: 14, height: 20 },
  'дуэль': { width: 26, height: 16 },
};

const tan = (deg) => Math.tan((deg / 2) * (Math.PI / 180));

for (const [screenName, [w, h]] of Object.entries(SCREENS)) {
  for (const [fieldName, field] of Object.entries(FIELDS)) {
    for (const mode of ['angled', 'top']) {
      test(`${screenName} · ${fieldName} · ${mode}: поле не в тумане и влезает в кадр`, () => {
        const aspect = w / h;
        const L = cameraLayout({ aspect, field, mode });
        // Камера над центром поля (для наклонной — сзади и сверху).
        const cam = mode === 'top'
          ? { x: 0, y: L.distance, z: 0 }
          : { x: L.back.x * L.distance * L.angledBack, y: L.distance * L.angledHeight, z: L.back.z * L.distance * L.angledBack };
        const dist = (x, z) => Math.hypot(cam.x - x, cam.y, cam.z - z);
        const hw = field.width / 2;
        const hh = field.height / 2;
        // Центр поля и ближняя половина — вне тумана целиком.
        assert.ok(dist(0, 0) < L.fogNear, `центр в тумане: ${dist(0, 0).toFixed(1)} ≥ ${L.fogNear.toFixed(1)}`);
        // Дальний угол может лишь чуть-чуть затуманиться (не больше трети глубины тумана).
        const far = Math.max(...[[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].map(([x, z]) => dist(x, z)));
        const fogged = (far - L.fogNear) / (L.fogFar - L.fogNear);
        assert.ok(fogged < 0.34, `дальний угол затуманен на ${(fogged * 100).toFixed(0)}%`);

        // Поле с отступом в клетку помещается в кадр по обеим осям (для камеры сверху — строго).
        const across = L.turn ? field.height : field.width;
        const along = L.turn ? field.width : field.height;
        const visibleV = 2 * L.distance * tan(L.fov);
        const visibleH = visibleV * aspect;
        assert.ok(along + 2 <= visibleV + 1e-9 && across + 2 <= visibleH + 1e-9, 'поле не влезает');
      });
    }
  }
}

test('на вертикальном телефоне дуэль занимает экран крупно: повёрнутое поле в 1,5+ раза ближе', () => {
  const aspect = 390 / 844;
  const field = FIELDS['дуэль'];
  const turned = cameraLayout({ aspect, field });
  assert.equal(turned.turn, 1);
  // Без поворота камере пришлось бы отъехать, чтобы влезли 26 клеток по узкой стороне экрана.
  const flatDistance = (field.width + 2) / 2 / tan(turned.fov) / aspect;
  assert.ok(flatDistance / turned.distance > 1.5, `выигрыш всего ×${(flatDistance / turned.distance).toFixed(2)}`);
});

test('поворот нужен только когда поле вытянуто поперёк экрана', () => {
  assert.equal(quarterTurn(390 / 844, { width: 26, height: 16 }), 1, 'дуэль на вертикальном телефоне');
  assert.equal(quarterTurn(390 / 844, { width: 14, height: 20 }), 0, 'вертикальное поле на вертикальном экране');
  assert.equal(quarterTurn(1920 / 1080, { width: 26, height: 16 }), 0, 'дуэль на компьютере');
  assert.equal(quarterTurn(844 / 390, { width: 14, height: 20 }), 1, 'вертикальное поле, телефон повернули боком');
  assert.equal(quarterTurn(390 / 844, { width: 20, height: 20 }), 0, 'квадратное поле не поворачиваем');
});

test('своя змейка внизу экрана: у второго игрока поле повёрнуто в другую сторону', () => {
  const field = { width: 26, height: 16 };
  // Игрок 1 стартует слева (x меньше) — камера отступает влево, то есть он внизу экрана.
  assert.equal(cameraLayout({ aspect: 0.46, field, focusIndex: 0 }).back.x, -1);
  // Игрок 2 стартует справа — камера отступает вправо.
  assert.equal(cameraLayout({ aspect: 0.46, field, focusIndex: 1 }).back.x, 1);
});

test('экранные направления переводятся в направления поля без потерь', () => {
  const dirs = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
  const opposite = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
  for (const turn of [0, 1, -1]) {
    const mapped = dirs.map((d) => screenToField(d, turn));
    assert.deepEqual(new Set(mapped).size, 4, `turn ${turn}: каждое направление ровно один раз`);
    // Противоположные свайпы остаются противоположными, а соседние — соседними (поворот, не зеркало).
    for (const d of dirs) assert.equal(screenToField(opposite[d], turn), opposite[screenToField(d, turn)]);
    const clockwise = (d) => dirs[(dirs.indexOf(d) + 1) % 4];
    for (const d of dirs) assert.equal(screenToField(clockwise(d), turn), clockwise(screenToField(d, turn)));
  }
  // Свайп вверх ведёт свою змейку «вперёд», к сопернику.
  assert.equal(screenToField('UP', 1), 'RIGHT');
  assert.equal(screenToField('UP', -1), 'LEFT');
});

test('камера плавно доезжает до цели и не обгоняет её', () => {
  let p = { x: 0, y: 0, z: 0 };
  const target = { x: 1, y: 0, z: -2 };
  for (let i = 0; i < 600; i += 1) {
    p = approachPoint(p, target, 1 / 60, { rate: 2.5, maxSpeed: 1.1 });
    assert.ok(Math.abs(p.x) <= 1 + 1e-9 && p.z >= -2 - 1e-9, 'не проскакивает цель');
  }
  assert.ok(Math.hypot(p.x - target.x, p.z - target.z) < 0.01, 'за 10 секунд доехала');
});

test('прыжок головы через стену не дёргает камеру: скорость камеры ограничена', () => {
  // Голова перескочила на другой край поля (24 клетки): цель камеры сдвинулась сразу далеко.
  let p = { x: 0, y: 0, z: 0 };
  const jump = { x: 24 * 0.06, y: 0, z: 0 };
  const maxSpeed = 1.1;
  for (let i = 0; i < 120; i += 1) {
    const next = approachPoint(p, jump, 1 / 60, { rate: 2.5, maxSpeed });
    const speed = Math.hypot(next.x - p.x, next.y - p.y, next.z - p.z) * 60;
    assert.ok(speed <= maxSpeed + 1e-9, `скорость ${speed.toFixed(3)} выше предела`);
    p = next;
  }
});

test('обычное следование за головой не упирается в ограничение скорости', () => {
  // Голова идёт по 12 клеток в секунду, камера повторяет 6% её смещения: 0,72 ед./с < предела.
  const p = { x: 0, y: 0, z: 0 };
  const next = approachPoint(p, { x: 12 * 0.06 / 60, y: 0, z: 0 }, 1 / 60, { rate: 2.5, maxSpeed: 1.1 });
  const free = (12 * 0.06 / 60) * (1 - Math.exp(-2.5 / 60));
  assert.ok(Math.abs(next.x - free) < 1e-12);
});
