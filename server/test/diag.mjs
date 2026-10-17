// Диагностика игрового цикла комнаты: два клиента, режим «стены», печать
// всех сообщений сервера по времени, включая отладочные {t:'diag'}.
// Запуск: API=https://… node test/diag.mjs   (по умолчанию — локальный сервер)
const B = (process.env.API ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const WS = B.replace(/^http/, 'ws');
const SECONDS = Number(process.env.SECONDS ?? 12);

const res = await fetch(`${B}/api/rooms`, { method: 'POST', body: JSON.stringify({ mode: 'walls', speed: 'fast' }) });
const { code } = await res.json();
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
console.log(`room ${code}`);

function client(name) {
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
  let states = 0;
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'debug' })));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'state') {
      states += 1;
      const ev = (m.events ?? []).map((x) => x.type).join(',');
      if (states % 5 === 1 || ev) console.log(`${at()} ${name} state#${states} step=${m.s.players.map((p) => `${p.body[0].x},${p.body[0].y}`).join('|')} ${ev}`);
    } else if (m.t === 'diag') {
      console.log(`${at()} ${name} DIAG ${JSON.stringify(m)}`);
    } else {
      console.log(`${at()} ${name} ${m.t} ${m.n ?? m.slot ?? ''}`);
    }
  });
  ws.addEventListener('close', (e) => console.log(`${at()} ${name} CLOSE ${e.code}`));
  return ws;
}

client('A');
await new Promise((r) => { setTimeout(r, 800); });
client('B');
await new Promise((r) => { setTimeout(r, SECONDS * 1000); });
process.exit(0);
