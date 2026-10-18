/**
 * Что происходит с результатом одиночной партии (экран «Игра окончена»).
 *
 *   - Каждая попытка сразу сохраняется в «Мои» — историю на этом устройстве.
 *   - Ника ещё нет → форма: ник (запомнится для всей игры), комментарий, «в общую таблицу».
 *   - Ник есть → формы нет. Новый личный рекорд уходит в общую таблицу кнопкой или сам
 *     (настройка «Рекорды в общую таблицу → Автоматически»). В таблице у ника одна строка —
 *     лучший результат, сервер обновляет её, только если новый результат лучше.
 *   - Не отправилось из-за сети — рекорд запоминается и уходит при следующем запуске
 *     или следующей партии.
 *
 * Защита таблицы (сервер): в начале партии берётся билет, по нему принимается ровно один
 * правдоподобный по времени результат; ник принадлежит устройству (секретный ключ на нём).
 * Партия без связи с сервером в общую таблицу не попадает, но сохраняется в «Мои».
 */
import {
  addAttempt, clearPending, deviceKey, loadPending, personalBest, savePending, setPlayerName,
} from '../storage.js';
import { $, serverMessage } from './dom.js';
import { iconSvg } from './icons.js';

// Отказы, которые не исправит повторная отправка: показываем и забываем.
const FINAL_REFUSALS = new Set(['nick_taken', 'nick_limit', 'implausible', 'bad_ticket', 'no_ticket']);

/**
 * @param {object} deps
 * @param {object} deps.settings ник, режим, автоотправка
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 * @param {() => void} deps.onChangeNick открыть настройки, чтобы сменить ник
 */
