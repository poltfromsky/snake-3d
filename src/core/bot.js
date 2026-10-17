/**
 * Боты для дуэли «игрок против компьютера».
 *
 * Один движок, четыре уровня силы. Сильные уровни устроены как боты из
 * турниров Battlesnake:
 *   - просчёт ходов ОБЕИХ змеек на несколько шагов вперёд (минимакс с отсечением,
 *     «параноидальный»: считаем, что соперник ответит худшим для нас ходом);
 *   - оценка позиции: чья территория больше (клетки, до которых я дойду раньше
 *     соперника), не загнал ли я себя в тупик (хватит ли места на всё тело),
 *     длина, близость еды, очки в режиме «на время».
 * Слабые уровни намеренно упрощены и ошибаются — так задаётся лестница сложности.
 *
 * Модуль не знает про браузер: его используют и игра (в отдельном потоке), и тесты.
 * Правила симуляции повторяют Duel.step(): ходы одновременные, «лоб в лоб» убивает
 * обоих, хвост освобождает клетку на том же шаге, если змейка не растёт.
 */
import { MODES } from './game.js';

export const DIR_NAMES = Object.freeze(['UP', 'DOWN', 'LEFT', 'RIGHT']);
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const OPPOSITE = [1, 0, 3, 2];

const WIN = 1e6;
// Ничья «лоб в лоб» по умолчанию почти как смерть. Сильные уровни задают свою оценку
// (drawValue): соперник — не самоубийца, и слишком сильный страх лобового столкновения
// заставляет змеек бесконечно кружить друг вокруг друга вместо игры.
const DRAW = -1e5;

/** Уровни ботов. Имена и порядок используются в меню и достижениях. */
export const BOT_LEVELS = Object.freeze({
  easy: Object.freeze({
    id: 'easy', name: 'Ужик', strategy: 'greedy',
    // Подобрано замером (tools/bot-ladder.mjs и тесты): доживает примерно до 2 уровня
    // и погибает сам — обычный игрок обыгрывает его быстро.
    mistake: 0.02, // доля случайных ходов
    lookChance: 0.9, // как часто вообще смотрит, не врежется ли следующим ходом
  }),
  medium: Object.freeze({
    id: 'medium', name: 'Гадюка', strategy: 'search',
    depth: 1, mistake: 0.01,
    weights: { territory: 0, length: 1500, food: 30, trap: 2000, score: 100 },
  }),
  hard: Object.freeze({
    id: 'hard', name: 'Анаконда', strategy: 'search',
    depth: 2, mistake: 0,
    weights: { territory: 4, length: 1500, food: 30, trap: 3000, score: 150 },
  }),
  claude: Object.freeze({
    id: 'claude', name: 'Claude', strategy: 'search',
    depth: 4, timeBudgetMs: 35, mistake: 0,
    weights: { territory: 2, length: 1500, food: 30, trap: 4000, score: 150 },
  }),
});

export const BOT_ORDER = Object.freeze(['easy', 'medium', 'hard', 'claude']);

const now = () => (globalThis.performance?.now?.() ?? Date.now());

/* ---------------- Состояние для симуляции ---------------- */

const dirIndex = (d) => {
  for (let i = 0; i < 4; i += 1) if (DX[i] === d.x && DY[i] === d.y) return i;
  return 3;
};

/**
 * Компактный слепок дуэли: клетки — числа y * w + x.
 * Это простой объект — его можно передать в Web Worker.
 */
export function stateFromDuel(duel, hunger = [0, 0]) {
  const { width: w, height: h, mode } = duel.opts;
  const idx = (c) => c.y * w + c.x;
  return {
    w,
    h,
    wrap: mode !== MODES.WALLS,
    timed: mode === MODES.TIMED,
    blocked: duel.obstacles.map(idx),
    snakes: duel.players.map((p) => ({
      body: p.body.map(idx),
      // Если поворот уже в очереди, змейка поедет туда — от него и считаем.
      dir: dirIndex(p.turnQueue.at(-1) ?? p.direction),
      growth: p.growth,
      score: p.score,
      hunger: hunger[duel.players.indexOf(p)] ?? 0,
    })),
    apples: duel.items.filter((i) => i.kind === 'apple').map(idx),
    bad: duel.items.filter((i) => i.kind === 'bad').map(idx),
  };
}

