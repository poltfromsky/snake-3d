/**
 * Интерфейс обучения: карточка с заданием поверх игры (шаг, текст, «Дальше»,
 * «Пропустить») и плашка в меню «Вы ещё не прошли обучение».
 */
import { STEPS, stepText } from '../tutorial/steps.js';
import { $ } from './dom.js';

/**
 * @param {object} hooks
 * @param {() => void} hooks.onNext «Дальше» на шагах, где нужно только прочитать
 * @param {() => void} hooks.onSkip «Пропустить обучение»
 * @param {() => void} hooks.onLayout карточка изменила размер или показана/скрыта — поле надо подвинуть
 */
export function createTutorialUI({ onNext, onSkip, onLayout }) {
  $('#btn-tutorial-next').addEventListener('click', onNext);
  $('#btn-tutorial-skip').addEventListener('click', onSkip);
  // Текст шага и замечания меняют высоту карточки — поле под ней подстраивается.
  new ResizeObserver(() => onLayout()).observe($('#tutorial-card'));

  return {
    /** Показать текущий шаг. */
    render(mode, device) {
      const { step, index } = mode;
      if (!step) return;
      $('#tutorial-progress').textContent = `Шаг ${index + 1} из ${STEPS.length}`;
      $('#tutorial-title').textContent = step.title;
      $('#tutorial-text').textContent = stepText(step, device);
      $('#tutorial-notice').textContent = '';
      const reading = step.goal === 'next';
      $('#btn-tutorial-next').classList.toggle('hidden', !reading && !mode.waiting);
      $('#btn-tutorial-next').textContent = (step.id === 'done' && 'Готово') || (reading && 'Дальше') || 'Понятно';
      $('#btn-tutorial-skip').classList.toggle('hidden', step.id === 'done');
      onLayout();
    },
    notice(text) {
      $('#tutorial-notice').textContent = text;
      onLayout();
    },
    setVisible(visible) {
      $('#tutorial-card').classList.toggle('hidden', !visible);
      onLayout();
    },
    /** Плашка в меню — пока обучение не пройдено. */
    setBanner(visible) {
      $('#tutorial-banner').classList.toggle('hidden', !visible);
    },
  };
}
