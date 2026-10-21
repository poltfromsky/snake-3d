/**
 * Синхронизация личной статистики между устройствами одного профиля (сервер — server/src/stats.js).
 *
 * Как устроено (так делают офлайн-приложения — очередь на устройстве и догрузка «с отметки»):
 *   - каждая партия получает id при записи и хозяина (ник профиля, если вошли в профиль);
 *   - неотправленные партии профиля уходят пачками; повтор безопасен — сервер узнаёт id;
 *   - в ответ сервер присылает партии с других устройств, начиная с отметки cursor; отметка
 *     сохраняется только вместе с полученной пачкой — обрыв связи ничего не теряет и не задваивает;
 *   - epoch — «поколение» статистики: если игрок удалил её на другом устройстве, здесь старые
 *     партии профиля стираются;
 *   - без связи — повтор через 30 с, 2 мин, 10 мин (сервер не долбим).
 * Партии, сыгранные без профиля, при первом входе в профиль на этом устройстве переходят к нему
 * (вместе со старой историей попыток — её партии получают id, одинаковый на любом устройстве).
 *
 * Хранилище: snake3d.stats.v1 = { v: 1, games: [...], sync: { [ник]: {cursor, epoch} }, historyClaimedBy }.
 */
import {
  cleanGameStat, legacyGameId, MAX_SERVER_GAMES, newGameId, SYNC_BATCH,
} from '../core/game-stats.js';

/** Сколько партий хранит устройство (все профили и игра без профиля вместе). */
export const MAX_LOCAL_GAMES = 1500;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
/** Сколько пачек за одну синхронизацию (1000 партий профиля — это 20 пачек туда и 4 страницы обратно). */
const MAX_ROUNDS = 40;
/** Партию записали — отправляем чуть погодя: вдруг игрок сразу нажал «Ещё раз». */
const AFTER_GAME_DELAY_MS = 1500;

/* ---------- Чистые функции над хранилищем (проверяются в tests/stats-sync.test.js) ---------- */

export function emptyStore() {
  return { v: 1, games: [], sync: {}, historyClaimedBy: null };
}

/** Привести хранилище к текущему виду: старые записи (до синхронизации) получают id. */
export function normalizeStore(raw) {
  const store = { ...emptyStore(), ...(raw && typeof raw === 'object' ? raw : {}) };
  store.games = Array.isArray(store.games) ? store.games.filter((g) => g && typeof g === 'object') : [];
  store.sync = store.sync && typeof store.sync === 'object' ? store.sync : {};
  for (const g of store.games) {
    if (typeof g.id !== 'string') g.id = newGameId();
    if (g.owner === undefined) g.owner = null;
    g.sent = g.sent === true;
  }
  return store;
}

/** Не больше MAX_LOCAL_GAMES: первыми уходят самые старые уже отправленные (или безхозные) партии. */
export function trimStore(store, max = MAX_LOCAL_GAMES) {
  if (store.games.length <= max) return store;
  const byAge = [...store.games].sort((a, b) => a.at - b.at);
  const drop = new Set();
  for (const g of byAge) {
    if (store.games.length - drop.size <= max) break;
    if (g.sent || !g.owner) drop.add(g);
  }
  for (const g of byAge) {
    if (store.games.length - drop.size <= max) break;
    drop.add(g);
  }
  store.games = store.games.filter((g) => !drop.has(g));
  return store;
}

/** Новая партия — в начало списка (новые первыми). */
export function addGame(store, entry, owner) {
  store.games.unshift({
    ...entry, id: entry.id ?? newGameId(), owner: owner ?? null, sent: false,
  });
  return trimStore(store);
}

/**
 * Первый вход в профиль на этом устройстве: партии без хозяина переходят к профилю.
 * Старая история попыток (только счёт, длина, дата) — тоже, но только одному профилю на устройстве
 * и только партии раньше первой подробной записи (дальше те же партии уже есть в записях).
 */
