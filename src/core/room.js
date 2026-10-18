/**
 * Онлайн-комната на двоих — чистая логика без сети.
 *
 * На сервере её оборачивает Durable Object (server/src/room.js): он передаёт
 * сюда подключения и сообщения игроков, вызывает tick() и рассылает то, что
 * вернули методы. Партию считает сервер, поэтому у обоих игроков одна и та же
 * игра, ни у кого нет преимущества и не важно, свернул ли кто-то вкладку.
 *
 * Сервер → игрок:
 *   joined {slot, mode, names} — место в комнате (0 — создатель, 1 — друг) и уже известные ники
 *   names {names}            — ники игроков изменились ([ник0, ник1], null — без ника)
 *   opponent {connected}     — соперник подключился / отключился
 *   round                    — новая партия: пересобрать сцену
 *   countdown {n}, go        — отсчёт 3-2-1 и старт
 *   state {s, events}        — снимок партии (Duel.snapshot) и события
 *   rematch {votes}          — кто уже нажал «Реванш»
 *   error {text}             — комната не найдена, занята и т. п.
 * Игрок → сервер:
 *   name {name}              — свой ник (проверяется как имя в рекордах)
 *   turn {dir}, rematch, ping
 */
import { Duel } from './duel.js';
import { DIRECTIONS, MODES } from './game.js';
import { cleanText, LIMITS } from './validate.js';

export const SPEEDS = Object.freeze({ slow: 0.75, normal: 1, fast: 1.35 });
export const COUNTDOWN_MS = 3000;
export const STATE_KEEPALIVE_MS = 500;
export const ROOM_TTL_MS = 60 * 60 * 1000; // пустая комната живёт час

const TURN_NAMES = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT']);

/** Сообщение: to — номер места (0/1), 'all' — обоим, 'self' — тому, кто подключается. */
const out = (to, msg) => ({ to, msg });

export class RoomSession {
  constructor({ mode = MODES.CLASSIC, speed = 'normal' } = {}, rng = Math.random) {
    this.mode = Object.values(MODES).includes(mode) ? mode : MODES.CLASSIC;
    this.speedFactor = SPEEDS[speed] ?? 1;
    this.rng = rng;
    this.slots = [null, null]; // id подключения или null
    this.names = [null, null]; // ники игроков, null — не назвался
    this.phase = 'waiting'; // waiting | countdown | playing | over
    this.duel = null;
    this.countdownLeft = 0;
    this.lastCountdown = 0;
    this.lastSentStep = -1;
    this.sinceLastState = 0;
    this.votes = [false, false];
  }

  get playerCount() {
    return this.slots.filter(Boolean).length;
  }

  get empty() {
    return this.playerCount === 0;
  }

  /** Нужен ли игровой цикл (иначе серверу незачем тикать). */
  get active() {
    return this.phase === 'countdown' || this.phase === 'playing';
  }

  slotOf(id) {
    return this.slots.indexOf(id);
  }

  join(id) {
    const slot = this.slots.indexOf(null);
    // 'self' — ответ именно этому подключению: места у него ещё нет.
    if (slot === -1) return { slot: -1, messages: [out('self', { t: 'error', text: 'В комнате уже двое игроков.' })] };
    this.slots[slot] = id;
    const messages = [out(slot, { t: 'joined', slot, mode: this.mode, names: [...this.names] })];
    const other = this.slots[1 - slot];
    if (other) {
      messages.push(out(1 - slot, { t: 'opponent', connected: true }));
      messages.push(out(slot, { t: 'opponent', connected: true }));
      messages.push(...this.startRound());
    }
    return { slot, messages };
  }

  leave(id) {
    const slot = this.slotOf(id);
    if (slot === -1) return [];
    this.slots[slot] = null;
    this.names[slot] = null;
    // Партия без соперника не имеет смысла: возвращаемся в ожидание.
    this.phase = 'waiting';
    this.duel = null;
    this.votes = [false, false];
    return this.slots[1 - slot] ? [out(1 - slot, { t: 'opponent', connected: false })] : [];
  }

  startRound() {
    this.duel = new Duel({ mode: this.mode, speedFactor: this.speedFactor, width: 26, height: 16 }, this.rng);
    this.phase = 'countdown';
    this.countdownLeft = COUNTDOWN_MS;
    this.lastCountdown = 0;
    this.lastSentStep = -1;
    this.sinceLastState = 0;
    this.votes = [false, false];
    return [out('all', { t: 'round' }), this.stateMessage([])];
  }

  stateMessage(events) {
    this.lastSentStep = this.duel.stepCount;
    this.sinceLastState = 0;
    return out('all', { t: 'state', s: this.duel.snapshot(), events });
  }

  handle(id, msg) {
    const slot = this.slotOf(id);
    if (slot === -1 || !msg || typeof msg !== 'object') return [];
    switch (msg.t) {
      case 'turn':
        if (this.phase === 'playing' && TURN_NAMES.has(msg.dir)) this.duel.turn(slot, DIRECTIONS[msg.dir]);
        return [];
      case 'name': {
        if (typeof msg.name !== 'string') return [];
        const name = cleanText(msg.name, LIMITS.name) || null;
        if (name === this.names[slot]) return [];
        this.names[slot] = name;
        return [out('all', { t: 'names', names: [...this.names] })];
      }
      case 'rematch':
        if (this.phase !== 'over') return [];
        this.votes[slot] = true;
        if (this.votes.every(Boolean) && this.playerCount === 2) return this.startRound();
        return [out('all', { t: 'rematch', votes: [...this.votes] })];
      default:
        return []; // ping и неизвестное — молча
    }
  }

  /** Продвигает время; возвращает сообщения для рассылки. */
  tick(dtMs) {
    if (this.phase === 'countdown') return this.tickCountdown(dtMs);
    if (this.phase !== 'playing') return [];

    const events = this.duel.update(dtMs).map((e) => (e.type === 'gameOver'
      ? {
        ...e,
        scores: this.duel.players.map((p) => p.score),
        deaths: this.duel.players.map((p) => p.deathReason),
      }
      : e));
    if (this.duel.over) this.phase = 'over';
    this.sinceLastState += dtMs;
    // Снимок — на каждом шаге змейки, при событиях и не реже раза в полсекунды.
    const stepped = this.duel.stepCount !== this.lastSentStep;
    if (stepped || events.length || this.sinceLastState >= STATE_KEEPALIVE_MS) {
      return [this.stateMessage(events)];
    }
    return [];
  }

  tickCountdown(dtMs) {
    this.countdownLeft -= dtMs;
    const n = Math.ceil(this.countdownLeft / 1000);
    const messages = [];
    if (n > 0 && n !== this.lastCountdown) {
      this.lastCountdown = n;
      messages.push(out('all', { t: 'countdown', n }));
    }
    if (this.countdownLeft <= 0) {
      this.phase = 'playing';
      messages.push(out('all', { t: 'go' }), this.stateMessage([]));
    }
    return messages;
  }
}
