import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DPAD_SCALE_MAX, DPAD_SCALE_MIN, dpadDirection, dpadPlacement,
} from '../src/ui/dpad.js';

// Крест 204×204 с центром в (200, 400).
const rect = { left: 98, top: 298, width: 204, height: 204 };

test('нажатие на кнопки и рядом с ними даёт нужное направление', () => {
  assert.equal(dpadDirection(200, 330, rect), 'UP');
  assert.equal(dpadDirection(200, 470, rect), 'DOWN');
  assert.equal(dpadDirection(130, 400, rect), 'LEFT');
  assert.equal(dpadDirection(270, 400, rect), 'RIGHT');
});

test('щели между кнопками и поле вокруг креста тоже работают', () => {
  assert.equal(dpadDirection(200, 270, rect), 'UP', 'выше креста');
  assert.equal(dpadDirection(200, 530, rect), 'DOWN', 'ниже креста');
  assert.equal(dpadDirection(260, 372, rect), 'RIGHT', 'угол креста — по большей оси');
  assert.equal(dpadDirection(160, 440, rect), 'DOWN', 'другой угол');
});

test('центр креста ничего не значит', () => {
  assert.equal(dpadDirection(200, 400, rect), null);
  assert.equal(dpadDirection(206, 395, rect), null);
});

test('своё расположение креста: в долях экрана, целиком на экране, размер в пределах', () => {
  // Телефон 400×800: крест справа внизу.
  assert.deepEqual(dpadPlacement({ x: 0.7, y: 0.8, scale: 1 }, 400, 800), { cx: 280, cy: 640, scale: 1 });
  // Утащили за край — крест прижимается к краю, но не вылезает (половина креста 102 px + 8 px отступ).
  assert.deepEqual(dpadPlacement({ x: 1.2, y: 1.5, scale: 1 }, 400, 800), { cx: 290, cy: 690, scale: 1 });
  assert.deepEqual(dpadPlacement({ x: -1, y: -1, scale: 1 }, 400, 800, { top: 200 }), { cx: 110, cy: 310, scale: 1 }, 'не под панелью сверху');
  // Размер — только в пределах.
  assert.equal(dpadPlacement({ x: 0.5, y: 0.5, scale: 9 }, 400, 800).scale, DPAD_SCALE_MAX);
  assert.equal(dpadPlacement({ x: 0.5, y: 0.5, scale: 0 }, 400, 800).scale, DPAD_SCALE_MIN);
  // Повернули телефон: те же доли экрана.
  assert.deepEqual(dpadPlacement({ x: 0.75, y: 0.8, scale: 1 }, 800, 400), { cx: 600, cy: 290, scale: 1 });
});

test('битая или пустая раскладка — место по умолчанию (внизу по центру)', () => {
  assert.equal(dpadPlacement(null, 400, 800), null);
  assert.equal(dpadPlacement({ x: 'a', y: 0.5, scale: 1 }, 400, 800), null);
  assert.equal(dpadPlacement({ x: 0.5, y: Number.NaN, scale: 1 }, 400, 800), null);
});
