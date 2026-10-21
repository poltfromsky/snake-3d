/**
 * Экран «Рекорды»:
 *   «Общие» — общая таблица: у каждого ника одна строка, его лучший результат;
 *   «Мои»   — все свои попытки на этом устройстве, новые сверху, лучшая отмечена звездой.
 * Режим и скорость (Медленно / Нормально / Быстро) — вкладки; у каждой скорости своя таблица.
 * У ника в общей таблице — значок, чем он играл: ПК, свайпы или кнопки.
 */
import { attemptSpeed, loadHistory, personalBest } from '../storage.js';
import { $, markActive } from './dom.js';
import { iconSvg } from './icons.js';

/** Значок платформы у ника: чем играли в партии с этим рекордом. */
export const PLATFORM_ICONS = Object.freeze({
  pc: { icon: 'monitor', label: 'Компьютер' },
  touch: { icon: 'phoneSwipe', label: 'Телефон, свайпы' },
  buttons: { icon: 'phoneButtons', label: 'Телефон, кнопки на экране' },
});

/**
 * @param {object} deps
 * @param {object} deps.settings режим по умолчанию
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 */
export function createRecordsScreen({ settings, leaderboard }) {
  let scope = leaderboard.enabled ? 'global' : 'local';
  let mode = settings.mode;
  let speed = 'normal';
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
      const platform = PLATFORM_ICONS[r.platform];
      if (platform) {
        const icon = iconSvg(platform.icon, 'icon platform-icon');
        icon.setAttribute('aria-hidden', 'false');
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', platform.label);
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = platform.label;
        icon.prepend(title);
        name.prepend(icon);
      }
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
      message('Здесь будут все ваши попытки в этом режиме на этой скорости.');
      return;
    }
    const best = personalBest(mode, speed);
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
      score.textContent = a.score;
      if (isBest) score.prepend(iconSvg('star'));
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
    markActive($('#records-speed'), 'speed', speed);
    markActive($('#records-scope'), 'scope', scope);
    showPlace(null);
    if (scope === 'local') {
      historyRows((loadHistory()[mode] ?? []).filter((a) => attemptSpeed(a) === speed));
      return;
    }
    const id = ++request;
    message('Загружаем…', 'loading');
    try {
      const [list, place] = await Promise.all([
        leaderboard.top(mode, speed),
        settings.playerName ? leaderboard.place(mode, settings.playerName, speed).catch(() => null) : null,
      ]);
      if (id !== request) return;
      globalRows(list);
      showPlace(place);
    } catch {
      if (id === request) message('Не удалось загрузить общую таблицу. Проверьте интернет; из России — включите VPN.');
    }
  }

  $('#records-tabs').addEventListener('click', (e) => {
    const m = e.target.closest('button')?.dataset.mode;
    if (m) render(m);
  });

  $('#records-speed').addEventListener('click', (e) => {
    const s = e.target.closest('button')?.dataset.speed;
    if (!s) return;
    speed = s;
    render();
  });

  $('#records-scope').addEventListener('click', (e) => {
    const s = e.target.closest('button')?.dataset.scope;
    if (!s) return;
    scope = s;
    render();
  });

  return { render };
}
