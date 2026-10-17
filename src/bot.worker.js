/**
 * Отдельный поток браузера для бота: просчёт ходов (особенно у Claude — до 4 шагов
 * вперёд) не должен подтормаживать отрисовку игры.
 */
import { chooseMove } from './core/bot.js';

self.onmessage = ({ data }) => {
  const { id, state, me, level, options } = data;
  const move = chooseMove(state, me, level, Math.random, options);
  self.postMessage({ id, move });
};
