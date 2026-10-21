/**
 * Обучение: новый игрок проходит его сам, кто пропустил — видит плашку и вопрос перед игрой,
 * пройти заново можно из меню. Подсказки первых партий — по одному разу.
 */
import { expect, test } from '@playwright/test';

import {
  collectErrors, gameState, openGame, releaseFinger, swipe, waitForGame,
} from './helpers.js';

const step = (page) => page.evaluate(() => globalThis.__snakeE2E.tutorialStep);

/** Повернуть змейку «вверх по экрану» тем способом, каким играет это устройство. */
async function turnUp(page, isMobile) {
  if (isMobile) {
    await swipe(page, { x: 200, y: 600 }, [{ x: 201, y: 560 }]);
    await releaseFinger(page);
  } else {
    await page.keyboard.press('ArrowUp');
  }
}

/**
 * Пройти шаг «съешь …»: кладём предмет в клетку, куда змейка шагнёт следующей —
 * с учётом уже заказанного, но ещё не выполненного поворота.
 */
async function eatNext(page, kind) {
  await page.evaluate((k) => {
    const g = globalThis.__snakeE2E.game;
    const { x, y } = g.head;
    const d = g.turnQueue[0] ?? g.direction;
    const { width, height } = g.opts;
    g.items = [{ kind: k, x: (x + d.x + width) % width, y: (y + d.y + height) % height, ttl: null }];
  }, kind);
}

test('новый игрок: сначала меню, потом карточка «Впервые здесь?»; «Пройти обучение» — и оно проходится до конца', async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e'); // чистое хранилище — как у человека, который зашёл впервые
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  // Обучение само не стартует: человек видит, куда попал.
  await expect(page.locator('#screen-menu')).toBeVisible();
  await expect(page.locator('#tutorial-card')).toBeHidden();
  await expect(page.locator('#welcome-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#welcome-title')).toHaveText('Впервые здесь?');
  await expect(page.locator('body')).toHaveClass(/welcome/);
  await expect(page.locator('#tutorial-banner')).toBeHidden(); // то же самое сказано в карточке
  await page.locator('#welcome-card [data-action="tutorial"]').click();
  await expect(page.locator('#welcome-card')).toBeHidden();
  await expect(page.locator('#tutorial-card')).toBeVisible();
  await expect.poll(() => step(page)).toBe(0);
  await expect(page.locator('#tutorial-text')).toHaveText(isMobile
    ? 'Проведите пальцем вверх в любом месте экрана — змейка повернёт.'
    : 'Нажмите ↑ или W.');

  await turnUp(page, isMobile);
  await expect.poll(() => step(page)).toBe(1);
  // Каждый шаг: змейка стоит, пока не нажмут «Понятно».
  for (const [kind, next] of [['apple', 2], ['apple', 3], ['slow', 4]]) {
    await expect(page.locator('#btn-tutorial-next')).toHaveText('Понятно');
    await eatNext(page, kind);
    await page.locator('#btn-tutorial-next').click();
    await expect.poll(() => step(page)).toBe(next);
  }
  await page.locator('#btn-tutorial-next').click();
  await expect(page.locator('#btn-tutorial-next')).toHaveText('Готово');
  await page.locator('#btn-tutorial-next').click();

  await expect(page.locator('#screen-tutorial-done')).toBeVisible();
  await expect(page.locator('.achievement-toast')).toContainText('Первые шаги');
  await page.locator('#screen-tutorial-done [data-action="menu"]').click();
  await expect(page.locator('#tutorial-banner')).toBeHidden();
  // Обучение пройдено — перед игрой больше не спрашиваем.
  await page.locator('#screen-menu [data-action="play"]').click();
  await expect.poll(() => gameState(page)).toBe('playing');
  expect(errors).toEqual([]);
});

test('новый игрок: «Позже» закрывает карточку, плашка остаётся, при повторном заходе карточки нет', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e');
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  await expect(page.locator('#welcome-card')).toBeVisible({ timeout: 15_000 });
  await page.locator('#welcome-card [data-action="welcome-later"]').click();
  await expect(page.locator('#welcome-card')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/welcome/);
  await expect(page.locator('#screen-menu')).toBeVisible();
  await expect(page.locator('#tutorial-banner')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  await page.waitForTimeout(2500); // дольше задержки карточки
  await expect(page.locator('#welcome-card')).toBeHidden();
  await expect(page.locator('#tutorial-banner')).toBeVisible();
  expect(errors).toEqual([]);
});

test('новый игрок: карточка пропадает, если он ушёл с меню (например, открыл рекорды)', async ({ page }) => {
  await page.goto('/?e2e');
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E), null, { timeout: 30_000 });
  await page.locator('#screen-menu [data-action="settings"]').click();
  await page.waitForTimeout(2500);
  await expect(page.locator('#welcome-card')).toBeHidden(); // не всплывает поверх чужого экрана
});

