/**
 * Запись о партии для личной статистики — проверка общая для браузера и сервера:
 * браузер чистит то, что получил с сервера и что отправляет, сервер — то, что пришло
 * (клиенту не доверяем). Формат описан в src/core/stats.js.
 *
 * Синхронизация (src/net/stats-sync.js ↔ server/src/stats.js): у каждой партии свой id,
 * поэтому повторная отправка не создаёт дублей, а партии с разных устройств одного
 * профиля сливаются в одну статистику.
 */
import { RECORD_MODES, RECORD_SPEEDS, PLATFORMS } from './validate.js';

export const GAME_KINDS = Object.freeze(['solo', 'bot', 'online']);
export const GAME_ENDS = Object.freeze(['wall', 'self', 'stone', 'poison', 'rival', 'headOn', 'time']);
export const GAME_RESULTS = Object.freeze(['win', 'loss', 'draw']);
export const BOT_LEVEL_IDS = Object.freeze(['easy', 'medium', 'hard', 'claude']);

/** Сколько партий профиля хранит сервер (новые вытесняют самые старые) и сколько шлёт за раз. */
export const MAX_SERVER_GAMES = 1000;
export const SYNC_BATCH = 50;

/** Партии раньше этой даты быть не может (игра моложе), позже «сейчас + сутки» — тоже. */
const EARLIEST_MS = Date.UTC(2025, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_.:-]{8,64}$/;

const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const oneOf = (v, list) => (list.includes(v) ? v : null);

/**
 * Чистая запись или null, если её нельзя принять. Лишние поля отбрасываются,
 * необязательные неверные — обнуляются, обязательные неверные — запись отклоняется.
 */
export function cleanGameStat(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  const at = int(raw.at, EARLIEST_MS, now + DAY_MS);
  const kind = oneOf(raw.kind, GAME_KINDS);
  const score = int(raw.score, 0, 5000);
  if (!id || at === null || !kind || score === null) return null;
  const bonuses = raw.bonuses && typeof raw.bonuses === 'object' ? raw.bonuses : {};
  return {
    id,
    at,
    kind,
    mode: oneOf(raw.mode, RECORD_MODES),
    speed: oneOf(raw.speed, RECORD_SPEEDS),
    score,
    length: int(raw.length, 1, 600),
    durationMs: int(raw.durationMs, 0, DAY_MS),
    end: oneOf(raw.end, GAME_ENDS),
    result: kind === 'solo' ? null : oneOf(raw.result, GAME_RESULTS),
    level: kind === 'bot' ? oneOf(raw.level, BOT_LEVEL_IDS) : null,
    platform: oneOf(raw.platform, PLATFORMS),
    apples: int(raw.apples, 0, 1000),
    bonuses: {
      slow: int(bonuses.slow, 0, 1000) ?? 0,
      ghost: int(bonuses.ghost, 0, 1000) ?? 0,
      bad: int(bonuses.bad, 0, 1000) ?? 0,
    },
    // Партия из старой истории (до подробных записей): только счёт, длина, дата и скорость.
    legacy: raw.legacy === true,
  };
}

/** Новый id партии: случайный, чтобы партии разных устройств не совпали. */
export function newGameId() {
  return globalThis.crypto?.randomUUID?.() ?? `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** id для партии из старой истории: один и тот же на любом устройстве, где она лежит. */
export function legacyGameId(mode, attempt) {
  return `h:${mode}:${attempt.date}:${attempt.score}`;
}
