/**
 * Экраны-оверлеи (меню, пауза, итоги…) и HUD поверх игры.
 */
import { DEFAULTS, EFFECT_WARN_MS } from '../core/game.js';
import { THEMES } from '../render/scene.js';
import { $ } from './dom.js';
import { iconHtml } from './icons.js';

const SCREENS = ['menu', 'pause', 'over', 'records', 'settings', 'online', 'duel', 'feedback', 'achievements', 'install',
  'tutorial-offer', 'tutorial-done', 'whats-new', 'profile', 'dpad-layout', 'stats'];
// Поверх каких экранов виден HUD (null — игра без оверлея).
const WITH_HUD = new Set([null, 'pause', 'over', 'duel']);

/**
 * Показывает один экран (или ни одного — null) и настраивает HUD под режим.
 * @param {string|null} name
 * @param {{isDuel: boolean, canPause: boolean}} mode текущий режим
 */
export function showScreen(name, mode) {
  for (const s of SCREENS) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  $('#hud').classList.toggle('hidden', !WITH_HUD.has(name));
  document.body.classList.toggle('duel', mode.isDuel);
  $('#btn-pause').classList.toggle('hidden', !mode.canPause);
}

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

let duelHud = null;

/**
 * Счёт дуэли: «● Вы 3 | 5 Удав ●». Узлы создаются один раз, дальше меняется только текст —
 * ник соперника приходит из сети, поэтому в HTML его не вставляем.
 */
function renderDuelHud(mode, scores, theme) {
  if (!duelHud) {
    const side = (order) => {
      const span = document.createElement('span');
      const name = document.createElement('span');
      const score = document.createElement('b');
      span.append(...order(name, score));
      return { span, name, score };
    };
    const left = side((name, score) => ['● ', name, ' ', score]);
    const right = side((name, score) => [score, ' ', name, ' ●']);
    $('#hud-duel').replaceChildren(left.span, right.span);
    duelHud = [left, right];
  }
  const color = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
  [theme.head, theme.rivalHead].forEach((hex, i) => {
    duelHud[i].span.style.color = color(hex);
    setText(duelHud[i].name, mode.playerName(i));
    setText(duelHud[i].score, String(scores[i]));
  });
}

/** Обновляет HUD по данным режима (mode.hud()). */
export function renderHud(mode, themeId) {
  const data = mode.hud();
  if (data.timeLeft != null) $('#hud-timer').textContent = formatTime(data.timeLeft);
  if (data.duel) {
    renderDuelHud(mode, data.scores, THEMES[themeId] ?? THEMES.neon);
    return;
  }
  $('#hud-score').textContent = data.score;
  $('#hud-length').textContent = data.length;
  $('#hud-level').textContent = data.level;
}

const STATUS_LABELS = { slow: 'Замедление', ghost: 'Призрак' };
// Над головой — на столько пикселей выше её точки на экране; если там верхняя панель — под головой.
const STATUS_GAP = 14;
const HUD_SAFE_TOP = 72;
/** Запас, чтобы таймер не прыгал «над головой ↔ под головой» у края верхней панели. */
const FLIP_HYSTERESIS = 24;
/** Сглаживание позиции: доля пути до цели за кадр; дальше этого расстояния — сразу (проход сквозь стену). */
const FOLLOW = 0.45;
const SNAP_PX = 90;

/**
 * Таймеры над змейкой. Раньше они каждый кадр пересобирались целиком (innerHTML), размер мерился
 * заново, а позиция округлялась до пикселя — таймер подрагивал. Теперь элементы создаются один раз
 * на набор статусов, меняются только число (раз в секунду) и полоска (transform, без перерисовки
 * разметки), позиция — дробная и сглаженная.
 */
const status = {
  kinds: '', // какие статусы показаны сейчас (например «slow,ghost»)
  chips: new Map(), // вид → { root, num, bar, sec, ending }
  width: 0,
  height: 0,
  x: null,
  y: null,
  below: false,
};

