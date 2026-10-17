/** Экран «Достижения» и кубки на кнопках побеждённых ботов. */
import { $ } from './dom.js';

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
    icon.textContent = a.unlockedAt ? a.icon : '🔒';
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
    b.classList.toggle('beaten', book.has(`beat-${b.dataset.level}`));
  }
}
