/**
 * Игровая логика «Изгиб Питона 3D».
 *
 * Модуль ничего не знает об отрисовке, звуке и DOM: он хранит состояние
 * поля и возвращает список событий на каждом шаге. Благодаря этому логику
 * можно тестировать в Node без браузера.
 */

export const DIRECTIONS = Object.freeze({
  UP: Object.freeze({ x: 0, y: -1 }),
  DOWN: Object.freeze({ x: 0, y: 1 }),
  LEFT: Object.freeze({ x: -1, y: 0 }),
  RIGHT: Object.freeze({ x: 1, y: 0 }),
});

export const MODES = Object.freeze({
  CLASSIC: 'classic', // сквозь стены
  WALLS: 'walls', // стены смертельны
  TIMED: 'timed', // сквозь стены, на время
});

export const ITEM = Object.freeze({
  APPLE: 'apple',
  BAD: 'bad',
  SLOW: 'slow',
  GHOST: 'ghost',
});

export const DEFAULTS = Object.freeze({
  width: 24,
  height: 18,
  mode: MODES.CLASSIC,
  speedFactor: 1, // множитель из настроек: 0.75 / 1 / 1.35
  timedDurationMs: 90_000,
  applesPerLevel: 5,
  baseTicksPerSecond: 7,
  maxTicksPerSecond: 18,
  bonusLifetimeMs: 8_000,
  bonusDurationMs: 5_000,
  badFoodLifetimeMs: 10_000,
});

const SCORE = { [ITEM.APPLE]: 10, [ITEM.BAD]: -5, [ITEM.SLOW]: 5, [ITEM.GHOST]: 5 };

/**
 * «Замедление»: скорость ×0.6. Вход и выход — плавные: раньше в конце скорость мгновенно
 * прыгала с 0.6 до 1, и змейка делала рывок. Теперь последнюю секунду скорость растёт
 * постепенно, а в начале за четверть секунды плавно падает.
 */
export const SLOW_FACTOR = 0.6;
export const SLOW_EASE_IN_MS = 250;
export const SLOW_EASE_OUT_MS = 1000;

const smoothstep = (k) => k * k * (3 - 2 * k);

/**
 * Статус вот-вот закончится: последние EFFECT_WARN_MS змейка мерцает,
 * и чем ближе конец, тем чаще — от 3 до 12 вспышек в секунду.
 */
export const EFFECT_WARN_MS = 1500;
const BLINK_FROM_HZ = 3;
const BLINK_TO_HZ = 12;

/**
 * Видна ли змейка «во вспышке» при оставшихся leftMs статуса (true — яркая фаза).
 * Частота растёт плавно (фаза — интеграл частоты), поэтому мерцание не дёргается.
 */
export function effectBlinkOn(leftMs) {
  if (!(leftMs > 0) || leftMs > EFFECT_WARN_MS) return true;
  const e = (EFFECT_WARN_MS - leftMs) / 1000; // сколько секунд уже мерцает
  const w = EFFECT_WARN_MS / 1000;
  const turns = BLINK_FROM_HZ * e + ((BLINK_TO_HZ - BLINK_FROM_HZ) / (2 * w)) * e * e;
  return turns % 1 < 0.5;
}

/** Сравнивает две клетки. */
export const sameCell = (a, b) => a.x === b.x && a.y === b.y;

/**
 * Сколько поворотов змейка помнит наперёд. Пальцем и на высокой скорости игрок успевает
 * сделать несколько поворотов до следующего шага — лишние раньше терялись.
 */
export const MAX_QUEUED_TURNS = 3;

const cellKey = (c) => `${c.x},${c.y}`;

const isOpposite = (a, b) => a.x === -b.x && a.y === -b.y;

/** Состояние одной партии. */
export class Game {
  /**
   * @param {object} options параметры партии (см. DEFAULTS)
   * @param {() => number} rng генератор [0, 1), подменяется в тестах
   */
  constructor(options = {}, rng = Math.random) {
    this.opts = { ...DEFAULTS, ...options };
    this.rng = rng;
    this.reset();
  }

