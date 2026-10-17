/** Экран «Отзыв об игре»: оценка, текст, имя — уходит на сервер (читает только автор). */
import { $, markActive, serverMessage } from './dom.js';

/**
 * @param {object} deps
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 * @param {string} deps.version версия игры для отзыва
 */
export function createFeedbackScreen({ leaderboard, version }) {
  let rating = null;

  $('#feedback-rating').addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (!value) return;
    rating = Number(value);
    markActive($('#feedback-rating'), 'value', value);
  });

  $('#feedback-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#feedback-form button[type=submit]');
    const status = $('#feedback-status');
    if (button.disabled) return;
    if ($('#feedback-message').value.trim().length < 3) {
      status.textContent = 'Напишите хотя бы пару слов.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Отправляем…';
    try {
      await leaderboard.submitFeedback({
        name: $('#feedback-name').value,
        rating,
        message: $('#feedback-message').value,
        version,
      });
      status.textContent = 'Спасибо! Отзыв отправлен.';
      $('#feedback-message').value = '';
    } catch (err) {
      status.textContent = serverMessage(err, 'Не получилось отправить. Проверьте интернет и попробуйте ещё раз.');
    } finally {
      button.disabled = false;
    }
  });

  /** Подготовить экран к показу. */
  function open(playerName) {
    $('#feedback-status').textContent = '';
    $('#feedback-name').value = $('#feedback-name').value || (playerName ?? '');
  }

  return { open, focus: () => $('#feedback-message').focus() };
}
