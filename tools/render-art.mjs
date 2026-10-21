/**
 * Снимает картинки игры её же 3D-рендером (tools/art/studio.html) — тем же Chromium,
 * что и автотесты, без графических редакторов и нейросетей.
 *
 *   node tools/render-art.mjs [--out папка] [--size 512] [сцена[:файл]…]
 *
 * Без имён — все сцены из tools/art/scenes.js. «сцена:файл» — сохранить под другим именем
 * (например, выбранный вариант медали: beat-easy-2:beat-easy).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  extname, join, normalize, resolve,
} from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGIN = 'http://studio.local';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const out = resolve(option('--out', join(ROOT, 'assets/art')));
const size = Number(option('--size', 512));
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size * 2, height: size * 2 } });
page.on('pageerror', (e) => console.error('страница:', e.message));
// Файлы проекта отдаём прямо с диска; Three.js грузится с того же CDN, что и в игре.
await page.route(`${ORIGIN}/**`, async (route) => {
  const path = normalize(join(ROOT, new URL(route.request().url()).pathname));
  if (!path.startsWith(ROOT)) return route.abort();
  try {
    return route.fulfill({ body: await readFile(path), contentType: TYPES[extname(path)] ?? 'application/octet-stream' });
  } catch {
    return route.fulfill({ status: 404 });
  }
});
await page.goto(`${ORIGIN}/tools/art/studio.html`);
await page.waitForFunction(() => globalThis.studioReady === true, null, { timeout: 30_000 });

const names = args.length ? args : await page.evaluate(() => globalThis.sceneNames);
for (const item of names) {
  const [name, as = name] = item.split(':');
  const url = await page.evaluate(([n, s]) => globalThis.shot(n, s), [name, size]);
  const file = join(out, `${as}.png`);
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`✔ ${name} → ${file}`);
}
await browser.close();
