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
const TUTORIAL_KEY = 'snake3d.tutorial.v1';
const SEEN_VERSION_KEY = 'snake3d.seen-version.v1';
const PROFILE_KEY = 'snake3d.profile.v1';
const STATS_KEY = 'snake3d.stats.v1';
/** Сколько раз перед «Играть» предлагаем обучение, если его не прошли. Дальше — только плашка в меню. */
export const TUTORIAL_OFFERS = 3;
const MAX_HISTORY = 100;

export const DEFAULT_SETTINGS = Object.freeze({
  musicVolume: 0.5,
  sfxVolume: 0.7,
  speed: 'normal', // slow | normal | fast
  theme: 'neon', // neon | forest | sunset
  camera: 'angled', // angled | top
  controls: 'swipe', // swipe | buttons — управление на сенсорном экране
  dpad: null, // свои положение и размер кнопок-стрелок: {x, y, scale} в долях экрана; null — внизу по центру
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
 * История попыток по режимам, новые сверху: { classic: [{score, length, date, speed}], ... }.
 * Это «Мои» на экране рекордов. В общей таблице у ника — только лучший результат.
 * speed — скорость партии; у попыток из прошлых версий её нет, они считаются «normal».
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

/** Скорость попытки: у записей из прошлых версий её нет — тогда «normal». */
export const attemptSpeed = (a) => a.speed ?? 'normal';

/** Лучший результат на этом устройстве в режиме и на скорости (0, если попыток не было). */
export function personalBest(mode, speed = 'normal') {
  return (loadHistory()[mode] ?? [])
    .filter((a) => attemptSpeed(a) === speed)
    .reduce((best, a) => Math.max(best, a.score), 0);
}

/**
 * Записывает попытку в историю. Возвращает true, если побит личный рекорд на этой скорости.
 * История ограничена MAX_HISTORY попытками, но лучшая на каждой скорости не вытесняется никогда.
 */
export function addAttempt(mode, {
  score, length, speed = 'normal', date = Date.now(),
}) {
  const before = personalBest(mode, speed);
  const history = loadHistory();
  let list = [{
    score, length, date, speed,
  }, ...(history[mode] ?? [])];
  if (list.length > MAX_HISTORY) {
    const tops = new Map();
    for (const a of list) {
      const s = attemptSpeed(a);
      if (!tops.has(s) || a.score > tops.get(s).score) tops.set(s, a);
    }
    const keep = new Set(tops.values());
    list = list.slice(0, MAX_HISTORY);
    // Вытесненные лучшие возвращаем на места самых старых обычных попыток (не на место другой лучшей).
    const missing = [...keep].filter((top) => !list.includes(top));
    for (let i = list.length - 1; i >= 0 && missing.length; i -= 1) {
      if (!keep.has(list[i])) list[i] = missing.shift();
    }
  }
  history[mode] = list;
  write(HISTORY_KEY, history);
  return score > 0 && score > before;
}

/**
 * Личная статистика: партии на этом устройстве и состояние синхронизации с профилем
 * (формат партии — src/core/stats.js, хранилище и синхронизация — src/net/stats-sync.js).
 * В партии — только её цифры; у партий профиля — ник профиля (чтобы не смешать профили на одном устройстве).
 */
export function loadStatsStore() {
  return read(STATS_KEY, null);
}

export function saveStatsStore(store) {
  write(STATS_KEY, store);
}

/**
 * Обучение: показывали ли, прошёл ли, сколько раз предлагали перед игрой и какие
 * подсказки первых партий уже видел. { shown, done, offers, hints: {bad: true, ...} }
 */
export function loadTutorial() {
  const t = read(TUTORIAL_KEY, null);
  return {
    shown: Boolean(t?.shown), done: Boolean(t?.done), offers: Number(t?.offers) || 0, hints: { ...t?.hints },
  };
}

export function saveTutorial(state) {
  write(TUTORIAL_KEY, state);
}

/** Версия, «Что нового» которой игрок уже видел (null — новый игрок). */
export function loadSeenVersion() {
  const v = read(SEEN_VERSION_KEY, null);
  return typeof v === 'string' ? v : null;
}

export function saveSeenVersion(version) {
  write(SEEN_VERSION_KEY, version);
}

/** Совсем новый игрок: ничего не сохранял и обучение ему ещё не показывали. */
export function isNewPlayer() {
  return !read(TUTORIAL_KEY, null) && !read(HISTORY_KEY, null) && !read(RECORDS_KEY, null) && !read(SETTINGS_KEY, null);
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
 * Профиль с паролем: ник, который защищён паролем и доступен с других устройств.
 * Хранится только ключ ника (nameKey) — ни пароля, ни ключа входа на устройстве нет.
 */
export function loadProfile() {
  const p = read(PROFILE_KEY, null);
  return p && typeof p.nameKey === 'string' ? p : null;
}

export function saveProfile(nameKey) {
  write(PROFILE_KEY, { nameKey, since: Date.now() });
}

/**
 * Выйти из профиля на этом устройстве: забыть профиль и ник, заменить ключ устройства новым.
 * Старый ключ был допущен к нику на сервере — без него это устройство больше не пишет под ником,
 * пока снова не войдут по паролю. История попыток и достижения остаются.
 */
export function logoutProfile(settings) {
  try {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(DEVICE_KEY);
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Хранилище недоступно — забывать нечего.
  }
  setPlayerName(settings, '');
}

/**
 * Рекорды, которые не удалось отправить в общую таблицу (нет сети, слишком часто).
 * По одному на режим и скорость — самый лучший; отправляются при следующей возможности.
 * Ключ «нормальной» скорости — просто режим, как в прошлых версиях игры.
 */
export function loadPending() {
  return read(PENDING_KEY, {});
}

const pendingKey = (mode, speed = 'normal') => (speed === 'normal' ? mode : `${mode}:${speed}`);

export function savePending(entry) {
  const pending = loadPending();
  const key = pendingKey(entry.mode, entry.speed);
  if (!pending[key] || pending[key].score < entry.score) pending[key] = entry;
  write(PENDING_KEY, pending);
}

export function clearPending(mode, score, speed = 'normal') {
  const pending = loadPending();
  const key = pendingKey(mode, speed);
  // Пока отправляли, мог появиться рекорд ещё лучше — его не трогаем.
  if (pending[key] && pending[key].score <= score) delete pending[key];
  write(PENDING_KEY, pending);
}