test('пропустил обучение: плашка в меню и вопрос перед игрой — первые три раза', async ({ page }) => {
  const errors = await openGame(page, { tutorial: false });
  await expect(page.locator('#tutorial-banner')).toBeVisible();
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#screen-menu [data-action="play"]').click();
    await expect(page.locator('#screen-tutorial-offer')).toBeVisible();
    await page.locator('[data-action="play-anyway"]').click();
    await expect.poll(() => gameState(page)).toBe('playing');
    await page.locator('#btn-pause').click();
    await page.locator('#screen-pause [data-action="menu"]').click();
  }
  // Больше не навязываем: «Играть» запускает игру сразу, плашка остаётся.
  await page.locator('#screen-menu [data-action="play"]').click();
  await expect.poll(() => gameState(page)).toBe('playing');
  await page.locator('#btn-pause').click();
  await page.locator('#screen-pause [data-action="menu"]').click();
  await expect(page.locator('#tutorial-banner')).toBeVisible();
  expect(errors).toEqual([]);
});

test('пройти обучение можно из меню и пропустить кнопкой', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.locator('#tutorial-banner')).toBeHidden();
  // «Как играть» на компьютере раскрыт, на телефоне свёрнут — раскрываем явно.
  await page.evaluate(() => { globalThis.document.querySelector('.howto').open = true; });
  await page.locator('.howto [data-action="tutorial"]').click();
  await expect(page.locator('#tutorial-card')).toBeVisible();
  await expect.poll(() => step(page)).toBe(0);
  await page.locator('#btn-tutorial-skip').click();
  await expect(page.locator('#screen-menu')).toBeVisible();
  await expect(page.locator('#tutorial-card')).toBeHidden();
  expect(errors).toEqual([]);
});

test('подсказка первых партий: впервые появилась гниль — объяснение один раз', async ({ page }) => {
  const errors = await openGame(page, { tutorial: false, mode: 'classic' });
  // Обучение пропущено, но предлагать его перед игрой уже не нужно.
  await page.evaluate(() => localStorage.setItem('snake3d.tutorial.v1', JSON.stringify({ shown: true, offers: 3, hints: {} })));
  await page.reload();
  await waitForGame(page);
  await page.locator('#screen-menu [data-action="play"]').click();
  await expect.poll(() => gameState(page)).toBe('playing');
  await page.evaluate(() => { globalThis.__snakeE2E.game.items.push({ kind: 'bad', x: 0, y: 0, ttl: null }); });
  await expect(page.locator('#first-hint')).toHaveText(/гниль/);
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('snake3d.tutorial.v1')).hints);
  expect(seen.bad).toBe(true);
  expect(errors).toEqual([]);
});

test('обучение: всегда «Неон» (яблоко красное), карточка и кнопки не закрывают поле', async ({ page, isMobile }) => {
  const errors = await openGame(page, { tutorial: false, theme: 'sunset', controls: 'buttons' });
  await page.evaluate(() => { globalThis.document.querySelector('.howto').open = true; });
  await page.locator('.howto [data-action="tutorial"]').click();
  await expect(page.locator('#tutorial-card')).toBeVisible();
  // В «Закате» яблоко бирюзовое, а текст говорит «красное»: в обучении тема принудительно «Неон».
  expect(await page.evaluate(() => globalThis.__snakeE2E.theme)).toBe('neon');
  expect(await page.evaluate(() => globalThis.__snakeE2E.game.opts)).toMatchObject({ width: 11, height: 11 });

  const gap = await page.evaluate(() => {
    const card = globalThis.document.querySelector('#tutorial-card').getBoundingClientRect();
    const dpad = globalThis.document.querySelector('#dpad');
    const inset = globalThis.__snakeE2E.fieldInsets;
    return {
      cardBottom: card.bottom, top: inset.top, bottom: inset.bottom, height: globalThis.innerHeight,
      dpadTop: dpad.classList.contains('hidden') ? null : dpad.getBoundingClientRect().top,
    };
  });
  expect(gap.top).toBeGreaterThanOrEqual(gap.cardBottom);
  if (isMobile) expect(gap.height - gap.bottom).toBeLessThanOrEqual(gap.dpadTop);
  await page.locator('#btn-tutorial-skip').click();
  expect(await page.evaluate(() => globalThis.__snakeE2E.fieldInsets)).toEqual({ top: 0, bottom: 0 });
  expect(await page.evaluate(() => globalThis.__snakeE2E.theme)).toBe('sunset');
  expect(errors).toEqual([]);
});

test('кнопки на экране — свои иконки, без символов, которые браузер превращает в эмодзи', async ({ page }) => {
  await openGame(page);
  for (const id of ['#btn-pause', '#dpad [data-dir="UP"]', '#dpad [data-dir="LEFT"]', '#dpad [data-dir="RIGHT"]', '#dpad [data-dir="DOWN"]']) {
    const button = page.locator(id);
    await expect(button.locator('svg')).toHaveCount(1);
    expect((await button.textContent()).trim(), id).toBe('');
  }
});
