/**
 * Машина состояний приложения: в каком «экране» сейчас игра.
 *
 *   menu ──▶ playing ⇄ paused        (одиночная, одна клавиатура, бот)
 *     │         │
 *     │         ▼
 *     └──▶ lobby ──▶ countdown ──▶ playing ──▶ over ──▶ (реванш / меню)
 *
 * Разрешённые переходы перечислены явно. Недопустимый переход не выполняется,
 * а пишет ошибку в консоль — браузерные тесты считают это падением, так что
 * «невозможные» состояния ловятся до выкладки, а у игрока игра не ломается.
 */

export const STATES = Object.freeze({
  MENU: 'menu',
  LOBBY: 'lobby', // экран онлайн-комнаты
  COUNTDOWN: 'countdown', // 3-2-1 перед онлайн-партией
  PLAYING: 'playing',
  PAUSED: 'paused',
  OVER: 'over', // партия окончена, показан экран итогов
});

const S = STATES;

export const TRANSITIONS = Object.freeze({
  [S.MENU]: [S.PLAYING, S.LOBBY],
  [S.LOBBY]: [S.MENU, S.COUNTDOWN],
  [S.COUNTDOWN]: [S.PLAYING, S.MENU, S.LOBBY],
  [S.PLAYING]: [S.PAUSED, S.OVER, S.MENU, S.LOBBY],
  [S.PAUSED]: [S.PLAYING, S.MENU],
  [S.OVER]: [S.PLAYING, S.COUNTDOWN, S.MENU, S.LOBBY],
});

export class StateMachine {
  /**
   * @param {string} initial начальное состояние
   * @param {(from: string, to: string) => void} [onChange] вызывается после перехода
   * @param {(message: string) => void} [report] куда сообщать о недопустимом переходе
   */
  constructor(initial = S.MENU, onChange = null, report = (m) => console.error(m)) {
    this.current = initial;
    this.onChange = onChange;
    this.report = report;
  }

  get state() {
    return this.current;
  }

  is(...states) {
    return states.includes(this.current);
  }

  can(to) {
    return to === this.current || (TRANSITIONS[this.current] ?? []).includes(to);
  }

  /** Переходит в состояние `to`. Возвращает false, если переход недопустим. */
  go(to) {
    if (!this.can(to)) {
      this.report(`Недопустимый переход экрана: ${this.current} → ${to}`);
      return false;
    }
    const from = this.current;
    this.current = to;
    if (from !== to) this.onChange?.(from, to);
    return true;
  }
}
