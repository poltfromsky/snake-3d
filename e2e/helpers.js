/** Общее для браузерных сценариев: открыть игру с настройками и собрать ошибки страницы. */
import { expect } from '@playwright/test';

import { APP_VERSION } from '../src/config.js';

export const BASE_SETTINGS = {
  musicVolume: 0, sfxVolume: 0, speed: 'normal', theme: 'neon', camera: 'angled', mode: 'walls',
};

/**
 * Ошибки JavaScript на странице. Не считаем ошибками нашего кода:
 *   - сбой загрузки внешнего ресурса (шрифт, CDN);
 *   - «Navigated away from page» — Firefox так сообщает об оборванном запросе, когда страницу
 *     перезагружают, пока она ещё что-то грузит. Обычные игроки этого не видят.
 */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const ignored = ['Failed to load resource', 'Navigated away from page'];
    if (m.type() === 'error' && !ignored.some((text) => m.text().includes(text))) errors.push(`console: ${m.text()}`);
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
 * Игрок уже видел «Что нового» текущей версии — окно не мешает остальным сценариям.
 */
async function seedSettings(page, { tutorial = true, ...settings } = {}) {
  await page.addInitScript(({ s, t, v }) => {
    if (localStorage.getItem('snake3d.settings.v1')) return;
    localStorage.setItem('snake3d.settings.v1', JSON.stringify(s));
    localStorage.setItem('snake3d.seen-version.v1', JSON.stringify(v));
    if (t) localStorage.setItem('snake3d.tutorial.v1', JSON.stringify(t));
  }, { s: { ...BASE_SETTINGS, ...settings }, t: tutorial ? TUTORIAL_DONE : null, v: APP_VERSION });
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

/**
 * Журнал клиента для разбора онлайн-сбоев на CI: события WebSocket (без снимков поля),
 * долгие задачи главного потока, паузы между кадрами и состояние игры раз в 2 с.
 * Подключать до открытия страницы; читать — readNetProbe(page).
 */
export async function attachNetProbe(page) {
  await page.addInitScript(() => {
    const t0 = performance.now();
    const log = [];
    const at = () => Math.round(performance.now() - t0);
    const push = (...entry) => { if (log.length < 400) log.push([at(), ...entry]); };
    globalThis.__netProbe = log;
    const Native = globalThis.WebSocket;
    globalThis.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        push('ws-new');
        this.addEventListener('open', () => push('ws-open'));
        this.addEventListener('close', (e) => push('ws-close', e.code));
        this.addEventListener('message', (e) => {
          const text = String(e.data);
          if (!text.startsWith('{"t":"state"')) push('msg', text.slice(0, 32));
        });
      }
    };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.duration > 300) push('long-task', Math.round(e.duration));
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // longtask есть только в Chromium
    }
    let last = performance.now();
    const frame = () => {
      const now = performance.now();
      if (now - last > 1000) push('frame-gap', Math.round(now - last));
      last = now;
      globalThis.requestAnimationFrame(frame);
    };
    globalThis.requestAnimationFrame(frame);
    setInterval(() => push('state', globalThis.__snakeE2E?.state ?? null, globalThis.document.visibilityState), 2000);
  });
}

export const readNetProbe = (page) => page.evaluate(() => globalThis.__netProbe ?? []).catch(() => 'нет данных');
