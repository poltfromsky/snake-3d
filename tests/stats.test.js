import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_DAYS, dayKey, formatPlayTime, plural, PROGRESS_POINTS, summarizeStats,
} from '../src/core/stats.js';

// Полдень 21 октября 2026 по местному времени — «сейчас» во всех тестах.
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n, hour = 12) => new Date(2026, 9, 21 - n, hour, 0, 0).getTime();

const solo = (at, score, extra = {}) => ({
  at, kind: 'solo', mode: 'classic', speed: 'normal', score, length: 3 + score / 10, durationMs: 60_000, apples: score / 10, ...extra,
});

test('пусто — нули и пустые блоки, без ошибок', () => {
  const s = summarizeStats({ games: [], history: {}, now: NOW });
  assert.equal(s.totals.games, 0);
  assert.equal(s.totals.best, null);
  assert.equal(s.detailedSince, null);
  assert.equal(s.progress.classic.points.length, 0);
  assert.equal(s.deaths.total, 0);
  assert.equal(s.deaths.insight, null);
  assert.equal(s.bots.easy.played, 0);
  assert.equal(s.activity.cells.length, ACTIVITY_DAYS);
  assert.equal(s.activity.streak, 0);
});

test('старая история и новые записи не считаются дважды', () => {
  const history = {
    classic: [
      { score: 50, length: 8, date: daysAgo(1), speed: 'normal' }, // та же партия, что в записях
      { score: 30, length: 6, date: daysAgo(5), speed: 'normal' }, // до начала записей
      { score: 20, length: 5, date: daysAgo(6), speed: 'fast' },
    ],
  };
  const games = [solo(daysAgo(1), 50, { end: 'self' })];
  const s = summarizeStats({ games, history, now: NOW });
  assert.equal(s.totals.solo, 3);
  assert.deepEqual(s.progress.classic.points.map((p) => p.score), [20, 30, 50]);
  assert.equal(s.progress.classic.bySpeed.fast, 20);
  assert.equal(s.progress.classic.bySpeed.normal, 50);
  assert.equal(s.progress.classic.bySpeed.slow, null);
  assert.deepEqual(s.totals.best, { score: 50, mode: 'classic' });
});

test('прогресс: последние партии, средний «сейчас» против «раньше»', () => {
  const games = [];
  for (let i = 0; i < 40; i += 1) games.push(solo(NOW - (40 - i) * 60_000, i < 30 ? 40 : 60));
  const p = summarizeStats({ games, history: {}, now: NOW }).progress.classic;
  assert.equal(p.games, 40);
  assert.equal(p.points.length, PROGRESS_POINTS);
  assert.equal(p.avgRecent, 60);
  assert.equal(p.avgBefore, 40);
  assert.ok(Math.abs(p.change - 0.5) < 1e-9, 'вырос на 50 %');
  // Мало партий — сравнивать не с чем.
  const few = summarizeStats({ games: games.slice(0, 12), history: {}, now: NOW }).progress.classic;
  assert.equal(few.avgBefore, null);
  assert.equal(few.change, null);
});

test('почему проигрываю: доли без «время вышло», подсказка — по самой частой причине', () => {
  const games = [
    ...Array.from({ length: 4 }, (_, i) => solo(daysAgo(0) - i, 10, { end: 'self' })),
    solo(daysAgo(0) - 10, 10, { end: 'wall' }),
    solo(daysAgo(0) - 11, 10, { end: 'stone' }),
    solo(daysAgo(0) - 12, 10, { end: 'time', mode: 'timed' }),
  ];
  const d = summarizeStats({ games, history: {}, now: NOW }).deaths;
  assert.equal(d.total, 6);
  assert.equal(d.timeUp, 1);
  assert.deepEqual(d.list.map((x) => x.reason), ['self', 'stone', 'wall']);
  assert.ok(Math.abs(d.list[0].share - 4 / 6) < 1e-9);
  assert.equal(d.insight, 'self');
  // Меньше пяти проигрышей — подсказки ещё нет.
  assert.equal(summarizeStats({ games: games.slice(0, 3), history: {}, now: NOW }).deaths.insight, null);
});

test('боты и онлайн: победы, поражения, ничьи и доля побед', () => {
  const duel = (kind, result, level) => ({
    at: daysAgo(0), kind, result, level, mode: 'walls', score: 10, durationMs: 30_000,
  });
  const games = [duel('bot', 'win', 'easy'), duel('bot', 'win', 'easy'), duel('bot', 'loss', 'easy'),
    duel('bot', 'loss', 'claude'), duel('online', 'draw'), duel('online', 'win')];
  const s = summarizeStats({ games, history: {}, now: NOW });
  assert.deepEqual(s.bots.easy, {
    win: 2, loss: 1, draw: 0, played: 3, winRate: 2 / 3,
  });
  assert.equal(s.bots.medium.played, 0);
  assert.equal(s.bots.medium.winRate, null);
  assert.equal(s.bots.claude.loss, 1);
  assert.equal(s.online.played, 2);
  assert.equal(s.online.winRate, 0.5);
  assert.equal(s.totals.duels, 6);
  assert.equal(s.totals.playMs, 6 * 30_000);
});

test('активность: календарь, дни с партиями и серия дней подряд', () => {
  const games = [
    solo(daysAgo(0, 9), 10), solo(daysAgo(0, 20), 10), // сегодня — 2 партии
    solo(daysAgo(1), 10), solo(daysAgo(2), 10), // ещё два дня подряд
    solo(daysAgo(5), 10), solo(daysAgo(6), 10), solo(daysAgo(7), 10), solo(daysAgo(8), 10), // 4 дня подряд раньше
    solo(daysAgo(200), 10), // давно — вне календаря, но идёт в «самую длинную серию»
  ];
  const a = summarizeStats({ games, history: {}, now: NOW }).activity;
  assert.equal(a.cells.at(-1).day, dayKey(NOW));
  assert.equal(a.cells.at(-1).count, 2);
  assert.equal(a.activeDays, 7);
  assert.equal(a.maxPerDay, 2);
  assert.equal(a.streak, 3);
  assert.equal(a.longestStreak, 4);
  // Сегодня ещё не играли, но вчера и позавчера — серия не прерывается.
  const yesterday = summarizeStats({ games: games.slice(2), history: {}, now: NOW }).activity;
  assert.equal(yesterday.streak, 2);
  // Пропустили вчера — серия 0.
  const gap = summarizeStats({ games: games.slice(3), history: {}, now: NOW + DAY }).activity;
  assert.equal(gap.streak, 0);
});

test('мусор в хранилище не ломает подсчёт', () => {
  const games = [null, { kind: 'solo' }, { at: 'вчера', kind: 'solo' }, { at: NOW, kind: 'tutorial' }, solo(NOW, 40)];
  const s = summarizeStats({ games, history: { classic: [null, { score: 'x' }], walls: 'не список' }, now: NOW });
  assert.equal(s.totals.games, 1);
});

test('подписи: время в игре и склонения', () => {
  assert.equal(formatPlayTime(0), '0 мин');
  assert.equal(formatPlayTime(30_000), 'меньше минуты');
  assert.equal(formatPlayTime(12 * 60_000), '12 мин');
  assert.equal(formatPlayTime(65 * 60_000), '1 ч 05 мин');
  const forms = ['партия', 'партии', 'партий'];
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, forms)),
    ['партия', 'партии', 'партий', 'партий', 'партия', 'партии', 'партий', 'партий']);
});
