/**
 * Сценарии игры в настоящем браузере. Главное, что они ловят, — ошибки интерфейса,
 * которые не видят юнит-тесты логики: не показался экран, упал скрипт, не выдалось
 * достижение. Каждый тест падает и при любой ошибке JavaScript на странице.
 */
import { expect, test } from '@playwright/test';

import {
  gameState, openGame, openGameFromLink,
} from './helpers.js';

test('одиночная игра: удар о стену → экран «Игра окончена»', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#screen-menu [data-action="play"]').click();
  await expect(page.locator('#hud')).toBeVisible();
  // Без поворотов змейка доезжает до стены (режим «Стены»).
  await expect(page.locator('#screen-over')).toBeVisible();
  await expect(page.locator('#over-reason')).toHaveText('Врезались в стену');
  expect(errors).toEqual([]);
});

test('одна клавиатура: WASD у первого игрока, стрелки у второго, итог и реванш', async ({ page, isMobile }) => {
  test.skip(isMobile, 'на телефоне клавиатуры нет — режим спрятан');
  const errors = await openGame(page);
  await page.locator('[data-action="local"]').click();
  await page.keyboard.press('KeyW');
  await page.keyboard.press('ArrowDown');
  const queued = await page.evaluate(() => globalThis.__snakeE2E.game.players.map((p) => p.turnQueue.at(-1) ?? p.direction));
  expect(queued).toEqual([{ x: 0, y: -1 }, { x: 0, y: 1 }]);

  // Ставим обеих змеек лоб в лоб — проверяем экран итогов дуэли.
  await page.evaluate(() => {
    const g = globalThis.__snakeE2E.game;
    g.players[0].body = [{ x: 10, y: 8 }]; g.players[0].direction = { x: 1, y: 0 }; g.players[0].turnQueue = [];
    g.players[1].body = [{ x: 12, y: 8 }]; g.players[1].direction = { x: -1, y: 0 }; g.players[1].turnQueue = [];
    g.players.forEach((p) => { p.prevBody = p.body.map((c) => ({ ...c })); });
  });
  await expect(page.locator('#screen-duel')).toBeVisible();
  await expect(page.locator('#duel-title')).toHaveText('Ничья');
  await expect(page.locator('#duel-reason')).toHaveText('Столкновение лоб в лоб');

  await page.locator('#screen-duel [data-action="rematch"]').click();
  await expect(page.locator('#screen-duel')).toBeHidden();
  expect(await gameState(page)).toBe('playing');
  expect(errors).toEqual([]);
});

test('против бота: победа над Ужиком даёт достижение и кубок', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => localStorage.removeItem('snake3d.achievements.v1'));
  await page.locator('[data-action="bot"][data-level="easy"]').click();
  await expect(page.locator('#hud-duel')).toContainText('Ужик');

  // Загоняем бота в угол, где любой ход смертелен: остальное — настоящая логика игры.
  await page.evaluate(() => {
    const g = globalThis.__snakeE2E.game;
    const b = g.players[1];
    b.body = [{ x: 25, y: 0 }, { x: 24, y: 0 }, { x: 23, y: 0 }];
    b.prevBody = b.body.map((c) => ({ ...c }));
    b.direction = { x: 1, y: 0 };
    b.turnQueue = [];
    g.obstacles.push({ x: 25, y: 1 });
  });
  await expect(page.locator('#screen-duel')).toBeVisible();
  await expect(page.locator('#duel-title')).toHaveText('Победа!');

  const toast = page.locator('.achievement-toast');
  await expect(toast).toContainText('Достижение получено');
  await expect(toast).toContainText('Ужик, прости');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('snake3d.achievements.v1')));
  expect(Object.keys(stored)).toEqual(['beat-easy']);

  await page.locator('#screen-duel [data-action="leave"]').click();
  await expect(page.locator('.bot-btn[data-level="easy"]')).toHaveClass(/beaten/);
  await expect(page.locator('.bot-btn[data-level="claude"]')).not.toHaveClass(/beaten/);
  await page.locator('[data-action="achievements"]').click();
  await expect(page.locator('#achievements-progress')).toHaveText('Открыто 1 из 5');
  expect(errors).toEqual([]);
});

