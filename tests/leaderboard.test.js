import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFeedback, buildRecord, cleanText } from '../src/core/validate.js';
import { Leaderboard } from '../src/net/leaderboard.js';

test('cleanText убирает управляющие символы и обрезает по длине', () => {
  assert.equal(cleanText('  a\u0000b\n\nc  ', 10), 'a b c');
  assert.equal(cleanText('x'.repeat(50), 16).length, 16);
});

test('buildRecord отсекает некорректные рекорды', () => {
  const ok = { name: 'Егор', mode: 'classic', score: 120, length: 14 };
  assert.deepEqual(buildRecord(ok), { ...ok, comment: null });
  assert.equal(buildRecord({ ...ok, name: '   ' }), null);
  assert.equal(buildRecord({ ...ok, mode: 'hack' }), null);
  assert.equal(buildRecord({ ...ok, score: 0 }), null);
  assert.equal(buildRecord({ ...ok, score: 999999 }), null);
  assert.equal(buildRecord({ ...ok, score: 1.5 }), null);
  assert.equal(buildRecord(), null);
});

test('buildFeedback требует текст и проверяет оценку', () => {
  assert.equal(buildFeedback({ message: 'ok' }), null);
  const fb = buildFeedback({ name: '', rating: 9, message: 'Классная игра!', version: '1.3.0' });
  assert.deepEqual(fb, { name: null, rating: null, message: 'Классная игра!', app_version: '1.3.0' });
});

test('Leaderboard выключен без адреса сервера', () => {
  assert.equal(new Leaderboard('').enabled, false);
});

test('top() обращается к /api/records нужного режима', async () => {
  let calledUrl;
  const fakeFetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => [{ name: 'A', score: 10 }] };
  };
  const lb = new Leaderboard('https://api.example/', fakeFetch);
  const rows = await lb.top('walls');
  assert.equal(rows[0].name, 'A');
  assert.equal(calledUrl, 'https://api.example/api/records?mode=walls');
});

test('текст ошибки сервера доходит до игрока', async () => {
  const lb = new Leaderboard('https://api.example', async () => ({
    ok: false, status: 429, json: async () => ({ error: 'Слишком часто.' }),
  }));
  await assert.rejects(
    () => lb.submitRecord({ name: 'A', mode: 'classic', score: 10, length: 4 }),
    /Слишком часто/,
  );
});
