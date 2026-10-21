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

test('«Зал славы» открывается, когда собраны все остальные достижения, и только тогда', () => {
  const book = new AchievementBook(memoryStorage());
  for (const bot of BOT_ORDER) book.recordBotWin(bot);
  assert.ok(book.has('ouroboros'));
  assert.equal(book.has('hall-of-fame'), false, 'обучение ещё не пройдено');
  const fresh = book.award('first-steps').map((a) => a.id);
  assert.deepEqual(fresh, ['first-steps', 'hall-of-fame']);
  assert.deepEqual(book.award('first-steps'), [], 'второй раз ничего не открывается');
  assert.equal(ACHIEVEMENTS.find((a) => a.id === 'hall-of-fame').rarity, 'mythic');
});

test('если обучение пройдено первым, «Зал славы» открывается вместе с последним ботом', () => {
  const book = new AchievementBook(memoryStorage());
  book.award('first-steps');
  for (const bot of ['easy', 'medium', 'hard']) book.recordBotWin(bot);
  assert.deepEqual(book.recordBotWin('claude').map((a) => a.id), ['beat-claude', 'ouroboros', 'hall-of-fame']);
});

test('медали ботов: чем сложнее бот, тем ценнее редкость — прогресс виден по ободу', async () => {
  const { RARITIES } = await import('../src/achievements.js');
  const rank = (id) => RARITIES.indexOf(ACHIEVEMENTS.find((a) => a.id === id).rarity);
  const ladder = BOT_ORDER.map((bot) => rank(`beat-${bot}`));
  for (let i = 1; i < ladder.length; i += 1) assert.ok(ladder[i] > ladder[i - 1], `${BOT_ORDER[i]} ценнее ${BOT_ORDER[i - 1]}`);
  assert.ok(ACHIEVEMENTS.every((a) => RARITIES.includes(a.rarity)), 'у всех известная редкость');
  assert.equal(rank('hall-of-fame'), RARITIES.length - 1, '«Зал славы» — самая ценная');
});