function neighbor(s, cell, d) {
  let x = (cell % s.w) + DX[d];
  let y = Math.floor(cell / s.w) + DY[d];
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) {
    if (!s.wrap) return -1;
    x = (x + s.w) % s.w;
    y = (y + s.h) % s.h;
  }
  return y * s.w + x;
}

/** Ходы без разворота назад (разворот игра всё равно не примет). */
function candidateMoves(snake) {
  const out = [];
  for (let d = 0; d < 4; d += 1) if (d !== OPPOSITE[snake.dir]) out.push(d);
  return out;
}

/**
 * Один одновременный шаг обеих змеек по правилам Duel.
 * Возвращает {dead:[bool,bool]} при чьей-то гибели или {state} — новое состояние.
 */
export function simulateStep(s, moves) {
  const heads = [0, 1].map((i) => neighbor(s, s.snakes[i].body[0], moves[i]));
  const after = s.snakes.map((sn) => (sn.growth > 0 ? sn.body : sn.body.slice(0, -1)));
  const dead = [false, false];
  for (let i = 0; i < 2; i += 1) {
    const hd = heads[i];
    if (hd < 0 || s.blocked.includes(hd) || after[i].includes(hd) || after[1 - i].includes(hd)) dead[i] = true;
  }
  if (heads[0] >= 0 && heads[1] >= 0) {
    const sameCell = heads[0] === heads[1];
    const swap = heads[0] === s.snakes[1].body[0] && heads[1] === s.snakes[0].body[0];
    if (sameCell || swap) { dead[0] = true; dead[1] = true; }
  }
  if (dead[0] || dead[1]) return { dead };

  let apples = s.apples;
  let bad = s.bad;
  const snakes = s.snakes.map((sn, i) => {
    const hd = heads[i];
    const body = [hd, ...after[i]];
    let growth = sn.growth > 0 ? sn.growth - 1 : 0;
    let score = sn.score;
    let hunger = (sn.hunger ?? 0) + 1;
    if (apples.includes(hd)) {
      growth += 1;
      score += 10;
      hunger = 0;
      apples = apples.filter((c) => c !== hd);
    } else if (bad.includes(hd)) {
      if (body.length > 1) body.pop();
      score = Math.max(0, score - 5);
      bad = bad.filter((c) => c !== hd);
    }
    return { body, dir: moves[i], growth, score, hunger };
  });
  return { state: { ...s, snakes, apples, bad } };
}

/* ---------------- Оценка позиции ---------------- */

/**
 * Две волны поиска в ширину от голов: кто до какой клетки доберётся раньше
 * (территория), сколько места доступно каждому и как далеко до еды.
 */
function analyse(s) {
  const n = s.w * s.h;
  const wall = new Uint8Array(n);
  for (const c of s.blocked) wall[c] = 1;
  for (const sn of s.snakes) {
    // Хвост к следующему шагу уйдёт (если змейка не растёт) — его клетку считаем свободной.
    const len = sn.growth > 0 ? sn.body.length : sn.body.length - 1;
    for (let k = 1; k < len; k += 1) wall[sn.body[k]] = 1;
  }
  const dist = [new Int16Array(n).fill(-1), new Int16Array(n).fill(-1)];
  const reach = [0, 0];
  const food = [-1, -1];
  const isApple = new Uint8Array(n);
  for (const c of s.apples) isApple[c] = 1;
  const queue = new Int32Array(n);
  for (let i = 0; i < 2; i += 1) {
    const d = dist[i];
    let head = 0;
    let tail = 0;
    const start = s.snakes[i].body[0];
    d[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      for (let dir = 0; dir < 4; dir += 1) {
        const nb = neighbor(s, c, dir);
        if (nb < 0 || wall[nb] || d[nb] !== -1) continue;
        d[nb] = d[c] + 1;
        queue[tail++] = nb;
        reach[i] += 1;
        if (isApple[nb] && food[i] === -1) food[i] = d[nb];
      }
    }
  }
  let territory = 0; // >0 — у змейки 0 больше «своих» клеток
  for (let c = 0; c < n; c += 1) {
    const a = dist[0][c];
    const b = dist[1][c];
    if (a > 0 && (b < 0 || a < b)) territory += 1;
    else if (b > 0 && (a < 0 || b < a)) territory -= 1;
  }
  return { territory, reach, food };
}

