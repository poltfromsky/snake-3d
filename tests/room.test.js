import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COUNTDOWN_MS, RoomSession } from '../src/core/room.js';

const types = (messages) => messages.map((m) => m.msg.t);

function fullRoom(options = {}) {
  const room = new RoomSession(options, () => 0.99);
  room.join('a');
  room.join('b');
  return room;
}

function playUntilGo(room) {
  room.tick(COUNTDOWN_MS + 1);
  assert.equal(room.phase, 'playing');
}

test('первый подключившийся — место 0, второй — место 1, третьего не пускают', () => {
  const room = new RoomSession();
  assert.equal(room.join('a').slot, 0);
  assert.equal(room.join('b').slot, 1);
  const third = room.join('c');
  assert.equal(third.slot, -1);
  assert.equal(third.messages[0].to, 'self');
  assert.equal(third.messages[0].msg.t, 'error');
});

test('когда пришёл второй, начинается партия с отсчётом', () => {
  const room = new RoomSession();
  room.join('a');
  const { messages } = room.join('b');
  assert.ok(types(messages).includes('round'));
  assert.equal(room.phase, 'countdown');
});

test('отсчёт 3-2-1, затем go и снимок', () => {
  const room = fullRoom();
  assert.deepEqual(room.tick(10).map((m) => m.msg.n), [3]);
  assert.deepEqual(room.tick(1000).map((m) => m.msg.n), [2]);
  const last = room.tick(2000);
  assert.ok(types(last).includes('go'));
  assert.ok(types(last).includes('state'));
});

test('повороты до старта игнорируются, после — доходят до змейки своего игрока', () => {
  const room = fullRoom();
  room.handle('b', { t: 'turn', dir: 'UP' });
  playUntilGo(room);
  assert.equal(room.duel.players[1].turnQueue.length, 0);
  room.handle('b', { t: 'turn', dir: 'UP' });
  assert.equal(room.duel.players[1].turnQueue.length, 1);
  assert.equal(room.duel.players[0].turnQueue.length, 0);
});

test('мусорные сообщения не ломают комнату', () => {
  const room = fullRoom();
  playUntilGo(room);
  for (const msg of [null, 'x', { t: 'turn', dir: 'NOPE' }, { t: 'hack' }]) {
    assert.deepEqual(room.handle('a', msg), []);
  }
  assert.deepEqual(room.handle('stranger', { t: 'turn', dir: 'UP' }), []);
});

test('снимок рассылается на шаге змейки, а не каждый тик', () => {
  const room = fullRoom();
  playUntilGo(room);
  const interval = room.duel.stepIntervalMs;
  assert.equal(room.tick(interval / 4).length, 0);
  const sent = room.tick(interval);
  assert.deepEqual(types(sent), ['state']);
});

test('конец партии: событие с очками и причинами, затем реванш по согласию обоих', () => {
  const room = fullRoom();
  playUntilGo(room);
  // Ставим змеек лоб в лоб.
  room.duel.players[0].body = [{ x: 4, y: 3 }];
  room.duel.players[1].body = [{ x: 6, y: 3 }];
  room.duel.players[1].direction = { x: -1, y: 0 };
  const sent = room.tick(room.duel.stepIntervalMs + 1);
  const over = sent[0].msg.events.find((e) => e.type === 'gameOver');
  assert.ok(over);
  assert.equal(over.scores.length, 2);
  assert.equal(room.phase, 'over');

  assert.deepEqual(types(room.handle('a', { t: 'rematch' })), ['rematch']);
  assert.ok(types(room.handle('b', { t: 'rematch' })).includes('round'));
  assert.equal(room.phase, 'countdown');
});

test('уход соперника возвращает комнату в ожидание и предупреждает оставшегося', () => {
  const room = fullRoom();
  playUntilGo(room);
  const sent = room.leave('b');
  assert.equal(room.phase, 'waiting');
  assert.deepEqual(sent, [{ to: 0, msg: { t: 'opponent', connected: false } }]);
  assert.equal(room.join('c').slot, 1, 'на освободившееся место можно зайти');
});

test('режим и скорость задаёт создатель, неизвестные значения заменяются безопасными', () => {
  const room = new RoomSession({ mode: 'walls', speed: 'fast' });
  assert.equal(room.mode, 'walls');
  const bad = new RoomSession({ mode: 'evil', speed: 'warp' });
  assert.equal(bad.mode, 'classic');
  assert.equal(bad.speedFactor, 1);
});
