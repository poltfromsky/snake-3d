import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { existsSync } from 'node:fs';

import { ACHIEVEMENTS, medalUrl } from '../src/achievements.js';

const ROOT = join(import.meta.dirname, '..');

/**
 * Эмодзи и символы, которые браузеры могут нарисовать как эмодзи (◀ ▶ ★ ⬆ и т. п.).
 * В интерфейсе вместо них — свои иконки (src/ui/icons.js): одинаковые на любом телефоне.
 */
// Из блоков стрелок и фигур — только те, у которых по стандарту Юникода есть эмодзи-вид
// (▶ ◀ ▪ ⬆ ⏸ …); ● и ▸ к ним не относятся.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2194}-\u{2199}\u{21A9}\u{21AA}\u{231A}\u{231B}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2B05}-\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}\u{2934}\u{2935}\u{3030}\u{303D}]|\u{FE0F}/u;
// Обычные стрелки ← ↑ → ↓ — это текст (подсказки «нажмите ↑»), их браузеры эмодзи не делают.
const ALLOWED = new Set(['←', '↑', '→', '↓']);

function files(dir, ext) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path, ext);
    return ext.some((x) => e.name.endsWith(x)) ? [path] : [];
  });
}

/** Комментарии не показываются игроку (в них, например, схема экранов со стрелками). */
const withoutComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('в интерфейсе нет эмодзи — только свои иконки', () => {
  const found = [];
  for (const file of ['index.html', 'styles.css', ...files('src', ['.js'])]) {
    const lines = withoutComments(readFileSync(join(ROOT, file), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const ch of line) {
        if (EMOJI.test(ch) && !ALLOWED.has(ch)) found.push(`${relative(ROOT, join(ROOT, file))}:${i + 1} «${ch}»`);
      }
    });
  }
  assert.deepEqual(found, []);
});

test('у каждого достижения своя медаль-картинка', () => {
  for (const a of ACHIEVEMENTS) assert.ok(existsSync(join(ROOT, medalUrl(a.id))), `${a.id}: нет файла медали`);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => medalUrl(a.id))).size, ACHIEVEMENTS.length, 'медали не повторяются');
});
