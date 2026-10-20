/**
 * Профили игроков: создать, войти с нового устройства, восстановить по коду.
 *
 *   POST /api/account/create   {name, device, key}        — защитить свой ник паролем; в ответе код
 *                                                           восстановления (показывается один раз)
 *   POST /api/account/login    {name, device, key}        — войти: это устройство получает ник
 *   POST /api/account/recover  {name, device, code, key}  — забыли пароль: новый пароль по коду,
 *                                                           в ответе новый код восстановления
 *
 * key — ключ входа: браузер растягивает пароль в 64 шестнадцатеричных знака (src/core/auth.js),
 * сам пароль сервер не получает. В базе — только SHA-256 от ключа и от кода восстановления.
 * Подбор ограничен: неудачные попытки считаются на ник и на адрес; о том, есть ли такой ник,
 * ответ не сообщает (одинаковое «неверный ник или пароль»).
 */
import {
  isLoginKey, isRecoveryCode, makeRecoveryCode, normalizeRecoveryCode, safeEqual,
} from '../../src/core/auth.js';
import { cleanText, LIMITS, nameKey } from '../../src/core/validate.js';

const DEVICE_RE = /^[0-9a-f]{64}$/;
/** Окно подсчёта неудачных попыток входа. */
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
/** Неудачных попыток на один ник за окно: дальше — пауза. */
const MAX_FAILS_PER_NICK = 5;
/** Неудачных попыток с одного адреса за окно (общий Wi-Fi — щедрее, чем на ник). */
const MAX_FAILS_PER_ADDRESS = 40;
/** Служебная уборка: попытки старше суток больше не нужны. */
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

const BAD_LOGIN = 'Неверный ник или пароль.';
const BAD_CODE = 'Неверный ник или код восстановления.';

/**
 * @param {object} deps общие помощники сервера (server/src/index.js)
 */
