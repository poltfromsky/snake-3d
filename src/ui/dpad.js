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

  root.addEventListener('pointerdown', (e) => {
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
    if (e.pointerId !== pointerId) return;
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
