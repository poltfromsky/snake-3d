/**
 * Личная статистика игрока: из записей о партиях (storage: loadGameStats) и прежней истории
 * попыток (loadHistory) — прогресс, рекорды, почему проигрывает, боты и онлайн, активность.
 *
 * Чистые функции без DOM: всё считается здесь и проверяется юнит-тестами (tests/stats.test.js),
 * экран (src/ui/stats-screen.js) только рисует готовый результат.
 *
 * Запись о партии (новая, с версии 1.11.0):
 *   { at, kind: 'solo'|'bot'|'online', mode, speed, score, length, durationMs,
 *     end: 'wall'|'self'|'stone'|'poison'|'rival'|'headOn'|'time'|null,
 *     result: 'win'|'loss'|'draw' (дуэли), level (бот), platform, apples, bonuses: {slow, ghost, bad} }
 * Прежняя история знает только счёт, длину, дату и скорость одиночных партий.
 */

export const MODES_ORDER = ['classic', 'walls', 'timed'];
export const SPEEDS_ORDER = ['slow', 'normal', 'fast'];
export const BOTS_ORDER = ['easy', 'medium', 'hard', 'claude'];

/** Сколько последних партий на графике прогресса и сколько — в «среднем за последние». */
export const PROGRESS_POINTS = 30;
export const AVERAGE_WINDOW = 10;
/** Календарь активности — последние 12 недель. */
export const ACTIVITY_DAYS = 84;
/** Подсказка «почему проигрываете» — только когда проигрышей набралось хоть сколько-то. */
const INSIGHT_MIN_LOSSES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Дата партии по местному времени игрока: «2026-10-21». */
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Полночь (местное время) дня, в который попадает ms. */
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Только целые записи: в хранилище мог попасть мусор (ручная правка, старая версия). */
function cleanGames(games) {
  return (Array.isArray(games) ? games : []).filter((g) => g && isNum(g.at) && ['solo', 'bot', 'online'].includes(g.kind));
}

/**
 * Одиночные партии по порядку времени: новые записи + старая история до начала записей
 * (после этого момента та же партия есть в обоих местах — берём из записей, там подробнее).
 */
function soloTimeline(games, history) {
  const solo = games.filter((g) => g.kind === 'solo');
  const firstRecorded = {};
  for (const g of solo) firstRecorded[g.mode] = Math.min(firstRecorded[g.mode] ?? Infinity, g.at);
  const old = [];
  for (const [mode, list] of Object.entries(history ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (!a || !isNum(a.score) || !isNum(a.date)) continue;
      if (a.date >= (firstRecorded[mode] ?? Infinity)) continue;
      old.push({
        at: a.date, kind: 'solo', mode, speed: a.speed ?? 'normal', score: a.score, length: a.length ?? null, old: true,
      });
    }
  }
  return [...old, ...solo].sort((a, b) => a.at - b.at);
}

const average = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);

function progressFor(timeline, mode) {
  const scores = timeline.filter((g) => g.mode === mode);
  const recent = scores.slice(-AVERAGE_WINDOW).map((g) => g.score);
  const before = scores.slice(-2 * AVERAGE_WINDOW, -AVERAGE_WINDOW).map((g) => g.score);
  const avgRecent = average(recent);
  const avgBefore = before.length >= AVERAGE_WINDOW / 2 ? average(before) : null;
  const best = scores.reduce((b, g) => (g.score > (b?.score ?? -1) ? g : b), null);
  const bySpeed = {};
  for (const speed of SPEEDS_ORDER) {
    const top = scores.filter((g) => g.speed === speed).reduce((m, g) => Math.max(m, g.score), -1);
    bySpeed[speed] = top >= 0 ? top : null;
  }
  return {
    games: scores.length,
    points: scores.slice(-PROGRESS_POINTS).map((g) => ({ at: g.at, score: g.score, length: g.length, speed: g.speed })),
    avgRecent,
    avgBefore,
    // Насколько средний счёт последних партий выше прошлых (в долях), если есть с чем сравнить.
    change: avgBefore ? (avgRecent - avgBefore) / avgBefore : null,
    best: best ? { score: best.score, at: best.at, speed: best.speed } : null,
    bySpeed,
  };
}