export function createAccountHandlers({
  json, readJson, clientHash, sha256, refuse, claimNick,
}) {
  /** Хэш для хранения: соль-префикс отделяет эти хэши от остальных SHA-256 в базе. */
  const secretHash = (kind, value) => sha256(`izgib-${kind}:v1:${value}`);

  /** Разбор общих полей запроса: ник, устройство. Возвращает null, если что-то не так. */
  function common(body) {
    const name = cleanText(body?.name, LIMITS.name);
    const key = nameKey(name);
    if (!key || typeof body?.device !== 'string' || !DEVICE_RE.test(body.device)) return null;
    return { name, key, device: body.device };
  }

  /** Достаточно ли неудачных попыток, чтобы сказать «подождите». */
  async function tooManyFails(env, key, hash) {
    const since = Date.now() - ATTEMPT_WINDOW_MS;
    const row = await env.DB
      .prepare(`SELECT
                  (SELECT COUNT(*) FROM auth_attempts WHERE name_key = ? AND ok = 0 AND at_ms > ?) AS nick,
                  (SELECT COUNT(*) FROM auth_attempts WHERE client_hash = ? AND ok = 0 AND at_ms > ?) AS address`)
      .bind(key, since, hash, since)
      .first();
    return row.nick >= MAX_FAILS_PER_NICK || row.address >= MAX_FAILS_PER_ADDRESS;
  }

  async function noteAttempt(env, key, hash, ok) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO auth_attempts (name_key, client_hash, ok, at_ms) VALUES (?, ?, ?, ?)')
        .bind(key, hash, ok ? 1 : 0, now),
      env.DB.prepare('DELETE FROM auth_attempts WHERE at_ms < ?').bind(now - ATTEMPT_TTL_MS),
    ]);
  }

  const limitReply = (request, env) => refuse(
    'auth_limit', 'Слишком много неудачных попыток. Подождите 15 минут и попробуйте снова.', 429, request, env,
  );

  /** Допустить устройство к нику. */
  const addDevice = (env, key, ownerHash) => env.DB
    .prepare('INSERT OR IGNORE INTO nick_devices (name_key, owner_hash) VALUES (?, ?)')
    .bind(key, ownerHash)
    .run();

  async function create(request, env) {
    const body = (await readJson(request)) ?? {};
    const fields = common(body);
    if (!fields || !isLoginKey(body.key)) return json({ error: 'Некорректный запрос.' }, 400, request, env);
    const hash = await clientHash(request, env);
    const ownerHash = await sha256(fields.device);

    // Ник должен быть свободен или уже принадлежать этому устройству (те же правила, что у рекордов).
    const denied = await claimNick(env, fields.key, fields.name, ownerHash, hash);
    if (denied) return refuse(denied.code, denied.error, denied.status, request, env);
    const exists = await env.DB.prepare('SELECT 1 AS x FROM accounts WHERE name_key = ?').bind(fields.key).first();
    if (exists) {
      return refuse('account_exists', 'У этого ника уже есть профиль. Войдите в него или выберите другой ник.', 409, request, env);
    }

    const recoveryCode = makeRecoveryCode();
    await env.DB
      .prepare('INSERT INTO accounts (name_key, auth_hash, recovery_hash) VALUES (?, ?, ?)')
      .bind(fields.key, await secretHash('auth', body.key), await secretHash('recovery', normalizeRecoveryCode(recoveryCode)))
      .run();
    await addDevice(env, fields.key, ownerHash);
    return json({ ok: true, recoveryCode }, 201, request, env);
  }

  async function login(request, env) {
    const body = (await readJson(request)) ?? {};
    const fields = common(body);
    if (!fields || !isLoginKey(body.key)) return json({ error: 'Некорректный запрос.' }, 400, request, env);
    const hash = await clientHash(request, env);
    if (await tooManyFails(env, fields.key, hash)) return limitReply(request, env);

    const account = await env.DB.prepare('SELECT auth_hash FROM accounts WHERE name_key = ?').bind(fields.key).first();
    // Хэш считаем и для несуществующего ника: время ответа не выдаёт, есть ли такой профиль.
    const given = await secretHash('auth', body.key);
    const ok = Boolean(account) && safeEqual(given, account.auth_hash);
    await noteAttempt(env, fields.key, hash, ok);
    if (!ok) return refuse('bad_login', BAD_LOGIN, 401, request, env);

    await addDevice(env, fields.key, await sha256(fields.device));
    return json({ ok: true }, 200, request, env);
  }

  async function recover(request, env) {
    const body = (await readJson(request)) ?? {};
    const fields = common(body);
    if (!fields || !isLoginKey(body.key) || !isRecoveryCode(body.code)) {
      return json({ error: 'Некорректный запрос.' }, 400, request, env);
    }
    const hash = await clientHash(request, env);
    if (await tooManyFails(env, fields.key, hash)) return limitReply(request, env);

    const account = await env.DB.prepare('SELECT recovery_hash FROM accounts WHERE name_key = ?').bind(fields.key).first();
    const given = await secretHash('recovery', normalizeRecoveryCode(body.code));
    const ok = Boolean(account) && safeEqual(given, account.recovery_hash);
    await noteAttempt(env, fields.key, hash, ok);
    if (!ok) return refuse('bad_code', BAD_CODE, 401, request, env);

    // Новый пароль и новый код; старый код больше не действует.
    const recoveryCode = makeRecoveryCode();
    await env.DB
      .prepare(`UPDATE accounts SET auth_hash = ?, recovery_hash = ?, updated_at = datetime('now') WHERE name_key = ?`)
      .bind(await secretHash('auth', body.key), await secretHash('recovery', normalizeRecoveryCode(recoveryCode)), fields.key)
      .run();
    await addDevice(env, fields.key, await sha256(fields.device));
    return json({ ok: true, recoveryCode }, 200, request, env);
  }

  return { create, login, recover };
}
