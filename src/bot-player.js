/**
 * Бот как участник дуэли: после каждого шага змеек решает, куда повернуть на следующем.
 *
 * Два уровня решения:
 *   1. Рефлекс — сразу, в основном потоке: поиск на 1 шаг вперёд (доли миллисекунды).
 *      Этот ход сразу ставится в очередь — бот повернёт, даже если глубокий расчёт не успеет.
 *   2. Расчёт уровня — в отдельном потоке (у Claude — до 4 шагов вперёд). Если ответ пришёл
 *      до следующего шага, он заменяет рефлекс; опоздавший ответ выбрасывается.
 * Раньше был только второй уровень: на телефоне, когда змейки разгонялись, ответ опаздывал
 * на каждом шаге — и бот переставал поворачивать вовсе (в «Классике» ехал прямо по кругу).
 * Время на расчёт подстраивается под то, сколько реально идёт ответ потока.
 */
import { DIRECTIONS } from './core/game.js';
import { chooseMove, HungerTracker, stateFromDuel } from './core/bot.js';

const MAX_BUDGET_MS = 35;
const MIN_BUDGET_MS = 4;
/** Запас до следующего шага: ответ должен успеть дойти и примениться. */
const SAFETY_MS = 8;
const RTT_SMOOTHING = 0.2;

export class BotPlayer {
  /**
   * @param {string} levelId easy | medium | hard | claude
   * @param {number} index номер змейки бота в дуэли
   * @param {{createWorker?: () => Worker | null, now?: () => number}} [deps] подмена для тестов
   */
  constructor(levelId, index, deps = {}) {
    this.levelId = levelId;
    this.index = index;
    this.hunger = new HungerTracker();
    this.askedStep = -1;
    this.sentAt = 0;
    this.overhead = 0; // сколько ответ потока идёт сверх самого расчёта (сглаженно), мс
    this.late = 0; // сколько ответов подряд опоздало
    this.duel = null;
    this.now = deps.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.worker = null;
    try {
      const create = deps.createWorker ?? (() => new Worker(new URL('./bot.worker.js', import.meta.url), { type: 'module' }));
      this.worker = create();
      if (this.worker) {
        this.worker.onmessage = ({ data }) => this.apply(data.id, data.move, data.spentMs);
        // Поток не поднялся (старый браузер, блокировка) — бот думает в основном потоке.
        this.worker.onerror = () => { this.worker = null; };
      }
    } catch {
      this.worker = null;
    }
  }

  /** Сколько можно думать в потоке, чтобы ответ успел до следующего шага. */
  budget(duel) {
    const window = duel.stepIntervalMs * 0.7 - this.overhead - SAFETY_MS;
    // Опаздываем — думаем короче, пока не начнём успевать.
    const shrink = this.late > 0 ? 0.5 ** Math.min(this.late, 3) : 1;
    return Math.max(MIN_BUDGET_MS, Math.min(MAX_BUDGET_MS, window * shrink));
  }

  /** Вызывается каждый кадр. Решает один раз на каждый шаг змеек. */
  update(duel) {
    this.duel = duel;
    if (duel.over || duel.stepCount === this.askedStep) return;
    this.askedStep = duel.stepCount;
    const state = stateFromDuel(duel, this.hunger.update(duel));
    // 1. Рефлекс: безопасный ход на шаг вперёд — сразу (без «ошибок» уровня: их делает расчёт).
    const reflex = chooseMove(state, this.index, this.levelId, Math.random, { depth: 1, timeBudgetMs: 0, mistake: 0 });
    duel.setTurn(this.index, DIRECTIONS[reflex]);
    // 2. Расчёт уровня.
    const options = { timeBudgetMs: this.budget(duel) };
    if (this.worker) {
      this.sentAt = this.now();
      this.worker.postMessage({ id: duel.stepCount, state, me: this.index, level: this.levelId, options });
    } else {
      this.apply(duel.stepCount, chooseMove(state, this.index, this.levelId, Math.random, {
        ...options, timeBudgetMs: Math.min(options.timeBudgetMs, 12),
      }));
    }
  }

  /** Ход применяется, только если он про текущий шаг: опоздавший ответ бот «проспал». */
  apply(id, move, spentMs) {
    const duel = this.duel;
    if (this.worker && id === this.askedStep && Number.isFinite(spentMs)) {
      const extra = Math.max(0, this.now() - this.sentAt - spentMs);
      this.overhead += (extra - this.overhead) * RTT_SMOOTHING;
    }
    if (!duel || duel.over || !DIRECTIONS[move]) return;
    if (id !== duel.stepCount) {
      this.late += 1;
      return;
    }
    this.late = 0;
    duel.setTurn(this.index, DIRECTIONS[move]);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}
