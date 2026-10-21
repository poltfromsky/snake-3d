import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanGameStat } from '../src/core/game-stats.js';
import {
  addGame, applyEpoch, claimForOwner, createStatsSync, emptyStore, forgetOwner, mergeServerGames,
  normalizeStore, pendingFor, toWire, trimStore, visibleGames,
} from '../src/net/stats-sync.js';

const NOW = Date.UTC(2026, 9, 21, 12);
const solo = (id, at, extra = {}) => ({
  id, at, kind: 'solo', mode: 'classic', speed: 'normal', score: 40, length: 7, durationMs: 60_000, end: 'self',
  apples: 4, bonuses: { slow: 0, ghost: 0, bad: 0 }, ...extra,
});

test('запись о партии: лишнее отбрасывается, неверное — отклоняется', () => {
  const clean = cleanGameStat({ ...solo('game-0001', NOW), owner: 'x', sent: true, hack: 1 }, NOW);
  assert.equal(clean.owner, undefined);
  assert.equal(clean.hack, undefined);
  assert.equal(clean.result, null, 'у одиночной партии нет результата дуэли');
  assert.equal(cleanGameStat({ ...solo('game-0002', NOW), score: 99999 }, NOW), null);
  assert.equal(cleanGameStat({ ...solo('x', NOW) }, NOW), null, 'слишком короткий id');
  assert.equal(cleanGameStat({ ...solo('game-0003', NOW + 3 * 86_400_000) }, NOW), null, 'из будущего');
  assert.equal(cleanGameStat({ ...solo('game-0004', NOW), kind: 'tutorial' }, NOW), null);
  assert.equal(cleanGameStat({ ...solo('game-0005', NOW), end: 'взрыв' }, NOW).end, null, 'неизвестная причина — пусто');
});

test('старое хранилище (до синхронизации) получает id и хозяина «без профиля»', () => {
  const store = normalizeStore({ v: 1, games: [{ at: NOW, kind: 'solo', score: 10 }, null] });
  assert.equal(store.games.length, 1);
  assert.equal(typeof store.games[0].id, 'string');
  assert.equal(store.games[0].owner, null);
  assert.equal(store.games[0].sent, false);
  assert.deepEqual(normalizeStore(null), emptyStore());
});

test('первый вход в профиль: партии без хозяина и старая история переходят к нему — один раз', () => {
  const store = emptyStore();
  addGame(store, solo('g-new-0001', NOW - 1000), null);
  const history = {
    classic: [
      { score: 40, length: 7, date: NOW - 1000, speed: 'normal' }, // та же партия, что в записях
      { score: 30, length: 6, date: NOW - 5 * 86_400_000, speed: 'fast' }, // до записей — переходит
    ],
    walls: [{ score: 20, length: 5, date: NOW - 6 * 86_400_000 }],
  };
  claimForOwner(store, 'питон', history);
  assert.ok(store.games.every((g) => g.owner === 'питон'));
  assert.equal(store.games.length, 3, 'дубль из истории не добавлен');
  const legacy = store.games.filter((g) => g.legacy);
  assert.deepEqual(legacy.map((g) => g.id).sort(), [`h:classic:${NOW - 5 * 86_400_000}:30`, `h:walls:${NOW - 6 * 86_400_000}:20`]);
  assert.equal(store.historyClaimedBy, 'питон');
  // Второй профиль на том же устройстве старую историю уже не получит.
  addGame(store, solo('g-new-0002', NOW), null);
  claimForOwner(store, 'удав', history);
  assert.equal(store.games.filter((g) => g.owner === 'удав').length, 1);
  assert.equal(store.games.filter((g) => g.legacy && g.owner === 'удав').length, 0);
});

test('очередь: неотправленные партии профиля — старые первыми, пачками; на сервер без служебных полей', () => {
  const store = emptyStore();
  for (let i = 0; i < 60; i += 1) addGame(store, solo(`g-${String(i).padStart(6, '0')}`, NOW - (60 - i) * 1000), 'питон');
  addGame(store, solo('g-other-01', NOW), 'удав');
  const batch = pendingFor(store, 'питон');
  assert.equal(batch.length, 50);
  assert.equal(batch[0].id, 'g-000000', 'самая старая — первой');
  const wire = toWire(batch[0]);
  assert.equal(wire.owner, undefined);
  assert.equal(wire.sent, undefined);
  assert.equal(batch[0].owner, 'питон', 'сама запись на устройстве не тронута');
});

