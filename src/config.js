/**
 * Адрес сервера игры (Cloudflare Worker из папки server/).
 *
 * Локально — `npm run dev` в server/ поднимает его на :8787.
 * На сайте — адрес из `wrangler deploy` (*.workers.dev).
 * Пока адрес не задан, онлайн-игра и общие рекорды скрыты, остальное работает.
 */
const PRODUCTION_API = '';

const isLocal = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);

export const API_BASE = isLocal ? 'http://localhost:8787' : PRODUCTION_API;

export const APP_VERSION = '1.3.0';