function evaluate(s, me, w) {
  const opp = 1 - me;
  const { territory, reach, food } = analyse(s);
  const lenMe = s.snakes[me].body.length + s.snakes[me].growth;
  const lenOpp = s.snakes[opp].body.length + s.snakes[opp].growth;
  let v = 0;
  v += w.territory * (me === 0 ? territory : -territory);
  v += w.length * (lenMe - lenOpp);
  // Тупик: места меньше, чем длина тела, — скоро смерть.
  if (reach[me] < lenMe) v -= w.trap * (lenMe - reach[me]);
  if (reach[opp] < lenOpp) v += (w.trap / 2) * (lenOpp - reach[opp]);
  // Тяга к еде должна быть сильнее борьбы за территорию (иначе в режиме «Стены» боты
  // кружат в центре и не едят), а вес длины — больше food × 42 (самое дальнее яблоко),
  // иначе после еды «далеко до новой еды» перевесит рост — и бот начнёт бояться есть.
  // «Голод» (как здоровье в Battlesnake, но только в голове бота): чем дольше не ел,
  // тем сильнее тянет к еде — иначе два осторожных бота бесконечно делят центр поля.
  const hungerBoost = 1 + Math.min(s.snakes[me].hunger ?? 0, 75) / 25;
  if (food[me] >= 0) v -= w.food * hungerBoost * food[me];
  if (s.timed) v += w.score * (s.snakes[me].score - s.snakes[opp].score);
  // Режим «Стены»: у края поля меньше путей отхода — сильные боты Battlesnake штрафуют
  // себя за езду вдоль стены.
  if (!s.wrap && w.edge) {
    const head = s.snakes[me].body[0];
    const x = head % s.w;
    const y = Math.floor(head / s.w);
    if (x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1) v -= w.edge;
  }
  return v;
}

function terminalValue(dead, me, ply, drawValue = DRAW) {
  const opp = 1 - me;
  if (dead[me] && dead[opp]) return drawValue;
  // Чем позже смерть и чем раньше победа — тем лучше.
  if (dead[me]) return -WIN + ply * 1000;
  return WIN - ply * 1000;
}

/* ---------------- Поиск ---------------- */

class Timeout extends Error {}

/**
 * Параноидальный минимакс по одновременным ходам: я выбираю ход,
 * соперник — худший для меня ответ. Возвращает {value, move}.
 */
function search(s, me, depth, alpha, beta, w, ply, ctx, preferred) {
  const drawValue = ctx.drawValue;
  ctx.nodes += 1;
  if (ctx.deadline && (ctx.nodes & 255) === 0 && now() > ctx.deadline) throw new Timeout();
  const opp = 1 - me;
  const myMoves = candidateMoves(s.snakes[me]);
  if (preferred != null && myMoves.includes(preferred)) {
    myMoves.splice(myMoves.indexOf(preferred), 1);
    myMoves.unshift(preferred);
  }
  const oppMoves = candidateMoves(s.snakes[opp]);
  let best = -Infinity;
  let bestMove = myMoves[0];
  for (const m of myMoves) {
    let worst = Infinity;
    for (const o of oppMoves) {
      const moves = me === 0 ? [m, o] : [o, m];
      const r = simulateStep(s, moves);
      let v;
      if (r.dead) v = terminalValue(r.dead, me, ply, drawValue);
      else if (depth <= 1) v = evaluate(r.state, me, w);
      else v = search(r.state, me, depth - 1, Math.max(alpha, best), worst, w, ply + 1, ctx, null).value;
      if (v < worst) worst = v;
      // Этот мой ход уже не лучше найденного — дальше ответы соперника не смотрим.
      if (worst <= best || worst <= alpha) break;
    }
    if (worst > best) {
      best = worst;
      bestMove = m;
    }
    if (best >= beta) break;
  }
  return { value: best, move: bestMove };
}