export function claimForOwner(store, key, history) {
  for (const g of store.games) if (!g.owner) g.owner = key;
  if (!store.historyClaimedBy && history && typeof history === 'object') {
    const firstRecorded = {};
    for (const g of store.games) {
      if (g.kind === 'solo' && !g.legacy) firstRecorded[g.mode] = Math.min(firstRecorded[g.mode] ?? Infinity, g.at);
    }
    const known = new Set(store.games.map((g) => g.id));
    for (const [mode, list] of Object.entries(history)) {
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (!a || !Number.isInteger(a.score) || !Number.isInteger(a.date)) continue;
        if (a.date >= (firstRecorded[mode] ?? Infinity)) continue;
        const id = legacyGameId(mode, a);
        if (known.has(id)) continue;
        known.add(id);
        store.games.push({
          id, at: a.date, kind: 'solo', mode, speed: a.speed ?? 'normal', score: a.score, length: a.length ?? null,
          legacy: true, owner: key, sent: false,
        });
      }
    }
    store.historyClaimedBy = key;
  }
  store.games.sort((a, b) => b.at - a.at);
  store.sync[key] ??= { cursor: 0, epoch: null };
  return trimStore(store);
}

/** Неотправленные партии профиля — самые старые первыми, не больше пачки. */
export function pendingFor(store, key, limit = SYNC_BATCH) {
  return store.games.filter((g) => g.owner === key && !g.sent).sort((a, b) => a.at - b.at).slice(0, limit);
}

/** Партия для сервера: без служебных полей устройства. */
export function toWire(g) {
  const wire = { ...g };
  delete wire.owner;
  delete wire.sent;
  return wire;
}

/**
 * Поколение статистики с сервера. Изменилось — значит, статистику профиля удалили на другом
 * устройстве: отправленные партии профиля здесь стираются, отметка — с начала. Неотправленные
 * остаются: их на сервере ещё не было, они уйдут в новое поколение.
 * @returns {boolean} true — был сброс
 */
export function applyEpoch(store, key, epoch) {
  const state = store.sync[key] ??= { cursor: 0, epoch: null };
  if (state.epoch === null || state.epoch === undefined) {
    state.epoch = epoch;
    return false;
  }
  if (state.epoch === epoch) return false;
  store.games = store.games.filter((g) => !(g.owner === key && g.sent));
  state.epoch = epoch;
  state.cursor = 0;
  return true;
}

/** Партии с сервера (в том числе с других устройств) — к себе, без дублей; свои отмечаются отправленными. */
export function mergeServerGames(store, key, games, now = Date.now()) {
  const byId = new Map(store.games.filter((g) => g.owner === key).map((g) => [g.id, g]));
  for (const raw of games ?? []) {
    const g = cleanGameStat(raw, now);
    if (!g) continue;
    const mine = byId.get(g.id);
    if (mine) {
      mine.sent = true;
    } else {
      const added = { ...g, owner: key, sent: true };
      store.games.push(added);
      byId.set(g.id, added);
    }
  }
  store.games.sort((a, b) => b.at - a.at);
  // На сервере — не больше MAX_SERVER_GAMES партий профиля; лишние старые здесь тоже не нужны.
  const owned = store.games.filter((g) => g.owner === key && g.sent);
  if (owned.length > MAX_SERVER_GAMES) {
    const extra = new Set(owned.slice(MAX_SERVER_GAMES));
    store.games = store.games.filter((g) => !extra.has(g));
  }
  return trimStore(store);
}

/** Какие партии показывать: профиля, если вошли, иначе — сыгранные без профиля. */
export function visibleGames(store, key) {
  return store.games.filter((g) => (key ? g.owner === key : !g.owner));
}

/** Вышли из профиля: его отправленные партии с устройства убираем (они на сервере), неотправленные ждут входа. */
export function forgetOwner(store, key) {
  store.games = store.games.filter((g) => !(g.owner === key && g.sent));
  delete store.sync[key];
  return store;
}

/* ---------- Синхронизация ---------- */

/**
 * @param {object} deps
 * @param {() => object} deps.load прочитать хранилище (сырое)
 * @param {(store: object) => void} deps.save записать хранилище
 * @param {() => object} deps.history старая история попыток (storage.loadHistory)
 * @param {() => ({key: string, name: string, device: string} | null)} deps.owner кто вошёл в профиль
 * @param {(path: string, body: object) => Promise<object>} deps.post запрос к серверу
 * @param {(state: object) => void} [deps.onState] состояние синхронизации изменилось
 */
