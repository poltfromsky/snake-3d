/**
 * Подсказки в первых настоящих партиях: когда что-то впервые появилось на поле —
 * короткое объяснение. Каждая подсказка — один раз на устройстве.
 */
import { ITEM } from '../core/game.js';
import { $ } from './dom.js';

export const FIRST_HINTS = Object.freeze({
  bad: 'Фиолетовое — гниль: −1 сегмент и −5 очков. Лучше обойти.',
  slow: 'Голубое кольцо — замедление на 5 секунд: успеете подумать.',
  ghost: 'Белый кристалл — «призрак»: 5 секунд можно проходить сквозь себя.',
  stones: 'Серые камни — препятствия: врезался — конец. С каждым уровнем их больше.',
  level: 'Новый уровень: змейка ускорилась. Каждые 5 яблок — следующий.',
});

const ITEM_HINTS = { [ITEM.BAD]: 'bad', [ITEM.SLOW]: 'slow', [ITEM.GHOST]: 'ghost' };
const SHOW_MS = 4500;

/**
 * @param {object} store
 * @param {Record<string, boolean>} store.seen какие подсказки уже были (меняется на месте)
 * @param {() => void} store.save сохранить seen
 */
export function createFirstHints({ seen, save }) {
  let timer = null;

  function show(id) {
    if (seen[id]) return;
    seen[id] = true;
    save();
    const el = $('#first-hint');
    el.textContent = FIRST_HINTS[id];
    el.classList.remove('hidden');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.add('hidden'), SHOW_MS);
  }

  return {
    /** Каждый кадр партии: не появилось ли на поле что-то новое для игрока. */
    check(view) {
      for (const item of view.items ?? []) {
        const id = ITEM_HINTS[item.kind];
        if (id && !seen[id]) {
          show(id);
          return; // по одной подсказке за раз
        }
      }
      if (view.obstacles?.length && !seen.stones) show('stones');
    },
    levelUp() {
      show('level');
    },
    hide() {
      clearTimeout(timer);
      $('#first-hint').classList.add('hidden');
    },
  };
}
