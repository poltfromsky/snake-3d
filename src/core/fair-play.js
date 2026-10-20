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

/** Множители скорости из настроек игры (Медленно / Нормально / Быстро). */
export const RUN_SPEED_FACTORS = Object.freeze({ slow: 0.75, normal: 1, fast: 1.35 });
/** Самая быстрая настройка скорости в игре («Быстро»). */
export const FASTEST_SPEED_FACTOR = RUN_SPEED_FACTORS.fast;
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
function maxTicksPerSecond(applesEaten, speedFactor) {
  const { baseTicksPerSecond, maxTicksPerSecond: cap, applesPerLevel } = DEFAULTS;
  const level = 1 + Math.floor(applesEaten / applesPerLevel);
  // Длина растёт не больше чем на 1 за яблоко; скорость: +0,25 за сегмент, +0,5 за уровень.
  const raw = baseTicksPerSecond + applesEaten * 0.25 + (level - 1) * 0.5;
  return Math.min(raw, cap) * speedFactor;
}

/**
 * Минимально возможная длительность партии (мс), за которую можно набрать score очков.
 * speedFactor — множитель скорости партии: на медленной скорости минимум больше.
 */
export function minRunMs(score, speedFactor = FASTEST_SPEED_FACTOR) {
  const apples = Math.ceil(Math.max(0, score) / MAX_POINTS_PER_APPLE);
  let ms = 0;
  for (let k = 0; k < apples; k += 1) {
    const steps = k < LUCKY_APPLES ? 1 : STEPS_PER_APPLE;
    ms += (steps * 1000) / maxTicksPerSecond(k, speedFactor);
  }
  return ms;
}

/**
 * Можно ли набрать score очков за elapsedMs на скорости speed.
 * Без скорости проверяем по самой быстрой — так же мягко, как раньше.
 * @returns {{ok: true} | {ok: false, reason: 'too_fast' | 'expired'}}
 */
export function checkRun({ score, elapsedMs, speed = 'fast' }) {
  if (!Number.isFinite(elapsedMs) || elapsedMs > RUN_TTL_MS) return { ok: false, reason: 'expired' };
  const factor = RUN_SPEED_FACTORS[speed] ?? FASTEST_SPEED_FACTOR;
  if (elapsedMs < minRunMs(score, factor) * SLACK) return { ok: false, reason: 'too_fast' };
  return { ok: true };
}
