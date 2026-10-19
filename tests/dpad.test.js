import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dpadDirection } from '../src/ui/dpad.js';

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
