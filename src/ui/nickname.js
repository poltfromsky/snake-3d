/** Поле «Ваш ник»: одно и то же значение в настройках, онлайне, рекордах и отзыве. */
import { setPlayerName } from '../storage.js';

/**
 * Связывает поле ввода с ником игрока: сохраняет при вводе, показывает текущий при открытии экрана.
 * @returns {{refresh(): void}}
 */
export function bindNameInput(input, settings) {
  // Сохраняем на каждый ввод, чтобы ник не пропал, если сразу уйти с экрана.
  input.addEventListener('input', () => setPlayerName(settings, input.value));
  // Когда поле отпустили — показываем ник в том виде, в каком он сохранён.
  input.addEventListener('change', () => { input.value = settings.playerName; });
  const refresh = () => { input.value = settings.playerName ?? ''; };
  refresh();
  return { refresh };
}
