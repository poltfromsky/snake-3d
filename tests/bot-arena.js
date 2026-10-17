/**
 * Арена: бот против бота по настоящим правилам Duel. Используется в тестах
 * лестницы сложности и в скрипте замера (tools/bot-ladder.mjs).
 */
import { DIRECTIONS, MODES } from '../src/core/game.js';
import { Duel } from '../src/core/duel.js';
import { chooseMove, HungerTracker, stateFromDuel } from '../src/core/bot.js';

/** Детерминированный генератор случайных чисел (mulberry32). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Одна партия. Возвращает 0 или 1 — номер победителя, null — ничья.
 * Если за maxSteps никто не погиб, побеждает тот, кто длиннее (в «на время» — по очкам).
 */
export function playMatch(levels, seed, { mode = MODES.CLASSIC, maxSteps = 600, options = [{}, {}] } = {}) {
  const duel = new Duel({ mode, width: 26, height: 16 }, seeded(seed));
  const rngs = [seeded(seed * 7 + 1), seeded(seed * 13 + 2)];
  const hunger = new HungerTracker();
  for (let step = 0; step < maxSteps && !duel.over; step += 1) {
    const state = stateFromDuel(duel, hunger.update(duel));
    for (let i = 0; i < 2; i += 1) {
      const move = chooseMove(state, i, levels[i], rngs[i], options[i]);
      duel.turn(i, DIRECTIONS[move]);
    }
    duel.step();
  }
  if (duel.over) return duel.winner;
  const [a, b] = duel.players.map((p) => (mode === MODES.TIMED ? p.score : p.body.length));
  if (a === b) return null;
  return a > b ? 0 : 1;
}

/** Серия партий со сменой сторон. Возвращает {wins, losses, draws} для levels[0]. */
export function series(strong, weak, games, opts = {}) {
  const result = { wins: 0, losses: 0, draws: 0 };
  for (let g = 0; g < games; g += 1) {
    const strongFirst = g % 2 === 0;
    const levels = strongFirst ? [strong, weak] : [weak, strong];
    const options = strongFirst ? [opts.strongOptions ?? {}, {}] : [{}, opts.strongOptions ?? {}];
    const winner = playMatch(levels, 1000 + g, { ...opts, options });
    const strongIndex = strongFirst ? 0 : 1;
    if (winner === null) result.draws += 1;
    else if (winner === strongIndex) result.wins += 1;
    else result.losses += 1;
  }
  return result;
}
