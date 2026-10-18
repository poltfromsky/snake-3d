/**
 * Экраны-оверлеи (меню, пауза, итоги…) и HUD поверх игры.
 */
import { THEMES } from '../render/scene.js';
import { $, setHtml } from './dom.js';
import { iconHtml } from './icons.js';

const SCREENS = ['menu', 'pause', 'over', 'records', 'settings', 'online', 'duel', 'feedback', 'achievements', 'install',
  'tutorial-offer', 'tutorial-done', 'whats-new'];
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
  const effects = [];
  if (data.effects.slow > 0) effects.push(`<span class="effect slow">${iconHtml('slow')} ${Math.ceil(data.effects.slow / 1000)}</span>`);
  if (data.effects.ghost > 0) effects.push(`<span class="effect ghost">${iconHtml('ghost')} ${Math.ceil(data.effects.ghost / 1000)}</span>`);
  setHtml($('#hud-effects'), effects.join(''));
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
