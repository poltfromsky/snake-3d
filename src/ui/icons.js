/**
 * Свой набор иконок — вместо эмодзи. Эмодзи каждый телефон рисует по-своему
 * (а ◀ ▶ некоторые браузеры превращают в цветные кнопки), из-за чего интерфейс
 * выглядел пёстрым и «собранным из чего попало». Здесь — единый стиль: контур
 * в 2 px на сетке 24×24, цвет берётся у текста (currentColor).
 *
 * В разметке: <span data-icon="cap"></span> — иконку подставит renderIcons().
 * В коде: iconSvg('lock').
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Содержимое иконок (внутренности <svg viewBox="0 0 24 24">). fill — у заливаемых фигур. */
export const ICONS = Object.freeze({
  // Шапочка выпускника — обучение.
  cap: '<path d="M2 9.5 12 5l10 4.5-10 4.5L2 9.5Z"/><path d="M6 11.3V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.7"/><path d="M22 9.5V15"/>',
  // Облачко с текстом — отзыв, комментарий.
  chat: '<path d="M4 5h16v11H9l-4 3.5V16H4Z"/><path d="M8 9.5h8M8 12.5h5"/>',
  // Глобус — общая таблица.
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z"/>',
  // Телефон со стрелкой — установить как приложение.
  install: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7.5v7M9 11.5l3 3 3-3"/><path d="M10.5 18.5h3"/>',
  // «Поделиться» как в Safari: квадрат со стрелкой вверх.
  share: '<path d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16"/><path d="M12 3v11M8.5 6.5 12 3l3.5 3.5"/>',
  // Песочные часы — замедление.
  slow: '<path d="M7 3h10M7 21h10"/><path d="M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9"/>',
  // Призрак.
  ghost: '<path d="M5 20V11a7 7 0 0 1 14 0v9l-2.3-1.6-2.4 1.6-2.3-1.6L9.7 20l-2.4-1.6Z"/><circle cx="9.5" cy="11" r="1" fill="currentColor"/><circle cx="14.5" cy="11" r="1" fill="currentColor"/>',
  // Замок — достижение ещё не открыто.
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2.5"/>',
  // Кубок — бот побеждён.
  trophy: '<path d="M8 3.5h8v5a4 4 0 0 1-8 0Z"/><path d="M8 5.5H5a3 3 0 0 0 3 4M16 5.5h3a3 3 0 0 1-3 4"/><path d="M12 12.5V17M8.5 20.5h7M10 17h4v3.5h-4Z"/>',
  // Звезда — лучший результат.
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8Z" fill="currentColor"/>',
  // Чем играл человек — значок у ника в общей таблице (как значок платформы в кроссплей-играх).
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>',
  phoneSwipe: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M9.5 12h5M12.5 9.5 15 12l-2.5 2.5"/>',
  // Телефон с крестом-кнопками на экране: тоже телефон, но играли кнопками.
  phoneButtons: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 9h2v2h2v2h-2v2h-2v-2H9v-2h2Z"/>',
  // Человек — профиль игрока.
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/>',
  // Знаки достижений.
  snake: '<path d="M5 19c3 0 3-4 6-4s3 4 6 4"/><path d="M17 19c1.7 0 3-1.3 3-3s-1.3-3-3-3H8a3 3 0 0 1 0-6h7"/><circle cx="17" cy="7" r="2"/>',
  flask: '<path d="M9.5 3h5M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 15h9"/>',
  spiral: '<path d="M12 12a1.5 1.5 0 1 1 1.5 1.5A3 3 0 1 1 16.5 10.5a4.5 4.5 0 1 1-4.5-4.5 6 6 0 1 1-6 6"/>',
  crown: '<path d="M3.5 8 7.5 12 12 5l4.5 7 4-4-2 11h-13Z"/><path d="M5.5 19h13"/>',
  infinity: '<path d="M7.5 8.5c-2 0-3.5 1.6-3.5 3.5s1.5 3.5 3.5 3.5c3.5 0 5.5-7 9-7 2 0 3.5 1.6 3.5 3.5s-1.5 3.5-3.5 3.5c-3.5 0-5.5-7-9-7Z"/>',
});

/** Иконка как элемент <svg>. */
export function iconSvg(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Разметка иконок — своя, из этого файла: чужой текст сюда не попадает.
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

/** Иконка как строка разметки — для мест, которые собираются строкой (HUD). Только свои иконки. */
export function iconHtml(name, className = 'icon') {
  return `<svg viewBox="0 0 24 24" class="${className}" aria-hidden="true" fill="none" stroke="currentColor"`
    + ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
}

/** Подставить иконки во все <… data-icon="имя"> внутри root. */
export function renderIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.firstElementChild?.tagName === 'svg') continue;
    el.prepend(iconSvg(el.dataset.icon));
  }
}
