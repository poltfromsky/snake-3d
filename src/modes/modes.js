/**
 * Режимы партии. У всех один интерфейс — поэтому остальная игра не спрашивает
 * «а какой сейчас режим?», а просто вызывает методы текущего:
 *
 *   kind        'solo' | 'local' | 'bot' | 'online'
 *   isDuel      две змейки или одна
 *   canPause    можно ли ставить на паузу (в онлайне нельзя — игра общая)
 *   restartable реванш = просто начать заново (у онлайна — голосование на сервере)
 *   myIndex     номер своей змейки (для камеры и подписей)
 *   game        объект логики (Game или Duel); у онлайна null — партию считает сервер
 *   view        что рисует сцена
 *   timed       идёт ли таймер
 *   update(dt)  продвинуть время, вернуть события игры
 *   steer(device, dir)  поворот: device — 'wasd' | 'arrows' | 'touch'
 *   playerName(i), hud(), intensity(), setSpeedFactor(f), dispose()
 *   duelResult(event)  (только дуэли) очки и причины выбывания для экрана итогов
 */
import { BOT_LEVELS } from '../core/bot.js';
import { Duel } from '../core/duel.js';
import { DIRECTIONS, Game, MODES } from '../core/game.js';

/** Скорость музыки: 0 — начало партии, 1 — максимальная скорость змеек. */
function intensityOf(game) {
  const { baseTicksPerSecond: base, maxTicksPerSecond: max } = game.opts;
  return Math.min(Math.max((game.ticksPerSecond - base) / (max - base), 0), 1);
}

export class SoloMode {
  /** @param {{mode: string, speedFactor: number, narrow: boolean}} config */
  constructor({ mode, speedFactor, narrow }) {
    this.kind = 'solo';
    this.isDuel = false;
    this.canPause = true;
    this.restartable = true;
    this.myIndex = 0;
    // На вертикальном экране поле тоже вертикальное.
    this.game = new Game({ width: narrow ? 14 : 24, height: narrow ? 20 : 16, mode, speedFactor });
  }

  get view() { return this.game; }

  get timed() { return this.game.opts.mode === MODES.TIMED; }

  update(dt) { return this.game.update(dt); }

  steer(_device, dir) { this.game.turn(DIRECTIONS[dir]); }

  playerName() { return 'Вы'; }

  hud() {
    const g = this.game;
    return {
      duel: false, score: g.score, length: g.length, level: g.level, timeLeft: g.timeLeftMs, effects: { ...g.effects },
    };
  }

  intensity() { return intensityOf(this.game); }

  setSpeedFactor(f) { this.game.opts.speedFactor = f; }

  dispose() {}
}

/** Общая часть дуэлей на одном компьютере (одна клавиатура и против бота). */
class LocalDuelBase {
  constructor({ mode, speedFactor }) {
    this.isDuel = true;
    this.canPause = true;
    this.restartable = true;
    this.myIndex = 0;
    // Поле дуэли не зависит от экрана: одинаковое у всех режимов дуэли.
    this.game = new Duel({ width: 26, height: 16, mode, speedFactor });
  }

  get view() { return this.game; }

  get timed() { return this.game.opts.mode === MODES.TIMED; }

  update(dt) { return this.game.update(dt); }

  hud() {
    return {
      duel: true, scores: this.game.players.map((p) => p.score), timeLeft: this.game.timeLeftMs,
    };
  }

  /** Итог для экрана: очки и причины выбывания. */
  duelResult() {
    return {
      scores: this.game.players.map((p) => p.score),
      deaths: this.game.players.map((p) => p.deathReason),
    };
  }

  intensity() { return intensityOf(this.game); }

  setSpeedFactor(f) { this.game.opts.speedFactor = f; }

  dispose() {}
}

export class LocalDuelMode extends LocalDuelBase {
  constructor(config) {
    super(config);
    this.kind = 'local';
  }

  /** За одной клавиатурой: WASD — первый игрок, стрелки — второй. */
  steer(device, dir) {
    this.game.turn(device === 'arrows' ? 1 : 0, DIRECTIONS[dir]);
  }

  playerName(i) { return `Игрок ${i + 1}`; }
}

