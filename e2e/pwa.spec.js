/**
 * Игра как приложение (PWA): манифест, иконки, service worker, работа без интернета.
 * Без интернета проверяем в Chromium: только там Playwright умеет отключать сеть
 * для service worker. Манифест и регистрацию — на всех движках.
 */
import { expect, test } from '@playwright/test';

import { openGame } from './helpers.js';

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
  }), { timeout: 20_000 }).toBe('activated');
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.navigator.serviceWorker.controller))).toBe(true);
  expect(errors).toEqual([]);
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
  }), { timeout: 30_000 }).toBe(true);
  await page.reload();
  await expect(page.locator('#screen-menu')).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('#screen-menu')).toBeVisible();
    await page.locator('#screen-menu [data-action="play"]').click();
    await expect(page.locator('#hud')).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.__snakeE2E.state)).toBe('playing');
  } finally {
    await context.setOffline(false);
  }
});
