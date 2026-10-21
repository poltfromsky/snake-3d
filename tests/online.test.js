import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';

import { RoomConnection } from '../src/net/online.js';

/** Поддельный WebSocket: тест сам решает, когда соединение откроется и что придёт. */
class FakeSocket {
  static CONNECTING = 0;

  static OPEN = 1;

  static CLOSED = 3;

  static last = null;

  constructor(url) {
    this.url = url;
    this.readyState = FakeSocket.CONNECTING;
    this.listeners = {};
    this.sent = [];
    FakeSocket.last = this;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  emit(type, event = {}) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }

  receive(msg) {
    this.emit('message', { data: JSON.stringify(msg) });
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
  }
}

beforeEach(() => {
  globalThis.WebSocket = FakeSocket;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
});
afterEach(() => mock.timers.reset());

const settle = (promise) => promise.then((v) => ({ ok: v }), (e) => ({ error: e.message }));

test('сервер принял соединение, а страница долго грузится — подключение не обрывается', async () => {
  const conn = new RoomConnection('http://localhost:8787', 'ABCDE', {});
  const result = settle(conn.connect());
  FakeSocket.last.open();
  // Ответ «вы в комнате» задерживается на 15 секунд (раньше на 10-й секунде был обрыв).
  mock.timers.tick(15_000);
  FakeSocket.last.receive({ t: 'joined', slot: 1, mode: 'walls', names: [null, null] });
  assert.deepEqual(await result, { ok: { t: 'joined', slot: 1, mode: 'walls', names: [null, null] } });
});

test('страница подвисла при загрузке — подключение не считается сорвавшимся', async () => {
  const conn = new RoomConnection('http://localhost:8787', 'ABCDE', {});
  const result = settle(conn.connect());
  // Страница «замёрзла» на 14 секунд: проверка через 10 секунд срабатывает с опозданием,
  // а событие «соединение открыто» ещё не дошло (так было на CI с тяжёлой 3D-загрузкой).
  mock.timers.setTime(Date.now() + 14_000);
  mock.timers.tick(0);
  FakeSocket.last.open();
  FakeSocket.last.receive({ t: 'joined', slot: 1, mode: 'walls', names: [null, null] });
  assert.deepEqual(await result, { ok: { t: 'joined', slot: 1, mode: 'walls', names: [null, null] } });
});

test('страница подвисла, но сервер так и не ответил — ошибка всё равно будет', async () => {
  const conn = new RoomConnection('http://localhost:8787', 'ABCDE', {});
  const result = settle(conn.connect());
  mock.timers.setTime(Date.now() + 14_000);
  mock.timers.tick(0);
  mock.timers.tick(2_001); // перепроверка вовремя: соединение так и не открылось
  assert.match((await result).error, /Сервер не отвечает/);
});

test('сервер не отвечает вовсе — через 10 секунд честная ошибка', async () => {
  const conn = new RoomConnection('http://localhost:8787', 'ABCDE', {});
  const result = settle(conn.connect());
  mock.timers.tick(10_001);
  assert.match((await result).error, /Сервер не отвечает/);
});

test('отказ сервера (комнаты нет) помечен — его не повторяют, а обрыв связи — повторяют', async () => {
  const refusedOf = (promise) => promise.then(() => null, (e) => e.refused);
  const refused = refusedOf(new RoomConnection('http://localhost:8787', 'ABCDE', {}).connect());
  FakeSocket.last.open();
  FakeSocket.last.receive({ t: 'error', text: 'Комната не найдена или устарела.' });
  assert.equal(await refused, true);

  const lost = refusedOf(new RoomConnection('http://localhost:8787', 'ABCDE', {}).connect());
  FakeSocket.last.emit('close');
  assert.equal(await lost, false);
});

test('соединение открыто, но ответа нет полминуты — тоже ошибка, а не вечное ожидание', async () => {
  const conn = new RoomConnection('http://localhost:8787', 'ABCDE', {});
  const result = settle(conn.connect());
  FakeSocket.last.open();
  for (let i = 0; i < 20; i += 1) mock.timers.tick(2_000);
  assert.match((await result).error, /Сервер не отвечает/);
  assert.equal(FakeSocket.last.readyState, FakeSocket.CLOSED);
});
