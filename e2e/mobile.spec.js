/**
 * Телефон: вёрстка, свайпы, вертикальная дуэль, кнопки-стрелки, поворот экрана.
 * Идут на телефонных проектах (android-chrome, iphone-safari), на компьютерных пропускаются.
 */
import { expect, test } from '@playwright/test';

import {
  gameState, openGame, releaseFinger, swipe,
} from './helpers.js';

test('на компьютере подсказки для пальцев и кнопки-стрелки спрятаны', async ({ page, isMobile }) => {
  test.skip(isMobile, 'сценарий для компьютера');
  await openGame(page);
  await expect(page.locator('[data-action="local"]')).toBeVisible();
  for (const el of await page.locator('.touch-only').all()) await expect(el).toBeHidden();
  await expect(page.locator('.howto li.keyboard-only').first()).toBeVisible();
});

test.describe('телефон', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, 'сценарии для телефона');
  });

  const lastTurn = (page, i = 0) => page.evaluate((idx) => {
    const g = globalThis.__snakeE2E.game;
    const p = g.players ? g.players[idx] : g;
    return p.turnQueue.at(-1) ?? null;
  }, i);

  test('ни один экран не вылезает за края телефона', async ({ page }) => {
    const errors = await openGame(page);
    const screens = ['menu', 'pause', 'over', 'records', 'settings', 'online', 'duel', 'feedback', 'achievements', 'install', 'no3d'];
    const overflow = await page.evaluate((ids) => {
      const { innerWidth } = globalThis;
      const out = {};
      for (const id of ids) {
        const el = globalThis.document.querySelector(`#screen-${id}`);
        const hidden = el.classList.contains('hidden');
        el.classList.remove('hidden');
        out[id] = [...el.querySelectorAll('*')]
          .filter((e) => e.offsetParent && (e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1))
          .map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}.${e.className}`);
        if (hidden) el.classList.add('hidden');
      }
      return out;
    }, screens);
    for (const id of screens) expect(overflow[id], `экран ${id}`).toEqual([]);
    // И страница целиком не листается вбок.
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    expect(errors).toEqual([]);
  });

  test('на телефоне спрятано клавиатурное и видны подсказки для пальцев', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('[data-action="local"]')).toBeHidden();
    await page.locator('.howto summary').click();
    await expect(page.locator('.howto li.touch-only').first()).toBeVisible();
    await expect(page.locator('.howto li.keyboard-only').first()).toBeHidden();
    await page.locator('#screen-menu [data-action="settings"]').click();
    await expect(page.locator('#set-controls')).toBeVisible();
  });

  test('свайп поворачивает змейку сразу, не дожидаясь, пока палец отпустят', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic' });
    await page.locator('#screen-menu [data-action="play"]').click();
    // Змейка в одиночной игре едет вправо; палец ведём вверх.
    await swipe(page, { x: 200, y: 500 }, [{ x: 200, y: 492 }]);
    expect(await lastTurn(page), 'короткое движение — ещё не свайп').toBeNull();
    await swipe(page, { x: 200, y: 500 }, [{ x: 201, y: 470 }]);
    expect(await lastTurn(page)).toEqual({ x: 0, y: -1 });
    // Тем же пальцем дальше влево — второй поворот одним движением.
    await page.evaluate(() => globalThis.document.querySelector('#scene').dispatchEvent(new globalThis.PointerEvent('pointermove', {
      pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: 170, clientY: 468, bubbles: true,
    })));
    expect(await lastTurn(page)).toEqual({ x: -1, y: 0 });
    await releaseFinger(page);
    expect(await gameState(page)).toBe('playing');
    expect(errors).toEqual([]);
  });

  test('дуэль на вертикальном экране повёрнута: своя змейка внизу, свайп вверх — к сопернику', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic' });
    await page.locator('[data-action="bot"][data-level="easy"]').click();
    await expect(page.locator('#hud-duel')).toContainText('Ужик');
    expect(await page.evaluate(() => globalThis.__snakeE2E.turn)).toBe(1);
    // Своя змейка стартует слева и едет вправо по полю — на повёрнутом экране это «вверх».
    await swipe(page, { x: 200, y: 600 }, [{ x: 230, y: 600 }]);
    expect(await lastTurn(page), 'вправо по экрану = вниз по полю').toEqual({ x: 0, y: 1 });
    await releaseFinger(page);
    expect(errors).toEqual([]);
  });

  test('кнопки-стрелки вместо свайпов: включаются в настройках и ведут змейку', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic' });
    await page.locator('#screen-menu [data-action="settings"]').click();
    await page.locator('#set-controls [data-value="buttons"]').click();
    await page.locator('#screen-settings [data-action="back"]').click();
    await page.locator('#screen-menu [data-action="play"]').click();
    await expect(page.locator('#dpad')).toBeVisible();
    await page.locator('#dpad [data-dir="UP"]').dispatchEvent('pointerdown');
    expect(await lastTurn(page)).toEqual({ x: 0, y: -1 });
    // На паузе кнопок нет — не мешают меню.
    await page.locator('#btn-pause').click();
    await expect(page.locator('#dpad')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('повернули телефон в меню — поле разворачивается вместе с экраном', async ({ page }) => {
    const errors = await openGame(page);
    const field = () => page.evaluate(() => globalThis.__snakeE2E.game.opts).then((o) => [o.width, o.height]);
    const [w, h] = await field();
    expect(h).toBeGreaterThan(w);
    const { width, height } = page.viewportSize();
    await page.setViewportSize({ width: height, height: width });
    await expect.poll(async () => { const [a, b] = await field(); return a > b; }).toBe(true);
    expect(errors).toEqual([]);
  });
});