test('онлайн: комната по ссылке, оба видят итог, реванш', async ({ browser }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const a = await host.newPage();
  const b = await guest.newPage();
  const errorsA = await openGame(a, { playerName: 'Питон' });
  await a.locator('[data-action="online"]').click();
  await expect(a.locator('#online-name')).toHaveValue('Питон');
  await a.locator('[data-action="create-room"]').click();
  await expect(a.locator('#online-status')).toHaveText(/Ждём друга/);
  const link = await a.locator('#room-link').inputValue();
  expect(link).toMatch(/\?room=[A-Z0-9]{5}$/);

  const errorsB = await openGameFromLink(b, `${link}&e2e`, { playerName: 'Удав' });
  // Режим «Стены», без поворотов: змейки одновременно врезаются в противоположные стены.
  for (const page of [a, b]) {
    await expect(page.locator('#screen-duel')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#duel-title')).toHaveText('Ничья');
  }
  // Каждый видит себя как «Вы», соперника — по нику (счёт зависит от съеденных яблок).
  await expect(a.locator('#duel-s0')).toHaveText(/^Вы \d+$/);
  await expect(a.locator('#duel-s1')).toHaveText(/^\d+ Удав$/);
  await expect(b.locator('#duel-s0')).toHaveText(/^Питон \d+$/);
  await expect(b.locator('#duel-s1')).toHaveText(/^\d+ Вы$/);

  await a.locator('#screen-duel [data-action="rematch"]').click();
  await expect(b.locator('#duel-status')).toHaveText('Питон хочет реванш!');
  await b.locator('#screen-duel [data-action="rematch"]').click();
  for (const page of [a, b]) await expect(page.locator('#screen-duel')).toBeHidden();
  expect([...errorsA, ...errorsB]).toEqual([]);
  await host.close();
  await guest.close();
});

test('отзыв уходит на сервер и игрок видит ответ', async ({ page }) => {
  const errors = await openGame(page);
  // Свой «адрес» на каждый прогон, чтобы не упереться в ограничение «отзыв раз в минуту».
  // В бою Cloudflare сам выставляет этот заголовок, подделать его из браузера нельзя.
  const fakeIp = `10.${Date.now() % 250}.${Math.floor(Math.random() * 250)}.1`;
  await page.route('**/api/feedback', (route) => route.continue({
    headers: { ...route.request().headers(), 'cf-connecting-ip': fakeIp },
  }));
  await page.locator('[data-action="feedback"]').click();
  await page.locator('#feedback-rating [data-value="5"]').click();
  // Печатаем с клавиатуры, а не fill(): пробел в тексте не должен запускать игру.
  await page.locator('#feedback-message').pressSequentially('Автотест: отзыв доходит до сервера');
  await expect(page.locator('#feedback-message')).toHaveValue('Автотест: отзыв доходит до сервера');
  expect(await gameState(page)).toBe('menu');
  await page.locator('#feedback-form button[type="submit"]').click();
  await expect(page.locator('#feedback-status')).toHaveText('Спасибо! Отзыв отправлен.');
  expect(errors).toEqual([]);
});

test('ник вводится один раз: из настроек он попадает в рекорд и отзыв и переживает перезагрузку', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#screen-menu [data-action="settings"]').click();
  await page.locator('#set-name').pressSequentially('Питон');
  await page.locator('#screen-settings [data-action="back"]').click();
  await page.reload();
  await expect(page.locator('#screen-menu')).toBeVisible();

  await page.locator('#screen-menu [data-action="play"]').click();
  // Очки, чтобы результат можно было сохранить; дальше змейка сама врежется в стену.
  await page.evaluate(() => { globalThis.__snakeE2E.game.score = 5; });
  await expect(page.locator('#screen-over')).toBeVisible();
  await expect(page.locator('#record-name')).toHaveValue('Питон');

  await page.locator('#screen-over [data-action="menu"]').click();
  await page.locator('[data-action="feedback"]').click();
  await expect(page.locator('#feedback-name')).toHaveValue('Питон');
  expect(errors).toEqual([]);
});
