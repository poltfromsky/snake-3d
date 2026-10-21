/**
 * Экран «Моя статистика» (из профиля): плитки с главными цифрами, график прогресса,
 * почему заканчиваются партии, боты и онлайн, календарь активности и все партии списком.
 *
 * Считает всё src/core/stats.js, здесь — только отрисовка. С профилем статистика общая для всех его
 * устройств (src/net/stats-sync.js): здесь — строка о синхронизации, сравнение с другими игроками
 * и удаление статистики профиля. Графики — свой SVG в цвете темы
 * (--accent): один ряд данных, тонкие линии, подписи у рекорда и последней партии, подсказка
 * при наведении или касании. Каждое число есть и текстом (плитки, строки, таблица) — график
 * ничего не прячет. Тексты — только через textContent.
 */
import { BOT_LEVELS } from '../core/bot.js';
import {
  formatPlayTime, MODES_ORDER, plural, SPEEDS_ORDER, summarizeStats,
} from '../core/stats.js';
import { loadHistory } from '../storage.js';
import { $, markActive } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MODE_LABELS = { classic: 'Классика', walls: 'Стены', timed: 'На время' };
const SPEED_LABELS = { slow: 'Медленно', normal: 'Нормально', fast: 'Быстро' };
const DEATH_LABELS = {
  self: 'Укусили себя',
  wall: 'Врезались в стену',
  stone: 'Врезались в камень',
  poison: 'Съели гниль на короткой змейке',
  rival: 'Врезались в соперника',
  headOn: 'Лоб в лоб',
  time: 'Время вышло',
};
const INSIGHTS = {
  self: 'Чаще всего змейка кусает себя. На длинной змейке поворачивайте заранее, а «Призрак» на 5 секунд разрешает проходить сквозь себя.',
  wall: 'Чаще всего — стены. В «Классике» их нет: змейка проходит насквозь — там удобно тренировать повороты.',
  stone: 'Чаще всего — камни: их становится больше с каждым уровнем. Смотрите на пару клеток вперёд.',
  poison: 'Гниль укорачивает змейку, а самую короткую губит. Обходите фиолетовую еду, пока змейка маленькая.',
};
const RESULT_LABELS = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };
const GAMES = ['партия', 'партии', 'партий'];
const DAYS = ['день', 'дня', 'дней'];
const WINS = ['победа', 'победы', 'побед'];
const LOSSES = ['поражение', 'поражения', 'поражений'];
const DRAWS = ['ничья', 'ничьи', 'ничьих'];
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const shortDate = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const dateTime = (ms) => new Date(ms).toLocaleString('ru-RU', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const percent = (share) => `${Math.round(share * 100)} %`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Круглые деления оси: 0, середина, верх — «красивые» числа. */
function niceMax(max) {
  if (max <= 10) return 10;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * step >= max) return k * step;
  return 10 * step;
}

/** Сравнение показываем, только когда есть с кем сравнивать (то же число — на сервере). */
const MIN_COMPARE = 3;
const DELETE_CONFIRM_MS = 5000;

/**
 * @param {object} deps
 * @param {() => object[]} deps.games партии для показа (профиля или без профиля)
 * @param {() => ({key: string, name: string} | null)} deps.owner кто вошёл в профиль
 * @param {ReturnType<import('../net/stats-sync.js').createStatsSync>} deps.sync синхронизация
 */
