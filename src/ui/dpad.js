/**
 * Кнопки-стрелки на экране телефона (настройка «Управление → Кнопки на экране»).
 *
 * Нажатие считается по всей площади креста и небольшому полю вокруг него, а не только
 * по самим кнопкам: палец легко попадает в щель между кнопками или чуть мимо, а кнопки
 * при этом остаются прежнего размера. Палец можно вести по кресту — направление
 * меняется без отрыва. Подсветка нажатой кнопки включается и выключается нашим кодом,
 * а не псевдоклассом :active, который на некоторых телефонах залипает после отпускания.
 */

/** Радиус центра креста, где нажатие ничего не значит (пальцем сюда попадают случайно). */
const DEAD_ZONE_PX = 14;

/** Размер креста в CSS (три кнопки по 64 px и два зазора по 6 px) и пределы его масштаба. */
const DPAD_SIZE_PX = 64 * 3 + 6 * 2;
export const DPAD_SCALE_MIN = 0.75;
export const DPAD_SCALE_MAX = 1.4;
const EDGE_PX = 8;

/**
 * Где на экране поставить крест (центр в пикселях и масштаб) по сохранённой раскладке
 * {x, y, scale} в долях экрана. Неверная раскладка — null (место по умолчанию: внизу по центру).
 * Крест целиком остаётся на экране и ниже top (например, панели редактора).
 */
export function dpadPlacement(layout, width, height, { top = 0 } = {}) {
  if (!layout || ![layout.x, layout.y, layout.scale].every(Number.isFinite)) return null;
  const scale = Math.min(DPAD_SCALE_MAX, Math.max(DPAD_SCALE_MIN, layout.scale));
  const half = (DPAD_SIZE_PX * scale) / 2 + EDGE_PX;
  const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return {
    cx: clamp(layout.x * width, half, width - half),
    cy: clamp(layout.y * height, top + half, height - half),
    scale,
  };
}

/** Ставит крест по раскладке; null — убрать своё положение (останется место из CSS). */
export function applyDpadLayout(root, layout) {
  const placed = dpadPlacement(layout, window.innerWidth, window.innerHeight);
  if (!placed) {
    for (const prop of ['left', 'top', 'bottom', 'transform']) root.style.removeProperty(prop);
    return;
  }
  root.style.left = `${placed.cx}px`;
  root.style.top = `${placed.cy}px`;
  root.style.bottom = 'auto';
  root.style.transform = `translate(-50%, -50%) scale(${placed.scale})`;
}

/**
 * Направление по точке нажатия относительно центра креста.
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @returns {'UP'|'DOWN'|'LEFT'|'RIGHT'|null}
 */
export function dpadDirection(x, y, rect) {
  const dx = x - (rect.left + rect.width / 2);
  const dy = y - (rect.top + rect.height / 2);
  if (Math.hypot(dx, dy) < DEAD_ZONE_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dy > 0 ? 'DOWN' : 'UP');
}

/**
 * Подключает крест к игре.
 * @param {HTMLElement} root элемент #dpad с кнопками [data-dir]
 * @param {(dir: string) => void} onPress поворот; вызывается при нажатии и при смене кнопки пальцем
 * @returns {{release(): void}} release — снять подсветку (например, когда крест спрятали)
 */
export function setupDpad(root, onPress) {
  let pointerId = null;
  let current = null;

  const setPressed = (dir) => {
    current = dir;
    for (const button of root.querySelectorAll('[data-dir]')) {
      button.classList.toggle('pressed', button.dataset.dir === dir);
    }
  };

  const release = () => {
    pointerId = null;
    setPressed(null);
  };

  const press = (dir) => {
    if (!dir || dir === current) return;
    setPressed(dir);
    onPress(dir);
  };

  // В редакторе расположения (src/ui/dpad-layout.js) крест перетаскивают, а не нажимают.
  const editing = () => root.classList.contains('editing');

  root.addEventListener('pointerdown', (e) => {
    if (editing()) return;
    e.preventDefault(); // без увеличения по двойному касанию и выделения
    const direct = e.target.closest?.('[data-dir]')?.dataset.dir;
    pointerId = e.pointerId;
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // Нет такого касания (синтетическое событие) — работаем без захвата.
    }
    // Повторное нажатие той же кнопки тоже поворот: подсветку сбрасываем перед ним.
    setPressed(null);
    press(direct ?? dpadDirection(e.clientX, e.clientY, root.getBoundingClientRect()));
  });

  root.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId || editing()) return;
    press(dpadDirection(e.clientX, e.clientY, root.getBoundingClientRect()));
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(type, (e) => {
      if (e.pointerId === pointerId) release();
    });
  }
  window.addEventListener('blur', release);

  return { release };
}
