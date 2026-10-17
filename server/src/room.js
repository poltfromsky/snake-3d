/**
 * Durable Object «Комната»: один экземпляр на код комнаты.
 *
 * Держит WebSocket-подключения двух игроков, гоняет игровой цикл и передаёт
 * всё в RoomSession (src/core/room.js), где живут правила. Здесь — только
 * «провода»: подключения, таймер и защита от флуда.
 *
 * Диагностика (временно, пока разбираемся с циклом в проде):
 *   - console.log/error пишут в Cloudflare Workers Logs события жизненного цикла
 *     и ошибки — без IP, заголовков и содержимого сообщений;
 *   - клиент может прислать {t:'debug'}, и сервер раз в секунду будет слать ему
 *     {t:'diag', ...} с состоянием цикла. Игре это не мешает.
 */
import { DurableObject } from 'cloudflare:workers';

import { ROOM_TTL_MS, RoomSession } from '../../src/core/room.js';

const TICK_MS = 20; // частота игрового цикла на сервере
const MAX_MESSAGES_PER_SECOND = 40;
const MAX_MESSAGE_BYTES = 512;
const DIAG_EVERY_MS = 1000;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.session = null;
    this.sockets = new Map(); // id подключения → WebSocket
    this.loop = null;
    this.lastTick = 0;
    this.createdAt = 0;
    this.roomTag = ctx.id.toString().slice(0, 8);
    this.debugIds = new Set();
    this.resetDiag();
    this.log('construct');
  }

  resetDiag() {
    this.diag = {
      ticks: 0, maxGap: 0, zeroDt: 0, errors: 0, lastDiagAt: 0, loopStarts: 0,
    };
  }

  /** Одна строка JSON в логах — удобно фильтровать в Cloudflare Workers Logs. */
  log(event, extra = {}) {
    console.log(JSON.stringify({
      room: this.roomTag, event, phase: this.session?.phase ?? null, players: this.sockets?.size ?? 0, ...extra,
    }));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init') return this.init(request);
    await this.restore();
    return this.connect();
  }

  /**
   * Cloudflare выгружает объект из памяти, когда к нему никто не подключён.
   * Настройки комнаты храним в его SQLite-хранилище и поднимаем при входе.
   */
  async restore() {
    if (this.session) return;
    const saved = await this.ctx.storage.get('room');
    if (!saved) return;
    this.session = new RoomSession({ mode: saved.mode, speed: saved.speed });
    this.createdAt = saved.createdAt;
    this.log('restore');
  }

  /** Создание комнаты. 409 — код занят комнатой, созданной меньше часа назад. */
  async init(request) {
    await this.restore();
    if (this.session && Date.now() - this.createdAt < ROOM_TTL_MS) {
      return new Response('busy', { status: 409 });
    }
    const { mode, speed } = await request.json().catch(() => ({}));
    this.session = new RoomSession({ mode, speed });
    this.createdAt = Date.now();
    await this.ctx.storage.put('room', { mode: this.session.mode, speed, createdAt: this.createdAt });
    this.log('init', { mode: this.session.mode });
    return new Response('ok');
  }

  connect() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const expired = !this.session || (this.session.empty && Date.now() - this.createdAt > ROOM_TTL_MS);
    if (expired) {
      this.sendTo(server, { t: 'error', text: 'Комната не найдена или устарела. Попросите друга создать новую.' });
      server.close(4404, 'room not found');
      this.log('connect-rejected', { reason: 'not-found' });
      return new Response(null, { status: 101, webSocket: client });
    }

    const id = crypto.randomUUID();
    const { slot, messages } = this.session.join(id);
    if (slot === -1) {
      for (const m of messages) this.sendTo(server, m.msg);
      server.close(4409, 'room full');
      this.log('connect-rejected', { reason: 'full' });
      return new Response(null, { status: 101, webSocket: client });
    }
    this.sockets.set(id, server);
    this.log('connect', { slot });

    let windowStart = Date.now();
    let count = 0;
    server.addEventListener('message', (event) => {
      try {
        // Простая защита от флуда: не больше N сообщений в секунду.
        const now = Date.now();
        if (now - windowStart > 1000) { windowStart = now; count = 0; }
        count += 1;
        if (count > MAX_MESSAGES_PER_SECOND) return;
        if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_BYTES) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg?.t === 'debug') {
          this.debugIds.add(id);
          this.log('debug-on', { slot });
          return;
        }
        this.dispatch(this.session.handle(id, msg));
        this.ensureLoop('message');
      } catch (err) {
        this.diag.errors += 1;
        console.error(JSON.stringify({ room: this.roomTag, event: 'message-error', error: err?.message, stack: String(err?.stack ?? '').slice(0, 600) }));
      }
    });
    const onGone = (event) => {
      if (!this.sockets.has(id)) return;
      this.sockets.delete(id);
      this.debugIds.delete(id);
      this.log('disconnect', { slot, code: event?.code ?? null });
      this.dispatch(this.session.leave(id));
      this.ensureLoop('leave');
    };
    server.addEventListener('close', onGone);
    server.addEventListener('error', onGone);

    this.dispatch(messages, server);
    this.ensureLoop('connect');
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Цикл крутится только пока идёт отсчёт или партия — иначе не тратим ресурсы. */
  ensureLoop(reason) {
    if (this.session?.active && !this.loop) {
      this.lastTick = Date.now();
      this.diag.loopStarts += 1;
      this.loop = setInterval(() => this.tick(), TICK_MS);
      this.log('loop-start', { reason });
    } else if (!this.session?.active && this.loop) {
      clearInterval(this.loop);
      this.loop = null;
      this.log('loop-stop', { reason, ticks: this.diag.ticks, maxGap: this.diag.maxGap });
    }
  }

  tick() {
    const now = Date.now();
    const gap = now - this.lastTick;
    const dt = Math.min(gap, 250);
    this.lastTick = now;
    this.diag.ticks += 1;
    if (gap > this.diag.maxGap) this.diag.maxGap = gap;
    if (dt === 0) this.diag.zeroDt += 1;
    try {
      this.dispatch(this.session.tick(dt));
    } catch (err) {
      this.diag.errors += 1;
      console.error(JSON.stringify({ room: this.roomTag, event: 'tick-error', error: err?.message, stack: String(err?.stack ?? '').slice(0, 600) }));
    }
    if (this.debugIds.size && now - this.diag.lastDiagAt >= DIAG_EVERY_MS) {
      this.diag.lastDiagAt = now;
      this.sendDiag(now);
    }
    this.ensureLoop('tick');
  }

  sendDiag(now) {
    const msg = {
      t: 'diag',
      now,
      phase: this.session?.phase,
      step: this.session?.duel?.stepCount ?? null,
      ticks: this.diag.ticks,
      maxGap: this.diag.maxGap,
      zeroDt: this.diag.zeroDt,
      errors: this.diag.errors,
      loopStarts: this.diag.loopStarts,
    };
    for (const id of this.debugIds) {
      const socket = this.sockets.get(id);
      if (socket) this.sendTo(socket, msg);
    }
  }

  dispatch(messages, selfSocket = null) {
    for (const { to, msg } of messages) {
      if (to === 'self') {
        if (selfSocket) this.sendTo(selfSocket, msg);
        continue;
      }
      for (const [id, socket] of this.sockets) {
        if (to === 'all' || this.session.slotOf(id) === to) this.sendTo(socket, msg);
      }
    }
  }

  sendTo(socket, msg) {
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      // Сокет уже закрыт — его уберёт обработчик close. Но фиксируем: вдруг дело в этом.
      this.diag.errors += 1;
      console.error(JSON.stringify({ room: this.roomTag, event: 'send-error', error: err?.message }));
    }
  }
}