  /** Начинает партию заново. */
  reset() {
    const { width, height } = this.opts;
    const start = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    this.snake = [start, { x: start.x - 1, y: start.y }, { x: start.x - 2, y: start.y }];
    this.prevSnake = this.snake.map((c) => ({ ...c }));
    this.direction = DIRECTIONS.RIGHT;
    this.turnQueue = [];
    this.growth = 0;
    this.score = 0;
    this.applesEaten = 0;
    this.level = 1;
    this.obstacles = [];
    this.items = [];
    this.effects = { slow: 0, ghost: 0 };
    this.slowDepth = 0; // 0 — обычная скорость, 1 — полное замедление (плавный вход и выход)
    this.elapsedMs = 0;
    this.timeLeftMs = this.opts.mode === MODES.TIMED ? this.opts.timedDurationMs : null;
    this.accumulatorMs = 0;
    this.over = false;
    this.overReason = null;
    this.spawnItem(ITEM.APPLE);
  }

  get head() {
    return this.snake[0];
  }

  get length() {
    return this.snake.length;
  }

  /** Сколько шагов змейки в секунду с учётом длины, уровня и бонусов. */
  get ticksPerSecond() {
    const { baseTicksPerSecond, maxTicksPerSecond, speedFactor } = this.opts;
    const raw = baseTicksPerSecond + (this.length - 3) * 0.25 + (this.level - 1) * 0.5;
    const capped = Math.min(raw, maxTicksPerSecond) * speedFactor;
    return capped * this.slowFactor;
  }

  /** Множитель скорости от «замедления»: от 1 до SLOW_FACTOR, меняется плавно. */
  get slowFactor() {
    return 1 - (1 - SLOW_FACTOR) * smoothstep(this.slowDepth);
  }

  /** Сколько осталось у статуса, который кончится раньше всех (мс), или null — статусов нет. */
  get effectEndingIn() {
    const left = Object.values(this.effects).filter((ms) => ms > 0);
    return left.length ? Math.min(...left) : null;
  }

  get stepIntervalMs() {
    return 1000 / this.ticksPerSecond;
  }

  /** Доля пути до следующего шага: нужна для плавной анимации. */
  get stepProgress() {
    return Math.min(this.accumulatorMs / this.stepIntervalMs, 1);
  }

  /**
   * Ставит поворот в очередь. Очередь из нескольких ходов (MAX_QUEUED_TURNS) позволяет
   * быстро нажать «вверх, влево, вниз» и не потерять повороты.
   */
  turn(dir) {
    const last = this.turnQueue.at(-1) ?? this.direction;
    if (sameCell(dir, last) || isOpposite(dir, last)) return false;
    if (this.turnQueue.length >= MAX_QUEUED_TURNS) return false;
    this.turnQueue.push(dir);
    return true;
  }

  /**
   * Продвигает время. Возвращает события, произошедшие за этот интервал.
   * @param {number} dtMs прошедшее время в миллисекундах
   */
  update(dtMs) {
    if (this.over) return [];
    const events = [];
    this.elapsedMs += dtMs;
    this.tickTimers(dtMs, events);
    if (this.over) return events;

    this.accumulatorMs += dtMs;
    // Ограничение не даёт змейке «телепортироваться» после зависания вкладки.
    for (let i = 0; i < 3 && this.accumulatorMs >= this.stepIntervalMs && !this.over; i += 1) {
      this.accumulatorMs -= this.stepIntervalMs;
      events.push(...this.step());
    }
    if (this.accumulatorMs >= this.stepIntervalMs) this.accumulatorMs = 0;
    return events;
  }

  tickTimers(dtMs, events) {
    for (const key of Object.keys(this.effects)) {
      if (this.effects[key] > 0) {
        this.effects[key] = Math.max(0, this.effects[key] - dtMs);
        if (this.effects[key] === 0) events.push({ type: 'effectEnd', effect: key });
      }
    }
    // Глубина замедления: к концу статуса следует за оставшимся временем (последняя секунда —
    // разгон до обычной скорости), а при входе растёт не быстрее, чем за SLOW_EASE_IN_MS.
    const target = Math.min(1, this.effects.slow / SLOW_EASE_OUT_MS);
    this.slowDepth = target > this.slowDepth ? Math.min(target, this.slowDepth + dtMs / SLOW_EASE_IN_MS) : target;
    this.items = this.items.filter((item) => {
      if (item.ttl == null) return true;
      item.ttl -= dtMs;
      return item.ttl > 0;
    });
    if (this.timeLeftMs != null) {
      this.timeLeftMs = Math.max(0, this.timeLeftMs - dtMs);
      if (this.timeLeftMs === 0) this.finish('time', events);
    }
  }

