import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFeedback, buildRecord, cleanText, slowerSpeed,
} from '../src/core/validate.js';
import { SPEED_FACTORS } from '../src/storage.js';
import { RUN_SPEED_FACTORS } from '../src/core/fair-play.js';
import { Leaderboard } from '../src/net/leaderboard.js';

test('cleanText убирает управляющие символы и обрезает по длине', () => {
  assert.equal(cleanText('  a\u0000b\n\nc  ', 10), 'a b c');
  assert.equal(cleanText('x'.repeat(50), 16).length, 16);
});

test('buildRecord отсекает некорректные рекорды', () => {
  const ok = { name: 'Питон', mode: 'classic', score: 120, length: 14 };
  assert.deepEqual(buildRecord(ok), {
    ...ok, speed: 'normal', platform: null, comment: null,
  }, 'без скорости — «normal» (очередь прошлых версий), без платформы — без значка');
  assert.equal(buildRecord({ ...ok, speed: 'turbo' }), null, 'неизвестная скорость');
  assert.equal(buildRecord({ ...ok, platform: 'toaster' }).platform, null, 'неизвестная платформа не мешает рекорду');
  assert.deepEqual(
    (({ speed, platform }) => ({ speed, platform }))(buildRecord({ ...ok, speed: 'slow', platform: 'buttons' })),
    { speed: 'slow', platform: 'buttons' },
  );
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

test('top() обращается к /api/records нужного режима и скорости', async () => {
  let calledUrl;
  const fakeFetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => [{ name: 'A', score: 10 }] };
  };
  const lb = new Leaderboard('https://api.example/', fakeFetch);
  const rows = await lb.top('walls');
  assert.equal(rows[0].name, 'A');
  assert.equal(calledUrl, 'https://api.example/api/records?mode=walls&speed=normal', 'без скорости — нормальная');
  await lb.top('walls', 'fast');
  assert.equal(calledUrl, 'https://api.example/api/records?mode=walls&speed=fast');
  assert.deepEqual(await lb.top('walls', 'turbo'), [], 'неизвестная скорость — без запроса');
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

test('submitRecord сообщает, записан ли результат: у ника хранится только лучший', async () => {
  const replies = [{ ok: true, improved: true, best: 70 }, { ok: true, improved: false, best: 70 }];
  const fakeFetch = async () => ({ ok: true, json: async () => replies.shift() });
  const lb = new Leaderboard('https://api.example', fakeFetch);
  const entry = { name: 'Питон', mode: 'walls', score: 70, length: 9 };
  assert.deepEqual(await lb.submitRecord(entry), { improved: true, best: 70 });
  assert.deepEqual(await lb.submitRecord({ ...entry, score: 40 }), { improved: false, best: 70 });
});

test('скорость меняли посреди партии — рекорд идёт во вкладку самой медленной', () => {
  assert.equal(slowerSpeed('fast', 'slow'), 'slow');
  assert.equal(slowerSpeed('normal', 'fast'), 'normal');
  assert.equal(slowerSpeed('normal', 'normal'), 'normal');
});

test('множители скорости одинаковые в настройках игры и в проверке рекордов', () => {
  assert.deepEqual({ ...SPEED_FACTORS }, { ...RUN_SPEED_FACTORS });
});
