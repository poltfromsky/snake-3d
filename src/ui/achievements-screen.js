/** Экран «Достижения» и кубки на кнопках побеждённых ботов. */
import { $ } from './dom.js';
import { medalUrl } from '../achievements.js';
import { iconSvg } from './icons.js';

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** @param {import('../achievements.js').AchievementBook} book */
export function renderAchievements(book) {
  const list = book.list();
  const open = list.filter((a) => a.unlockedAt).length;
  $('#achievements-progress').textContent = `Открыто ${open} из ${list.length}`;
  const ul = $('#achievements-list');
  ul.replaceChildren();
  for (const a of list) {
    const li = document.createElement('li');
    li.className = `${a.rarity}${a.unlockedAt ? '' : ' locked'}`;
    const icon = document.createElement('div');
    icon.className = 'achievement-icon';
    // Медаль видна и у закрытого достижения — серой, с замком: понятно, к чему стремиться.
    const medal = document.createElement('img');
    medal.className = 'medal';
    medal.src = medalUrl(a.id);
    medal.alt = '';
    icon.append(medal);
    if (!a.unlockedAt) icon.append(iconSvg('lock', 'icon medal-lock'));
    const title = document.createElement('b');
    title.textContent = a.title;
    const desc = document.createElement('span');
    desc.textContent = a.unlockedAt ? `${a.description} · ${formatDate(a.unlockedAt)}` : a.description;
    li.append(icon, title, desc);
    ul.append(li);
  }
}

/** Кубок на кнопках ботов, которых игрок уже победил. */
export function renderBotButtons(book) {
  for (const b of document.querySelectorAll('.bot-btn')) {
    const beaten = book.has(`beat-${b.dataset.level}`);
    b.classList.toggle('beaten', beaten);
    const mark = b.querySelector('.beaten-mark');
    if (beaten && !mark) {
      const span = document.createElement('span');
      span.className = 'beaten-mark';
      span.append(iconSvg('trophy'));
      b.append(span);
    } else if (!beaten && mark) {
      mark.remove();
    }
  }
}
