/**
 * Настройки и таблица рекордов в localStorage.
 *
 * В приватном окне или при запрете хранилища браузер бросает исключение —
 * тогда игра просто работает без сохранения.
 */

import { cleanText, LIMITS } from './core/validate.js';

const SETTINGS_KEY = 'snake3d.settings.v1';
const RECORDS_KEY = 'snake3d.records.v1'; // до версии 1.6: топ-10 на устройстве (переносится в историю)
const HISTORY_KEY = 'snake3d.history.v1';
const PENDING_KEY = 'snake3d.pending.v1';
const DEVICE_KEY = 'snake3d.device.v1';
const MAX_HISTORY = 100;

export const DEFAULT_SETTINGS = Object.freeze({
  musicVolume: 0.5,
  sfxVolume: 0.7,
  speed: 'normal', // slow | normal | fast
  theme: 'neon', // neon | forest | sunset
  camera: 'angled', // angled | top
  controls: 'swipe', // swipe | buttons — управление на сенсорном экране
  autoSubmit: 'off', // on | off — сам отправлять личный рекорд в общую таблицу
  mode: 'classic',
  playerName: '', // один ник на всю игру: рекорды, отзыв, онлайн
});

export const SPEED_FACTORS = Object.freeze({ slow: 0.75, normal: 1, fast: 1.35 });

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Хранилище недоступно — молча продолжаем без сохранения.
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

/**
 * Запоминает ник игрока (где бы его ни ввели) и возвращает очищенный вариант.
 * Правила те же, что у имени в общей таблице рекордов.
 */
export function setPlayerName(settings, raw) {
  const name = cleanText(raw, LIMITS.name);
  settings.playerName = name;
  saveSettings(settings);
  return name;
}

/**
 * История попыток по режимам, новые сверху: { classic: [{score, length, date}], ... }.
 * Это «Мои» на экране рекордов. В общей таблице у ника — только лучший результат.
 */
export function loadHistory() {
  const history = read(HISTORY_KEY, null);
  if (history) return history;
  // Первый запуск после обновления: прежние рекорды на устройстве становятся началом истории.
  const seeded = {};
  for (const [mode, list] of Object.entries(read(RECORDS_KEY, {}))) {
    if (!Array.isArray(list)) continue;
    seeded[mode] = list
      .map(({ score, length, date }) => ({ score, length, date }))
      .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  }
  return seeded;
}

/** Лучший результат на этом устройстве в режиме (0, если попыток не было). */
export function personalBest(mode) {
  return (loadHistory()[mode] ?? []).reduce((best, a) => Math.max(best, a.score), 0);
}

/**
 * Записывает попытку в историю. Возвращает true, если побит личный рекорд.
 * История ограничена MAX_HISTORY попытками, но лучшая из них не вытесняется никогда.
 */
export function addAttempt(mode, { score, length, date = Date.now() }) {
  const before = personalBest(mode);
  const history = loadHistory();
  let list = [{ score, length, date }, ...(history[mode] ?? [])];
  if (list.length > MAX_HISTORY) {
    const top = list.reduce((a, b) => (b.score > a.score ? b : a));
    list = list.slice(0, MAX_HISTORY);
    if (!list.includes(top)) list[MAX_HISTORY - 1] = top;
  }
  history[mode] = list;
  write(HISTORY_KEY, history);
  return score > 0 && score > before;
}

/**
 * Секретный ключ этого устройства: им устройство доказывает серверу, что ник — его.
 * Сервер хранит только хэш ключа. Ключ не покидает устройство иначе как в запросе
 * к своему серверу; если очистить данные сайта, ник придётся выбрать заново.
 */
export function deviceKey() {
  let key = read(DEVICE_KEY, null);
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    key = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    write(DEVICE_KEY, key);
  }
  return key;
}

/**
 * Рекорды, которые не удалось отправить в общую таблицу (нет сети, слишком часто).
 * По одному на режим — самый лучший; отправляются при следующей возможности.
 */
export function loadPending() {
  return read(PENDING_KEY, {});
}

export function savePending(entry) {
  const pending = loadPending();
  if (!pending[entry.mode] || pending[entry.mode].score < entry.score) pending[entry.mode] = entry;
  write(PENDING_KEY, pending);
}

export function clearPending(mode, score) {
  const pending = loadPending();
  // Пока отправляли, мог появиться рекорд ещё лучше — его не трогаем.
  if (pending[mode] && pending[mode].score <= score) delete pending[mode];
  write(PENDING_KEY, pending);
}