export function createResultSaver({ settings, leaderboard, onChangeNick }) {
  let current = null; // { mode, score, length, isBest, ticket } — последняя партия
  // Билет текущей партии: {ticket} или {ticket: null, error} — почему сервер его не дал.
  let runTicket = Promise.resolve({ ticket: null, error: null });

  function status(text) {
    $('#record-auto-status').textContent = text;
  }

  async function publish(entry, { quiet = false } = {}) {
    if (!entry.ticket && entry.ticketError) {
      // Сервер отказал в билете (например, слишком много партий подряд) — говорим как есть.
      clearPending(entry.mode, entry.score);
      if (!quiet) status(`${entry.ticketError} Результат сохранён в «Мои».`);
      return false;
    }
    if (!entry.ticket) {
      // Без билета сервер не примет (партия без связи или очередь от прошлой версии).
      clearPending(entry.mode, entry.score);
      if (!quiet) status('Партия шла без связи с сервером — в общую таблицу не попадёт. В «Мои» она сохранена.');
      return false;
    }
    if (!quiet) status('Отправляем в общую таблицу…');
    try {
      const { improved, best } = await leaderboard.submitRecord(entry);
      clearPending(entry.mode, entry.score);
      if (!quiet) {
        status(improved
          ? `В общей таблице: ${entry.name} — ${entry.score}`
          : `В общей таблице у ${entry.name} уже ${best} — этот результат не лучше.`);
      }
      return true;
    } catch (err) {
      if (FINAL_REFUSALS.has(err.code)) {
        clearPending(entry.mode, entry.score);
        if (!quiet) status(err.message);
        return false;
      }
      savePending(entry);
      if (!quiet) status(`${serverMessage(err, 'Нет связи с сервером.')} Рекорд отправится сам, когда получится.`);
      return false;
    }
  }

  /** Отправить рекорды, которые не ушли раньше. Тихо: игрок их уже видел. */
  async function flushPending() {
    if (!leaderboard.enabled) return;
    for (const entry of Object.values(loadPending())) {
      // По одному: сервер ограничивает частоту отправки.
      if (!(await publish(entry, { quiet: true }))) break;
    }
  }

  /**
   * Блок «ник уже есть»: без формы, только итог и, если нужно, кнопка общей таблицы.
   * allowAuto: false — когда ник только что ввели в форме и решение об отправке уже принято там.
   */
  function showAuto({ allowAuto = true } = {}) {
    const { mode, score, isBest } = current;
    $('#record-form').classList.add('hidden');
    $('#record-auto').classList.remove('hidden');
    $('#record-auto-name').textContent = settings.playerName;
    const title = $('#record-auto-title');
    title.replaceChildren(isBest ? 'Новый личный рекорд!' : `Ваш лучший результат: ${personalBest(mode)}`);
    if (isBest) title.prepend(iconSvg('star'));
    $('#record-auto-comment').value = '';
    $('#record-auto-comment').classList.add('hidden');
    status('');
    const canPublish = leaderboard.enabled && isBest && score > 0;
    const auto = allowAuto && canPublish && settings.autoSubmit === 'on';
    $('#record-publish').classList.toggle('hidden', !canPublish || auto);
    $('#btn-publish').disabled = false;
    if (auto) current.ticketReady.then(() => publish(entryFor(current)));
  }

  function entryFor({
    mode, score, length, ticket, ticketError,
  }, comment = '') {
    return {
      name: settings.playerName, mode, score, length, comment, ticket, ticketError, device: deviceKey(),
    };
  }

  /** Новая одиночная партия: сразу берём билет у сервера (не дожидаясь, игра уже идёт). */
  function startRun(mode) {
    runTicket = leaderboard.enabled
      ? leaderboard.startRun(mode).then(
        (ticket) => ({ ticket, error: null }),
        // Сеть недоступна — молчим (партия «без связи»); сервер отказал — запоминаем его слова.
        (err) => ({ ticket: null, error: err?.status ? serverMessage(err, null) : null }),
      )
      : Promise.resolve({ ticket: null, error: null });
  }

  /**
   * Итог одиночной партии.
   * @returns {{needsForm: boolean, isBest: boolean}} needsForm — показана форма с полем ника
   */
  function finish({ mode, score, length }) {
    const isBest = addAttempt(mode, { score, length });
    current = {
      mode, score, length, isBest, ticket: null, ticketError: null,
    };
    const game = current;
    game.ticketReady = runTicket.then(({ ticket, error }) => {
      game.ticket = ticket;
      game.ticketError = error;
    });
    $('#record-auto').classList.add('hidden');
    $('#record-form').classList.add('hidden');
    flushPending();

    if (settings.playerName) {
      showAuto();
      return { needsForm: false, isBest };
    }
    if (score <= 0) return { needsForm: false, isBest };
    // Ника нет — спрашиваем один раз; дальше он подставляется везде.
    $('#record-form').classList.remove('hidden');
    $('#record-label').textContent = isBest ? 'Новый рекорд! Ваш ник:' : 'Ваш ник:';
    $('#record-name').value = '';
    $('#record-comment').value = '';
    $('#record-status').textContent = '';
    $('#record-form button[type=submit]').disabled = false;
    return { needsForm: true, isBest };
  }

  $('#record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#record-form button[type=submit]');
    if (button.disabled || !current) return;
    const name = setPlayerName(settings, $('#record-name').value);
    if (!name) {
      $('#record-status').textContent = 'Введите ник — он запомнится, и больше спрашивать не будем.';
      return;
    }
    button.disabled = true;
    const toGlobal = leaderboard.enabled && $('#record-public').checked && current.score > 0;
    const comment = $('#record-comment').value;
    showAuto({ allowAuto: false });
    // Галочка «в общую таблицу» стояла — отправляем; сняли — оставляем кнопку на потом.
    if (toGlobal) {
      $('#record-publish').classList.add('hidden');
      await current.ticketReady;
      await publish(entryFor(current, comment));
    }
  });

  $('#btn-publish').addEventListener('click', async () => {
    if (!current) return;
    $('#btn-publish').disabled = true;
    await current.ticketReady;
    const ok = await publish(entryFor(current, $('#record-auto-comment').value));
    if (ok) $('#record-publish').classList.add('hidden');
    else $('#btn-publish').disabled = false;
  });

  $('#btn-add-comment').addEventListener('click', () => {
    $('#record-auto-comment').classList.remove('hidden');
    $('#record-auto-comment').focus();
  });

  $('#btn-change-nick').addEventListener('click', onChangeNick);

  return {
    startRun,
    finish,
    flushPending,
    /** Ник поменяли в настройках, пока был открыт экран итогов. */
    refreshName() {
      if (current && settings.playerName) $('#record-auto-name').textContent = settings.playerName;
    },
  };
}
