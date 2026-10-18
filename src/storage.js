/**
 * Настройки и таблица рекордов в localStorage.
 *
 * В приватном окне или при запрете хранилища браузер бросает исключение —
 * тогда игра просто работает без сохранения.
 */

import { cleanText, LIMITS } from './core/validate.js';

const SETTINGS_KEY = 'snake3d.settings.v1';
const RECORDS_KEY = 'snake3d.records.v1';
const MAX_RECORDS = 10;

export const DEFAULT_SETTINGS = Object.freeze({
  musicVolume: 0.5,
  sfxVolume: 0.7,
  speed: 'normal', // slow | normal | fast
  theme: 'neon', // neon | forest | sunset
  camera: 'angled', // angled | top
  controls: 'swipe', // swipe | buttons — управление на сенсорном экране
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

/** Рекорды по режимам: { classic: [{name, score, length, date}], ... } */
export function loadRecords() {
  return read(RECORDS_KEY, {});
}

export function isRecord(mode, score) {
  if (score <= 0) return false;
  const list = loadRecords()[mode] ?? [];
  return list.length < MAX_RECORDS || score > list.at(-1).score;
}

export function addRecord(mode, entry) {
  const records = loadRecords();
  const list = [...(records[mode] ?? []), entry]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECORDS);
  records[mode] = list;
  write(RECORDS_KEY, records);
  return list.indexOf(entry);
}
