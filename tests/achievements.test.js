import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACHIEVEMENTS, AchievementBook } from '../src/achievements.js';
import { BOT_ORDER } from '../src/core/bot.js';

/** Заглушка localStorage. */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

test('у каждого бота своё достижение, плюс «Уроборос» за всех', () => {
  for (const bot of BOT_ORDER) assert.ok(ACHIEVEMENTS.some((a) => a.bot === bot), bot);
  assert.ok(ACHIEVEMENTS.find((a) => a.id === 'ouroboros'));
  assert.equal(ACHIEVEMENTS.find((a) => a.bot === 'claude').title, 'Бог змейки');
});

test('достижение открывается один раз', () => {
  const book = new AchievementBook(memoryStorage());
  assert.equal(book.recordBotWin('easy').length, 1);
  assert.equal(book.recordBotWin('easy').length, 0);
});

test('после победы над всеми четырьмя открывается «Уроборос»', () => {
  const book = new AchievementBook(memoryStorage());
  book.recordBotWin('easy');
  book.recordBotWin('medium');
  book.recordBotWin('hard');
  const last = book.recordBotWin('claude').map((a) => a.id);
  assert.deepEqual(last, ['beat-claude', 'ouroboros']);
});

test('достижения сохраняются между запусками', () => {
  const storage = memoryStorage();
  new AchievementBook(storage).recordBotWin('hard');
  const again = new AchievementBook(storage);
  assert.ok(again.has('beat-hard'));
  assert.ok(again.list().find((a) => a.id === 'beat-hard').unlockedAt);
});

test('испорченное хранилище не ломает игру', () => {
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full'); } };
  const book = new AchievementBook(broken);
  assert.equal(book.recordBotWin('easy').length, 1);
});
