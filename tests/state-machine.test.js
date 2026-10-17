import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATES, StateMachine, TRANSITIONS } from '../src/app/state-machine.js';

const S = STATES;

function machine(initial = S.MENU) {
  const reports = [];
  const changes = [];
  const m = new StateMachine(initial, (from, to) => changes.push(`${from}→${to}`), (msg) => reports.push(msg));
  return { m, reports, changes };
}

function walk(m, path) {
  for (const to of path) assert.equal(m.go(to), true, `переход в ${to} из ${m.state} должен быть разрешён`);
}

test('одиночная партия: меню → игра ⇄ пауза → итоги → заново → меню', () => {
  const { m, reports } = machine();
  walk(m, [S.PLAYING, S.PAUSED, S.PLAYING, S.OVER, S.PLAYING, S.OVER, S.MENU]);
  assert.equal(m.state, S.MENU);
  assert.deepEqual(reports, []);
});

test('онлайн: лобби → отсчёт → игра → итоги → реванш через отсчёт', () => {
  const { m, reports } = machine();
  walk(m, [S.LOBBY, S.COUNTDOWN, S.PLAYING, S.OVER, S.COUNTDOWN, S.PLAYING]);
  assert.deepEqual(reports, []);
});

test('обрыв связи возвращает в лобби из любой онлайн-стадии', () => {
  for (const from of [S.COUNTDOWN, S.PLAYING, S.OVER]) {
    const { m } = machine(from);
    assert.equal(m.go(S.LOBBY), true, `${from} → lobby`);
  }
});

test('в меню можно выйти из любого состояния', () => {
  for (const from of Object.values(S)) {
    const { m } = machine(from);
    assert.equal(m.go(S.MENU), true, `${from} → menu`);
  }
});

test('недопустимый переход не выполняется и сообщается', () => {
  const cases = [
    [S.MENU, S.OVER], // итогов без партии не бывает
    [S.MENU, S.PAUSED],
    [S.PAUSED, S.OVER], // на паузе змейка не может разбиться
    [S.LOBBY, S.PLAYING], // онлайн-партия начинается только после отсчёта
    [S.COUNTDOWN, S.PAUSED], // в онлайне паузы нет
    [S.PAUSED, S.LOBBY],
  ];
  for (const [from, to] of cases) {
    const { m, reports, changes } = machine(from);
    assert.equal(m.go(to), false, `${from} → ${to}`);
    assert.equal(m.state, from);
    assert.equal(reports.length, 1);
    assert.match(reports[0], new RegExp(`${from} → ${to}`));
    assert.deepEqual(changes, []);
  }
});

test('переход в то же состояние разрешён и не вызывает onChange', () => {
  const { m, changes } = machine(S.PLAYING);
  assert.equal(m.go(S.PLAYING), true);
  assert.deepEqual(changes, []);
  m.go(S.PAUSED);
  assert.deepEqual(changes, ['playing→paused']);
});

test('is() проверяет одно или несколько состояний', () => {
  const { m } = machine(S.COUNTDOWN);
  assert.equal(m.is(S.COUNTDOWN), true);
  assert.equal(m.is(S.PLAYING, S.COUNTDOWN), true);
  assert.equal(m.is(S.MENU), false);
});

test('таблица переходов: только известные состояния, все достижимы из меню, тупиков нет', () => {
  const all = new Set(Object.values(S));
  assert.deepEqual(new Set(Object.keys(TRANSITIONS)), all);
  for (const targets of Object.values(TRANSITIONS)) {
    for (const t of targets) assert.ok(all.has(t), `неизвестное состояние ${t}`);
  }
  const reached = new Set([S.MENU]);
  const queue = [S.MENU];
  while (queue.length) {
    for (const next of TRANSITIONS[queue.shift()]) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  assert.deepEqual(reached, all);
});
