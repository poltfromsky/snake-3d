/**
 * Обучение на настоящем поле — тот же интерфейс, что у остальных режимов
 * (src/modes/modes.js), поэтому игровой цикл, управление и сцена не меняются.
 *
 * В начале каждого шага змейка стоит, пока игрок не нажмёт «Понятно» или не повернёт:
 * иначе она успевала доехать до предмета раньше, чем человек дочитает задание.
 *
 * Поле небольшое и одинаковое на всех устройствах, змейка медленная, предметы раскладывает сам режим — перед
 * змейкой, чтобы до них было пару шагов. Погибнуть нельзя насовсем: если змейка
 * разбилась или отравилась, шаг начинается заново.
 *
 * update(dt) возвращает события игры (еда — звук и частицы) и свои:
 *   {type: 'tutorialStep', index} — начался шаг index;
 *   {type: 'tutorialGo'}          — змейка поехала (игрок прочитал задание);
 *   {type: 'tutorialRetry'}       — змейка погибла, шаг заново;
 *   {type: 'tutorialBad'}         — съедена гниль на шаге «обойдите гниль»;
 *   {type: 'tutorialDone'}        — обучение пройдено.
 */
import {
  DIRECTIONS, Game, ITEM, MODES,
} from '../core/game.js';
import { STEPS } from '../tutorial/steps.js';

const TUTORIAL_SPEED = 0.6; // медленнее обычного: время подумать
// Одно и то же поле у всех: квадрат не поворачивается ни на телефоне, ни на компьютере.
export const TUTORIAL_FIELD = Object.freeze({ width: 11, height: 11 });
const BONUS_KINDS = new Set([ITEM.SLOW, ITEM.GHOST]);

export class TutorialMode {
  /**
   * @param {object} config
   * @param {() => string} [config.screenUp] какое направление поля сейчас «вверх по экрану»
   * @param {() => number} [config.rng] случайность (в тестах — предсказуемая)
   */
  constructor({ screenUp = () => 'UP', rng = () => 0.99 } = {}) {
    this.kind = 'tutorial';
    this.isDuel = false;
    this.canPause = true;
    this.restartable = false;
    this.myIndex = 0;
    this.size = { ...TUTORIAL_FIELD };
    this.screenUp = screenUp;
    this.rng = rng;
    this.index = 0;
    this.pending = [{ type: 'tutorialStep', index: 0 }];
    this.newGame();
    this.placeItems();
    this.waiting = true;
  }

  get step() {
    return STEPS[this.index];
  }

  get done() {
    return this.index >= STEPS.length;
  }

  newGame() {
    // rng по умолчанию 0.99 — никаких случайных бонусов и гнили: предметы кладёт обучение.
    this.game = new Game({
      ...this.size, mode: MODES.CLASSIC, speedFactor: TUTORIAL_SPEED,
    }, this.rng);
    this.game.items = [];
  }

  /**
   * Клетка в k шагах перед головой (и side клеток вбок), с переходом через край поля.
   * «Перед» — по уже заказанному повороту: шаг «поворот» засчитывается раньше,
   * чем змейка повернёт, и яблоко должно лечь на новый курс, а не на старый.
   */
  cellAhead(k, side = 0) {
    const { head } = this.game;
    const d = this.game.turnQueue.at(-1) ?? this.game.direction;
    const { width, height } = this.size;
    // Вбок — поворот направления на 90°.
    const x = head.x + d.x * k + -d.y * side;
    const y = head.y + d.y * k + d.x * side;
    return { x: ((x % width) + width) % width, y: ((y % height) + height) % height };
  }

  /** Предметы для текущего шага: лежат по курсу, чтобы до них было несколько шагов. */
  placeItems() {
    const g = this.game;
    g.obstacles = [];
    const item = (kind, cell) => ({ kind, ...cell, ttl: null });
    switch (this.step?.id) {
      case 'apple':
        // В стороне от курса: чтобы съесть, надо самому повернуть.
        g.items = [item(ITEM.APPLE, this.cellAhead(4, 3))];
        break;
      case 'bad':
        // Гниль прямо по курсу, яблоко — в стороне: чтобы его съесть, гниль надо обойти.
        g.items = [item(ITEM.BAD, this.cellAhead(3)), item(ITEM.APPLE, this.cellAhead(5, 2))];
        break;
      case 'bonus':
        g.items = [item(ITEM.SLOW, this.cellAhead(4, -3))];
        break;
      case 'danger':
        g.items = [];
        // Камни — сбоку от пути, чтобы их увидеть, а не врезаться.
        g.obstacles = [this.cellAhead(3, 2), this.cellAhead(5, -2)];
        break;
      default:
        g.items = [];
    }
  }

  advance() {
    this.index += 1;
    if (this.done) {
      this.pending.push({ type: 'tutorialDone' });
      return;
    }
    this.placeItems();
    this.waiting = this.step.goal !== 'next';
    this.pending.push({ type: 'tutorialStep', index: this.index });
  }

  /** Змейка трогается: задание прочитано. */
  go() {
    if (!this.waiting) return;
    this.waiting = false;
    this.pending.push({ type: 'tutorialGo' });
  }

  /** «Понятно» — змейка поехала; «Дальше» на шагах, где нужно только прочитать. */
  next() {
    if (this.done) return;
    if (this.waiting) this.go();
    else if (this.step.goal === 'next') this.advance();
  }

  get view() { return this.game; }

  get timed() { return false; }

  update(dt) {
    const out = this.pending;
    this.pending = [];
    if (this.done) return out;
    // На шагах «прочитать» и до «Понятно» змейка стоит — текст можно спокойно дочитать.
    const events = this.step.goal === 'next' || this.waiting ? [] : this.game.update(dt);
    for (const e of events) {
      if (e.type === 'gameOver') {
        this.newGame();
        this.placeItems();
        this.waiting = true;
        out.push({ type: 'tutorialRetry' });
        return out;
      }
      if (e.type !== 'eat') continue;
      out.push(e);
      const { goal, id } = this.step;
      if (goal === 'eat-apple' && e.kind === ITEM.APPLE) {
        this.advance();
      } else if (goal === 'eat-bonus' && BONUS_KINDS.has(e.kind)) {
        this.advance();
      } else if (id === 'bad' && e.kind === ITEM.BAD) {
        out.push({ type: 'tutorialBad' });
      }
      if (e.kind === ITEM.APPLE && !this.done && this.step.id !== 'apple') {
        // Игра сама кладёт новое яблоко после съеденного — в обучении предметы раскладываем мы.
        this.placeItems();
      }
    }
    // Шаг «поверните вверх»: засчитываем, как только поворот принят.
    if (!this.done && this.step.goal === 'turn-up') {
      const up = DIRECTIONS[this.screenUp()];
      const wanted = this.game.turnQueue.at(-1) ?? this.game.direction;
      if (wanted === up) this.advance();
    }
    return out.concat(this.pending.splice(0));
  }

  steer(_device, dir) {
    if (this.done || this.step.goal === 'next') return;
    this.game.turn(DIRECTIONS[dir]);
    this.go(); // поворот — тоже знак, что игрок готов
  }

  playerName() { return 'Вы'; }

  hud() {
    const g = this.game;
    return {
      duel: false, score: g.score, length: g.length, level: g.level, timeLeft: null, effects: { ...g.effects },
    };
  }

  intensity() { return 0; }

  setSpeedFactor() {} // в обучении скорость всегда спокойная

  dispose() {}
}
