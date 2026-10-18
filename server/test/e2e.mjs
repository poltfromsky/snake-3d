// Сквозная проверка онлайн-комнаты через настоящий сервер.
// Запуск: `npm run dev` в одном терминале, `npm run test:e2e` в другом.
// Адрес можно переопределить: API=https://… npm run test:e2e
import assert from 'node:assert/strict';

const B = (process.env.API ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const WS = B.replace(/^http/, 'ws');

function client(code, name) {
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  const log = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    log.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  const waitFor = (pred, ms = 15000) => new Promise((resolve, reject) => {
    const hit = log.find(pred);
    if (hit) return resolve(hit);
    waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error(`${name}: timeout`)), ms);
  });
  const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e.code)));
  return { ws, log, waitFor, closed, send: (m) => ws.send(JSON.stringify(m)) };
}

const res = await fetch(`${B}/api/rooms`, { method: 'POST', body: JSON.stringify({ mode: 'walls', speed: 'fast' }) });
const { code } = await res.json();
assert.match(code, /^[A-Z0-9]{5}$/);
console.log('✔ комната создана:', code);

const a = client(code, 'A');
const joinedA = await a.waitFor((m) => m.t === 'joined');
const b = client(code, 'B');
const joinedB = await b.waitFor((m) => m.t === 'joined');
assert.deepEqual([joinedA.slot, joinedB.slot, joinedA.mode], [0, 1, 'walls']);
console.log('✔ места 0 и 1, режим задал создатель');

a.send({ t: 'name', name: 'Питон' });
b.send({ t: 'name', name: '  Удав\u0000  ' });
const named = await a.waitFor((m) => m.t === 'names' && m.names[0] === 'Питон' && m.names[1] === 'Удав');
assert.deepEqual(named.names, ['Питон', 'Удав']);
console.log('✔ ники игроков дошли до обоих и очищены сервером');

const c = client(code, 'C');
const err = await c.waitFor((m) => m.t === 'error');
assert.equal(await c.closed, 4409);
console.log('✔ третьего не пускает:', err.text);

await a.waitFor((m) => m.t === 'go');
assert.deepEqual(a.log.filter((m) => m.t === 'countdown').map((m) => m.n), [3, 2, 1]);
console.log('✔ отсчёт 3-2-1');
const over = await a.waitFor((m) => m.t === 'state' && m.events?.some((e) => e.type === 'gameOver'), 20000);
const go = over.events.find((e) => e.type === 'gameOver');
assert.equal(go.scores.length, 2);
console.log('✔ конец партии:', JSON.stringify({ winner: go.winner, reason: go.reason, deaths: go.deaths }));
const states = a.log.filter((m) => m.t === 'state').length;
console.log(`  снимков за партию: ${states}`);

a.send({ t: 'rematch' });
const vote = await b.waitFor((m) => m.t === 'rematch');
assert.deepEqual(vote.votes, [true, false]);
console.log('✔ голос за реванш виден сопернику');
b.send({ t: 'rematch' });
await a.waitFor((m) => m.t === 'round' && a.log.filter((x) => x.t === 'round').length >= 2);
console.log('✔ реванш начался');

// Общая таблица: у ника одна строка — его лучший результат.
// Свой «адрес» на каждую отправку — иначе сработает ограничение частоты.
const nick = `e2e${Date.now().toString(36).slice(-6)}`;
let fakeIp = 0;
const submit = async (name, score) => {
  fakeIp += 1;
  const r = await fetch(`${B}/api/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${fakeIp}` },
    body: JSON.stringify({ name, mode: 'timed', score, length: 5 }),
  });
  assert.ok(r.ok, `POST /api/records → ${r.status}`);
  return r.json();
};
const rowsOf = async () => (await (await fetch(`${B}/api/records?mode=timed`)).json())
  .filter((row) => row.name.toLowerCase() === nick);
assert.equal((await submit(nick, 40)).improved, true);
assert.deepEqual(await submit(nick, 30), { ok: true, improved: false, best: 40 });
assert.equal((await submit(nick.toUpperCase(), 55)).improved, true, 'ник без учёта регистра');
const mine = await rowsOf();
assert.equal(mine.length, 1, 'одна строка на ник');
assert.equal(mine[0].score, 55);
const place = await (await fetch(`${B}/api/records/place?mode=timed&name=${encodeURIComponent(nick)}`)).json();
assert.equal(place.score, 55);
assert.ok(Number.isInteger(place.place) && place.place >= 1, 'место в таблице');
assert.equal(await (await fetch(`${B}/api/records/place?mode=timed&name=nobody-${nick}`)).json(), null);
console.log('✔ общая таблица: одна строка на ник, обновляется только лучшим результатом');

const ghost = client('ZZZZZ', 'ghost');
const gerr = await ghost.waitFor((m) => m.t === 'error');
console.log('✔ несуществующая комната:', gerr.text);

a.ws.close(); b.ws.close();
setTimeout(() => process.exit(0), 300);