export function createStatsScreen({ games, owner, sync }) {
  let summary = null;
  let modeTab = 'classic';
  let deleteArmedUntil = 0;
  let compareRequest = 0;
  const tip = $('#stats-tip');
  const visible = () => !$('#screen-stats').classList.contains('hidden');

  function showTip(text, x, y) {
    tip.textContent = text;
    tip.classList.remove('hidden');
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8);
    const top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  const hideTip = () => tip.classList.add('hidden');

  /* ---------- Плитки ---------- */
  function renderKpis(s) {
    const tiles = [
      [String(s.totals.games), plural(s.totals.games, GAMES)],
      [formatPlayTime(s.totals.playMs), 'в игре'],
      [String(s.activity.streak), `${plural(s.activity.streak, DAYS)} подряд`],
      [s.totals.best ? String(s.totals.best.score) : '—', s.totals.best ? `рекорд · ${MODE_LABELS[s.totals.best.mode]}` : 'рекорд'],
    ];
    $('#stats-kpis').replaceChildren(...tiles.map(([value, label]) => {
      const tile = el('div', 'stats-kpi');
      tile.append(el('b', '', value), el('small', '', label));
      return tile;
    }));
  }

  /* ---------- Прогресс ---------- */
  function renderProgress(s) {
    markActive($('#stats-mode'), 'mode', modeTab);
    const p = s.progress[modeTab];
    const box = $('#stats-progress');
    box.replaceChildren();
    if (!p.points.length) {
      box.append(el('p', 'stats-empty', `В режиме «${MODE_LABELS[modeTab]}» ещё нет партий.`));
      $('#stats-progress-text').textContent = '';
      $('#stats-speeds').replaceChildren();
      return;
    }
    box.append(progressChart(p.points, p.best));

    let text = `Средний счёт последних ${Math.min(p.games, 10)} ${plural(Math.min(p.games, 10), ['партии', 'партий', 'партий'])}: ${Math.round(p.avgRecent)}.`;
    if (p.change !== null) {
      const sign = p.change >= 0 ? '+' : '−';
      text += ` Раньше было ${Math.round(p.avgBefore)} (${sign}${Math.abs(Math.round(p.change * 100))} %)`;
      text += p.change > 0.05 ? ' — растёте!' : p.change < -0.05 ? ' — бывает, отдохните и попробуйте снова.' : ' — держите уровень.';
    }
    $('#stats-progress-text').textContent = text;

    $('#stats-speeds').replaceChildren(...SPEEDS_ORDER.map((speed) => {
      const tile = el('div', 'stats-speed');
      tile.append(el('small', '', SPEED_LABELS[speed]), el('b', '', p.bySpeed[speed] === null ? '—' : String(p.bySpeed[speed])));
      return tile;
    }));
  }

  /** Линия счёта по партиям: рекорд и последняя партия подписаны, остальное — в подсказке. */
  function progressChart(points, best) {
    const width = Math.max(240, $('#stats-progress').clientWidth || 300);
    const height = 150;
    const pad = {
      left: 32, right: 14, top: 16, bottom: 22,
    };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const top = niceMax(Math.max(...points.map((pt) => pt.score), 1));
    const x = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v) => pad.top + innerH - (v / top) * innerH;

    const svg = svgEl('svg', {
      class: 'stats-svg', viewBox: `0 0 ${width} ${height}`, width, height, tabindex: 0, role: 'img',
      'aria-label': `Счёт за последние ${points.length} ${plural(points.length, ['партию', 'партии', 'партий'])}: от ${Math.min(...points.map((pt) => pt.score))} до ${Math.max(...points.map((pt) => pt.score))}`,
    });
    for (const v of [0, top / 2, top]) {
      svg.append(svgEl('line', {
        class: 'stats-grid', x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v),
      }));
      const label = svgEl('text', {
        class: 'stats-axis', x: pad.left - 6, y: y(v) + 4, 'text-anchor': 'end',
      });
      label.textContent = String(Math.round(v));
      svg.append(label);
    }
    for (const [i, anchor] of [[0, 'start'], [points.length - 1, 'end']]) {
      if (points.length === 1 && i === 0 && anchor === 'start') continue;
      const label = svgEl('text', {
        class: 'stats-axis', x: x(i), y: height - 6, 'text-anchor': points.length === 1 ? 'middle' : anchor,
      });
      label.textContent = shortDate(points[i].at);
      svg.append(label);
    }

    const coords = points.map((pt, i) => `${x(i).toFixed(1)},${y(pt.score).toFixed(1)}`);
    if (points.length > 1) {
      svg.append(svgEl('path', {
        class: 'stats-area', d: `M${x(0)},${y(0)} L${coords.join(' L')} L${x(points.length - 1)},${y(0)} Z`,
      }));
      svg.append(svgEl('polyline', { class: 'stats-line-mark', points: coords.join(' ') }));
    }

    // Подписи: рекорд режима (если он среди последних партий) и последняя партия.
    const last = points.length - 1;
    const bestIndex = best ? points.findIndex((pt) => pt.at === best.at && pt.score === best.score) : -1;
    const marks = new Map();
    if (bestIndex === last) {
      marks.set(last, `рекорд ${best.score}`);
    } else if (bestIndex >= 0 && Math.abs(x(bestIndex) - x(last)) < 70) {
      // Рекорд почти у последней точки — две подписи налезли бы друг на друга: оставляем рекорд.
      marks.set(bestIndex, `рекорд ${best.score}`);
    } else {
      if (bestIndex >= 0) marks.set(bestIndex, `рекорд ${best.score}`);
      marks.set(last, `${points[last].score}`);
    }
    for (const [i, text] of marks) {
      svg.append(svgEl('circle', {
        class: 'stats-dot', cx: x(i), cy: y(points[i].score), r: 4,
      }));
      const label = svgEl('text', {
        class: 'stats-label', x: x(i), y: y(points[i].score) - 9,
        'text-anchor': x(i) > width - 50 ? 'end' : x(i) < pad.left + 30 ? 'start' : 'middle',
      });
      label.textContent = text;
      svg.append(label);
    }

    // Подсказка: вертикальная линия «прилипает» к ближайшей партии.
    const cross = svgEl('line', {
      class: 'stats-cross hidden', y1: pad.top, y2: pad.top + innerH,
    });
    const focusDot = svgEl('circle', { class: 'stats-dot stats-focus hidden', r: 5 });
    svg.append(cross, focusDot);
    let focus = null;
    const point = (i, clientX, clientY) => {
      focus = i;
      const pt = points[i];
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      focusDot.setAttribute('cx', x(i));
      focusDot.setAttribute('cy', y(pt.score));
      cross.classList.remove('hidden');
      focusDot.classList.remove('hidden');
      const rect = svg.getBoundingClientRect();
      const px = clientX ?? rect.left + (x(i) / width) * rect.width;
      const py = clientY ?? rect.top + (y(pt.score) / height) * rect.height;
      showTip(`${pt.score} ${plural(pt.score, ['очко', 'очка', 'очков'])} · ${dateTime(pt.at)}${pt.speed ? ` · ${SPEED_LABELS[pt.speed] ?? ''}` : ''}`, px, py);
    };
    const nearest = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((clientX - rect.left) / rect.width) * width;
      let bestI = 0;
      for (let i = 1; i < points.length; i += 1) if (Math.abs(x(i) - sx) < Math.abs(x(bestI) - sx)) bestI = i;
      return bestI;
    };
    const leave = () => {
      focus = null;
      cross.classList.add('hidden');
      focusDot.classList.add('hidden');
      hideTip();
    };
    svg.addEventListener('pointermove', (e) => point(nearest(e.clientX), e.clientX, e.clientY));
    svg.addEventListener('pointerdown', (e) => point(nearest(e.clientX), e.clientX, e.clientY));
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('blur', leave);
    svg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation(); // стрелки здесь листают партии, а не ведут змейку
      const i = focus === null ? last : Math.min(last, Math.max(0, focus + (e.key === 'ArrowRight' ? 1 : -1)));
      point(i);
    });
    return svg;
  }

  /* ---------- Почему проигрываю ---------- */
  function renderDeaths(s) {
    const d = s.deaths;
    const box = $('#stats-deaths');
    if (!d.total) {
      box.replaceChildren(el('p', 'stats-empty', 'Пока нечего считать — сыграйте несколько одиночных партий.'));
      $('#stats-insight').textContent = '';
      return;
    }
    box.replaceChildren(...d.list.map(({ reason, count, share }) => {
      const row = el('div', 'stats-bar-row');
      const bar = el('div', 'stats-bar');
      const fill = el('i', 'stats-bar-fill');
      fill.style.width = `${Math.max(2, share * 100)}%`;
      bar.append(fill);
      row.append(el('span', 'stats-bar-label', DEATH_LABELS[reason] ?? reason), bar, el('b', 'stats-bar-value', `${percent(share)} · ${count}`));
      return row;
    }));
    let insight = d.insight ? INSIGHTS[d.insight] ?? '' : 'Подсказка появится, когда наберётся хотя бы 5 проигрышей.';
    if (d.timeUp) insight += ` Ещё ${d.timeUp} ${plural(d.timeUp, ['партия', 'партии', 'партий'])} «На время» доиграны до конца — это не проигрыш.`;
    $('#stats-insight').textContent = insight.trim();
  }

  /* ---------- Боты и онлайн ---------- */
  function renderDuels(s) {
    const rows = [...Object.entries(s.bots).map(([level, r]) => [BOT_LEVELS[level]?.name ?? level, r]), ['Онлайн с другом', s.online]];
    $('#stats-duels').replaceChildren(...rows.map(([name, r]) => {
      const row = el('div', 'stats-duel');
      const head = el('div', 'stats-duel-head');
      head.append(el('b', '', name), el('span', '', r.played
        ? [`${r.win} ${plural(r.win, WINS)}`, `${r.loss} ${plural(r.loss, LOSSES)}`, r.draw ? `${r.draw} ${plural(r.draw, DRAWS)}` : '']
          .filter(Boolean).join(' · ')
        : 'ещё не играли'));
      const meter = el('div', 'stats-meter');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', `${name}: доля побед`);
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meter.setAttribute('aria-valuenow', String(Math.round((r.winRate ?? 0) * 100)));
      const fill = el('i');
      fill.style.width = `${(r.winRate ?? 0) * 100}%`;
      meter.append(fill);
      row.append(head, meter, el('small', '', r.played ? `${percent(r.winRate)} побед` : ''));
      return row;
    }));
  }

  /* ---------- Активность ---------- */
  function renderActivity(s) {
    const { cells } = s.activity;
    const cell = 14;
    const gap = 3;
    const left = 20;
    const firstWeekday = (new Date(cells[0].at).getDay() + 6) % 7; // пн = 0
    const columns = Math.ceil((cells.length + firstWeekday) / 7);
    const width = left + columns * (cell + gap);
    const height = 7 * (cell + gap);
    const svg = svgEl('svg', {
      class: 'stats-svg stats-heat', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
      'aria-label': `Активность за 12 недель: играли ${s.activity.activeDays} ${plural(s.activity.activeDays, DAYS)}`,
    });
    for (const [row, name] of [[0, WEEKDAYS[0]], [2, WEEKDAYS[2]], [4, WEEKDAYS[4]], [6, WEEKDAYS[6]]]) {
      const label = svgEl('text', { class: 'stats-axis', x: 0, y: row * (cell + gap) + cell - 3 });
      label.textContent = name;
      svg.append(label);
    }
    cells.forEach((c, i) => {
      const pos = i + firstWeekday;
      const level = c.count === 0 ? 0 : c.count === 1 ? 1 : c.count <= 3 ? 2 : c.count <= 6 ? 3 : 4;
      const rect = svgEl('rect', {
        class: `stats-cell lv${level}`, x: left + Math.floor(pos / 7) * (cell + gap), y: (pos % 7) * (cell + gap),
        width: cell, height: cell, rx: 3,
      });
      const text = `${new Date(c.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' })} · ${c.count ? `${c.count} ${plural(c.count, GAMES)}` : 'не играли'}`;
      rect.addEventListener('pointerenter', (e) => showTip(text, e.clientX, e.clientY));
      rect.addEventListener('pointerdown', (e) => showTip(text, e.clientX, e.clientY));
      rect.addEventListener('pointerleave', hideTip);
      svg.append(rect);
    });
    // Легенда под календарём: «меньше ■■■■■ больше».
    const legend = el('div', 'stats-legend');
    legend.append(el('span', '', 'меньше'));
    for (let lv = 0; lv <= 4; lv += 1) legend.append(el('i', `lv${lv}`));
    legend.append(el('span', '', 'больше'));
    $('#stats-activity').replaceChildren(svg, legend);

    const a = s.activity;
    $('#stats-activity-text').textContent = a.activeDays
      ? `Играли ${a.activeDays} ${plural(a.activeDays, DAYS)} из 84 · самая длинная серия — ${a.longestStreak} ${plural(a.longestStreak, DAYS)} подряд`
      : 'За последние 12 недель партий нет.';
  }

  /* ---------- Синхронизация и сравнение ---------- */
  const syncTime = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  function renderSync(state = sync.state) {
    const who = owner();
    const line = $('#stats-sync');
    line.classList.toggle('error', ['offline', 'limited', 'denied'].includes(state.status) && Boolean(who));
    $('#stats-delete').classList.toggle('hidden', !who);
    if (!who) {
      line.textContent = 'Без профиля статистика только на этом устройстве. Войдите в профиль — и она станет общей для всех ваших устройств.';
      return;
    }
    const texts = {
      syncing: 'Синхронизируем с другими устройствами…',
      synced: `Общая для всех ваших устройств · обновлено в ${syncTime(state.at ?? Date.now())}`,
      offline: 'Нет связи с сервером игры — партии с этого устройства отправятся позже сами (из России — с VPN).',
      limited: 'Слишком много партий за час — остальные отправятся позже сами.',
      denied: 'Это устройство больше не допущено к профилю — войдите в профиль снова.',
    };
    line.textContent = `Профиль «${who.name}». ${texts[state.status] ?? 'Общая для всех ваших устройств.'}`;
  }

  /** Строка сравнения: подпись, шкала «лучше, чем у такой доли игроков» и пояснение. */
  function compareRow(label, share, text) {
    const row = el('div', 'stats-duel');
    const head = el('div', 'stats-duel-head');
    head.append(el('b', '', label), el('span', '', share === null ? '' : `лучше, чем у ${Math.round(share * 100)} %`));
    const meter = el('div', 'stats-meter');
    if (share !== null) {
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', `${label}: лучше, чем у такой доли игроков`);
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meter.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    }
    const fill = el('i');
    fill.style.width = `${(share ?? 0) * 100}%`;
    meter.append(fill);
    // Не с кем сравнивать — пустая шкала только сбивает с толку.
    row.append(...(share === null ? [head] : [head, meter]), el('small', 'stats-compare-note', text));
    return row;
  }

  async function renderCompare() {
    const box = $('#stats-compare');
    const who = owner();
    $('#stats-compare-block').classList.toggle('hidden', !who);
    if (!who) return;
    const id = ++compareRequest;
    box.replaceChildren(el('p', 'stats-empty', 'Сравниваем…'));
    let data;
    try {
      data = await sync.compare();
    } catch {
      if (id === compareRequest) box.replaceChildren(el('p', 'stats-empty', 'Сравнение появится, когда будет связь с сервером игры (из России — с VPN).'));
      return;
    }
    if (id !== compareRequest || !data) return;
    const rows = [];
    for (const mode of MODES_ORDER) {
      const m = data.modes?.[mode];
      if (!m || m.mine === null || m.mine === undefined) continue;
      const enough = m.others >= MIN_COMPARE;
      rows.push(compareRow(
        `${MODE_LABELS[mode]} · рекорд ${m.mine}`,
        enough ? m.below / m.others : null,
        enough ? `Сравнение с лучшими результатами ${m.others} ${plural(m.others, ['игрока', 'игроков', 'игроков'])} в общей таблице`
          : 'Пока мало игроков для сравнения',
      ));
    }
    for (const [level, b] of Object.entries(data.bots ?? {})) {
      if (b.mine === null || b.mine === undefined) continue;
      const enough = b.others >= MIN_COMPARE;
      rows.push(compareRow(
        `${BOT_LEVELS[level]?.name ?? level} · побед ${percent(b.mine)}`,
        enough ? b.below / b.others : null,
        enough ? `Доля побед — среди ${b.others} ${plural(b.others, ['игрока', 'игроков', 'игроков'])}, сыгравших с ботом хотя бы 3 раза`
          : 'Пока мало игроков для сравнения',
      ));
    }
    box.replaceChildren(...(rows.length ? rows : [el('p', 'stats-empty', 'Сыграйте одиночную партию или 3 партии с ботом — и появится сравнение.')]));
  }

  /* ---------- Таблица ---------- */
  function renderTable() {
    const list = games().slice(0, 30);
    const box = $('#stats-table');
    if (!list.length) {
      box.replaceChildren(el('p', 'stats-empty', 'Подробные записи появятся после первой партии.'));
      return;
    }
    const table = el('table');
    const head = el('tr');
    for (const h of ['Когда', 'Что', 'Счёт', 'Итог']) head.append(el('th', '', h));
    table.append(el('thead'));
    table.tHead.append(head);
    const body = el('tbody');
    for (const g of list) {
      const tr = el('tr');
      const what = g.kind === 'solo'
        ? `${MODE_LABELS[g.mode] ?? ''}${g.speed ? `, ${SPEED_LABELS[g.speed]?.toLowerCase() ?? ''}` : ''}`
        : g.kind === 'bot' ? `Бот ${BOT_LEVELS[g.level]?.name ?? ''}` : 'Онлайн';
      const result = g.kind === 'solo' ? DEATH_LABELS[g.end] ?? '—' : RESULT_LABELS[g.result] ?? '—';
      for (const v of [dateTime(g.at), what, String(g.score ?? 0), result]) tr.append(el('td', '', v));
      body.append(tr);
    }
    table.append(body);
    box.replaceChildren(table);
  }

  /** Партии для подсчёта: с профилем старая история уже стала партиями профиля (stats-sync). */
  const compute = () => summarizeStats({ games: games(), history: owner() ? {} : loadHistory() });

  function resetDelete() {
    deleteArmedUntil = 0;
    $('#stats-delete').textContent = 'Удалить статистику профиля';
  }

  function renderAll() {
    summary = compute();
    const since = summary.detailedSince
      ? ` Причины проигрышей, боты и время в игре считаются с ${new Date(summary.detailedSince).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}.`
      : ' Сыграйте партию — и здесь появятся цифры.';
    $('#stats-note').textContent = `${owner() ? 'Все ваши устройства.' : 'На этом устройстве.'}${since}`;
    renderSync();
    resetDelete();
    // Открываем на режиме, в котором больше всего партий.
    modeTab = MODES_ORDER.reduce((m, k) => (summary.progress[k].games > summary.progress[m].games ? k : m), modeTab);
    renderKpis(summary);
    renderProgress(summary);
    renderDeaths(summary);
    renderDuels(summary);
    renderActivity(summary);
    renderTable();
  }

  $('#stats-delete').addEventListener('click', async () => {
    // Первое нажатие — предупреждение, второе (в течение 5 секунд) — удаление.
    if (Date.now() > deleteArmedUntil) {
      deleteArmedUntil = Date.now() + DELETE_CONFIRM_MS;
      $('#stats-delete').textContent = 'Точно удалить? Партии исчезнут на всех устройствах — нажмите ещё раз';
      return;
    }
    resetDelete();
    try {
      await sync.deleteAll();
      renderAll();
      renderCompare();
      $('#stats-sync').textContent = 'Статистика профиля удалена: на сервере и здесь сразу, на остальных устройствах — при их синхронизации.';
    } catch {
      $('#stats-sync').textContent = 'Не удалось удалить — нет связи с сервером игры (из России — с VPN). Попробуйте позже.';
      $('#stats-sync').classList.add('error');
    }
  });

  $('#stats-mode').addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.mode;
    if (!value || !summary) return;
    modeTab = value;
    hideTip();
    renderProgress(summary);
  });
  window.addEventListener('resize', () => {
    if (summary && !$('#screen-stats').classList.contains('hidden')) renderProgress(summary);
  });
  $('#screen-stats').addEventListener('scroll', hideTip, { passive: true });

  return {
    /** Открыли экран: сразу показать что есть, потом синхронизировать и сравнить. */
    render() {
      renderAll();
      if (owner()) {
        sync.syncNow();
        renderCompare();
      } else {
        $('#stats-compare-block').classList.add('hidden');
      }
    },
    /** Синхронизация сообщила о себе: строка состояния, а получили новое — пересчитать экран. */
    syncState(state) {
      if (!visible()) return;
      if (state.status === 'synced') renderAll();
      else renderSync(state);
    },
    hideTip,
    /** Коротко для «Моего профиля»: время в игре и серия. */
    brief() {
      const s = compute();
      return { playTime: formatPlayTime(s.totals.playMs), streak: s.activity.streak, games: s.totals.games };
    },
  };
}
