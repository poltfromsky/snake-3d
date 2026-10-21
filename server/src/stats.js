/**
 * Личная статистика профиля: одна на все устройства игрока.
 *
 *   POST /api/stats/sync    {name, device, games: [...до 50], since} — записать новые партии с устройства
 *                            и получить партии с других устройств: {games, cursor, more, total}
 *                            (since/cursor — номер последней полученной записи: догружается только новое)
 *   POST /api/stats/compare {name, device} — сравнение с другими игроками: лучший результат в каждом
 *                            режиме против лучших результатов в общей таблице, доля побед над каждым
 *                            ботом против других профилей. Только сводные цифры, без ников.
 *   POST /api/stats/delete  {name, device} — удалить статистику профиля: на сервере сразу, на остальных
 *                            устройствах — при их следующей синхронизации (растёт epoch, «поколение»)
 *
 * В ответе sync — epoch: устройство, у которого записано другое поколение, стирает у себя старые
 * партии профиля и догружает всё заново (так удаление доходит до всех устройств).
 *
 * Доступ — только у профиля (accounts) и только с устройства, допущенного к нику: того, что занял
 * его первым (nicks), или вошедшего по паролю (nick_devices). Ключ устройства — секрет устройства,
 * в базе только его хэш. Записи проверяет src/core/game-stats.js — клиенту не доверяем.
 */
import { cleanGameStat, MAX_SERVER_GAMES, SYNC_BATCH } from '../../src/core/game-stats.js';
import { cleanText, LIMITS, nameKey } from '../../src/core/validate.js';

const DEVICE_RE = /^[0-9a-f]{64}$/;
/** Пачка партий весит до ~20 КБ: у этих запросов свой предел размера (у остальных — 4 КБ). */
const MAX_SYNC_BYTES = 48 * 1024;
/** Сколько записей отдаём за один ответ (дальше устройство догружает, пока more). */
const PAGE = 300;
/** Защита от заливки: не больше стольких новых записей на профиль за час (первая выгрузка истории влезает). */
const MAX_NEW_PER_HOUR = 1500;
/** Сравнение показываем, только когда есть хотя бы столько других игроков. */
export const MIN_COMPARE_PLAYERS = 3;
/** Доля побед над ботом считается у тех, кто сыграл с ним хотя бы столько раз. */
const MIN_BOT_GAMES = 3;

const MODES = ['classic', 'walls', 'timed'];
const LEVELS = ['easy', 'medium', 'hard', 'claude'];

/** Строка базы → запись партии в формате игры. */
function rowToGame(r) {
  return {
    id: r.game_id,
    at: r.at_ms,
    kind: r.kind,
    mode: r.mode,
    speed: r.speed,
    score: r.score,
    length: r.length,
    durationMs: r.duration_ms,
    end: r.end_reason,
    result: r.result,
    level: r.level,
    platform: r.platform,
    apples: r.apples,
    bonuses: { slow: r.bonus_slow, ghost: r.bonus_ghost, bad: r.bonus_bad },
    legacy: r.legacy === 1,
  };
}

/**
 * @param {object} deps общие помощники сервера (server/src/index.js)
 */
