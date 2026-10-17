/**
 * Бот как участник дуэли: после каждого шага змеек просит поток бота
 * придумать следующий ход и применяет его, если ответ пришёл вовремя.
 * Бот «думает», пока змейки едут, — как человек, который видит поле и реагирует.
 */
import { DIRECTIONS } from './core/game.js';
import { chooseMove, HungerTracker, stateFromDuel } from './core/bot.js';

const MAX_BUDGET_MS = 35;
const MIN_BUDGET_MS = 6;

export class BotPlayer {
  /**
   * @param {string} levelId easy | medium | hard | claude
   * @param {number} index номер змейки бота в дуэли
   */
  constructor(levelId, index) {
    this.levelId = levelId;
    this.index = index;
    this.hunger = new HungerTracker();
    this.askedStep = -1;
    this.duel = null;
    this.worker = null;
    try {
      this.worker = new Worker(new URL('./bot.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => this.apply(data.id, data.move);
      // Поток не поднялся (старый браузер, блокировка) — бот думает в основном потоке.
      this.worker.onerror = () => { this.worker = null; };
    } catch {
      this.worker = null;
    }
  }

  /** Вызывается каждый кадр. Просит ход один раз на каждый шаг змеек. */
  update(duel) {
    this.duel = duel;
    if (duel.over || duel.stepCount === this.askedStep) return;
    this.askedStep = duel.stepCount;
    const state = stateFromDuel(duel, this.hunger.update(duel));
    // Думать можно не дольше доли интервала между шагами, чтобы ход успел до следующего.
    const options = { timeBudgetMs: Math.max(MIN_BUDGET_MS, Math.min(MAX_BUDGET_MS, duel.stepIntervalMs * 0.4)) };
    if (this.worker) {
      this.worker.postMessage({ id: duel.stepCount, state, me: this.index, level: this.levelId, options });
    } else {
      this.apply(duel.stepCount, chooseMove(state, this.index, this.levelId, Math.random, {
        ...options, timeBudgetMs: Math.min(options.timeBudgetMs, 12),
      }));
    }
  }

  /** Ход применяется, только если он про текущий шаг: опоздавший ответ бот «проспал». */
  apply(id, move) {
    const duel = this.duel;
    if (!duel || duel.over || id !== duel.stepCount || !DIRECTIONS[move]) return;
    duel.turn(this.index, DIRECTIONS[move]);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}
