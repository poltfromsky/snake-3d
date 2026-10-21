/**
 * Своё расположение кнопок-стрелок (Настройки → Управление → «Расположение кнопок»).
 *
 * На экране редактора крест можно перетащить пальцем куда удобно, поставить одной кнопкой
 * слева, по центру или справа и поменять размер. Положение хранится в настройках в долях
 * экрана ({x, y, scale}), поэтому переживает поворот телефона; null — как раньше, внизу по центру.
 */
import { applyDpadLayout, DPAD_SCALE_MAX, DPAD_SCALE_MIN, dpadPlacement } from './dpad.js';
import { $, markActive } from './dom.js';

/** Быстрые варианты: центр креста по ширине экрана, у нижнего края. */
const PRESETS = { left: 0.22, center: 0.5, right: 0.78 };
const PRESET_Y = 0.84;

/**
 * @param {object} deps
 * @param {HTMLElement} deps.root элемент #dpad
 * @param {object} deps.settings настройки (меняются на месте)
 * @param {(settings: object) => void} deps.save сохранить настройки
 */
export function createDpadEditor({ root, settings, save }) {
  let editing = false;
  let drag = null; // { pointerId, dx, dy } — где палец взялся за крест относительно его центра

  const panelBottom = () => $('#screen-dpad-layout .dpad-editor')?.getBoundingClientRect().bottom ?? 0;
  const current = () => settings.dpad ?? { x: PRESETS.center, y: PRESET_Y, scale: 1 };

  function apply(layout, persist = false) {
    // Крест не заезжает под панель редактора и за края экрана.
    const placed = dpadPlacement(layout, window.innerWidth, window.innerHeight, { top: editing ? panelBottom() : 0 });
    settings.dpad = placed ? { x: placed.cx / window.innerWidth, y: placed.cy / window.innerHeight, scale: placed.scale } : null;
    applyDpadLayout(root, settings.dpad);
    if (persist) save(settings);
    syncControls();
  }

  function syncControls() {
    $('#dpad-scale').value = String(settings.dpad?.scale ?? 1);
    const preset = Object.entries(PRESETS).find(([, x]) => settings.dpad
      && Math.abs(settings.dpad.x - x) < 0.01 && Math.abs(settings.dpad.y - PRESET_Y) < 0.01)?.[0];
    markActive($('#dpad-preset'), 'value', preset ?? (settings.dpad ? '' : 'center'));
  }

  root.addEventListener('pointerdown', (e) => {
    if (!editing) return;
    e.preventDefault();
    const r = root.getBoundingClientRect();
    drag = { pointerId: e.pointerId, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
    root.classList.add('dragging');
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // Синтетическое событие — без захвата.
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (!editing || drag?.pointerId !== e.pointerId) return;
    apply({
      x: (e.clientX - drag.dx) / window.innerWidth,
      y: (e.clientY - drag.dy) / window.innerHeight,
      scale: current().scale,
    });
  });
  for (const type of ['pointerup', 'pointercancel']) {
    root.addEventListener(type, (e) => {
      if (drag?.pointerId !== e.pointerId) return;
      drag = null;
      root.classList.remove('dragging');
      save(settings);
    });
  }

  $('#dpad-preset').addEventListener('click', (e) => {
    const where = e.target.closest('button')?.dataset.value;
    if (where in PRESETS) apply({ x: PRESETS[where], y: PRESET_Y, scale: current().scale }, true);
  });
  $('#dpad-scale').addEventListener('input', (e) => {
    const scale = Number(e.target.value);
    apply({ ...current(), scale }, true);
  });

  // Повернули телефон — крест остаётся в тех же долях экрана, но не вылезает за край.
  window.addEventListener('resize', () => applyDpadLayout(root, settings.dpad));
  applyDpadLayout(root, settings.dpad);

  return {
    open() {
      editing = true;
      root.classList.add('editing');
      $('#dpad-scale').min = String(DPAD_SCALE_MIN);
      $('#dpad-scale').max = String(DPAD_SCALE_MAX);
      if (settings.dpad) apply(settings.dpad);
      else syncControls();
    },
    close() {
      editing = false;
      drag = null;
      root.classList.remove('editing', 'dragging');
      save(settings);
    },
    /** Вернуть как было: внизу по центру, обычный размер. */
    reset() {
      settings.dpad = null;
      applyDpadLayout(root, null);
      save(settings);
      syncControls();
    },
  };
}