function buildChips(el, kinds) {
  el.replaceChildren();
  status.chips.clear();
  for (const kind of kinds) {
    const root = document.createElement('span');
    root.className = `effect ${kind}`;
    root.title = STATUS_LABELS[kind] ?? '';
    root.insertAdjacentHTML('afterbegin', iconHtml(kind)); // своя иконка из icons.js, не данные
    const num = document.createElement('b');
    num.className = 'effect-num';
    const bar = document.createElement('i');
    bar.className = 'effect-bar';
    root.append(num, bar);
    el.append(root);
    status.chips.set(kind, {
      root, num, bar, sec: null, ending: false,
    });
  }
  status.kinds = kinds.join(',');
}

/**
 * Таймеры статусов над змейкой: значок, секунды и полоска оставшегося времени.
 * Последние EFFECT_WARN_MS — подсвечены (змейка в это время мигает).
 * @param {object|null} data mode.hud() во время партии, иначе null — спрятать
 * @param {{x: number, y: number, visible: boolean}|undefined} head точка головы на экране
 */
export function renderSnakeStatus(data, head) {
  const el = $('#snake-status');
  const active = data && !data.duel ? Object.entries(data.effects).filter(([, ms]) => ms > 0) : [];
  if (!active.length || !head?.visible) {
    if (!el.classList.contains('hidden')) el.classList.add('hidden');
    status.x = null; // в следующий раз — сразу на место, без «подлёта»
    return;
  }
  const kinds = active.map(([kind]) => kind);
  let resized = false;
  if (kinds.join(',') !== status.kinds) {
    buildChips(el, kinds);
    resized = true;
  }
  for (const [kind, ms] of active) {
    const chip = status.chips.get(kind);
    const sec = Math.ceil(ms / 1000);
    if (sec !== chip.sec) {
      chip.num.textContent = String(sec);
      chip.sec = sec;
      resized = true;
    }
    const ending = ms <= EFFECT_WARN_MS;
    if (ending !== chip.ending) {
      chip.root.classList.toggle('ending', ending);
      chip.ending = ending;
    }
    chip.bar.style.transform = `scaleX(${Math.min(1, ms / DEFAULTS.bonusDurationMs).toFixed(3)})`;
  }
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    resized = true;
  }
  // Размер меряем только когда он мог измениться (новый набор, другое число секунд).
  if (resized || !status.width) {
    status.width = el.offsetWidth;
    status.height = el.offsetHeight;
  }
  const half = status.width / 2;
  const targetX = Math.min(Math.max(head.x, half + 8), window.innerWidth - half - 8) - half;
  const above = head.y - STATUS_GAP - status.height;
  if (status.below) status.below = above < HUD_SAFE_TOP + FLIP_HYSTERESIS;
  else status.below = above < HUD_SAFE_TOP;
  const targetY = status.below ? head.y + STATUS_GAP * 3 : above;
  if (status.x === null || Math.hypot(targetX - status.x, targetY - status.y) > SNAP_PX) {
    status.x = targetX;
    status.y = targetY;
  } else {
    status.x += (targetX - status.x) * FOLLOW;
    status.y += (targetY - status.y) * FOLLOW;
  }
  el.style.transform = `translate3d(${status.x.toFixed(2)}px, ${status.y.toFixed(2)}px, 0)`;
}

/** Показывать ли таймер в HUD. */
export function showTimer(visible) {
  $('#hud-timer-box').classList.toggle('hidden', !visible);
}

/** Атрибуция музыки по требованию CC BY 4.0: название, автор, источник, лицензия. */
export function renderCredits(tracks, license) {
  if (!tracks.length) return;
  const titles = tracks.map((t) => `«${t.title}»`).join(', ');
  const authors = [...new Set(tracks.map((t) => t.author))].join(', ');
  $('#music-credits').innerHTML = `Музыка: ${titles} — ${authors} `
    + '(<a href="https://incompetech.com" target="_blank" rel="noopener">incompetech.com</a>), '
    + `<a href="${license.url}" target="_blank" rel="noopener">${license.name}</a>`;
}
