/**
 * Распознавание свайпов для телефона — чистая логика без DOM.
 *
 * Палец никогда не идёт по идеальной прямой: «вниз» почти всегда чуть уходит вбок.
 * Раньше сравнивалось «по какой оси сдвиг больше», граница шла ровно по 45°, и
 * лёгкий увод пальца давал лишний поворот. Теперь направление берётся не от точки
 * касания, а по «скользящему окну» — последним WINDOW пикселям пути пальца:
 *   - поворот засчитывается, только когда движение в окне явно идёт вдоль одной оси
 *     (конус примерно ±30° от неё); косое движение ждёт, пока станет понятно, куда ведёт палец;
 *   - постоянный лёгкий увод (палец ведёт «вверх» с наклоном) в окне остаётся «вверх»
 *     и не накапливается, как при отсчёте от одной точки;
 *   - повторять тот же поворот в том же движении не нужно — его засчитывают один раз.
 */

/** Параметры по умолчанию, в пикселях экрана. */
export const SWIPE_DEFAULTS = Object.freeze({
  /** Сдвиг до первого поворота. */
  start: 18,
  /** Сдвиг для следующего поворота в том же движении. */
  next: 22,
  /** Во сколько раз сдвиг вдоль оси должен превышать сдвиг поперёк (1.8 ≈ конус ±29°). */
  ratio: 1.8,
  /** Длина последнего участка пути, по которому определяется направление. */
  window: 36,
});

export class SwipeTracker {
  /** @param {Partial<typeof SWIPE_DEFAULTS>} [options] */
  constructor(options = {}) {
    this.options = { ...SWIPE_DEFAULTS, ...options };
    this.points = [];
    this.fired = null;
  }

  /** Палец коснулся экрана. */
  begin(x, y) {
    this.points = [{ x, y }];
    this.fired = null;
  }

  /** Палец отпущен или касание прервано. */
  end() {
    this.points = [];
    this.fired = null;
  }

  /**
   * Палец сдвинулся в точку (x, y).
   * @returns {'UP'|'DOWN'|'LEFT'|'RIGHT'|null} направление, если сработал поворот
   */
  move(x, y) {
    if (!this.points.length) return null;
    this.points.push({ x, y });
    const from = this.windowStart();
    const dx = x - from.x;
    const dy = y - from.y;
    const major = Math.max(Math.abs(dx), Math.abs(dy));
    const minor = Math.min(Math.abs(dx), Math.abs(dy));
    const { start, next, ratio } = this.options;
    if (major < (this.fired ? next : start)) return null;
    // Косое движение: ждём, пока палец явно пойдёт вдоль оси.
    if (major < ratio * minor) return null;

    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'RIGHT' : 'LEFT')
      : (dy > 0 ? 'DOWN' : 'UP');
    // Палец продолжает вести в ту же сторону — поворот уже засчитан.
    if (dir === this.fired) {
      this.points = this.points.slice(-2);
      return null;
    }
    this.fired = dir;
    this.points = [{ x, y }];
    return dir;
  }

  /** Начало окна: точка, от которой до конца пути прошло не больше WINDOW пикселей. */
  windowStart() {
    const { points } = this;
    let length = 0;
    let i = points.length - 1;
    while (i > 0 && length < this.options.window) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      i -= 1;
    }
    // Старые точки не нужны — окно только скользит вперёд.
    this.points = points.slice(i);
    return this.points[0];
  }
}