  /** Один шаг змейки на клетку. */
  step() {
    const events = [];
    if (this.turnQueue.length) this.direction = this.turnQueue.shift();
    this.prevSnake = this.snake.map((c) => ({ ...c }));

    const next = this.nextHead();
    if (next === null) {
      this.finish('wall', events);
      return events;
    }
    if (this.obstacles.some((o) => sameCell(o, next))) {
      this.finish('stone', events);
      return events;
    }

    // Хвост освободит клетку на этом же шаге, если змейка не растёт.
    const body = this.growth > 0 ? this.snake : this.snake.slice(0, -1);
    if (this.effects.ghost === 0 && body.some((c) => sameCell(c, next))) {
      this.finish('self', events);
      return events;
    }

    this.snake.unshift(next);
    if (this.growth > 0) this.growth -= 1;
    else this.snake.pop();
    events.push({ type: 'move' });

    const item = this.items.find((i) => sameCell(i, next));
    if (item) this.consume(item, events);
    return events;
  }

  /** Следующая клетка головы или null, если в режиме «стены» вышли за поле. */
  nextHead() {
    const { width, height, mode } = this.opts;
    let x = this.head.x + this.direction.x;
    let y = this.head.y + this.direction.y;
    const outside = x < 0 || y < 0 || x >= width || y >= height;
    if (outside && mode === MODES.WALLS) return null;
    x = (x + width) % width;
    y = (y + height) % height;
    return { x, y };
  }

  consume(item, events) {
    this.items = this.items.filter((i) => i !== item);
    this.score = Math.max(0, this.score + SCORE[item.kind]);
    events.push({ type: 'eat', kind: item.kind, x: item.x, y: item.y });

    switch (item.kind) {
      case ITEM.APPLE:
        this.growth += 1;
        this.applesEaten += 1;
        this.spawnItem(ITEM.APPLE);
        this.maybeLevelUp(events);
        this.maybeSpawnExtras();
        break;
      case ITEM.BAD:
        if (this.snake.length <= 1) {
          this.finish('poison', events);
        } else {
          this.snake.pop();
          this.prevSnake.pop();
        }
        break;
      case ITEM.SLOW:
        this.effects.slow = this.opts.bonusDurationMs;
        break;
      case ITEM.GHOST:
        this.effects.ghost = this.opts.bonusDurationMs;
        break;
      default:
        break;
    }
  }

  maybeLevelUp(events) {
    const level = 1 + Math.floor(this.applesEaten / this.opts.applesPerLevel);
    if (level > this.level) {
      this.level = level;
      // На каждом новом уровне добавляются камни, но не больше 12.
      const stones = Math.min(2, 12 - this.obstacles.length);
      for (let i = 0; i < stones; i += 1) {
        const cell = this.freeCell({ awayFromHead: 4 });
        if (cell) this.obstacles.push(cell);
      }
      events.push({ type: 'levelUp', level });
    }
  }

  maybeSpawnExtras() {
    const has = (kind) => this.items.some((i) => i.kind === kind);
    if (!has(ITEM.BAD) && this.rng() < 0.3) {
      this.spawnItem(ITEM.BAD, this.opts.badFoodLifetimeMs);
    }
    if (!has(ITEM.SLOW) && !has(ITEM.GHOST) && this.rng() < 0.18) {
      this.spawnItem(this.rng() < 0.5 ? ITEM.SLOW : ITEM.GHOST, this.opts.bonusLifetimeMs);
    }
  }

  spawnItem(kind, ttl = null) {
    const cell = this.freeCell({ awayFromHead: kind === ITEM.APPLE ? 0 : 3 });
    if (!cell) return null;
    const item = { kind, x: cell.x, y: cell.y, ttl };
    this.items.push(item);
    return item;
  }

  /** Случайная клетка, не занятая змейкой, камнями и предметами. */
  freeCell({ awayFromHead = 0 } = {}) {
    const { width, height } = this.opts;
    const busy = new Set([...this.snake, ...this.obstacles, ...this.items].map(cellKey));
    const free = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const far = Math.abs(x - this.head.x) + Math.abs(y - this.head.y) >= awayFromHead;
        if (far && !busy.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    if (!free.length) return null;
    return free[Math.floor(this.rng() * free.length)];
  }

  /** Данные для отрисовки: общий формат для одиночной игры, дуэли и сетевого гостя. */
  get snakes() {
    return [{
      body: this.snake, prevBody: this.prevSnake, direction: this.direction,
      ghost: this.effects.ghost > 0, palette: 0, alive: !this.over, endingIn: this.effectEndingIn,
    }];
  }

  finish(reason, events) {
    this.over = true;
    this.overReason = reason;
    events.push({ type: 'gameOver', reason, score: this.score });
  }
}
