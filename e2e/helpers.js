/** Общее для браузерных сценариев: открыть игру с настройками и собрать ошибки страницы. */
import { expect } from '@playwright/test';

export const BASE_SETTINGS = {
  musicVolume: 0, sfxVolume: 0, speed: 'normal', theme: 'neon', camera: 'angled', mode: 'walls',
};

/** Ошибки JavaScript на странице. Сбой загрузки внешнего ресурса (шрифт, CDN) — не ошибка нашего кода. */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Обучение уже пройдено и все подсказки показаны — чтобы они не мешали остальным сценариям. */
const TUTORIAL_DONE = {
  shown: true, done: true, offers: 3, hints: { bad: true, slow: true, ghost: true, stones: true, level: true },
};

/**
 * Настройки — только в чистое хранилище: после перезагрузки остаётся то, что сохранила игра.
 * tutorial: false — как у игрока, который обучение ещё не проходил.
 */
async function seedSettings(page, { tutorial = true, ...settings } = {}) {
  await page.addInitScript(({ s, t }) => {
    if (localStorage.getItem('snake3d.settings.v1')) return;
    localStorage.setItem('snake3d.settings.v1', JSON.stringify(s));
    if (t) localStorage.setItem('snake3d.tutorial.v1', JSON.stringify(t));
  }, { s: { ...BASE_SETTINGS, ...settings }, t: tutorial ? TUTORIAL_DONE : null });
}

/**
 * Игра запустилась: скрипты загружены, кнопки работают. Меню видно раньше — оно есть
 * в самом HTML, а игра стартует после проверки 3D (src/boot.js) и загрузки Three.js.
 */
export async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  await expect(page.locator('#screen-menu')).toBeVisible();
}

/** Открывает игру в тестовом режиме (?e2e) с заданными настройками. */
export async function openGame(page, settings = {}) {
  const errors = collectErrors(page);
  await seedSettings(page, settings);
  await page.goto('/?e2e');
  await waitForGame(page);
  return errors;
}

/** Гость открывает ссылку друга — настройки у него свои, режим задаёт создатель. */
export async function openGameFromLink(page, url, settings = {}) {
  const errors = collectErrors(page);
  await seedSettings(page, settings);
  await page.goto(url);
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  return errors;
}

export const gameState = (page) => page.evaluate(() => globalThis.__snakeE2E.state);

/**
 * Свайп пальцем по полю: события указателя, как от сенсорного экрана.
 * Шаги — чтобы проверить, что поворот срабатывает во время движения, а не при отпускании.
 */
export async function swipe(page, from, steps) {
  await page.evaluate(({ from: start, steps: path }) => {
    const canvas = globalThis.document.querySelector('#scene');
    const fire = (type, x, y) => canvas.dispatchEvent(new globalThis.PointerEvent(type, {
      pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true,
    }));
    fire('pointerdown', start.x, start.y);
    for (const p of path) fire('pointermove', p.x, p.y);
  }, { from, steps });
}

export async function releaseFinger(page) {
  await page.evaluate(() => globalThis.document.querySelector('#scene').dispatchEvent(new globalThis.PointerEvent('pointerup', {
    pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true,
  })));
}
