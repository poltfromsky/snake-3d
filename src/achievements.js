/**
 * Достижения (как в Steam). Хранятся в браузере игрока.
 * Логика без DOM: какие есть, какие открыты, что открывается за победу над ботом.
 * У каждого — медаль: картинка assets/medals/<id>.png, снятая 3D-рендером самой игры
 * (tools/render-art.mjs). Редкость — обод медали, и по ботам она растёт вместе со сложностью:
 * обычная (сталь) → редкая (синий) → эпическая (рубин) → легендарная (золото) → мифическая (перламутр).
 */

const STORAGE_KEY = 'snake3d.achievements.v1';
/** Достижение за все остальные. */
const HALL_OF_FAME = 'hall-of-fame';

export const ACHIEVEMENTS = Object.freeze([
  // Первым — обучение: с него игрок начинает.
  {
    id: 'first-steps', rarity: 'common',
    title: 'Первые шаги', description: 'Пройти обучение',
  },
  {
    id: 'beat-easy', bot: 'easy', rarity: 'common',
    title: 'Ужик, прости', description: 'Победить Ужика — лёгкого бота',
  },
  {
    id: 'beat-medium', bot: 'medium', rarity: 'rare',
    title: 'Яд не подействовал', description: 'Победить Гадюку — среднего бота',
  },
  {
    id: 'beat-hard', bot: 'hard', rarity: 'epic',
    title: 'Выскользнул из объятий', description: 'Победить Анаконду — сложного бота',
  },
  {
    id: 'beat-claude', bot: 'claude', rarity: 'legendary',
    title: 'Бог змейки', description: 'Победить Claude — самого сильного бота',
  },
  {
    id: 'ouroboros', rarity: 'legendary',
    title: 'Уроборос', description: 'Победить всех четырёх ботов: круг замкнулся',
  },
  {
    id: HALL_OF_FAME, rarity: 'mythic',
    title: 'Зал славы', description: 'Собрать все остальные достижения',
  },
]);

/** Редкости от простой к самой ценной. */
export const RARITIES = Object.freeze(['common', 'rare', 'epic', 'legendary', 'mythic']);

/** Картинка медали достижения. */
export const medalUrl = (id) => `assets/medals/${id}.png`;

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

  /**
   * Открыть достижение и всё, что из-за него открылось: «Зал славы», если собраны все остальные.
   * @returns {object[]} впервые открытые — по порядку, для всплывашек
   */
  award(id) {
    const fresh = [];
    const first = this.unlock(id);
    if (first) fresh.push(first);
    if (ACHIEVEMENTS.every((a) => a.id === HALL_OF_FAME || this.has(a.id))) {
      const hall = this.unlock(HALL_OF_FAME);
      if (hall) fresh.push(hall);
    }
    return fresh;
  }

  /** Победа над ботом: его достижение, «Уроборос», если побеждены все, и «Зал славы». */
  recordBotWin(botId) {
    const own = BOT_ACHIEVEMENTS.find((a) => a.bot === botId);
    const fresh = own ? this.award(own.id) : [];
    if (BOT_ACHIEVEMENTS.every((a) => this.has(a.id))) fresh.push(...this.award('ouroboros'));
    return fresh;
  }

  /** Все достижения с отметкой, когда открыты (null — ещё нет). */
  list() {
    return ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: this.unlocked[a.id] ?? null }));
  }
}
