/**
 * Экран «Рекорды»:
 *   «Общие» — общая таблица: у каждого ника одна строка, его лучший результат;
 *   «Мои»   — все свои попытки на этом устройстве, новые сверху, лучшая отмечена ★.
 */
import { loadHistory, personalBest } from '../storage.js';
import { $, markActive } from './dom.js';

/**
 * @param {object} deps
 * @param {object} deps.settings режим по умолчанию
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 */
export function createRecordsScreen({ settings, leaderboard }) {
  let scope = leaderboard.enabled ? 'global' : 'local';
  let mode = settings.mode;
  let request = 0;

  function message(text, className = 'empty') {
    const li = document.createElement('li');
    li.className = className;
    li.textContent = text;
    $('#records-list').replaceChildren(li);
  }

  const date = (ts) => new Date(ts).toLocaleDateString('ru-RU');
  const dateTime = (ts) => new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  /** Общая таблица. textContent, а не innerHTML: ники и комментарии пишут посторонние люди. */
  function globalRows(list) {
    const ol = $('#records-list');
    ol.classList.remove('history');
    ol.replaceChildren();
    if (!list.length) {
      message('Пока пусто — станьте первым!');
      return;
    }
    for (const r of list) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = r.name;
      if (settings.playerName && r.name.toLowerCase() === settings.playerName.toLowerCase()) li.classList.add('me');
      const score = document.createElement('b');
      score.textContent = r.score;
      const meta = document.createElement('small');
      meta.textContent = `длина ${r.length} · ${date(r.created_at)}`;
      li.append(name, score, meta);
      if (r.comment) {
        const comment = document.createElement('small');
        comment.className = 'comment';
        comment.textContent = `«${r.comment}»`;
        li.append(comment);
      }
      ol.append(li);
    }
  }

  /** История своих попыток. */
  function historyRows(list) {
    const ol = $('#records-list');
    ol.classList.add('history');
    ol.replaceChildren();
    if (!list.length) {
      message('Здесь будут все ваши попытки в этом режиме.');
      return;
    }
    const best = personalBest(mode);
    let bestMarked = false;
    for (const a of list) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const isBest = !bestMarked && a.score === best && best > 0;
      if (isBest) {
        bestMarked = true;
        li.classList.add('best');
      }
      label.textContent = a.date ? dateTime(a.date) : 'раньше';
      const score = document.createElement('b');
      score.textContent = isBest ? `★ ${a.score}` : a.score;
      const meta = document.createElement('small');
      meta.textContent = `длина ${a.length}`;
      li.append(label, score, meta);
      ol.append(li);
    }
  }

  /** Своё место под таблицей — видно, даже если ника нет в топ-10. */
  function showPlace(place) {
    const el = $('#records-me');
    el.classList.toggle('hidden', !place);
    if (!place) return;
    const label = document.createElement('b');
    label.textContent = `${place.place}-е место`;
    el.replaceChildren(`Ваш лучший результат в общей таблице: ${place.score} · `, label);
  }

  async function render(nextMode = mode) {
    mode = nextMode;
    markActive($('#records-tabs'), 'mode', mode);
    markActive($('#records-scope'), 'scope', scope);
    showPlace(null);
    if (scope === 'local') {
      historyRows(loadHistory()[mode] ?? []);
      return;
    }
    const id = ++request;
    message('Загружаем…', 'loading');
    try {
      const [list, place] = await Promise.all([
        leaderboard.top(mode),
        settings.playerName ? leaderboard.place(mode, settings.playerName).catch(() => null) : null,
      ]);
      if (id !== request) return;
      globalRows(list);
      showPlace(place);
    } catch {
      if (id === request) message('Не удалось загрузить общую таблицу. Проверьте интернет.');
    }
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

  return { render };
}
