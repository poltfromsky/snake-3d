/**
 * Первый заход: игра не бросает новичка сразу в обучение. Он видит меню, а через пару
 * секунд поверх появляется карточка «Впервые здесь?» (пройти обучение или позже)
 * и мягко подсвечиваются главные кнопки: «Играть», боты, рекорды.
 * Карточка закрывается любым нажатием в игре и при уходе с меню.
 */
import { $ } from './dom.js';

const DELAY_MS = 1500;

export function createWelcome() {
  let timer = null;
  let active = false;

  function set(on) {
    active = on;
    $('#welcome-card').classList.toggle('hidden', !on);
    document.body.classList.toggle('welcome', on);
  }

  return {
    /** Показать карточку через DELAY_MS, если к тому времени игрок всё ещё в меню (canShow). */
    start(canShow) {
      timer = setTimeout(() => {
        timer = null;
        if (canShow()) set(true);
      }, DELAY_MS);
    },
    dismiss() {
      clearTimeout(timer);
      timer = null;
      if (active) set(false);
    },
  };
}
