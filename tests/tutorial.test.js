import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DIRECTIONS, ITEM } from '../src/core/game.js';
import { TutorialMode } from '../src/modes/tutorial-mode.js';
import { controlDevice, STEPS, stepText } from '../src/tutorial/steps.js';

const events = (mode, ms = 100) => mode.update(ms);
const types = (list) => list.map((e) => e.type);

/** Ведёт змейку к цели кратчайшим путём (поле с переходом через края), обходя гниль. */
function steerTo(mode, target) {
  const { head } = mode.game;
  const { width, height } = mode.size;
  const wrapDelta = (a, b, size) => {
    const d = (b - a + size) % size;
    return d > size / 2 ? d - size : d;
  };
  const dx = wrapDelta(head.x, target.x, width);
  const dy = wrapDelta(head.y, target.y, height);
  const options = [];
  if (dx > 0) options.push('RIGHT');
  if (dx < 0) options.push('LEFT');
  if (dy > 0) options.push('DOWN');
  if (dy < 0) options.push('UP');
  const bad = mode.game.items.filter((i) => i.kind === ITEM.BAD);
  const safe = options.filter((name) => {
    const d = DIRECTIONS[name];
    const x = (head.x + d.x + width) % width;
    const y = (head.y + d.y + height) % height;
    return !bad.some((b) => b.x === x && b.y === y);
  });
  const pick = safe[0] ?? options[0];
  if (pick) mode.steer('touch', pick);
}

/** Играть шаг, пока он не сменится (или не кончится время). */
function playUntilStepChanges(mode, targetKind) {
  const start = mode.index;
  const all = [];
  for (let i = 0; i < 400 && mode.index === start; i += 1) {
    const target = mode.game.items.find((it) => it.kind === targetKind);
    if (target) steerTo(mode, target);
    all.push(...events(mode, 250));
  }
  return all;
}

test('подсказки зависят от устройства: свайп, кнопки на экране, клавиатура', () => {
  const turn = STEPS.find((s) => s.id === 'turn');
  assert.match(stepText(turn, 'swipe'), /Проведите пальцем вверх/);
  assert.match(stepText(turn, 'buttons'), /кнопках внизу/);
  assert.match(stepText(turn, 'keys'), /↑ или W/);
  assert.match(stepText(STEPS.find((s) => s.id === 'apple'), 'keys'), /яблоко/, 'общий текст для всех устройств');
  assert.equal(controlDevice({ touch: false, controls: 'buttons' }), 'keys');
  assert.equal(controlDevice({ touch: true, controls: 'swipe' }), 'swipe');
  assert.equal(controlDevice({ touch: true, controls: 'buttons' }), 'buttons');
});

test('обучение проходится целиком: поворот, яблоко, гниль, бонус, опасности, готово', () => {
  const mode = new TutorialMode();
  assert.deepEqual(types(events(mode)), ['tutorialStep']);
  assert.equal(mode.step.id, 'turn');

  // Без поворота шаг не засчитывается.
  for (let i = 0; i < 10; i += 1) events(mode, 250);
  assert.equal(mode.step.id, 'turn');
  mode.steer('touch', 'UP');
  assert.ok(types(events(mode, 10)).includes('tutorialStep'));
  assert.equal(mode.step.id, 'apple');
  assert.deepEqual(mode.game.items.map((i) => i.kind), [ITEM.APPLE], 'яблоко разложено перед змейкой');

  assert.ok(types(playUntilStepChanges(mode, ITEM.APPLE)).includes('eat'));
  assert.equal(mode.step.id, 'bad');
  assert.deepEqual(mode.game.items.map((i) => i.kind).sort(), [ITEM.APPLE, ITEM.BAD].sort());

  playUntilStepChanges(mode, ITEM.APPLE);
  assert.equal(mode.step.id, 'bonus');
  playUntilStepChanges(mode, ITEM.SLOW);
  assert.equal(mode.step.id, 'danger');
  assert.equal(mode.game.obstacles.length, 2, 'камни показаны');

  // Шаги «прочитать»: змейка стоит, пока не нажмут «Дальше».
  const head = { ...mode.game.head };
  for (let i = 0; i < 10; i += 1) events(mode, 250);
  assert.deepEqual(mode.game.head, head);
  mode.next();
  assert.equal(mode.step.id, 'done');
  mode.next();
  assert.ok(types(events(mode)).includes('tutorialDone'));
  assert.equal(mode.done, true);
});

