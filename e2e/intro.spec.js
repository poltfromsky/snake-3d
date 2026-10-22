/**
 * Вступление (src/ui/intro.js). Новый игрок: заставка с руками → обложка → нажатие на змейку →
 * карточка «Обучение — 1 минута»: «Начать обучение» — обучение, «Пропустить» — меню (без карточки
 * «Впервые здесь?», остаётся плашка про обучение). Вернувшийся: сразу обложка, нажатие — меню.
 * Пока музыка выключена (MUSIC = false в intro.js), экрана «Нажми, чтобы начать» нет.
 * В автотестах вступление выключено; ?intro=fast включает короткую версию.
 */
import { expect, test } from '@playwright/test';

import { collectErrors } from './helpers.js';

/** Новый игрок доходит до обложки и нажимает на змейку — появляется карточка выбора. */
async function reachCard(page) {
  await page.goto('/?e2e&intro=fast');
  await expect(page.locator('.splash')).toBeVisible();
  await expect(page.locator('.splash-hand')).toHaveCount(2);
  await expect(page.locator('.intro-cover')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.intro-title')).toContainText('Питона');
  await expect(page.locator('.splash')).toHaveCount(0);
  // Пока идёт вступление, карточка «Впервые здесь?» не вылезает поверх.
  await expect(page.locator('#welcome-card')).toBeHidden();
  // Змейка «дышит» (анимация) — Playwright ждал бы, пока она замрёт; человеку это не мешает.
  await page.locator('.intro-snake').click({ force: true });
  await expect(page.locator('.intro-card')).toBeVisible();
  await expect(page.locator('.intro-card h3')).toHaveText('Обучение — 1 минута');
}

test('вступление: заставка → обложка → змейка → «Начать обучение» открывает обучение', async ({ page }) => {
  const errors = collectErrors(page);
  await reachCard(page);
  await page.locator('.intro-go').click({ force: true });
  await page.waitForFunction(() => globalThis.__snakeE2E?.kind === 'tutorial', null, { timeout: 15_000 });
  await expect(page.locator('.intro')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('вступление: «Пропустить» на карточке — меню без повторной карточки «Впервые здесь?»', async ({ page }) => {
  const errors = collectErrors(page);
  await reachCard(page);
  await page.locator('.intro-later').click({ force: true });
  await expect(page.locator('.intro')).toHaveCount(0);
  await expect(page.locator('#screen-menu')).toBeVisible();
  await expect(page.locator('#tutorial-banner')).toBeVisible();
  await page.waitForTimeout(4_000); // карточка «Впервые здесь?» появлялась бы через пару секунд
  await expect(page.locator('#welcome-card')).toBeHidden();
  expect(await page.evaluate(() => globalThis.__snakeE2E.kind)).not.toBe('tutorial');
  expect(errors).toEqual([]);
});

test('вступление: «Пропустить» вверху во время заставки — сразу меню', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e&intro=fast');
  await expect(page.locator('.splash')).toBeVisible();
  await page.locator('.intro-skip').click();
  await expect(page.locator('.intro')).toHaveCount(0);
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('#screen-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('вернувшийся игрок: сразу обложка, нажатие — в меню; в автотестах без ?intro её нет', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e');
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  await expect(page.locator('.intro')).toHaveCount(0);
  // В хранилище уже есть данные — игрок здесь не впервые. Без ?e2e — как на сайте.
  await page.evaluate(() => localStorage.setItem('snake3d.tutorial.v1', JSON.stringify({ shown: true })));
  await page.goto('/');
  await expect(page.locator('.intro-cover')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.splash')).toHaveCount(0);
  // Вернувшемуся — только название и змейка, без подписей.
  await expect(page.locator('.intro-title')).toBeVisible();
  await expect(page.locator('.intro-hint, .intro-sub')).toHaveCount(0);
  await page.locator('.intro-snake').click({ force: true });
  await expect(page.locator('.intro')).toHaveCount(0);
  await expect(page.locator('.intro-card')).toHaveCount(0);
  await expect(page.locator('#screen-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('вернувшийся игрок: обложка сама уходит в меню, ничего нажимать не нужно', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e');
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem('snake3d.tutorial.v1', JSON.stringify({ shown: true })));
  await page.goto('/');
  await expect(page.locator('.intro-cover')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#screen-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('в настройках заставку можно выключить: ни тёмного экрана, ни обложки', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e');
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem('snake3d.settings.v1', JSON.stringify({ intro: 'off' })));
  await page.goto('/');
  await expect(page.locator('#screen-menu')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.intro')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.document.documentElement.classList.contains('pre-intro'))).toBe(false);
  expect(errors).toEqual([]);
});
