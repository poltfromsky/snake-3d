/**
 * Общая таблица рекордов и отзывы — запросы к своему серверу (server/).
 * Проверки те же, что на сервере (src/core/validate.js): отсекаем ошибки
 * заранее, но окончательно решает сервер.
 */
import {
  buildFeedback, buildRecord, RECORD_MODES, RECORD_SPEEDS,
} from '../core/validate.js';

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

  /** Топ-10 по режиму и скорости: по одной строке на ник — его лучший результат. */
  async top(mode, speed = 'normal') {
    if (!RECORD_MODES.includes(mode) || !RECORD_SPEEDS.includes(speed)) return [];
    return this.request(`records?mode=${encodeURIComponent(mode)}&speed=${encodeURIComponent(speed)}`);
  }

  /** Билет партии: берётся при старте одиночной игры, без него результат в таблицу не примут. */
  async startRun(mode) {
    if (!RECORD_MODES.includes(mode)) return null;
    const { ticket } = await this.request('runs', { method: 'POST', body: { mode } });
    return ticket ?? null;
  }

  /** Место ника в общей таблице: {place, score, length} или null, если он туда ещё не попадал. */
  async place(mode, name, speed = 'normal') {
    if (!RECORD_MODES.includes(mode) || !RECORD_SPEEDS.includes(speed) || !name) return null;
    const query = `mode=${encodeURIComponent(mode)}&speed=${encodeURIComponent(speed)}&name=${encodeURIComponent(name)}`;
    return this.request(`records/place?${query}`);
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

  /**
   * Профиль с паролем (server/src/account.js). key — ключ входа из пароля (src/core/auth.js):
   * сам пароль на сервер не уходит.
   * @returns {Promise<{recoveryCode: string}>} код восстановления — показывается игроку один раз
   */
  async createProfile({ name, device, key }) {
    // consent — игрок отметил согласие с политикой конфиденциальности (без него сервер откажет).
    return this.request('account/create', {
      method: 'POST',
      body: {
        name, device, key, consent: true,
      },
    });
  }

  /** Войти в профиль с этого устройства. */
  async login({ name, device, key }) {
    await this.request('account/login', { method: 'POST', body: { name, device, key } });
  }

  /** Сменить пароль, зная текущий (оба — ключи входа, не сами пароли). */
  async changePassword({
    name, device, key, newKey,
  }) {
    await this.request('account/password', {
      method: 'POST',
      body: {
        name, device, key, newKey,
      },
    });
  }

  /** Удалить профиль и все данные игрока на сервере (только с паролем — ключом входа). */
  async deleteProfile({ name, device, key }) {
    return this.request('account/delete', { method: 'POST', body: { name, device, key } });
  }

  /** Лучшие результаты ника во всех режимах и скоростях с местом в таблице — для профиля. */
  async playerStats(name) {
    if (!name) return [];
    return this.request(`records/player?name=${encodeURIComponent(name)}`);
  }

  /** Забыли пароль: новый пароль по коду восстановления; в ответе новый код. */
  async recover({ name, device, code, key }) {
    return this.request('account/recover', { method: 'POST', body: { name, device, code, key } });
  }

  async submitFeedback(entry) {
    const feedback = buildFeedback(entry);
    if (!feedback) throw new Error('Напишите хотя бы пару слов.');
    await this.request('feedback', { method: 'POST', body: feedback });
  }
}
