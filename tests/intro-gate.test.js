// Тёмная подложка в index.html решает «нужно ли вступление» отдельно от src/boot.js — ключи хранилища должны совпадать.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/storage.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../src/storage.js', import.meta.url), 'utf8');

test('ключ настроек в index.html тот же, что в storage.js', () => {
  const key = /const SETTINGS_KEY = '([^']+)'/.exec(storage)[1];
  assert.ok(html.includes(`ls('${key}')`), 'подложка читает настройки по другому ключу');
});

test('заставка по умолчанию включена, выключатель называется intro', () => {
  assert.equal(DEFAULT_SETTINGS.intro, 'on');
  assert.ok(html.includes(".intro === 'off'"));
  assert.ok(html.includes('id="set-intro"'));
});