export class BotDuelMode extends LocalDuelBase {
  /**
   * @param {object} config настройки поля + {level, createBot}
   * @param {(level: string, index: number) => {update(duel): void, dispose(): void}} config.createBot
   */
  constructor(config) {
    super(config);
    this.kind = 'bot';
    this.level = config.level;
    this.bot = config.createBot(config.level, 1);
  }

  update(dt) {
    const events = this.game.update(dt);
    // Бот думает над следующим ходом сразу после каждого шага змеек.
    if (!this.game.over) this.bot.update(this.game);
    return events;
  }

  steer(_device, dir) { this.game.turn(0, DIRECTIONS[dir]); }

  playerName(i) { return i === 0 ? 'Вы' : BOT_LEVELS[this.level].name; }

  dispose() { this.bot.dispose(); }
}

/**
 * Онлайн: партию считает сервер, режим только хранит последний снимок,
 * досчитывает плавность между снимками и пересылает повороты.
 */
export class OnlineMode {
  /**
   * @param {{connection: {send(msg): void, close(): void}, slot: number, now?: () => number}} config
   */
  constructor({ connection, slot, now = () => performance.now() }) {
    this.kind = 'online';
    this.isDuel = true;
    this.canPause = false;
    this.restartable = false;
    this.connection = connection;
    this.myIndex = slot;
    this.now = now;
    this.game = null;
    this.remote = null; // { snap, receivedAt }
    // Сцену пересобираем под поле сервера: по первому снимку и в начале каждого раунда.
    this.needsSetup = true;
  }

  /**
   * Сообщение сервера → действие для приложения (протокол — src/core/room.js).
   * @returns {{type: string} | null}
   */
  receive(msg) {
    if (!msg || typeof msg !== 'object') return null;
    switch (msg.t) {
      case 'state':
        this.remote = { snap: msg.s, receivedAt: this.now() };
        return { type: 'events', events: Array.isArray(msg.events) ? msg.events : [] };
      case 'round':
        this.needsSetup = true;
        return { type: 'round' };
      case 'countdown':
        return { type: 'countdown', n: msg.n };
      case 'go':
        return { type: 'go' };
      case 'rematch':
        return { type: 'rematch', mine: Boolean(msg.votes?.[this.myIndex]) };
      case 'opponent':
        return { type: 'opponent', connected: Boolean(msg.connected) };
      case 'error':
        return { type: 'error', text: msg.text };
      default:
        return null;
    }
  }

  get ready() { return Boolean(this.remote); }

  get view() {
    if (!this.remote) return null;
    const { snap, receivedAt } = this.remote;
    const elapsed = this.now() - receivedAt;
    return {
      opts: { width: snap.w, height: snap.h, mode: snap.mode },
      snakes: snap.players.map((p, i) => ({
        body: p.body, prevBody: p.prev, direction: p.dir, ghost: false, palette: i, alive: p.alive,
      })),
      items: snap.items,
      obstacles: snap.obstacles,
      // Между снимками досчитываем движение сами, чтобы змейки шли плавно.
      stepProgress: snap.over ? 1 : Math.min(snap.progress + elapsed / snap.interval, 1),
      over: snap.over,
    };
  }

  get timed() { return this.remote?.snap.mode === MODES.TIMED; }

  /** Во время партии сервер шлёт снимок минимум раз в полсекунды; дольше — связь оборвалась. */
  isStalled(stallMs) {
    return Boolean(this.remote) && !this.remote.snap.over && this.now() - this.remote.receivedAt > stallMs;
  }

  update() { return []; }

  steer(_device, dir) { this.connection.send({ t: 'turn', dir }); }

  rematch() { this.connection.send({ t: 'rematch' }); }

  /** Итог партии сервер присылает в самом событии gameOver. */
  duelResult(event) { return { scores: event.scores, deaths: event.deaths }; }

  playerName(i) { return i === this.myIndex ? 'Вы' : 'Друг'; }

  hud() {
    return {
      duel: true,
      scores: this.remote?.snap.players.map((p) => p.score) ?? [0, 0],
      timeLeft: this.remote?.snap.timeLeft ?? null,
    };
  }

  intensity() { return null; } // темп музыки в онлайне не меняем

  setSpeedFactor() {} // скорость задаёт создатель комнаты

  dispose() { this.connection.close(); }
}
