/**
 * Сервер «Изгиба Питона 3D» на Cloudflare Workers.
 *
 *   POST /api/rooms                 — создать комнату {mode, speed} → {code}
 *   GET  /api/rooms/:code/ws        — WebSocket игрока (Durable Object Room)
 *   GET  /api/records?mode=classic  — топ-10 общей таблицы (по строке на ник)
 *   GET  /api/records/place?mode=classic&name=… — место и лучший результат ника {place, score, length} или null
 *   POST /api/records               — рекорд игрока: в таблице одна строка на ник,
 *                                     обновляется, только если результат лучше
 *   POST /api/feedback              — оставить отзыв (читает только владелец, в D1)
 *   GET  /api/health                — проверка, что сервер жив
 */
import {
  buildFeedback, buildRecord, nameKey, RECORD_MODES,
} from '../../src/core/validate.js';

export { Room } from './room.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих 0/O, 1/I/L
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const RECORD_COOLDOWN_S = 20;
const FEEDBACK_COOLDOWN_S = 60;
const MAX_BODY_BYTES = 4096;

function makeCode(length = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Отпечаток клиента для защиты от спама: хэш IP с секретной солью.
 * Сам IP в базе не хранится. Соль — только секрет (`wrangler secret put IP_SALT`,
 * локально — server/.dev.vars): с известной солью хэш IPv4 перебирается обратно.
 */
async function clientHash(request, env) {
  if (!env.IP_SALT || env.IP_SALT.length < 16) throw new Error('IP_SALT secret is not configured');
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const data = new TextEncoder().encode(`${env.IP_SALT}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function tooSoon(env, table, hash, seconds) {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE client_hash = ? AND created_at > datetime('now', ?)`)
    .bind(hash, `-${seconds} seconds`)
    .first();
  return row.n > 0;
}

async function createRoom(request, env) {
  const body = (await readJson(request)) ?? {};
  // Код случайный; если вдруг совпал с живой комнатой — пробуем другой.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ mode: body.mode, speed: body.speed }),
    });
    if (res.ok) return json({ code }, 201, request, env);
  }
  return json({ error: 'Не удалось создать комнату, попробуйте ещё раз.' }, 503, request, env);
}

async function topRecords(request, env, url) {
  const mode = url.searchParams.get('mode');
  if (!RECORD_MODES.includes(mode)) return json({ error: 'unknown mode' }, 400, request, env);
  // По одной строке на ник — его лучший результат (при равенстве — самый ранний).
  // Старые записи до миграции 0002 могли повторять ник — они отсеиваются здесь же.
  const { results } = await env.DB
    .prepare(`SELECT name, score, length, comment, created_at FROM (
                SELECT name, score, length, comment, created_at,
                       ROW_NUMBER() OVER (
                         PARTITION BY COALESCE(name_key, lower(trim(name)))
                         ORDER BY score DESC, created_at ASC
                       ) AS place
                FROM records WHERE mode = ?
              ) WHERE place = 1
              ORDER BY score DESC, created_at ASC LIMIT 10`)
    .bind(mode)
    .all();
  return json(results, 200, request, env);
}

/** Место ника в общей таблице: игрок видит себя, даже если он не в топ-10. */
async function placeOf(request, env, url) {
  const mode = url.searchParams.get('mode');
  const key = nameKey(url.searchParams.get('name'));
  if (!RECORD_MODES.includes(mode) || !key) return json({ error: 'unknown mode or name' }, 400, request, env);
  const row = await env.DB
    .prepare(`WITH best AS (
                SELECT COALESCE(name_key, lower(trim(name))) AS k, score, length, created_at,
                       ROW_NUMBER() OVER (
                         PARTITION BY COALESCE(name_key, lower(trim(name)))
                         ORDER BY score DESC, created_at ASC
                       ) AS n
                FROM records WHERE mode = ?
              ), ranked AS (
                SELECT k, score, length, RANK() OVER (ORDER BY score DESC) AS place FROM best WHERE n = 1
              )
              SELECT place, score, length FROM ranked WHERE k = ?`)
    .bind(mode, key)
    .first();
  return json(row ?? null, 200, request, env);
}

async function addRecord(request, env) {
  const record = buildRecord((await readJson(request)) ?? {});
  if (!record) return json({ error: 'Некорректный рекорд.' }, 400, request, env);
  const hash = await clientHash(request, env);
  if (await tooSoon(env, 'records', hash, RECORD_COOLDOWN_S)) {
    return json({ error: 'Слишком часто. Попробуйте через полминуты.' }, 429, request, env);
  }
  const key = nameKey(record.name);
  const best = await env.DB
    .prepare(`SELECT id, score FROM records WHERE mode = ? AND COALESCE(name_key, lower(trim(name))) = ?
              ORDER BY score DESC, created_at ASC LIMIT 1`)
    .bind(record.mode, key)
    .first();
  // Результат не лучше уже записанного — таблицу не трогаем, игроку сообщаем его лучший.
  if (best && record.score <= best.score) {
    return json({ ok: true, improved: false, best: best.score }, 200, request, env);
  }
  if (best) {
    // Новый лучший результат ника: обновляем его строку. Комментарий — новый, а если его нет, старый.
    await env.DB
      .prepare(`UPDATE records SET name = ?, name_key = ?, score = ?, length = ?, comment = COALESCE(?, comment),
                client_hash = ?, created_at = datetime('now') WHERE id = ?`)
      .bind(record.name, key, record.score, record.length, record.comment, hash, best.id)
      .run();
  } else {
    await env.DB
      .prepare('INSERT INTO records (name, name_key, mode, score, length, comment, client_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(record.name, key, record.mode, record.score, record.length, record.comment, hash)
      .run();
  }
  return json({ ok: true, improved: true, best: record.score }, best ? 200 : 201, request, env);
}

async function addFeedback(request, env) {
  const feedback = buildFeedback((await readJson(request)) ?? {});
  if (!feedback) return json({ error: 'Напишите хотя бы пару слов.' }, 400, request, env);
  const hash = await clientHash(request, env);
  if (await tooSoon(env, 'feedback', hash, FEEDBACK_COOLDOWN_S)) {
    return json({ error: 'Отзыв уже отправлен. Следующий — через минуту.' }, 429, request, env);
  }
  await env.DB
    .prepare('INSERT INTO feedback (name, rating, message, app_version, client_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(feedback.name, feedback.rating, feedback.message, feedback.app_version, hash)
    .run();
  return json({ ok: true }, 201, request, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const ws = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (ws) {
      const code = ws[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('bad code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    try {
      // `return await`, а не `return`: иначе ошибка из обработчика пролетит мимо catch
      // и Cloudflare отдаст свою страницу ошибки вместо короткого JSON.
      if (url.pathname === '/api/health') return json({ ok: true }, 200, request, env);
      if (url.pathname === '/api/rooms' && request.method === 'POST') return await createRoom(request, env);
      if (url.pathname === '/api/records' && request.method === 'GET') return await topRecords(request, env, url);
      if (url.pathname === '/api/records/place' && request.method === 'GET') return await placeOf(request, env, url);
      if (url.pathname === '/api/records' && request.method === 'POST') return await addRecord(request, env);
      if (url.pathname === '/api/feedback' && request.method === 'POST') return await addFeedback(request, env);
    } catch (err) {
      // В лог — только текст ошибки, без запроса и заголовков (там IP игрока).
      console.error(err?.message ?? 'unknown error');
      return json({ error: 'Ошибка сервера.' }, 500, request, env);
    }
    return json({ error: 'not found' }, 404, request, env);
  },
};
