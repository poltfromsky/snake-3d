/**
 * Тексты экранов итогов. Чистые функции — проверяются юнит-тестами без браузера.
 */

const SOLO_REASONS = {
  self: 'Змейка укусила себя',
  wall: 'Врезались в стену',
  stone: 'Врезались в камень',
  poison: 'Отравились гнилью',
  time: 'Время вышло',
};

const DUEL_REASONS = {
  self: 'укусил сам себя',
  wall: 'врезался в стену',
  stone: 'врезался в камень',
  rival: 'врезался в соперника',
  headOn: 'Столкновение лоб в лоб',
  time: 'Время вышло — решили очки',
};

/** Конец одиночной игры. */
export function soloSummary(reason) {
  return {
    title: reason === 'time' ? 'Финиш!' : 'Игра окончена',
    reason: SOLO_REASONS[reason] ?? '',
  };
}

/**
 * Конец дуэли с точки зрения игрока за этим экраном.
 * @param {{winner: number|null, reason: string}} result
 * @param {{scores: number[], deaths: (string|null)[]}} details
 * @param {{kind: string, myIndex: number, playerName(i: number): string}} mode
 * @returns {{title: string, reason: string, left: string, right: string, sound: string, iWon: boolean}}
 */
export function duelSummary({ winner, reason }, { scores, deaths }, mode) {
  const me = mode.myIndex;
  const shared = mode.kind === 'local'; // два игрока за одним экраном — «я» нет
  let title;
  if (winner === null) title = 'Ничья';
  else if (shared) title = `Победил игрок ${winner + 1}!`;
  else title = winner === me ? 'Победа!' : 'Поражение';

  let why = DUEL_REASONS[reason] ?? '';
  if (!['headOn', 'time'].includes(reason)) {
    const losers = [0, 1].filter((i) => deaths[i]);
    if (losers.length === 2) why = 'Оба выбыли одновременно';
    else if (losers.length === 1) why = `${mode.playerName(losers[0])}: ${DUEL_REASONS[deaths[losers[0]]]}`;
  }
  const iWon = !shared && winner === me;
  return {
    title,
    reason: why,
    left: `${mode.playerName(0)} ${scores[0]}`,
    right: `${scores[1]} ${mode.playerName(1)}`,
    sound: winner === null || (!shared && winner !== me) ? 'die' : 'record',
    iWon,
  };
}
