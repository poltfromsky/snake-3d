/**
 * Онлайн-игра вдвоём через свой сервер (Cloudflare, папка server/).
 *
 * Партию считает сервер, оба игрока — равноправные клиенты: присылают свои
 * повороты и получают снимки состояния по WebSocket. Работает в любой сети,
 * где открываются обычные сайты: прямое соединение между устройствами не нужно.
 */

const PING_EVERY_MS = 15000;
const CONNECT_TIMEOUT_MS = 10000;
// Сервер уже принял соединение, а ответа «вы в комнате» ещё нет — страница могла подвиснуть
// (тяжёлая загрузка на слабом телефоне). Тогда ждём дольше, но не бесконечно.
const JOIN_WAIT_MS = 30000;
const JOIN_RECHECK_MS = 2000;

export function normalizeRoomCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function roomLink(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}

/** Создаёт комнату на сервере с режимом и скоростью создателя. */
export async function createRoom(apiBase, { mode, speed }) {
  let res;
  try {
    res = await fetch(`${apiBase}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, speed }),
    });
  } catch {
    throw new Error('Сервер игры недоступен. Для онлайн-игры включите VPN.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.code) throw new Error(data.error ?? 'Не удалось создать комнату.');
  return data.code;
}

/**
 * Подключение к комнате. Колбэки: onMessage(msg), onClose(reason).
 * connect() завершается, когда сервер принял игрока (сообщение joined).
 * Если сервер сам отказал (комнаты нет, она занята), у ошибки refused = true:
 * повторять такое подключение бессмысленно, в отличие от оборванной связи.
 */
export class RoomConnection {
  constructor(apiBase, code, handlers) {
    this.url = `${apiBase.replace(/^http/, 'ws')}/api/rooms/${encodeURIComponent(code)}/ws`;
    this.code = code;
    this.handlers = handlers;
    this.socket = null;
    this.ping = null;
    this.closedByUs = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (text, refused = false) => {
        if (settled) return;
        settled = true;
        reject(Object.assign(new Error(text), { refused }));
      };
      const started = Date.now();
      let timer = null;
      const check = () => {
        if (settled) return;
        if (this.socket?.readyState === WebSocket.OPEN && Date.now() - started < JOIN_WAIT_MS) {
          timer = setTimeout(check, JOIN_RECHECK_MS);
          return;
        }
        fail('Сервер не отвечает. Для онлайн-игры включите VPN.');
        this.close();
      };
      timer = setTimeout(check, CONNECT_TIMEOUT_MS);

      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!settled) {
          if (msg.t === 'joined') {
            settled = true;
            clearTimeout(timer);
            resolve(msg);
          } else if (msg.t === 'error') {
            clearTimeout(timer);
            fail(msg.text, true);
            return;
          }
        }
        this.handlers.onMessage?.(msg);
      });
      this.socket.addEventListener('close', () => {
        clearTimeout(timer);
        clearInterval(this.ping);
        fail('Не удалось подключиться к комнате. Для онлайн-игры включите VPN.');
        if (!this.closedByUs) this.handlers.onClose?.();
      });
      // Пинг не даёт промежуточным прокси закрыть «молчащее» соединение.
      this.ping = setInterval(() => this.send({ t: 'ping' }), PING_EVERY_MS);
    });
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(msg) {
    if (this.connected) this.socket.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.ping);
    try {
      this.socket?.close(1000, 'bye');
    } catch {
      // Уже закрыто.
    }
  }
}
