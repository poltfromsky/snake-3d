/**
 * Экран «Рекорды» (свои и общие) и форма сохранения результата после одиночной игры.
 */
import { addRecord, isRecord, loadRecords, saveSettings } from '../storage.js';
import { $, markActive, serverMessage } from './dom.js';

/**
 * @param {object} deps
 * @param {object} deps.settings настройки игрока (меняется: имя игрока)
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 * @param {(name: string) => void} deps.show показать экран
 * @param {(screen: string) => void} deps.setBack куда ведёт «Назад»
 */
export function createRecordsScreen({ settings, leaderboard, show, setBack }) {
  let scope = leaderboard.enabled ? 'global' : 'local';
  let mode = settings.mode;
  let request = 0;
  let pending = null; // результат одиночной игры, который можно сохранить

  function message(text, className = 'empty') {
    const li = document.createElement('li');
    li.className = className;
    li.textContent = text;
    $('#records-list').replaceChildren(li);
  }

  function rows(list) {
    const ol = $('#records-list');
    ol.replaceChildren();
    if (!list.length) {
      message('Пока пусто — станьте первым!');
      return;
    }
    for (const r of list) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = r.name;
      const score = document.createElement('b');
      score.textContent = r.score;
      const meta = document.createElement('small');
      const date = new Date(r.created_at ?? r.date).toLocaleDateString('ru-RU');
      meta.textContent = `длина ${r.length} · ${date}`;
      li.append(name, score, meta);
      if (r.comment) {
        // textContent, а не innerHTML: комментарии пишут посторонние люди.
        const comment = document.createElement('small');
        comment.className = 'comment';
        comment.textContent = `«${r.comment}»`;
        li.append(comment);
      }
      ol.append(li);
    }
  }

  async function render(nextMode = mode) {
    mode = nextMode;
    markActive($('#records-tabs'), 'mode', mode);
    markActive($('#records-scope'), 'scope', scope);
    if (scope === 'local') {
      rows(loadRecords()[mode] ?? []);
      return;
    }
    const id = ++request;
    message('Загружаем…', 'loading');
    try {
      const list = await leaderboard.top(mode);
      if (id === request) rows(list);
    } catch {
      if (id === request) message('Не удалось загрузить общую таблицу. Проверьте интернет.');
    }
  }

  /** Подготовить форму сохранения после одиночной игры. Возвращает, можно ли сохранять. */
  function offer(result) {
    pending = result;
    const record = isRecord(settings.mode, result.score);
    // В общую таблицу можно отправить любой ненулевой результат, даже не личный рекорд.
    const canSave = record || (leaderboard.enabled && result.score > 0);
    $('#record-form').classList.toggle('hidden', !canSave);
    $('#record-label').textContent = record ? 'Новый рекорд! Ваше имя:' : 'Ваше имя для общей таблицы:';
    $('#record-name').value = settings.playerName ?? '';
    $('#record-comment').value = '';
    $('#record-status').textContent = '';
    $('#record-form button[type=submit]').disabled = false;
    return { canSave, record };
  }

  $('#records-tabs').addEventListener('click', (e) => {
    const m = e.target.closest('button')?.dataset.mode;
    if (m) render(m);
  });

  $('#records-scope').addEventListener('click', (e) => {
    const s = e.target.closest('button')?.dataset.scope;
    if (!s) return;
    scope = s;
    render();
  });

  $('#record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#record-form button[type=submit]');
    if (button.disabled || !pending) return;
    button.disabled = true;
    const name = $('#record-name').value.trim() || 'Игрок';
    settings.playerName = name;
    saveSettings(settings);
    const entry = { name, score: pending.score, length: pending.length };
    if (isRecord(settings.mode, pending.score)) addRecord(settings.mode, { ...entry, date: Date.now() });

    const toGlobal = leaderboard.enabled && $('#record-public').checked;
    if (toGlobal) {
      $('#record-status').textContent = 'Отправляем…';
      try {
        await leaderboard.submitRecord({ ...entry, mode: settings.mode, comment: $('#record-comment').value });
      } catch (err) {
        // Сервер объясняет отказ сам (например, «слишком часто») — показываем его слова.
        $('#record-status').textContent = `${serverMessage(err, 'Нет связи с сервером.')} У вас результат сохранён.`;
        button.disabled = false;
        return;
      }
    }
    $('#record-form').classList.add('hidden');
    pending = null;
    setBack('menu');
    scope = toGlobal ? 'global' : 'local';
    render(settings.mode);
    show('records');
  });

  return { render, offer };
}