export function createStatsHandlers({
  json, readJson, sha256, refuse,
}) {
  /** Профиль и устройство: можно ли этому устройству читать и писать статистику ника. */
  async function authorize(env, body) {
    const name = cleanText(body?.name, LIMITS.name);
    const key = nameKey(name);
    if (!key || typeof body?.device !== 'string' || !DEVICE_RE.test(body.device)) return { status: 400 };
    const ownerHash = await sha256(body.device);
    const row = await env.DB
      .prepare(`SELECT
                  EXISTS (SELECT 1 FROM accounts WHERE name_key = ?1) AS account,
                  EXISTS (SELECT 1 FROM nicks WHERE name_key = ?1 AND owner_hash = ?2)
                    OR EXISTS (SELECT 1 FROM nick_devices WHERE name_key = ?1 AND owner_hash = ?2) AS device`)
      .bind(key, ownerHash)
      .first();
    // Одинаковый отказ: ответ не выдаёт, есть ли у чужого ника профиль.
    if (!row.account || !row.device) return { status: 403 };
    return { key };
  }

  const denied = (auth, request, env) => (auth.status === 400
    ? json({ error: 'Некорректный запрос.' }, 400, request, env)
    : refuse('stats_denied', 'Статистика профиля доступна только с устройств, вошедших в этот профиль.', 403, request, env));

  async function sync(request, env) {
    const body = (await readJson(request, MAX_SYNC_BYTES)) ?? {};
    const auth = await authorize(env, body);
    if (!auth.key) return denied(auth, request, env);
    const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
    const incoming = Array.isArray(body.games) ? body.games : [];
    if (incoming.length > SYNC_BATCH) return json({ error: `Не больше ${SYNC_BATCH} партий за раз.` }, 400, request, env);

    const now = Date.now();
    const games = incoming.map((g) => cleanGameStat(g, now)).filter(Boolean);
    if (games.length) {
      const recent = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM game_stats WHERE name_key = ? AND received_ms > ?')
        .bind(auth.key, now - 60 * 60 * 1000)
        .first();
      if (recent.n + games.length > MAX_NEW_PER_HOUR) {
        return refuse('stats_limit', 'Слишком много партий за час — остальные отправятся позже.', 429, request, env);
      }
      const insert = env.DB.prepare(`INSERT OR IGNORE INTO game_stats
        (name_key, game_id, at_ms, kind, mode, speed, score, length, duration_ms, end_reason, result, level, platform,
         apples, bonus_slow, bonus_ghost, bonus_bad, legacy, received_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      await env.DB.batch([
        ...games.map((g) => insert.bind(
          auth.key, g.id, g.at, g.kind, g.mode, g.speed, g.score, g.length, g.durationMs, g.end, g.result, g.level,
          g.platform, g.apples, g.bonuses.slow, g.bonuses.ghost, g.bonuses.bad, g.legacy ? 1 : 0, now,
        )),
        // Не больше MAX_SERVER_GAMES последних партий на профиль.
        env.DB.prepare(`DELETE FROM game_stats WHERE name_key = ?1 AND seq NOT IN (
                          SELECT seq FROM game_stats WHERE name_key = ?1 ORDER BY at_ms DESC, seq DESC LIMIT ?2)`)
          .bind(auth.key, MAX_SERVER_GAMES),
      ]);
    }

    const { results } = await env.DB
      .prepare('SELECT * FROM game_stats WHERE name_key = ? AND seq > ? ORDER BY seq LIMIT ?')
      .bind(auth.key, since, PAGE + 1)
      .all();
    const page = results.slice(0, PAGE);
    const meta = await env.DB
      .prepare(`SELECT (SELECT COUNT(*) FROM game_stats WHERE name_key = ?1) AS total,
                       COALESCE((SELECT epoch FROM stats_meta WHERE name_key = ?1), 0) AS epoch`)
      .bind(auth.key)
      .first();
    return json({
      ok: true,
      epoch: meta.epoch,
      accepted: games.length,
      games: page.map(rowToGame),
      cursor: page.length ? page.at(-1).seq : since,
      more: results.length > PAGE,
      total: meta.total,
    }, 200, request, env);
  }

  async function compare(request, env) {
    const body = (await readJson(request)) ?? {};
    const auth = await authorize(env, body);
    if (!auth.key) return denied(auth, request, env);

    const modes = {};
    for (const mode of MODES) {
      // Свой лучший — из общей таблицы или из своей статистики (рекорд могли не отправлять);
      // чужие — лучшие результаты в общей таблице, по одному на ник.
      const row = await env.DB
        .prepare(`WITH best AS (
                    SELECT COALESCE(name_key, lower(trim(name))) AS k, MAX(score) AS s
                    FROM records WHERE mode = ?1 GROUP BY k
                  ), me AS (
                    SELECT MAX(s) AS s FROM (
                      SELECT s FROM best WHERE k = ?2
                      UNION ALL SELECT MAX(score) FROM game_stats WHERE name_key = ?2 AND mode = ?1 AND kind = 'solo'
                    )
                  )
                  SELECT (SELECT s FROM me) AS mine,
                         COUNT(*) AS others,
                         COALESCE(SUM(CASE WHEN s < (SELECT s FROM me) THEN 1 ELSE 0 END), 0) AS below
                  FROM best WHERE k <> ?2`)
        .bind(mode, auth.key)
        .first();
      modes[mode] = { mine: row.mine ?? null, others: row.others, below: row.below };
    }

    const bots = {};
    for (const level of LEVELS) {
      const row = await env.DB
        .prepare(`WITH r AS (
                    SELECT name_key, 1.0 * SUM(result = 'win') / COUNT(*) AS rate, COUNT(*) AS n
                    FROM game_stats WHERE kind = 'bot' AND level = ?1 AND result IS NOT NULL
                    GROUP BY name_key HAVING COUNT(*) >= ?3
                  )
                  SELECT (SELECT rate FROM r WHERE name_key = ?2) AS mine,
                         COUNT(*) AS others,
                         COALESCE(SUM(CASE WHEN rate < (SELECT rate FROM r WHERE name_key = ?2) THEN 1 ELSE 0 END), 0) AS below
                  FROM r WHERE name_key <> ?2`)
        .bind(level, auth.key, MIN_BOT_GAMES)
        .first();
      bots[level] = { mine: row.mine ?? null, others: row.others, below: row.below };
    }
    return json({ ok: true, modes, bots, minPlayers: MIN_COMPARE_PLAYERS, minBotGames: MIN_BOT_GAMES }, 200, request, env);
  }

  async function remove(request, env) {
    const body = (await readJson(request)) ?? {};
    const auth = await authorize(env, body);
    if (!auth.key) return denied(auth, request, env);
    const [deleted] = await env.DB.batch([
      env.DB.prepare('DELETE FROM game_stats WHERE name_key = ?').bind(auth.key),
      env.DB.prepare(`INSERT INTO stats_meta (name_key, epoch, reset_ms) VALUES (?1, 1, ?2)
                      ON CONFLICT (name_key) DO UPDATE SET epoch = epoch + 1, reset_ms = excluded.reset_ms`)
        .bind(auth.key, Date.now()),
    ]);
    const meta = await env.DB.prepare('SELECT epoch FROM stats_meta WHERE name_key = ?').bind(auth.key).first();
    return json({ ok: true, deleted: deleted.meta.changes ?? 0, epoch: meta.epoch }, 200, request, env);
  }

  return { sync, compare, remove };
}
