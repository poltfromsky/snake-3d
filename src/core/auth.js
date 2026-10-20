/**
 * Профиль игрока: вход по нику и паролю — чистая логика, общая для браузера и сервера.
 *
 * Как устроено (пароль сервер не видит никогда):
 *   1. Браузер «растягивает» пароль медленной функцией PBKDF2 (на телефоне ~0,5 с) и получает
 *      длинный ключ — 64 шестнадцатеричных знака. Соль — ник: у двух игроков с одним паролем
 *      ключи разные.
 *   2. На сервер уходит только этот ключ. Сервер хранит SHA-256 от него — быстро и надёжно,
 *      потому что ключ уже длинный и случайный на вид; перебирать пароль подбором приходится
 *      через тот же медленный PBKDF2 (на бесплатном тарифе сервера он бы не уложился в лимит
 *      процессорного времени, поэтому тяжёлая часть — у игрока).
 *   3. Забыл пароль — код восстановления: он выдаётся один раз при создании профиля, сервер
 *      хранит только его хэш. По коду задают новый пароль и получают новый код.
 */
import { nameKey } from './validate.js';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
/** Число итераций PBKDF2-SHA256: рекомендация OWASP для паролей. */
export const KDF_ITERATIONS = 600_000;
const KDF_SALT_PREFIX = 'izgib-pitona:v1:';

/** Алфавит кода восстановления: без похожих знаков (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_GROUPS = 4;
const CODE_GROUP_LENGTH = 5;

/** Пароль подходит? Возвращает текст замечания по-русски или null. */
export function passwordProblem(password) {
  const text = String(password ?? '');
  if (text.length < PASSWORD_MIN) return `Пароль — не короче ${PASSWORD_MIN} символов.`;
  if (text.length > PASSWORD_MAX) return `Пароль — не длиннее ${PASSWORD_MAX} символов.`;
  if (text.trim() !== text) return 'Уберите пробелы в начале и в конце пароля.';
  if (nameKey(text) === text.toLowerCase() && /^(.)\1+$/.test(text)) return 'Пароль не должен состоять из одного повторяющегося знака.';
  return null;
}

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Ключ входа из пароля. Тяжёлая часть: вызывать в браузере, не на сервере.
 * @param {string} password
 * @param {string} name ник (соль — его нормализованный ключ)
 * @param {number} [iterations] в тестах уменьшают, в игре всегда KDF_ITERATIONS
 * @returns {Promise<string>} 64 шестнадцатеричных знака
 */
export async function deriveLoginKey(password, name, iterations = KDF_ITERATIONS) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Браузер не умеет защищать пароль — обновите его.');
  const encoder = new TextEncoder();
  const material = await subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: encoder.encode(`${KDF_SALT_PREFIX}${nameKey(name)}`),
    iterations,
  }, material, 256);
  return toHex(bits);
}

/** Привести код восстановления к виду из базы: без пробелов и дефисов, заглавные. */
export function normalizeRecoveryCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Код восстановления выглядит правильно (формат, а не «верный ли он»). */
export function isRecoveryCode(raw) {
  const code = normalizeRecoveryCode(raw);
  return code.length === CODE_GROUPS * CODE_GROUP_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** Новый случайный код восстановления: четыре группы по пять знаков, через дефис. */
export function makeRecoveryCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const total = CODE_GROUPS * CODE_GROUP_LENGTH;
  // Отбрасываем байты, которые дали бы перекос в алфавите (256 не делится на его длину нацело).
  const limit = 256 - (256 % CODE_ALPHABET.length);
  const chars = [];
  while (chars.length < total) {
    for (const byte of random(total * 2)) {
      if (byte < limit && chars.length < total) chars.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
    }
  }
  const groups = [];
  for (let i = 0; i < total; i += CODE_GROUP_LENGTH) groups.push(chars.slice(i, i + CODE_GROUP_LENGTH).join(''));
  return groups.join('-');
}

/** Ключ входа выглядит правильно (64 шестнадцатеричных знака). */
export const isLoginKey = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** Сравнение строк за одинаковое время: чтобы по скорости ответа нельзя было угадывать хэш. */
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}
