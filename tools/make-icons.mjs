/**
 * PNG-иконки приложения из assets/icons/icon.svg — тем же Chromium, что и в автотестах,
 * без отдельных графических библиотек. Запуск после правки SVG: `npm run icons`.
 *   icon-192 / icon-512      — обычные (Android, компьютер);
 *   icon-maskable-512        — змейка в безопасной зоне: Android сам обрезает в круг или «капельку»;
 *   apple-touch-icon (180)   — iPhone, без прозрачности (iOS сам скругляет углы).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const DIR = resolve(import.meta.dirname, '../assets/icons');
const svg = await readFile(resolve(DIR, 'icon.svg'), 'utf8');
// Квадратным иконкам — фон без скругления: углы скруглит сама система.
const toDataUrl = (text) => `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`;
const roundUrl = toDataUrl(svg);
const squareUrl = toDataUrl(svg.replace('rx="112"', 'rx="0"'));
// Маскируемая: фон на всю площадь, змейка уменьшена до безопасной зоны (80% в центре).
const maskableUrl = toDataUrl(svg.replace('rx="112"', 'rx="0"')
  .replace('<g id="fg">', '<g id="fg" transform="translate(51.2 51.2) scale(0.8)">'));

const ICONS = [
  { file: 'icon-192.png', size: 192, url: roundUrl, round: true },
  { file: 'icon-512.png', size: 512, url: roundUrl, round: true },
  { file: 'icon-maskable-512.png', size: 512, url: maskableUrl, round: false },
  { file: 'apple-touch-icon.png', size: 180, url: squareUrl, round: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, url, round } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <img src="${url}" style="display:block;width:${size}px;height:${size}px"></body></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.screenshot({ path: resolve(DIR, file), omitBackground: round });
  console.log(`✔ ${file}`);
}
await browser.close();
