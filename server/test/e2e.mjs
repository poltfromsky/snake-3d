// Сквозная проверка онлайн-комнаты через настоящий сервер.
// Запуск: `npm run dev` в одном терминале, `npm run test:e2e` в другом.
// Адрес можно переопределить: API=https://… npm run test:e2e
import assert from 'node:assert/strict';

import { deriveLoginKey, isRecoveryCode } from '../../src/core/auth.js';

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

// Общая таблица: у ника одна строка — его лучший результат; ник принадлежит устройству;
// результат принимается только по билету партии и только правдоподобный по времени.
// Свой «адрес» на каждый запрос — чтобы не упереться в лимиты (в бою его ставит Cloudflare).
const nick = `e2e${Date.now().toString(36).slice(-6)}`;
const deviceA = 'a'.repeat(48) + Date.now().toString(16).padStart(16, '0').slice(-16);
const deviceB = 'b'.repeat(48) + Date.now().toString(16).padStart(16, '0').slice(-16);
let fakeIp = 0;
const post = async (path, body) => {
  fakeIp += 1;
  const r = await fetch(`${B}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${fakeIp % 250}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
const ticket = async (mode = 'timed') => (await post('runs', { mode })).data.ticket;
/** Сыграть «партию»: билет, немного подождать, отправить результат. */
const submit = async (name, score, device = deviceA) => {
  const t = await ticket();
  await pause(600);
  return post('records', { name, mode: 'timed', score, length: 5, ticket: t, device });
};
const rowsOf = async () => (await (await fetch(`${B}/api/records?mode=timed`)).json())
  .filter((row) => row.name.toLowerCase() === nick);

let reply = await submit(nick, 40);
assert.equal(reply.status, 201, JSON.stringify(reply.data));
assert.equal(reply.data.improved, true);
assert.deepEqual((await submit(nick, 30)).data, { ok: true, improved: false, best: 40 });
assert.equal((await submit(nick.toUpperCase(), 55)).data.improved, true, 'ник без учёта регистра');
const mine = await rowsOf();
assert.ok(mine.length <= 1, 'одна строка на ник');
const place = await (await fetch(`${B}/api/records/place?mode=timed&name=${encodeURIComponent(nick)}`)).json();
assert.equal(place.score, 55);
assert.ok(Number.isInteger(place.place) && place.place >= 1, 'место в таблице');
assert.equal(await (await fetch(`${B}/api/records/place?mode=timed&name=nobody-${nick}`)).json(), null);
console.log('✔ общая таблица: одна строка на ник, обновляется только лучшим результатом, видно своё место');

reply = await submit(nick, 70, deviceB);
assert.equal(reply.status, 403);
assert.equal(reply.data.code, 'nick_taken');
console.log('✔ чужое устройство не может писать под занятым ником');

// Скорость и платформа: у ника своя строка на каждой скорости, значок платформы приходит с рекордом.
const speedRows = async (speed) => (await (await fetch(`${B}/api/records?mode=timed&speed=${speed}`)).json())
  .filter((row) => row.name.toLowerCase() === nick);
let t2 = await ticket();
await pause(1500); // на медленной скорости проверка правдоподобия строже — ждём чуть дольше
reply = await post('records', {
  name: nick, mode: 'timed', speed: 'slow', platform: 'touch', score: 20, length: 5, ticket: t2, device: deviceA,
});
assert.equal(reply.status, 201, `новая строка на медленной скорости: ${JSON.stringify(reply.data)}`);
const slow = await speedRows('slow');
assert.equal(slow.length, 1);
assert.equal(slow[0].score, 20, 'на медленной — свой рекорд, хотя на нормальной у ника больше');
assert.equal(slow[0].platform, 'touch');
assert.equal((await speedRows('normal'))[0].score, 55, 'нормальная не тронута');
const slowPlace = await (await fetch(`${B}/api/records/place?mode=timed&speed=slow&name=${encodeURIComponent(nick)}`)).json();
assert.equal(slowPlace.score, 20);
assert.equal((await fetch(`${B}/api/records?mode=timed&speed=turbo`)).status, 400, 'неизвестная скорость');
t2 = await ticket();
reply = await post('records', {
  name: nick, mode: 'timed', speed: 'slow', score: 300, length: 5, ticket: t2, device: deviceA,
});
assert.equal(reply.data.code, 'implausible', '300 очков на медленной сразу после старта');
console.log('✔ скорость: своя строка на каждой скорости, медленная проверяется строже; платформа сохраняется');

const used = await ticket();
await pause(600);
assert.equal((await post('records', { name: nick, mode: 'timed', score: 60, length: 5, ticket: used, device: deviceA })).status, 200);
reply = await post('records', { name: nick, mode: 'timed', score: 65, length: 5, ticket: used, device: deviceA });
assert.equal(reply.data.code, 'bad_ticket', 'билет одноразовый');
reply = await post('records', { name: nick, mode: 'timed', score: 65, length: 5, device: deviceA });
assert.equal(reply.data.code, 'no_ticket');
reply = await post('records', { name: nick, mode: 'timed', score: 4000, length: 5, ticket: await ticket(), device: deviceA });
assert.equal(reply.data.code, 'implausible', '4000 очков сразу после старта');
reply = await post('records', { name: nick, mode: 'walls', score: 10, length: 5, ticket: await ticket('timed'), device: deviceA });
assert.equal(reply.data.code, 'bad_ticket', 'билет другого режима');
console.log('✔ без билета, повторно по билету, «накрутка» и чужой режим — не принимаются');

// Профиль с паролем: ник можно защитить, войти с другого устройства, подбор пароля ограничен,
// забытый пароль заменяется кодом восстановления.
const ITER = 1000; // в тестах ключ считается быстро: проверяем сервер, а не стойкость растягивания
const profileNick = `pr${Date.now().toString(36).slice(-6)}`;
const keyOf = (password, name = profileNick) => deriveLoginKey(password, name, ITER);
const deviceC = 'd'.repeat(48) + Date.now().toString(16).padStart(16, '0').slice(-16);
const key1 = await keyOf('первый пароль 1');

reply = await post('account/create', { name: profileNick, device: deviceA, key: key1, consent: true });
assert.equal(reply.status, 201, JSON.stringify(reply.data));
assert.ok(isRecoveryCode(reply.data.recoveryCode), 'в ответе код восстановления');
const code1 = reply.data.recoveryCode;
assert.equal((await post('account/create', { name: profileNick, device: deviceA, key: key1, consent: true })).data.code, 'account_exists');
assert.equal((await post('account/create', { name: profileNick, device: deviceB, key: key1, consent: true })).data.code, 'nick_taken',
  'создать профиль чужого ника нельзя');
assert.equal((await post('account/create', { name: profileNick, device: 'не ключ', key: key1, consent: true })).status, 400);
assert.equal((await post('account/create', { name: profileNick, device: deviceA, key: 'x', consent: true })).status, 400);
console.log('✔ профиль: создаётся один раз, только владельцем ника, в ответе код восстановления');

const foreignTicket = await ticket();
await pause(600);
reply = await post('records', { name: profileNick, mode: 'timed', score: 10, length: 5, ticket: foreignTicket, device: deviceB });
assert.equal(reply.data.code, 'nick_taken', 'без входа чужое устройство не пишет под ником');
reply = await post('account/login', { name: profileNick, device: deviceB, key: await keyOf('не тот пароль 9') });
assert.equal(reply.status, 401);
assert.equal(reply.data.code, 'bad_login');
const unknown = await post('account/login', { name: `нет${profileNick}`, device: deviceB, key: await keyOf('не тот пароль 9', `нет${profileNick}`) });
assert.equal(unknown.status, 401);
assert.equal(unknown.data.error, reply.data.error, 'ответ не выдаёт, есть ли такой ник');
reply = await post('account/login', { name: profileNick.toUpperCase(), device: deviceB, key: key1 });
assert.equal(reply.status, 200, JSON.stringify(reply.data));
const loggedTicket = await ticket();
await pause(600);
reply = await post('records', { name: profileNick, mode: 'timed', score: 10, length: 5, ticket: loggedTicket, device: deviceB });
assert.equal(reply.status, 201, JSON.stringify(reply.data));
console.log('✔ вход: неверный пароль и неизвестный ник — одинаковый отказ; верный пароль даёт нику второе устройство');

// Подбор: после 5 неудачных попыток на ник даже верный пароль на время не принимается.
const lockNick = `lk${Date.now().toString(36).slice(-6)}`;
const lockKey = await keyOf('замок пароль 1', lockNick);
assert.equal((await post('account/create', { name: lockNick, device: deviceA, key: lockKey, consent: true })).status, 201);
for (let i = 0; i < 5; i += 1) {
  assert.equal((await post('account/login', { name: lockNick, device: deviceC, key: await keyOf(`мимо пароль ${i}`, lockNick) })).status, 401);
}
reply = await post('account/login', { name: lockNick, device: deviceC, key: lockKey });
assert.equal(reply.status, 429);
assert.equal(reply.data.code, 'auth_limit');
console.log('✔ после пяти неудачных попыток вход на время закрыт, даже с верным паролем');

// Забыли пароль: код восстановления даёт новый пароль и новый код; старые пароль и код больше не действуют.
const key2 = await keyOf('второй пароль 2');
reply = await post('account/recover', { name: profileNick, device: deviceC, code: 'AAAAA-AAAAA-AAAAA-AAAAA', key: key2 });
assert.equal(reply.data.code, 'bad_code');
assert.equal((await post('account/recover', { name: profileNick, device: deviceC, code: 'коротко', key: key2 })).status, 400);
reply = await post('account/recover', { name: profileNick, device: deviceC, code: code1.toLowerCase().replace(/-/g, ' '), key: key2 });
assert.equal(reply.status, 200, JSON.stringify(reply.data));
const code2 = reply.data.recoveryCode;
assert.ok(isRecoveryCode(code2));
assert.notEqual(code2, code1, 'код восстановления сменился');
assert.equal((await post('account/login', { name: profileNick, device: deviceC, key: key1 })).data.code, 'bad_login', 'старый пароль не действует');
assert.equal((await post('account/login', { name: profileNick, device: deviceC, key: key2 })).status, 200);
assert.equal((await post('account/recover', { name: profileNick, device: deviceC, code: code1, key: key2 })).data.code, 'bad_code', 'старый код не действует');
console.log('✔ восстановление: новый пароль и новый код, старые не действуют');

// Смена пароля, зная старый (свой ник: у прошлого уже набрались неудачные попытки).
const pwNick = `pw${Date.now().toString(36).slice(-6)}`;
const pwOld = await keyOf('старый пароль 1', pwNick);
const pwNew = await keyOf('новый пароль 2', pwNick);
const deviceE = 'e'.repeat(48) + Date.now().toString(16).padStart(16, '0').slice(-16); // лимит 3 новых ника на устройство
assert.equal((await post('account/create', { name: pwNick, device: deviceE, key: pwOld, consent: true })).status, 201);
reply = await post('account/password', { name: pwNick, device: deviceE, key: pwNew, newKey: pwNew });
assert.equal(reply.data.code, 'bad_login', 'не зная текущего пароля, не сменить');
reply = await post('account/password', { name: pwNick, device: deviceE, key: pwOld, newKey: pwNew });
assert.equal(reply.status, 200, JSON.stringify(reply.data));
assert.equal((await post('account/login', { name: pwNick, device: deviceC, key: pwOld })).data.code, 'bad_login');
assert.equal((await post('account/login', { name: pwNick, device: deviceC, key: pwNew })).status, 200);
console.log('✔ смена пароля: только зная текущий, после смены действует новый');

// Статистика игрока: лучшие строки во всех режимах и скоростях с местом.
const stats = await (await fetch(`${B}/api/records/player?name=${encodeURIComponent(nick)}`)).json();
const timedNormal = stats.find((r) => r.mode === 'timed' && r.speed === 'normal');
const timedSlow = stats.find((r) => r.mode === 'timed' && r.speed === 'slow');
assert.equal(timedNormal?.score, 60, JSON.stringify(stats));
assert.equal(timedSlow?.score, 20);
assert.equal(timedSlow?.platform, 'touch');
assert.ok(Number.isInteger(timedNormal.place) && timedNormal.place >= 1);
assert.deepEqual(await (await fetch(`${B}/api/records/player?name=nobody-${nick}`)).json(), []);
assert.equal((await fetch(`${B}/api/records/player`)).status, 400);
console.log('✔ статистика игрока: лучший результат и место в каждом режиме и скорости');

const fresh = 'c'.repeat(48) + Date.now().toString(16).padStart(16, '0').slice(-16);
for (let i = 1; i <= 3; i += 1) {
  assert.equal((await submit(`${nick}n${i}`, 10, fresh)).status, 201, `новый ник ${i}`);
}
reply = await submit(`${nick}n4`, 10, fresh);
assert.equal(reply.data.code, 'nick_limit', 'четвёртый новый ник за сутки с одного устройства');
console.log('✔ не больше 3 новых ников в сутки с одного устройства');

// Личная статистика профиля: одна на все устройства, только для вошедших устройств, без дублей.
const game = (id, extra = {}) => ({
  id: `e2e-${pwNick}-${id}`, at: Date.now() - 60_000, kind: 'solo', mode: 'classic', speed: 'normal', score: 40, length: 7,
  durationMs: 50_000, end: 'self', apples: 4, bonuses: { slow: 1, ghost: 0, bad: 0 }, ...extra,
});
reply = await post('stats/sync', { name: pwNick, device: deviceE, games: [game(1), game(2, { kind: 'bot', level: 'easy', result: 'win', end: 'wall' })], since: 0 });
assert.equal(reply.status, 200, JSON.stringify(reply.data));
assert.equal(reply.data.accepted, 2);
assert.equal(reply.data.epoch, 0, 'статистику ещё не удаляли');
assert.deepEqual(reply.data.games.map((g) => g.id).sort(), [game(1).id, game(2).id].sort());
assert.equal(reply.data.games.find((g) => g.kind === 'bot').result, 'win');
let cursor = reply.data.cursor;
// Второе устройство профиля (вошло по паролю) получает партии первого и добавляет свою.
reply = await post('stats/sync', { name: pwNick, device: deviceC, games: [game(3, { mode: 'walls', score: 70 })], since: 0 });
assert.equal(reply.status, 200, JSON.stringify(reply.data));
assert.equal(reply.data.total, 3);
assert.equal(reply.data.games.length, 3, 'второе устройство видит все партии профиля');
// Повтор той же партии — без дубля; догрузка «с номера» — только новое.
reply = await post('stats/sync', { name: pwNick, device: deviceE, games: [game(3, { mode: 'walls', score: 70 })], since: cursor });
assert.equal(reply.data.total, 3, 'повторная отправка не создаёт дубль');
assert.deepEqual(reply.data.games.map((g) => g.id), [game(3).id], 'с номера — только новые записи');
cursor = reply.data.cursor;
assert.deepEqual((await post('stats/sync', { name: pwNick, device: deviceE, games: [], since: cursor })).data.games, []);
// Мусор отбрасывается, лишнее — отказ.
reply = await post('stats/sync', { name: pwNick, device: deviceE, games: [{ id: 'x', kind: 'hack' }, game(4, { score: 99999 }), game(5)], since: cursor });
assert.equal(reply.data.accepted, 1, 'неверные записи не приняты');
reply = await post('stats/sync', { name: pwNick, device: deviceE, games: Array.from({ length: 51 }, (_, i) => game(100 + i)), since: 0 });
assert.equal(reply.status, 400, 'не больше 50 партий за раз');
// Чужое устройство и ник без профиля — одинаковый отказ.
reply = await post('stats/sync', { name: pwNick, device: deviceA, games: [game(6)], since: 0 });
assert.equal(reply.status, 403);
assert.equal(reply.data.code, 'stats_denied');
const noProfile = await post('stats/sync', { name: nick, device: deviceA, games: [game(7)], since: 0 });
assert.equal(noProfile.status, 403, 'у ника без профиля статистики на сервере нет');
assert.equal(noProfile.data.error, reply.data.error, 'ответ не выдаёт, есть ли профиль');
assert.equal((await post('stats/sync', { name: pwNick, device: 'не ключ', games: [] })).status, 400);
console.log('✔ статистика профиля: общая для устройств профиля, без дублей, догрузка только нового, чужим — отказ');

reply = await post('stats/compare', { name: pwNick, device: deviceC });
assert.equal(reply.status, 200, JSON.stringify(reply.data));
assert.equal(reply.data.modes.walls.mine, 70, 'свой лучший — из статистики, даже если рекорд не отправляли');
assert.ok(Number.isInteger(reply.data.modes.classic.others));
assert.ok('easy' in reply.data.bots && 'claude' in reply.data.bots);
assert.equal((await post('stats/compare', { name: pwNick, device: deviceA })).status, 403);
console.log('✔ сравнение с игроками: сводные цифры по режимам и ботам, только своему профилю');

reply = await post('stats/delete', { name: pwNick, device: deviceA });
assert.equal(reply.status, 403, 'чужое устройство не удалит');
reply = await post('stats/delete', { name: pwNick, device: deviceE });
assert.equal(reply.status, 200);
assert.equal(reply.data.deleted, 4);
assert.equal(reply.data.epoch, 1, 'новое поколение — остальные устройства сотрут у себя старые партии');
reply = await post('stats/sync', { name: pwNick, device: deviceC, games: [], since: cursor });
assert.equal(reply.data.total, 0);
assert.equal(reply.data.epoch, 1, 'второе устройство узнаёт об удалении при синхронизации');
console.log('✔ игрок сам удаляет статистику профиля; удаление доходит до всех его устройств');

// Согласие с политикой обязательно; удаление профиля — только с паролем, стирает всё и освобождает ник.
const delNick = `dl${Date.now().toString(36).slice(-6)}`;
const delKey = await keyOf('удалить пароль 1', delNick);
const deviceF = 'f'.repeat(48) + Date.now().toString(16).padStart(16, '0').slice(-16);
reply = await post('account/create', { name: delNick, device: deviceF, key: delKey });
assert.equal(reply.data.code, 'consent_required', 'без галочки согласия профиль не создаётся');
assert.equal((await post('account/create', { name: delNick, device: deviceF, key: delKey, consent: true })).status, 201);
assert.equal((await post('stats/sync', { name: delNick, device: deviceF, games: [game(900)], since: 0 })).data.accepted, 1);
reply = await post('account/delete', { name: delNick, device: deviceF, key: await keyOf('не тот пароль 3', delNick) });
assert.equal(reply.data.code, 'bad_login', 'без пароля не удалить');
assert.equal((await post('account/delete', { name: delNick, device: 'не ключ', key: delKey })).status, 400);
reply = await post('account/delete', { name: delNick, device: deviceA, key: delKey });
assert.equal(reply.status, 200, JSON.stringify(reply.data));
assert.equal(reply.data.deleted.games, 1);
assert.equal((await post('account/login', { name: delNick, device: deviceF, key: delKey })).data.code, 'bad_login', 'профиля больше нет');
assert.equal((await post('stats/sync', { name: delNick, device: deviceF, games: [], since: 0 })).status, 403, 'статистики больше нет');
assert.equal((await post('account/create', { name: delNick, device: deviceB, key: delKey, consent: true })).status, 201, 'ник освободился');
console.log('✔ согласие при регистрации обязательно; профиль удаляется только с паролем, данные стёрты, ник свободен');

const ghost = client('ZZZZZ', 'ghost');
const gerr = await ghost.waitFor((m) => m.t === 'error');
console.log('✔ несуществующая комната:', gerr.text);

a.ws.close(); b.ws.close();
setTimeout(() => process.exit(0), 300);
