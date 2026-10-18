import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, setPlayerName } from '../src/storage.js';

// В Node нет localStorage: сохранение молча пропускается, проверяем саму логику.
test('ник по умолчанию пустой, setPlayerName чистит и запоминает его в настройках', () => {
  assert.equal(DEFAULT_SETTINGS.playerName, '');
  const settings = { ...DEFAULT_SETTINGS };
  assert.equal(setPlayerName(settings, '  Питон  '), 'Питон');
  assert.equal(settings.playerName, 'Питон');
  assert.equal(setPlayerName(settings, 'Ник\nс переносом и длинный'), 'Ник с переносом ');
  assert.equal(setPlayerName(settings, ''), '');
  assert.equal(settings.playerName, '');
});