test('два устройства одного профиля: партии сливаются без дублей', () => {
  const pc = emptyStore();
  const phone = emptyStore();
  addGame(pc, solo('pc-game-001', NOW - 3000), 'питон');
  addGame(phone, solo('ph-game-001', NOW - 2000, { score: 70 }), 'питон');
  // Сервер вернул обе партии обоим устройствам (в том числе свою же).
  const server = [toWire(pc.games[0]), toWire(phone.games[0])];
  mergeServerGames(pc, 'питон', server, NOW);
  mergeServerGames(phone, 'питон', server, NOW);
  mergeServerGames(phone, 'питон', server, NOW); // повтор — ничего не меняет
  for (const device of [pc, phone]) {
    assert.deepEqual(visibleGames(device, 'питон').map((g) => g.id).sort(), ['pc-game-001', 'ph-game-001']);
    assert.ok(device.games.every((g) => g.sent), 'всё отмечено отправленным');
  }
  // Мусор с сервера не проходит.
  mergeServerGames(pc, 'питон', [{ id: 'bad', kind: 'solo' }], NOW);
  assert.equal(pc.games.length, 2);
});

test('удаление на другом устройстве (новое поколение): отправленные партии стираются, неотправленные остаются', () => {
  const store = emptyStore();
  claimForOwner(store, 'питон', {});
  assert.equal(applyEpoch(store, 'питон', 0), false, 'первый ответ сервера только запоминается');
  addGame(store, solo('old-game-01', NOW - 5000), 'питон');
  mergeServerGames(store, 'питон', [toWire(store.games[0])], NOW);
  addGame(store, solo('new-game-01', NOW), 'питон'); // ещё не отправлена
  store.sync['питон'].cursor = 17;
  assert.equal(applyEpoch(store, 'питон', 1), true);
  assert.deepEqual(store.games.map((g) => g.id), ['new-game-01']);
  assert.equal(store.sync['питон'].cursor, 0, 'догружаем заново');
  assert.equal(applyEpoch(store, 'питон', 1), false);
});

test('выход из профиля: отправленные партии профиля с устройства убираются, без профиля — свои остаются', () => {
  const store = emptyStore();
  addGame(store, solo('mine-game-1', NOW - 2000), 'питон');
  addGame(store, solo('mine-game-2', NOW - 1000), 'питон');
  store.games.find((g) => g.id === 'mine-game-1').sent = true;
  addGame(store, solo('guest-game1', NOW), null);
  forgetOwner(store, 'питон');
  assert.deepEqual(store.games.map((g) => g.id).sort(), ['guest-game1', 'mine-game-2']);
  assert.deepEqual(visibleGames(store, null).map((g) => g.id), ['guest-game1']);
});

test('места на устройстве не хватает — первыми уходят старые отправленные, а не ждущие отправки', () => {
  const store = emptyStore();
  for (let i = 0; i < 6; i += 1) store.games.push({ ...solo(`g-trim-${i}0`, NOW - i * 1000), owner: 'питон', sent: i !== 5 });
  trimStore(store, 4);
  assert.equal(store.games.length, 4);
  assert.ok(store.games.some((g) => g.id === 'g-trim-50'), 'самая старая, но неотправленная — осталась');
});

test('синхронизация целиком: два устройства через «сервер» в памяти, обрыв связи и повтор', async () => {
  // Простейший сервер: хранит партии профиля, нумерует их и отдаёт «с номера».
  const rows = [];
  let online = true;
  const post = async (path, body) => {
    if (!online) throw Object.assign(new Error('offline'), { status: 0 });
    assert.equal(path, 'stats/sync');
    for (const g of body.games) if (!rows.some((r) => r.g.id === g.id)) rows.push({ seq: rows.length + 1, g });
    const page = rows.filter((r) => r.seq > body.since);
    return {
      ok: true, epoch: 0, games: page.map((r) => r.g), cursor: page.at(-1)?.seq ?? body.since, more: false, total: rows.length,
    };
  };
  const device = () => {
    let raw = null;
    return createStatsSync({
      load: () => raw, save: (s) => { raw = JSON.parse(JSON.stringify(s)); }, history: () => ({}),
      owner: () => ({ key: 'питон', name: 'Питон', device: 'a'.repeat(64) }), post,
    });
  };
  const pc = device();
  const phone = device();
  pc.record(solo('pc-game-0001', NOW - 2000));
  phone.record(solo('ph-game-0001', NOW - 1000));
  online = false;
  assert.equal((await pc.syncNow()).status, 'offline', 'без связи — честный статус');
  online = true;
  assert.equal((await pc.syncNow()).status, 'synced');
  assert.equal((await phone.syncNow()).status, 'synced');
  await pc.syncNow();
  assert.deepEqual(pc.games().map((g) => g.id).sort(), ['pc-game-0001', 'ph-game-0001']);
  assert.deepEqual(phone.games().map((g) => g.id).sort(), ['pc-game-0001', 'ph-game-0001']);
  assert.equal(rows.length, 2, 'на «сервере» без дублей');
});
