/**
 * Что происходит с результатом одиночной партии (экран «Игра окончена»).
 *
 *   - Каждая попытка сразу сохраняется в «Мои» — историю на этом устройстве.
 *   - Ника ещё нет → форма: ник (запомнится для всей игры), комментарий, «в общую таблицу».
 *   - Ник есть → формы нет. Новый личный рекорд уходит в общую таблицу кнопкой или сам
 *     (настройка «Рекорды в общую таблицу → Автоматически»). В таблице у ника одна строка —
 *     лучший результат, сервер обновляет её, только если новый результат лучше.
 *   - Не отправилось (нет сети, игра без интернета, слишком часто) — рекорд запоминается
 *     и уходит при следующем запуске или следующей партии.
 */
import {
  addAttempt, clearPending, loadPending, personalBest, savePending, setPlayerName,
} from '../storage.js';
import { $, serverMessage } from './dom.js';

/**
 * @param {object} deps
 * @param {object} deps.settings ник, режим, автоотправка
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 * @param {() => void} deps.onChangeNick открыть настройки, чтобы сменить ник
 */
export function createResultSaver({ settings, leaderboard, onChangeNick }) {
  let current = null; // { mode, score, length, isBest } — последняя партия

  function status(text) {
    $('#record-auto-status').textContent = text;
  }

  async function publish(entry, { quiet = false } = {}) {
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
    $('#record-auto-title').textContent = isBest ? '★ Новый личный рекорд!' : `Ваш лучший результат: ${personalBest(mode)}`;
    $('#record-auto-comment').value = '';
    $('#record-auto-comment').classList.add('hidden');
    status('');
    const canPublish = leaderboard.enabled && isBest && score > 0;
    const auto = allowAuto && canPublish && settings.autoSubmit === 'on';
    $('#record-publish').classList.toggle('hidden', !canPublish || auto);
    $('#btn-publish').disabled = false;
    if (auto) publish(entryFor(current));
  }

  function entryFor({ mode, score, length }, comment = '') {
    return { name: settings.playerName, mode, score, length, comment };
  }

  /**
   * Итог одиночной партии.
   * @returns {{needsForm: boolean, isBest: boolean}} needsForm — показана форма с полем ника
   */
  function finish({ mode, score, length }) {
    const isBest = addAttempt(mode, { score, length });
    current = { mode, score, length, isBest };
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
      await publish(entryFor(current, comment));
    }
  });

  $('#btn-publish').addEventListener('click', async () => {
    if (!current) return;
    $('#btn-publish').disabled = true;
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
    finish,
    flushPending,
    /** Ник поменяли в настройках, пока был открыт экран итогов. */
    refreshName() {
      if (current && settings.playerName) $('#record-auto-name').textContent = settings.playerName;
    },
  };
}