/** Простой ход «к ближайшему яблоку» для лёгкого бота. */
function greedyMove(s, me, level, rng) {
  const sn = s.snakes[me];
  let moves = candidateMoves(sn);
  if (rng() < level.lookChance) {
    // Смотрит только на один шаг и не думает о сопернике.
    const occupied = new Set([...s.blocked, ...s.snakes[0].body, ...s.snakes[1].body]);
    const safe = moves.filter((d) => {
      const nb = neighbor(s, sn.body[0], d);
      return nb >= 0 && !occupied.has(nb);
    });
    if (safe.length) moves = safe;
  }
  const head = sn.body[0];
  const hx = head % s.w;
  const hy = Math.floor(head / s.w);
  const target = s.apples.reduce((bestCell, c) => {
    const dist = Math.abs((c % s.w) - hx) + Math.abs(Math.floor(c / s.w) - hy);
    return !bestCell || dist < bestCell.dist ? { c, dist } : bestCell;
  }, null);
  if (!target) return moves[0];
  const tx = target.c % s.w;
  const ty = Math.floor(target.c / s.w);
  let best = moves[0];
  let bestDist = Infinity;
  for (const d of moves) {
    const nb = neighbor(s, head, d);
    if (nb < 0) continue;
    const dist = Math.abs((nb % s.w) - tx) + Math.abs(Math.floor(nb / s.w) - ty);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

/**
 * Главная функция: какой ход сделать боту `me` в состоянии `s`.
 * @param {object} options переопределение уровня для тестов: {depth, timeBudgetMs}
 * @returns {string} 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
 */
export function chooseMove(s, me, levelId, rng = Math.random, options = {}) {
  const level = { ...BOT_LEVELS[levelId], ...options };
  const moves = candidateMoves(s.snakes[me]);
  if (level.mistake && rng() < level.mistake) {
    return DIR_NAMES[moves[Math.floor(rng() * moves.length)]];
  }
  if (level.strategy === 'greedy') return DIR_NAMES[greedyMove(s, me, level, rng)];

  if (!level.timeBudgetMs) {
    const ctx = { nodes: 0, drawValue: level.drawValue ?? DRAW };
    return DIR_NAMES[search(s, me, level.depth, -Infinity, Infinity, level.weights, 0, ctx, null).move];
  }
  // Итеративное углубление: считаем на 1, 2, 3… шага, пока хватает времени.
  const ctx = { nodes: 0, deadline: now() + level.timeBudgetMs, drawValue: level.drawValue ?? DRAW };
  let move = null;
  for (let depth = 1; depth <= level.depth; depth += 1) {
    try {
      move = search(s, me, depth, -Infinity, Infinity, level.weights, 0, ctx, move).move;
    } catch (err) {
      if (err instanceof Timeout) break;
      throw err;
    }
  }
  return DIR_NAMES[move ?? moves[0]];
}

/**
 * Считает «голод» змеек между ходами: сколько шагов прошло с последнего яблока.
 * Хранится снаружи бота (в игре — в потоке бота, в тестах — в арене).
 */
export class HungerTracker {
  constructor() {
    this.lengths = [null, null];
    this.hunger = [0, 0];
  }

  update(duel) {
    duel.players.forEach((p, i) => {
      const len = p.body.length + p.growth;
      this.hunger[i] = this.lengths[i] != null && len > this.lengths[i] ? 0 : this.hunger[i] + 1;
      this.lengths[i] = len;
    });
    return this.hunger;
  }
}