export function createStatsSync({
  load, save, history, owner, post, onState = () => {},
}) {
  let running = null;
  let retryTimer = null;
  let afterGameTimer = null;
  let failures = 0;
  let lastOwnerKey = owner()?.key ?? null;
  let state = { status: 'idle', at: null, total: null };

  const setState = (next) => {
    state = { ...state, ...next };
    onState(state);
  };
  const read = () => normalizeStore(load());

  /** Вошли в профиль на этом устройстве — партии без хозяина и старая история переходят к нему. */
  function claim(who) {
    const store = read();
    if (!store.sync[who.key] || store.games.some((g) => !g.owner) || !store.historyClaimedBy) {
      save(claimForOwner(store, who.key, history()));
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const delay = RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)];
    retryTimer = setTimeout(() => api.syncNow(), delay);
    retryTimer.unref?.(); // в тестах (Node) таймер не держит процесс; в браузере unref нет
  }

  async function run() {
    const who = owner();
    if (!who) {
      setState({ status: 'local' });
      return state;
    }
    claim(who);
    setState({ status: 'syncing' });
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const pending = pendingFor(read(), who.key);
      const since = read().sync[who.key]?.cursor ?? 0;
      const res = await post('stats/sync', {
        name: who.name, device: who.device, games: pending.map(toWire), since,
      });
      // Пока шёл запрос, могла закончиться ещё одна партия — читаем хранилище заново.
      const store = read();
      const reset = applyEpoch(store, who.key, res.epoch ?? 0);
      if (!reset) {
        const sentIds = new Set(pending.map((g) => g.id));
        for (const g of store.games) if (g.owner === who.key && sentIds.has(g.id)) g.sent = true;
        mergeServerGames(store, who.key, res.games);
        store.sync[who.key].cursor = res.cursor ?? since;
      }
      save(store);
      if (!reset && !res.more && !pendingFor(store, who.key).length) {
        setState({ status: 'synced', at: Date.now(), total: res.total ?? null });
        return state;
      }
    }
    setState({ status: 'synced', at: Date.now() });
    return state;
  }

  const api = {
    get state() { return state; },

    /** Синхронизировать сейчас (одновременно — только одна; повторный вызов ждёт текущую). */
    syncNow() {
      if (running) return running;
      clearTimeout(retryTimer);
      running = run()
        .then((s) => {
          failures = 0;
          return s;
        }, (err) => {
          failures += 1;
          const status = err?.status === 403 ? 'denied' : err?.status === 429 ? 'limited' : 'offline';
          setState({ status });
          if (status !== 'denied') scheduleRetry();
          return state;
        })
        .finally(() => { running = null; });
      return running;
    },

    /** Записать партию; если вошли в профиль — отправить чуть погодя. */
    record(entry) {
      const who = owner();
      const store = read();
      save(addGame(store, entry, who?.key ?? null));
      if (!who) return;
      clearTimeout(afterGameTimer);
      afterGameTimer = setTimeout(() => api.syncNow(), AFTER_GAME_DELAY_MS);
      afterGameTimer.unref?.();
    },

    /** Партии для экрана статистики: профиля (если вошли) или сыгранные без профиля. */
    games() {
      const who = owner();
      if (who) claim(who);
      return visibleGames(read(), who?.key ?? null);
    },

    /** Вошли, вышли, сменили профиль: вышли — убрать его отправленные партии, вошли — синхронизировать. */
    ownerChanged() {
      const who = owner();
      if ((who?.key ?? null) === lastOwnerKey) return;
      if (lastOwnerKey) save(forgetOwner(read(), lastOwnerKey));
      lastOwnerKey = who?.key ?? null;
      failures = 0;
      if (who) api.syncNow();
      else setState({ status: 'local', at: null, total: null });
    },

    /** Сравнение с другими игроками (только профилю). */
    compare() {
      const who = owner();
      if (!who) return Promise.resolve(null);
      return post('stats/compare', { name: who.name, device: who.device });
    },

    /** Удалить статистику профиля: на сервере, здесь и (при их синхронизации) на остальных устройствах. */
    async deleteAll() {
      const who = owner();
      if (!who) return;
      const res = await post('stats/delete', { name: who.name, device: who.device });
      const store = read();
      store.games = store.games.filter((g) => g.owner !== who.key);
      store.sync[who.key] = { cursor: 0, epoch: res.epoch ?? null };
      save(store);
      setState({ status: 'synced', at: Date.now(), total: 0 });
    },
  };
  return api;
}
