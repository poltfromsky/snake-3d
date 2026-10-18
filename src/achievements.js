/**
 * Достижения (как в Steam). Хранятся в браузере игрока.
 * Логика без DOM: какие есть, какие открыты, что открывается за победу над ботом.
 * icon — имя знака из src/ui/icons.js (свой набор, не эмодзи).
 */

const STORAGE_KEY = 'snake3d.achievements.v1';

export const ACHIEVEMENTS = Object.freeze([
  {
    id: 'beat-easy', bot: 'easy', icon: 'snake', rarity: 'common',
    title: 'Ужик, прости', description: 'Победить Ужика — лёгкого бота',
  },
  {
    id: 'beat-medium', bot: 'medium', icon: 'flask', rarity: 'common',
    title: 'Яд не подействовал', description: 'Победить Гадюку — среднего бота',
  },
  {
    id: 'beat-hard', bot: 'hard', icon: 'spiral', rarity: 'rare',
    title: 'Выскользнул из объятий', description: 'Победить Анаконду — сложного бота',
  },
  {
    id: 'beat-claude', bot: 'claude', icon: 'crown', rarity: 'legendary',
    title: 'Бог змейки', description: 'Победить Claude — самого сильного бота',
  },
  {
    id: 'ouroboros', icon: 'infinity', rarity: 'legendary',
    title: 'Уроборос', description: 'Победить всех четырёх ботов: круг замкнулся',
  },
  {
    id: 'first-steps', icon: 'cap', rarity: 'common',
    title: 'Первые шаги', description: 'Пройти обучение',
  },
]);

const BOT_ACHIEVEMENTS = ACHIEVEMENTS.filter((a) => a.bot);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class AchievementBook {
  /** @param {Storage|null} storage localStorage или заглушка в тестах */
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.unlocked = this.load();
  }

  load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.unlocked));
    } catch {
      // Хранилище недоступно (приватный режим) — достижения живут до перезагрузки.
    }
  }

  has(id) {
    return Boolean(this.unlocked[id]);
  }

  /** Открывает достижение. Возвращает его описание, если открыто впервые, иначе null. */
  unlock(id, at = Date.now()) {
    const achievement = ACHIEVEMENTS.find((a) => a.id === id);
    if (!achievement || this.has(id)) return null;
    this.unlocked[id] = at;
    this.save();
    return achievement;
  }

  /** Победа над ботом: его достижение и, если побеждены все, «Уроборос». */
  recordBotWin(botId) {
    const fresh = [];
    const own = BOT_ACHIEVEMENTS.find((a) => a.bot === botId);
    const first = own && this.unlock(own.id);
    if (first) fresh.push(first);
    if (BOT_ACHIEVEMENTS.every((a) => this.has(a.id))) {
      const all = this.unlock('ouroboros');
      if (all) fresh.push(all);
    }
    return fresh;
  }

  /** Все достижения с отметкой, когда открыты (null — ещё нет). */
  list() {
    return ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: this.unlocked[a.id] ?? null }));
  }
}
