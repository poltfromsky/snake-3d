/**
 * Экраны-оверлеи (меню, пауза, итоги…) и HUD поверх игры.
 */
import { DEFAULTS, EFFECT_WARN_MS } from '../core/game.js';
import { THEMES } from '../render/scene.js';
import { $, setHtml } from './dom.js';
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
    el.classList.add('hidden');
    return;
  }
  setHtml(el, active.map(([kind, ms]) => {
    const ending = ms <= EFFECT_WARN_MS ? ' ending' : '';
    const share = Math.round(Math.min(1, ms / DEFAULTS.bonusDurationMs) * 100);
    return `<span class="effect ${kind}${ending}" title="${STATUS_LABELS[kind] ?? ''}">${iconHtml(kind)} ${Math.ceil(ms / 1000)}<i class="effect-bar" style="width: ${share}%"></i></span>`;
  }).join(''));
  el.classList.remove('hidden');
  const halfWidth = el.offsetWidth / 2;
  const x = Math.min(Math.max(head.x, halfWidth + 8), window.innerWidth - halfWidth - 8);
  const above = head.y - STATUS_GAP - el.offsetHeight;
  const y = above < HUD_SAFE_TOP ? head.y + STATUS_GAP * 3 : above;
  el.style.transform = `translate(${Math.round(x - halfWidth)}px, ${Math.round(y)}px)`;
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
