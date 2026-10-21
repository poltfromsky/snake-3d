/**
 * Значки приложения и медали достижений — 3D-рендером самой игры (tools/render-art.mjs, сцены
 * в tools/art/scenes.js). Запуск после правки сцен: `npm run icons`.
 *
 *   assets/icons/icon-512, icon-192 — обычные (Android, компьютер, значок вкладки);
 *   assets/icons/icon-maskable-512  — для Android: система сама обрезает в круг или «капельку»,
 *                                     поэтому голова змейки меньше и целиком в безопасной зоне;
 *   assets/icons/apple-touch-icon   — iPhone (180×180, углы скругляет сама система);
 *   assets/medals/<id>.png          — медали достижений (192×192 — чётко на экранах с высокой плотностью).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const render = (out, size, ...scenes) => execFileSync(
  process.execPath,
  [resolve(ROOT, 'tools/render-art.mjs'), '--out', resolve(ROOT, out), '--size', String(size), ...scenes],
  { stdio: 'inherit' },
);

render('assets/icons', 512, 'app-icon:icon-512', 'app-icon-maskable:icon-maskable-512');
render('assets/icons', 192, 'app-icon:icon-192');
render('assets/icons', 180, 'app-icon:apple-touch-icon');
render('assets/medals', 192,
  'first-steps', 'beat-claude', 'ouroboros', 'hall-of-fame',
  // Ужик, Гадюка и Анаконда — выбранные варианты из нескольких (сцены beat-easy-N, beat-medium-N, beat-hard-N).
  'beat-easy-2:beat-easy', 'beat-medium-5:beat-medium', 'beat-hard-3:beat-hard');
