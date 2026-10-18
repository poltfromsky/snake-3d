/**
 * Проверка рекордов и отзывов. Общая для браузера и сервера:
 * клиент проверяет до отправки, сервер — ещё раз, потому что клиенту не доверяем.
 */

export const LIMITS = Object.freeze({
  name: 16,
  recordComment: 200,
  feedbackName: 32,
  feedbackMessage: 1000,
  maxScore: 5000,
  maxLength: 600,
  version: 20,
});

export const RECORD_MODES = Object.freeze(['classic', 'walls', 'timed']);

/** Убирает управляющие символы и лишние пробелы, обрезает до лимита. */
export function cleanText(value, max) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Ключ ника: «Polt», «polt» и « polt » — один игрок. В общей таблице у каждого ключа
 * одна строка — лучший результат.
 */
export function nameKey(name) {
  return cleanText(name, LIMITS.name).toLowerCase();
}

/** Готовит рекорд к сохранению или возвращает null, если он некорректен. */
export function buildRecord({ name, mode, score, length, comment } = {}) {
  const cleanName = cleanText(name, LIMITS.name);
  if (!cleanName || !RECORD_MODES.includes(mode)) return null;
  if (!Number.isInteger(score) || score < 1 || score > LIMITS.maxScore) return null;
  if (!Number.isInteger(length) || length < 1 || length > LIMITS.maxLength) return null;
  const cleanComment = cleanText(comment, LIMITS.recordComment);
  return { name: cleanName, mode, score, length, comment: cleanComment || null };
}

/** Готовит отзыв к сохранению или возвращает null, если текста нет. */
export function buildFeedback({ name, rating, message, version } = {}) {
  const cleanMessage = cleanText(message, LIMITS.feedbackMessage);
  if (cleanMessage.length < 3) return null;
  const r = Number(rating);
  return {
    name: cleanText(name, LIMITS.feedbackName) || null,
    rating: Number.isInteger(r) && r >= 1 && r <= 5 ? r : null,
    message: cleanMessage,
    app_version: cleanText(version, LIMITS.version) || null,
  };
}
