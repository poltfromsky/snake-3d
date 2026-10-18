/**
 * Проверка правдоподобия результата одиночной партии для общей таблицы.
 *
 * Сервер знает время начала партии (билет выдаётся при старте) и не верит счёту
 * на слово: за N очков нужно съесть не меньше N/15 яблок (яблоко +10, бонус +5,
 * а бонус появляется только после яблока), а на каждое яблоко нужны шаги змейки,
 * скорость которых ограничена правилами игры. Отсюда — минимально возможное время.
 *
 * Оценка заведомо мягкая к игроку: считаем самую быструю настройку, самые
 * выгодные бонусы и всего 1 шаг на каждое из первых яблок и STEPS_PER_APPLE на
 * остальные (на деле яблоко появляется в случайной клетке и до него в среднем
 * 10+ шагов). Тест tests/fair-play.test.js гоняет «идеального» робота на
 * максимальной скорости и проверяет, что его результаты проходят с запасом.
 */
import { DEFAULTS } from './game.js';

/** Самая быстрая настройка скорости в игре («Быстро»). */
export const FASTEST_SPEED_FACTOR = 1.35;
/** Очков за одно яблоко в лучшем случае: само яблоко + бонус, появившийся после него. */
const MAX_POINTS_PER_APPLE = 15;
/** Первые яблоки могут лежать прямо перед змейкой — для них считаем по одному шагу. */
const LUCKY_APPLES = 5;
/** Дальше — не меньше стольких шагов на яблоко в среднем (реально ~10). */
export const STEPS_PER_APPLE = 3;
/** Запас на неточность часов и сети. */
const SLACK = 0.85;
/** Билет партии действует столько — дольше одиночная партия не длится. */
export const RUN_TTL_MS = 3 * 60 * 60 * 1000;

/** Самая высокая скорость (шагов в секунду), возможная после k съеденных яблок. */
function maxTicksPerSecond(applesEaten) {
  const { baseTicksPerSecond, maxTicksPerSecond: cap, applesPerLevel } = DEFAULTS;
  const level = 1 + Math.floor(applesEaten / applesPerLevel);
  // Длина растёт не больше чем на 1 за яблоко; скорость: +0,25 за сегмент, +0,5 за уровень.
  const raw = baseTicksPerSecond + applesEaten * 0.25 + (level - 1) * 0.5;
  return Math.min(raw, cap) * FASTEST_SPEED_FACTOR;
}

/** Минимально возможная длительность партии (мс), за которую можно набрать score очков. */
export function minRunMs(score) {
  const apples = Math.ceil(Math.max(0, score) / MAX_POINTS_PER_APPLE);
  let ms = 0;
  for (let k = 0; k < apples; k += 1) {
    const steps = k < LUCKY_APPLES ? 1 : STEPS_PER_APPLE;
    ms += (steps * 1000) / maxTicksPerSecond(k);
  }
  return ms;
}

/**
 * Можно ли набрать score очков за elapsedMs.
 * @returns {{ok: true} | {ok: false, reason: 'too_fast' | 'expired'}}
 */
export function checkRun({ score, elapsedMs }) {
  if (!Number.isFinite(elapsedMs) || elapsedMs > RUN_TTL_MS) return { ok: false, reason: 'expired' };
  if (elapsedMs < minRunMs(score) * SLACK) return { ok: false, reason: 'too_fast' };
  return { ok: true };
}
