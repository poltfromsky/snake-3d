/**
 * Замер лестницы сложности ботов: серия партий для каждой пары соседних уровней.
 * Запуск: node tools/bot-ladder.mjs [партий=20] [режим=classic]
 */
import { series } from '../tests/bot-arena.js';
import { BOT_ORDER } from '../src/core/bot.js';

const games = Number(process.argv[2] ?? 20);
const mode = process.argv[3] ?? 'classic';
// В замере Claude считает на фиксированную глубину, чтобы результат не зависел от скорости машины.
const strongOptions = { claude: { timeBudgetMs: 0, depth: 3 } };

for (let i = 1; i < BOT_ORDER.length; i += 1) {
  const strong = BOT_ORDER[i];
  const weak = BOT_ORDER[i - 1];
  const started = Date.now();
  const r = series(strong, weak, games, { mode, strongOptions: strongOptions[strong] });
  const rate = ((r.wins / games) * 100).toFixed(0);
  console.log(`${strong.padEnd(7)} vs ${weak.padEnd(7)} | побед ${r.wins}/${games} (${rate}%), поражений ${r.losses}, ничьих ${r.draws} | ${((Date.now() - started) / 1000).toFixed(1)} с`);
}
