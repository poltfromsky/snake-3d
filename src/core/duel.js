/**
 * Дуэль: две змейки на одном поле.
 *
 * Как и Game, класс не знает про отрисовку и сеть. В онлайне его запускает
 * только хозяин комнаты, а гость получает готовые снимки состояния.
 */
import { DEFAULTS, DIRECTIONS, ITEM, MODES, sameCell } from './game.js';

const SCORE = { [ITEM.APPLE]: 10, [ITEM.BAD]: -5 };

const isOpposite = (a, b) => a.x === -b.x && a.y === -b.y;

export class Duel {
  constructor(options = {}, rng = Math.random) {
    this.opts = { ...DEFAULTS, ...options };
    this.rng = rng;
    this.reset();
  }

  reset() {
    const { width, height, mode } = this.opts;
    // Разные ряды: иначе змейки, идущие навстречу, сразу сталкиваются лбами.
    const top = Math.floor(height / 3);
    const bottom = height - 1 - top;
    const left = Math.floor(width / 4);
    const right = width - 1 - left;
    this.players = [
      this.createPlayer(
        [{ x: left, y: top }, { x: left - 1, y: top }, { x: left - 2, y: top }], DIRECTIONS.RIGHT,
      ),
      this.createPlayer(
        [{ x: right, y: bottom }, { x: right + 1, y: bottom }, { x: right + 2, y: bottom }], DIRECTIONS.LEFT,
      ),
    ];
    this.items = [];
    this.obstacles = [];
    this.applesEaten = 0;
    this.level = 1;
    this.accumulatorMs = 0;
    this.stepCount = 0; // по нему хозяин понимает, что пора слать снимок
    this.timeLeftMs = mode === MODES.TIMED ? this.opts.timedDurationMs : null;
    this.over = false;
    this.winner = null; // 0, 1 или null — ничья
    this.overReason = null;
    this.spawnItem(ITEM.APPLE);
    this.spawnItem(ITEM.APPLE);
  }

  createPlayer(body, direction) {
    return {
      body,
      prevBody: body.map((c) => ({ ...c })),
      direction,
      turnQueue: [],
      growth: 0,
      score: 0,
      alive: true,
      deathReason: null,
    };
  }

  get ticksPerSecond() {
    const { baseTicksPerSecond, maxTicksPerSecond, speedFactor } = this.opts;
    const longest = Math.max(...this.players.map((p) => p.body.length));
    const raw = baseTicksPerSecond + (longest - 3) * 0.2 + (this.level - 1) * 0.5;
    return Math.min(raw, maxTicksPerSecond) * speedFactor;
  }

  get stepIntervalMs() {
    return 1000 / this.ticksPerSecond;
  }

  get stepProgress() {
    return Math.min(this.accumulatorMs / this.stepIntervalMs, 1);
  }

  turn(index, dir) {
    const p = this.players[index];
    if (!p || !p.alive) return false;
    const last = p.turnQueue.at(-1) ?? p.direction;
    if (sameCell(dir, last) || isOpposite(dir, last) || p.turnQueue.length >= 2) return false;
    p.turnQueue.push(dir);
    return true;
  }

  update(dtMs) {
    if (this.over) return [];
    const events = [];
    if (this.timeLeftMs != null) {
      this.timeLeftMs = Math.max(0, this.timeLeftMs - dtMs);
      if (this.timeLeftMs === 0) {
        this.finishByScore('time', events);
        return events;
      }
    }
    this.items = this.items.filter((item) => {
      if (item.ttl == null) return true;
      item.ttl -= dtMs;
      return item.ttl > 0;
    });

    this.accumulatorMs += dtMs;
    for (let i = 0; i < 3 && this.accumulatorMs >= this.stepIntervalMs && !this.over; i += 1) {
      this.accumulatorMs -= this.stepIntervalMs;
      events.push(...this.step());
    }
    if (this.accumulatorMs >= this.stepIntervalMs) this.accumulatorMs = 0;
    return events;
  }

  nextHead(p) {
    const { width, height, mode } = this.opts;
    let x = p.body[0].x + p.direction.x;
    let y = p.body[0].y + p.direction.y;
    if ((x < 0 || y < 0 || x >= width || y >= height) && mode === MODES.WALLS) return null;
    x = (x + width) % width;
    y = (y + height) % height;
    return { x, y };
  }

