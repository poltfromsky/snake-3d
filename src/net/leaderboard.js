/**
 * Общая таблица рекордов и отзывы через REST API Supabase.
 *
 * SDK не нужен: Supabase отдаёт таблицы по HTTP (PostgREST), хватает fetch.
 * Все проверки дублируются в базе (CHECK и RLS) — клиенту не доверяем.
 */

export const LIMITS = Object.freeze({
  name: 16,
  recordComment: 200,
  feedbackName: 32,
  feedbackMessage: 1000,
  maxScore: 5000,
});

const MODES = new Set(['classic', 'walls', 'timed']);
const TIMEOUT_MS = 8000;

/** Убирает управляющие символы и лишние пробелы, обрезает до лимита. */
export function cleanText(value, max) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Готовит рекорд к отправке или возвращает null, если он некорректен. */
export function buildRecord({ name, mode, score, length, comment }) {
  const cleanName = cleanText(name, LIMITS.name);
  if (!cleanName || !MODES.has(mode)) return null;
  if (!Number.isInteger(score) || score < 1 || score > LIMITS.maxScore) return null;
  if (!Number.isInteger(length) || length < 1) return null;
  const cleanComment = cleanText(comment, LIMITS.recordComment);
  return { name: cleanName, mode, score, length, comment: cleanComment || null };
}

/** Готовит отзыв к отправке или возвращает null, если текста нет. */
export function buildFeedback({ name, rating, message, version }) {
  const cleanMessage = cleanText(message, LIMITS.feedbackMessage);
  if (cleanMessage.length < 3) return null;
  const r = Number(rating);
  return {
    name: cleanText(name, LIMITS.feedbackName) || null,
    rating: Number.isInteger(r) && r >= 1 && r <= 5 ? r : null,
    message: cleanMessage,
    app_version: version ?? null,
  };
}

export class Leaderboard {
  constructor(url, anonKey, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    this.url = url.replace(/\/+$/, '');
    this.key = anonKey;
    this.fetch = fetchImpl;
  }

  get enabled() {
    return Boolean(this.url && this.key && this.fetch);
  }

  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetch(`${this.url}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          // Отзывы читать нельзя, поэтому просим базу ничего не возвращать.
          Prefer: 'return=minimal',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return method === 'GET' ? res.json() : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Топ-10 по режиму. */
  async top(mode, limit = 10) {
    if (!MODES.has(mode)) return [];
    const query = new URLSearchParams({
      select: 'name,score,length,comment,created_at',
      mode: `eq.${mode}`,
      order: 'score.desc,created_at.asc',
      limit: String(limit),
    });
    return this.request(`records?${query}`);
  }

  async submitRecord(entry) {
    const record = buildRecord(entry);
    if (!record) throw new Error('invalid record');
    await this.request('records', { method: 'POST', body: record });
  }

  async submitFeedback(entry) {
    const feedback = buildFeedback(entry);
    if (!feedback) throw new Error('invalid feedback');
    await this.request('feedback', { method: 'POST', body: feedback });
  }
}
