import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DIRECTIONS, ITEM, MODES } from '../src/core/game.js';
import { Duel } from '../src/core/duel.js';

function makeDuel(options = {}) {
  const duel = new Duel({ width: 12, height: 8, ...options }, () => 0.99);
  duel.items = [];
  return duel;
}

test('две змейки стартуют на разных половинах поля навстречу друг другу', () => {
  const duel = makeDuel();
  const [a, b] = duel.players;
  assert.ok(a.body[0].x < b.body[0].x);
  assert.deepEqual(a.direction, DIRECTIONS.RIGHT);
  assert.deepEqual(b.direction, DIRECTIONS.LEFT);
});

test('без поворотов змейки не сталкиваются сразу после старта', () => {
  const duel = makeDuel();
  for (let i = 0; i < 30; i += 1) duel.step();
  assert.equal(duel.over, false);
});

test('игроки поворачивают независимо', () => {
  const duel = makeDuel();
  duel.turn(0, DIRECTIONS.UP);
  duel.step();
  assert.deepEqual(duel.players[0].direction, DIRECTIONS.UP);
  assert.deepEqual(duel.players[1].direction, DIRECTIONS.LEFT);
});

test('врезался в соперника — проиграл', () => {
  const duel = makeDuel();
  const [a, b] = duel.players;
  a.body = [{ x: 4, y: 3 }, { x: 3, y: 3 }];
  a.direction = DIRECTIONS.DOWN;
  b.body = [{ x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 4 }];
  b.direction = DIRECTIONS.RIGHT;
  duel.step();
  assert.equal(duel.over, true);
  assert.equal(duel.winner, 1);
  assert.equal(a.deathReason, 'rival');
});

test('лоб в лоб — ничья', () => {
  const duel = makeDuel();
  const [a, b] = duel.players;
  a.body = [{ x: 4, y: 3 }];
  b.body = [{ x: 6, y: 3 }];
  duel.step();
  assert.equal(duel.over, true);
  assert.equal(duel.winner, null);
});

test('змейки, поменявшиеся местами, тоже сталкиваются', () => {
  const duel = makeDuel();
  const [a, b] = duel.players;
  a.body = [{ x: 4, y: 3 }];
  b.body = [{ x: 5, y: 3 }];
  duel.step();
  assert.equal(duel.over, true);
  assert.equal(duel.winner, null);
});

test('яблоко достаётся тому, кто его съел', () => {
  const duel = makeDuel();
  const head = duel.players[0].body[0];
  duel.items = [{ kind: ITEM.APPLE, x: head.x + 1, y: head.y, ttl: null }];
  duel.step();
  assert.equal(duel.players[0].score, 10);
  assert.equal(duel.players[1].score, 0);
});

test('режим «стены»: вылет за поле — проигрыш', () => {
  const duel = makeDuel({ mode: MODES.WALLS });
  duel.players[1].body = [{ x: 0, y: 3 }];
  duel.step();
  assert.equal(duel.winner, 0);
  assert.equal(duel.players[1].deathReason, 'wall');
});

test('на время: побеждает тот, у кого больше очков', () => {
  const duel = makeDuel({ mode: MODES.TIMED, timedDurationMs: 500 });
  duel.players[1].score = 30;
  duel.update(600);
  assert.equal(duel.over, true);
  assert.equal(duel.winner, 1);
});

test('снимок состояния сериализуется в JSON без потерь', () => {
  const duel = makeDuel();
  const snap = JSON.parse(JSON.stringify(duel.snapshot()));
  assert.deepEqual(snap.players[0].body, duel.players[0].body);
  assert.equal(snap.w, 12);
});
