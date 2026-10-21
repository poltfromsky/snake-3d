/**
 * Собирает src/ui/icons.js из набора Phosphor Icons (MIT, пакет @phosphor-icons/core — только для сборки).
 * Иконки встраиваются в код: игра не загружает их из сети и не зависит от пакета.
 *
 *   node tools/build-icons.mjs
 *
 * Чтобы добавить иконку: допишите её в ICONS ниже и запустите скрипт.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'node_modules/@phosphor-icons/core/assets');
const PACKAGE = JSON.parse(await readFile(join(ROOT, 'node_modules/@phosphor-icons/core/package.json'), 'utf8'));
/** Толщина линий для иконок интерфейса: «bold» хорошо читается в мелком размере рядом с жирным шрифтом. */
const WEIGHT = 'bold';

/** Имя в игре → иконка Phosphor (и толщина, если не основная). */
const ICONS = {
  cap: ['graduation-cap'], // обучение
  chat: ['chat-text'], // отзыв, комментарий
  globe: ['globe'], // общая таблица
  install: ['download-simple'], // установить как приложение
  share: ['export'], // «Поделиться» в Safari
  slow: ['hourglass-medium'], // замедление
  ghost: ['ghost'], // призрак
  lock: ['lock-simple'], // достижение ещё не открыто
  trophy: ['trophy'], // бот побеждён
  star: ['star', 'fill'], // лучший результат
  user: ['user'], // профиль
  eye: ['eye'], // показать пароль
  eyeOff: ['eye-slash'], // скрыть пароль
  pause: ['pause', 'fill'], // пауза
  triangle: ['triangle', 'fill'], // кнопки-стрелки на экране
  monitor: ['desktop'], // рекорд поставлен на компьютере
};

/**
 * Значки «телефон»: корпус device-mobile из Phosphor и знак внутри экрана (экран — квадрат 76…180),
 * чтобы оба читались как телефон, но различались способом управления.
 */
const PHONE_GLYPHS = {
  phoneSwipe: 'M96,120h40v-16l28,24-28,24v-16h-40Z', // стрелка — свайпы
  phoneButtons: 'M118,92h20v26h26v20h-26v26h-20v-26h-26v-20h26Z', // крестик — кнопки на экране
};

async function inner(name, weight = WEIGHT) {
  const file = weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`;
  const svg = await readFile(join(ASSETS, weight, file), 'utf8');
  const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  if (!body || body === svg) throw new Error(`не разобрать ${file}`);
  return body;
}

const entries = [];
for (const [key, [name, weight]] of Object.entries(ICONS)) {
  entries.push([key, await inner(name, weight)]);
}
const phone = await inner('device-mobile');
for (const [key, glyph] of Object.entries(PHONE_GLYPHS)) entries.push([key, `${phone}<path d="${glyph}"/>`]);

const source = `/**
 * Иконки интерфейса — набор Phosphor Icons ${PACKAGE.version} (толщина «${WEIGHT}»), встроенные в код.
 * Файл собирается скриптом tools/build-icons.mjs — правьте список там, а не здесь.
 *
 * Phosphor Icons — https://phosphoricons.com, лицензия MIT:
 * Copyright (c) 2023 Phosphor Icons
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions: The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
 * KIND, EXPRESS OR IMPLIED. (Полный текст — в CREDITS.md.)
 *
 * Почему не эмодзи: каждый телефон рисует их по-своему, а ◀ ▶ некоторые браузеры превращают в цветные
 * кнопки. Иконки берут цвет у текста (currentColor).
 *
 * В разметке: <span data-icon="cap"></span> — иконку подставит renderIcons(). В коде: iconSvg('lock').
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Содержимое иконок (внутренности <svg viewBox="0 0 256 256">). */
export const ICONS = Object.freeze({
${entries.map(([key, body]) => `  ${key}: '${body.replace(/'/g, "\\'")}',`).join('\n')}
});

/** Иконка как элемент <svg>. */
export function iconSvg(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  // Разметка иконок — своя, из этого файла: чужой текст сюда не попадает.
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

/** Иконка как строка разметки — для мест, которые собираются строкой (HUD). Только свои иконки. */
export function iconHtml(name, className = 'icon') {
  return \`<svg viewBox="0 0 256 256" class="\${className}" aria-hidden="true" fill="currentColor">\${ICONS[name] ?? ''}</svg>\`;
}

/** Подставить иконки во все <… data-icon="имя"> внутри root. */
export function renderIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.firstElementChild?.tagName === 'svg') continue;
    el.prepend(iconSvg(el.dataset.icon));
  }
}
`;

await writeFile(join(ROOT, 'src/ui/icons.js'), source);
console.log(`✔ src/ui/icons.js: ${entries.length} иконок, Phosphor ${PACKAGE.version} (${WEIGHT})`);
