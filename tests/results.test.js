import { test } from 'node:test';
import assert from 'node:assert/strict';

import { duelSummary, soloSummary } from '../src/ui/results.js';

const local = { kind: 'local', myIndex: 0, playerName: (i) => `Игрок ${i + 1}` };
const vsBot = { kind: 'bot', myIndex: 0, playerName: (i) => (i === 0 ? 'Вы' : 'Ужик') };
const onlineSlot1 = { kind: 'online', myIndex: 1, playerName: (i) => (i === 1 ? 'Вы' : 'Друг') };

test('одиночная игра: заголовок и причина', () => {
  assert.deepEqual(soloSummary('wall'), { title: 'Игра окончена', reason: 'Врезались в стену' });
  assert.deepEqual(soloSummary('time'), { title: 'Финиш!', reason: 'Время вышло' });
  assert.deepEqual(soloSummary('???'), { title: 'Игра окончена', reason: '' });
});

test('одна клавиатура: победителя называют по номеру, «моей» победы нет', () => {
  const s = duelSummary({ winner: 1, reason: 'wall' }, { scores: [3, 5], deaths: ['wall', null] }, local);
  assert.equal(s.title, 'Победил игрок 2!');
  assert.equal(s.reason, 'Игрок 1: врезался в стену');
  assert.equal(s.left, 'Игрок 1 3');
  assert.equal(s.right, '5 Игрок 2');
  assert.equal(s.sound, 'record');
  assert.equal(s.iWon, false);
});

test('против бота: победа и поражение', () => {
  const win = duelSummary({ winner: 0, reason: 'rival' }, { scores: [4, 1], deaths: [null, 'rival'] }, vsBot);
  assert.equal(win.title, 'Победа!');
  assert.equal(win.reason, 'Ужик: врезался в соперника');
  assert.equal(win.iWon, true);
  assert.equal(win.sound, 'record');

  const loss = duelSummary({ winner: 1, reason: 'self' }, { scores: [4, 1], deaths: ['self', null] }, vsBot);
  assert.equal(loss.title, 'Поражение');
  assert.equal(loss.reason, 'Вы: укусил сам себя');
  assert.equal(loss.iWon, false);
  assert.equal(loss.sound, 'die');
});

test('онлайн: победа считается со стороны своего слота', () => {
  const s = duelSummary({ winner: 1, reason: 'stone' }, { scores: [0, 2], deaths: ['stone', null] }, onlineSlot1);
  assert.equal(s.title, 'Победа!');
  assert.equal(s.iWon, true);
  assert.equal(s.left, 'Друг 0');
  assert.equal(s.right, '2 Вы');
});

test('ничьи: лоб в лоб, оба выбыли, время', () => {
  const headOn = duelSummary({ winner: null, reason: 'headOn' }, { scores: [1, 1], deaths: ['headOn', 'headOn'] }, local);
  assert.equal(headOn.title, 'Ничья');
  assert.equal(headOn.reason, 'Столкновение лоб в лоб');
  assert.equal(headOn.sound, 'die');

  const both = duelSummary({ winner: null, reason: 'wall' }, { scores: [1, 1], deaths: ['wall', 'self'] }, vsBot);
  assert.equal(both.reason, 'Оба выбыли одновременно');
  assert.equal(both.iWon, false);

  const time = duelSummary({ winner: 0, reason: 'time' }, { scores: [6, 2], deaths: [null, null] }, vsBot);
  assert.equal(time.reason, 'Время вышло — решили очки');
  assert.equal(time.title, 'Победа!');
});