test('поле обучения одинаковое у всех: квадрат, без разницы телефон или компьютер', () => {
  const a = new TutorialMode();
  const b = new TutorialMode({ screenUp: () => 'RIGHT' });
  assert.deepEqual(a.size, { width: 11, height: 11 });
  assert.deepEqual(b.size, a.size);
  assert.deepEqual(a.game.snake, b.game.snake, 'змейка стартует в одном месте');
});

test('после поворота яблоко впереди по новому курсу и в стороне — к нему надо повернуть', () => {
  const mode = new TutorialMode();
  events(mode);
  mode.steer('touch', 'UP');
  events(mode, 10); // шаг засчитан, змейка ещё не повернула
  assert.equal(mode.step.id, 'apple');
  const [apple] = mode.game.items;
  const { head } = mode.game;
  assert.equal(apple.y, (head.y - 4 + 11) % 11, '4 клетки вперёд по новому курсу (вверх)');
  assert.equal(apple.x, (head.x + 3) % 11, '3 клетки вбок');
});

test('в начале шага змейка стоит, пока игрок не нажмёт «Понятно» или не повернёт', () => {
  const mode = new TutorialMode();
  const start = { ...mode.game.head };
  for (let i = 0; i < 10; i += 1) events(mode, 250);
  assert.deepEqual(mode.game.head, start, 'шаг «поворот»: стоит');
  mode.steer('touch', 'UP'); // поворот — и поехали
  events(mode, 10);
  assert.equal(mode.step.id, 'apple');
  assert.equal(mode.waiting, true, 'новый шаг — снова ждёт');
  const head = { ...mode.game.head };
  for (let i = 0; i < 10; i += 1) events(mode, 250);
  assert.deepEqual(mode.game.head, head, 'шаг «еда»: стоит, пока читают');
  mode.next(); // «Понятно»
  assert.ok(types(events(mode, 10)).includes('tutorialGo'));
  for (let i = 0; i < 4; i += 1) events(mode, 250);
  assert.notDeepEqual(mode.game.head, head, 'поехала');
  assert.equal(mode.step.id, 'apple', '«Понятно» шаг не пропускает');
});

test('съел гниль на шаге «обойдите» — замечание; отравился насовсем — шаг заново', () => {
  const mode = new TutorialMode();
  mode.steer('touch', 'UP');
  events(mode, 10);
  playUntilStepChanges(mode, ITEM.APPLE);
  assert.equal(mode.step.id, 'bad');
  mode.next(); // «Понятно»
  // Едем прямо: гниль на пути. Каждая гниль — замечание; длина падает, в конце — отравление.
  const seen = [];
  for (let i = 0; i < 200 && !seen.includes('tutorialRetry'); i += 1) {
    if (!mode.game.items.some((it) => it.kind === ITEM.BAD)) {
      mode.game.items.push({ kind: ITEM.BAD, ...mode.cellAhead(1), ttl: null });
    }
    seen.push(...types(events(mode, 250)));
  }
  assert.ok(seen.includes('tutorialBad'), 'замечание про гниль');
  assert.ok(seen.includes('tutorialRetry'), 'змейка погибла — шаг заново');
  assert.equal(mode.step.id, 'bad', 'остаёмся на том же шаге');
  assert.equal(mode.game.over, false, 'новая змейка');
  assert.ok(mode.game.items.some((it) => it.kind === ITEM.APPLE));
});

test('«вверх по экрану» на повёрнутом поле — это другое направление поля', () => {
  const mode = new TutorialMode({ screenUp: () => 'RIGHT' });
  events(mode);
  mode.steer('touch', 'UP');
  events(mode, 10);
  // Змейка и так ехала вправо (= «вверх» на повёрнутом экране) — шаг засчитан сразу.
  assert.notEqual(mode.step.id, 'turn');
});

test('у обучения тот же интерфейс, что у режимов игры', () => {
  const mode = new TutorialMode();
  for (const f of ['update', 'steer', 'playerName', 'hud', 'intensity', 'setSpeedFactor', 'dispose']) {
    assert.equal(typeof mode[f], 'function', f);
  }
  assert.equal(mode.kind, 'tutorial');
  assert.equal(mode.isDuel, false);
  assert.equal(mode.view, mode.game);
  assert.equal(mode.hud().duel, false);
});
