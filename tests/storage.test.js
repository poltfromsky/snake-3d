import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addAttempt, clearPending, DEFAULT_SETTINGS, loadHistory, loadPending, personalBest, savePending, setPlayerName,
} from '../src/storage.js';

// В Node нет localStorage — подставляем простое хранилище в памяти.
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
beforeEach(() => memory.clear());

test('ник по умолчанию пустой, setPlayerName чистит и запоминает его в настройках', () => {
  assert.equal(DEFAULT_SETTINGS.playerName, '');
  assert.equal(DEFAULT_SETTINGS.autoSubmit, 'off', 'в общую таблицу без спроса не отправляем');
  const settings = { ...DEFAULT_SETTINGS };
  assert.equal(setPlayerName(settings, '  Питон  '), 'Питон');
  assert.equal(settings.playerName, 'Питон');
  assert.equal(setPlayerName(settings, 'Ник\nс переносом и длинный'), 'Ник с переносом ');
  assert.equal(setPlayerName(settings, ''), '');
});

test('каждая попытка — в историю, новые сверху; личный рекорд определяется по истории', () => {
  assert.equal(addAttempt('classic', { score: 30, length: 6, date: 1 }), true, 'первый результат — рекорд');
  assert.equal(addAttempt('classic', { score: 20, length: 5, date: 2 }), false);
  assert.equal(addAttempt('classic', { score: 30, length: 7, date: 3 }), false, 'повторить рекорд — не побить');
  assert.equal(addAttempt('classic', { score: 50, length: 9, date: 4 }), true);
  assert.equal(addAttempt('classic', { score: 0, length: 3, date: 5 }), false);
  assert.deepEqual(loadHistory().classic.map((a) => a.score), [0, 50, 30, 20, 30]);
  assert.equal(personalBest('classic'), 50);
  assert.equal(personalBest('walls'), 0, 'режимы раздельно');
});

test('история ограничена 100 попытками, но лучшая не вытесняется', () => {
  addAttempt('timed', { score: 999, length: 40, date: 0 });
  for (let i = 1; i <= 150; i += 1) addAttempt('timed', { score: 10, length: 4, date: i });
  const list = loadHistory().timed;
  assert.equal(list.length, 100);
  assert.equal(personalBest('timed'), 999);
  assert.equal(list[0].date, 150, 'новые сверху');
});

test('прежние рекорды на устройстве (до версии 1.6) переносятся в историю', () => {
  memory.set('snake3d.records.v1', JSON.stringify({
    walls: [{ name: 'Питон', score: 80, length: 12, date: 10 }, { name: 'Питон', score: 40, length: 8, date: 20 }],
  }));
  assert.deepEqual(loadHistory().walls, [{ score: 40, length: 8, date: 20 }, { score: 80, length: 12, date: 10 }]);
  assert.equal(personalBest('walls'), 80);
  assert.equal(addAttempt('walls', { score: 60, length: 9 }), false, 'старый рекорд всё ещё учитывается');
});

test('неотправленные рекорды: по одному лучшему на режим, отправленный убирается', () => {
  savePending({ name: 'Питон', mode: 'classic', score: 40, length: 6 });
  savePending({ name: 'Питон', mode: 'classic', score: 30, length: 5 });
  savePending({ name: 'Питон', mode: 'walls', score: 10, length: 4 });
  assert.equal(loadPending().classic.score, 40, 'худший не заменяет лучший');
  savePending({ name: 'Питон', mode: 'classic', score: 70, length: 9 });
  // Отправили 40, а за это время появился 70 — его не трогаем.
  clearPending('classic', 40);
  assert.equal(loadPending().classic.score, 70);
  clearPending('classic', 70);
  assert.deepEqual(Object.keys(loadPending()), ['walls']);
});
