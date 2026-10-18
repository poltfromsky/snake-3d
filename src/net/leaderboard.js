/**
 * Общая таблица рекордов и отзывы — запросы к своему серверу (server/).
 * Проверки те же, что на сервере (src/core/validate.js): отсекаем ошибки
 * заранее, но окончательно решает сервер.
 */
import { buildFeedback, buildRecord, RECORD_MODES } from '../core/validate.js';

const TIMEOUT_MS = 8000;

export class Leaderboard {
  constructor(apiBase, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    this.base = (apiBase ?? '').replace(/\/+$/, '');
    this.fetch = fetchImpl;
  }

  get enabled() {
    return Boolean(this.base && this.fetch);
  }

  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetch(`${this.base}/api/${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      // Сервер объясняет отказ по-русски — показываем как есть; code — для решения «повторять ли».
      if (!res.ok) {
        const err = new Error(data.error ?? `HTTP ${res.status}`);
        err.code = data.code ?? null;
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Топ-10 по режиму: по одной строке на ник — его лучший результат. */
  async top(mode) {
    if (!RECORD_MODES.includes(mode)) return [];
    return this.request(`records?mode=${encodeURIComponent(mode)}`);
  }

  /** Билет партии: берётся при старте одиночной игры, без него результат в таблицу не примут. */
  async startRun(mode) {
    if (!RECORD_MODES.includes(mode)) return null;
    const { ticket } = await this.request('runs', { method: 'POST', body: { mode } });
    return ticket ?? null;
  }

  /** Место ника в общей таблице: {place, score, length} или null, если он туда ещё не попадал. */
  async place(mode, name) {
    if (!RECORD_MODES.includes(mode) || !name) return null;
    return this.request(`records/place?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(name)}`);
  }

  /**
   * Отправить результат. Сервер хранит у ника только лучший.
   * @returns {Promise<{improved: boolean, best: number}>} improved — записан ли этот результат
   */
  async submitRecord(entry) {
    const record = buildRecord(entry);
    if (!record) throw new Error('Некорректный рекорд.');
    const body = { ...record, ticket: entry.ticket, device: entry.device };
    const data = await this.request('records', { method: 'POST', body });
    return { improved: data.improved !== false, best: Number(data.best) || record.score };
  }

  async submitFeedback(entry) {
    const feedback = buildFeedback(entry);
    if (!feedback) throw new Error('Напишите хотя бы пару слов.');
    await this.request('feedback', { method: 'POST', body: feedback });
  }
}
