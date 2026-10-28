/**
 * Игра как приложение (PWA): манифест, иконки, service worker, работа без интернета.
 * Без интернета проверяем в Chromium: только там Playwright умеет отключать сеть
 * для service worker. Манифест и регистрацию — на всех движках.
 */
import { expect, test } from '@playwright/test';

import { openGame, waitForGame } from './helpers.js';

test('манифест приложения и все иконки на месте', async ({ page, request }) => {
  await openGame(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href)).json();
  expect(manifest).toMatchObject({ name: 'Изгиб Питона 3D', display: 'standalone', start_url: './' });
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  expect((await request.get(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'))).status()).toBe(200);
});

test('service worker включается и управляет страницей', async ({ page }) => {
  const errors = await openGame(page);
  await expect.poll(() => page.evaluate(async () => {
    const reg = await globalThis.navigator.serviceWorker.getRegistration();
    return reg?.active?.state ?? null;
  }), { timeout: 45_000 }).toBe('activated');
  await page.reload();
  await waitForGame(page);
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.navigator.serviceWorker.controller))).toBe(true);
  expect(errors).toEqual([]);
});

test('под service worker ссылка на политику открывает политику, а не игру', async ({ page }) => {
  await openGame(page);
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.navigator.serviceWorker.controller)), { timeout: 45_000 })
    .toBe(true);
  await page.goto('/privacy.html');
  await expect(page.locator('h1')).toHaveText(/Политика конфиденциальности/);
  await page.goto('/privacy.html?from=app');
  await expect(page.locator('h1')).toHaveText(/Политика конфиденциальности/);
  // Сама игра по-прежнему открывается и с параметрами.
  await page.goto('/?e2e');
  await waitForGame(page);
});

test('без интернета игра открывается и в неё можно играть', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'отключение сети для service worker — только в Chromium');
  await openGame(page, { mode: 'classic' });
  // Ждём, пока service worker сохранит и свои файлы, и Three.js со шрифтами.
  await expect.poll(() => page.evaluate(async () => {
    if (!globalThis.navigator.serviceWorker.controller) return false;
    const vendor = await globalThis.caches.open('snake3d-vendor');
    const keys = await vendor.keys();
    return keys.some((r) => r.url.includes('three.module.js')) && keys.some((r) => r.url.includes('UnrealBloomPass'));
  }), { timeout: 45_000 }).toBe(true);
  await page.reload();
  await waitForGame(page);

  await context.setOffline(true);
  try {
    await page.reload();
    await waitForGame(page);
    await page.locator('#screen-menu [data-action="play"]').click();
    await expect(page.locator('#hud')).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.__snakeE2E.state)).toBe('playing');
  } finally {
    await context.setOffline(false);
  }
});

test('браузер предложил установку, пока игра ещё грузилась: кнопка открывает его окно, а не инструкцию', async ({ page }) => {
  await page.addInitScript(() => {
    // Как Chrome и Edge: событие приходит рано, до загрузки игры. prompt() запоминаем.
    globalThis.__promptCalls = 0;
    // boot.js (модуль) уже выполнен, а игра ещё грузится — тут событие и приходит.
    globalThis.document.addEventListener('DOMContentLoaded', () => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = async () => { globalThis.__promptCalls += 1; };
      e.userChoice = Promise.resolve({ outcome: 'dismissed' });
      globalThis.dispatchEvent(e);
    });
  });
  const errors = await openGame(page);
  await page.locator('#screen-menu [data-action="install"]').click();
  await expect.poll(() => page.evaluate(() => globalThis.__promptCalls)).toBe(1);
  await expect(page.locator('#screen-install')).toBeHidden();
  expect(errors).toEqual([]);
});

test('игра уже установлена: вместо общей инструкции — подсказка про «Открыть в приложении» и ярлык', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation(), { capture: true });
    globalThis.navigator.getInstalledRelatedApps = async () => [{ platform: 'webapp' }];
  });
  const errors = await openGame(page);
  await page.locator('#screen-menu [data-action="install"]').click();
  const steps = page.locator('#screen-install ol.install-steps:visible');
  await expect(steps).toHaveCount(1);
  await expect(steps).toContainText('Игра уже установлена');
  await expect(steps).toContainText('Открыть в приложении');
  expect(errors).toEqual([]);
});

test('кнопка установки видна всегда: в меню и в настройках, а без окна браузера — инструкция под него', async ({ page }) => {
  // Своё окно установки браузер может и не дать (Chrome после удаления приложения, Safari, Firefox) —
  // как будто его нет: игра должна показать инструкцию.
  await page.addInitScript(() => {
    globalThis.addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation(), { capture: true });
  });
  const errors = await openGame(page);
  const menuButton = page.locator('#screen-menu [data-action="install"]');
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  await expect(page.locator('#screen-install')).toBeVisible();
  await expect(page.locator('#screen-install ol.install-steps:visible')).toHaveCount(1);
  await page.locator('[data-action="install-back"]').click();
  await expect(page.locator('#screen-menu')).toBeVisible();

  await page.locator('#screen-menu [data-action="settings"]').click();
  await page.locator('#screen-settings [data-action="install"]').click();
  await expect(page.locator('#screen-install')).toBeVisible();
  await page.locator('[data-action="install-back"]').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
  expect(errors).toEqual([]);
});
