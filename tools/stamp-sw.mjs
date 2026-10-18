/**
 * Готовит sw.js к выкладке: вписывает номер версии и список файлов игры.
 * Запускается в CI перед публикацией сайта (и перед браузерными тестами — чтобы
 * проверялся тот же service worker, что уйдёт на сайт). Локально файл не меняют.
 *
 *   node tools/stamp-sw.mjs <версия>
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import {
  join, relative, resolve, sep,
} from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const version = process.argv[2];
if (!version || !/^[\w.-]{1,64}$/.test(version)) {
  console.error('Укажите версию: node tools/stamp-sw.mjs <версия>');
  process.exit(1);
}

async function files(dir, test) {
  const out = [];
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path, test));
    else if (test(entry.name)) out.push(relative(ROOT, join(ROOT, path)).split(sep).join('/'));
  }
  return out;
}

// Всё, что нужно игре без интернета. Музыка не входит: её Safari грузит кусками, мимо кэша.
const list = [
  'index.html', 'styles.css', 'manifest.webmanifest', 'changelog.json',
  ...await files('src', (name) => name.endsWith('.js')),
  ...await files('assets/icons', (name) => /\.(png|svg)$/.test(name)),
].sort();

const path = join(ROOT, 'sw.js');
const source = await readFile(path, 'utf8');
const stamped = source
  .replace("const VERSION = 'dev';", `const VERSION = ${JSON.stringify(version)};`)
  .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(list, null, 2)};`);
if (stamped === source || !stamped.includes(JSON.stringify(version))) {
  console.error('В sw.js не нашлось мест для подстановки — он уже подготовлен или изменён.');
  process.exit(1);
}
await writeFile(path, stamped);
console.log(`✔ sw.js: версия ${version}, файлов в кэше: ${list.length}`);
