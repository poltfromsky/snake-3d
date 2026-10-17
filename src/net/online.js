/**
 * Онлайн-игра вдвоём без своего сервера.
 *
 * Браузеры соединяются напрямую по WebRTC. Чтобы найти друг друга, они
 * используют бесплатный публичный сервер PeerJS: через него идёт только
 * служебный обмен для установки соединения, сама игра — напрямую.
 *
 * Хозяин комнаты считает всю игру (класс Duel) и рассылает снимки состояния,
 * гость только присылает свои повороты. Так у обоих одна и та же партия.
 */

const ID_PREFIX = 'izgib-pitona-3d-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих 0/O, 1/I/L

let peerModulePromise = null;

/** PeerJS грузится только когда игрок выбрал онлайн — одиночная игра от него не зависит. */
function loadPeer() {
  peerModulePromise ??= import('peerjs').then((m) => m.Peer ?? m.default);
  return peerModulePromise;
}

export function makeRoomCode(length = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

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

const ERRORS = {
  'peer-unavailable': 'Комната не найдена. Проверьте код или попросите друга создать новую.',
  'unavailable-id': 'Такой код уже занят, создайте комнату ещё раз.',
  network: 'Нет связи с сервером соединения. Проверьте интернет или VPN.',
  'server-error': 'Сервер соединения недоступен. Попробуйте позже.',
  'browser-incompatible': 'Браузер не поддерживает WebRTC.',
};

const describe = (err) => ERRORS[err?.type] ?? `Ошибка соединения: ${err?.type ?? err?.message ?? err}`;

/**
 * Соединение между двумя игроками. Колбэки:
 * onOpen() — канал готов, onMessage(msg), onClose(), onError(text).
 */
export class OnlineLink {
  constructor(handlers) {
    this.handlers = handlers;
    this.peer = null;
    this.conn = null;
    this.role = null;
    this.code = null;
  }

  async host() {
    const Peer = await loadPeer();
    this.role = 'host';
    this.code = makeRoomCode();
    this.peer = new Peer(ID_PREFIX + this.code, { debug: 0 });
    this.peer.on('error', (err) => this.handlers.onError?.(describe(err)));
    this.peer.on('connection', (conn) => {
      // В комнате два места: остальных вежливо закрываем.
      if (this.conn?.open) {
        conn.on('open', () => conn.close());
        return;
      }
      this.attach(conn);
    });
    await new Promise((resolve, reject) => {
      this.peer.once('open', resolve);
      this.peer.once('error', reject);
    });
    return this.code;
  }

  async join(code) {
    const Peer = await loadPeer();
    this.role = 'guest';
    this.code = code;
    this.peer = new Peer({ debug: 0 });
    this.peer.on('error', (err) => this.handlers.onError?.(describe(err)));
    await new Promise((resolve, reject) => {
      this.peer.once('open', resolve);
      this.peer.once('error', reject);
    });
    this.attach(this.peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' }));
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => this.handlers.onOpen?.());
    conn.on('data', (msg) => this.handlers.onMessage?.(msg));
    conn.on('close', () => this.handlers.onClose?.());
    conn.on('error', (err) => this.handlers.onError?.(describe(err)));
  }

  get connected() {
    return Boolean(this.conn?.open);
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  close() {
    try {
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      // Соединение уже закрыто — ничего страшного.
    }
    this.conn = null;
    this.peer = null;
  }
}