/** Почему заканчиваются одиночные партии. «Время вышло» — не ошибка, его считаем отдельно. */
function deathsOf(games) {
  const counts = {};
  let timeUp = 0;
  for (const g of games) {
    if (g.kind !== 'solo' || !g.end) continue;
    if (g.end === 'time') timeUp += 1;
    else counts[g.end] = (counts[g.end] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const list = Object.entries(counts)
    .map(([reason, count]) => ({ reason, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return {
    total, timeUp, list, insight: total >= INSIGHT_MIN_LOSSES ? list[0].reason : null,
  };
}

function duelRecord(list) {
  const r = { win: 0, loss: 0, draw: 0 };
  for (const g of list) if (g.result in r) r[g.result] += 1;
  const played = r.win + r.loss + r.draw;
  return { ...r, played, winRate: played ? r.win / played : null };
}

function activityOf(timeline, games, now, days) {
  const byDay = new Map();
  const add = (at) => byDay.set(dayKey(at), (byDay.get(dayKey(at)) ?? 0) + 1);
  for (const g of timeline) add(g.at);
  for (const g of games) if (g.kind !== 'solo') add(g.at);

  const today = startOfDay(now);
  const cells = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    // Через полдень: переход на летнее время не сдвигает дату.
    const at = today - i * DAY_MS + DAY_MS / 2;
    const key = dayKey(at);
    cells.push({ day: key, at, count: byDay.get(key) ?? 0 });
  }

  // Серия: дни подряд с партиями, считая от сегодня (или от вчера — сегодня ещё можно успеть).
  let current = 0;
  let at = today + DAY_MS / 2;
  if (!byDay.has(dayKey(at))) at -= DAY_MS;
  while (byDay.has(dayKey(at))) {
    current += 1;
    at -= DAY_MS;
  }
  const sortedDays = [...byDay.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const key of sortedDays) {
    const at = new Date(`${key}T12:00:00`).getTime();
    run = prev !== null && Math.round((at - prev) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = at;
  }
  return {
    cells,
    activeDays: cells.filter((c) => c.count > 0).length,
    maxPerDay: cells.reduce((m, c) => Math.max(m, c.count), 0),
    streak: current,
    longestStreak: longest,
  };
}

/**
 * Вся статистика для экрана «Моя статистика».
 * @param {{games: object[], history: object, now?: number}} input
 */
export function summarizeStats({ games, history, now = Date.now() }) {
  const recorded = cleanGames(games);
  const timeline = soloTimeline(recorded, history);
  const duels = recorded.filter((g) => g.kind !== 'solo');
  const sum = (key) => recorded.reduce((s, g) => s + (isNum(g[key]) ? g[key] : 0), 0);

  const progress = {};
  for (const mode of MODES_ORDER) progress[mode] = progressFor(timeline, mode);
  const best = timeline.reduce((b, g) => (g.score > (b?.score ?? -1) ? g : b), null);

  const bots = {};
  for (const level of BOTS_ORDER) bots[level] = duelRecord(duels.filter((g) => g.kind === 'bot' && g.level === level));

  return {
    totals: {
      games: timeline.length + duels.length,
      solo: timeline.length,
      duels: duels.length,
      playMs: sum('durationMs'),
      apples: sum('apples'),
      best: best ? { score: best.score, mode: best.mode } : null,
    },
    // С какого дня есть подробные записи (причины, время, боты) — раньше их не вели.
    detailedSince: recorded.length ? Math.min(...recorded.map((g) => g.at)) : null,
    progress,
    deaths: deathsOf(recorded),
    bots,
    online: duelRecord(duels.filter((g) => g.kind === 'online')),
    activity: activityOf(timeline, duels, now, ACTIVITY_DAYS),
  };
}

/** «1 ч 05 мин», «12 мин», «меньше минуты». */
export function formatPlayTime(ms) {
  const minutes = Math.floor((ms ?? 0) / 60000);
  if (minutes < 1) return ms > 0 ? 'меньше минуты' : '0 мин';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}

/** Склонение: plural(5, ['партия', 'партии', 'партий']) → «партий». */
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