  /** Обе змейки ходят одновременно, поэтому сначала считаем все новые головы. */
  step() {
    const events = [];
    this.stepCount += 1;
    const [a, b] = this.players;
    for (const p of this.players) {
      if (p.turnQueue.length) p.direction = p.turnQueue.shift();
      p.prevBody = p.body.map((c) => ({ ...c }));
    }
    const heads = this.players.map((p) => this.nextHead(p));
    // Тела, которые будут занимать поле после шага (хвост уходит, если змейка не растёт).
    const bodies = this.players.map((p) => (p.growth > 0 ? p.body : p.body.slice(0, -1)));

    const reasons = heads.map((head, i) => {
      if (head === null) return 'wall';
      if (this.obstacles.some((o) => sameCell(o, head))) return 'stone';
      if (bodies[i].some((c) => sameCell(c, head))) return 'self';
      if (bodies[1 - i].some((c) => sameCell(c, head))) return 'rival';
      return null;
    });
    // Лоб в лоб: обе головы в одну клетку или змейки поменялись местами.
    if (heads[0] && heads[1]) {
      const sameCellHit = sameCell(heads[0], heads[1]);
      const swap = sameCell(heads[0], b.body[0]) && sameCell(heads[1], a.body[0]);
      if (sameCellHit || swap) {
        reasons[0] = reasons[0] ?? 'headOn';
        reasons[1] = reasons[1] ?? 'headOn';
      }
    }

    if (reasons.some(Boolean)) {
      reasons.forEach((reason, i) => {
        if (reason) {
          this.players[i].alive = false;
          this.players[i].deathReason = reason;
        }
      });
      const alive = this.players.map((p) => p.alive);
      const winner = alive[0] && !alive[1] ? 0 : alive[1] && !alive[0] ? 1 : null;
      this.finish(winner, reasons.find(Boolean), events);
      return events;
    }

    this.players.forEach((p, i) => {
      p.body.unshift(heads[i]);
      if (p.growth > 0) p.growth -= 1;
      else p.body.pop();
      const item = this.items.find((it) => sameCell(it, heads[i]));
      if (item) this.consume(i, item, events);
    });
    return events;
  }

  consume(index, item, events) {
    const p = this.players[index];
    this.items = this.items.filter((i) => i !== item);
    p.score = Math.max(0, p.score + SCORE[item.kind]);
    events.push({ type: 'eat', player: index, kind: item.kind, x: item.x, y: item.y });
    if (item.kind === ITEM.APPLE) {
      p.growth += 1;
      this.applesEaten += 1;
      this.spawnItem(ITEM.APPLE);
      const level = 1 + Math.floor(this.applesEaten / (this.opts.applesPerLevel * 2));
      if (level > this.level) {
        this.level = level;
        for (let i = 0; i < 2 && this.obstacles.length < 12; i += 1) {
          const cell = this.freeCell(4);
          if (cell) this.obstacles.push(cell);
        }
        events.push({ type: 'levelUp', level });
      }
      if (!this.items.some((i) => i.kind === ITEM.BAD) && this.rng() < 0.3) {
        this.spawnItem(ITEM.BAD, this.opts.badFoodLifetimeMs);
      }
    } else if (item.kind === ITEM.BAD && p.body.length > 1) {
      p.body.pop();
      p.prevBody.pop();
    }
  }

  spawnItem(kind, ttl = null) {
    const cell = this.freeCell(kind === ITEM.APPLE ? 0 : 3);
    if (cell) this.items.push({ kind, x: cell.x, y: cell.y, ttl });
  }

  freeCell(awayFromHeads = 0) {
    const { width, height } = this.opts;
    const busy = new Set(
      [...this.players.flatMap((p) => p.body), ...this.obstacles, ...this.items]
        .map((c) => `${c.x},${c.y}`),
    );
    const heads = this.players.map((p) => p.body[0]);
    const free = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const far = heads.every((h) => Math.abs(x - h.x) + Math.abs(y - h.y) >= awayFromHeads);
        if (far && !busy.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    return free.length ? free[Math.floor(this.rng() * free.length)] : null;
  }

  finishByScore(reason, events) {
    const [s0, s1] = this.players.map((p) => p.score);
    this.finish(s0 === s1 ? null : s0 > s1 ? 0 : 1, reason, events);
  }

  finish(winner, reason, events) {
    this.over = true;
    this.winner = winner;
    this.overReason = reason;
    events.push({ type: 'gameOver', winner, reason });
  }

  /** Данные для отрисовки — тот же формат, что у Game и у сетевого гостя. */
  get snakes() {
    return this.players.map((p, i) => ({
      body: p.body, prevBody: p.prevBody, direction: p.direction,
      ghost: false, palette: i, alive: p.alive,
    }));
  }

  /** Компактный снимок состояния для отправки гостю. */
  snapshot() {
    return {
      w: this.opts.width,
      h: this.opts.height,
      mode: this.opts.mode,
      players: this.players.map((p) => ({
        body: p.body, prev: p.prevBody, dir: p.direction, score: p.score, alive: p.alive,
      })),
      items: this.items.map(({ kind, x, y, ttl }) => ({ kind, x, y, ttl })),
      obstacles: this.obstacles,
      progress: this.stepProgress,
      interval: this.stepIntervalMs,
      level: this.level,
      timeLeft: this.timeLeftMs,
      over: this.over,
      winner: this.winner,
      reason: this.overReason,
    };
  }
}
