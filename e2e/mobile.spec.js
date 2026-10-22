/**
 * Телефон: вёрстка, свайпы, вертикальная дуэль, кнопки-стрелки, поворот экрана.
 * Идут на телефонных проектах (android-chrome, iphone-safari), на компьютерных пропускаются.
 */
import { expect, test } from '@playwright/test';

import {
  gameState, openGame, releaseFinger, swipe, waitForGame,
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

  // Последний заказанный поворот, а если очередь уже пуста — текущее направление:
  // на медленной машине змейка успевает сделать шаг между свайпом и проверкой.
  const lastTurn = (page, i = 0) => page.evaluate((idx) => {
    const g = globalThis.__snakeE2E.game;
    const p = g.players ? g.players[idx] : g;
    return p.turnQueue.at(-1) ?? p.direction;
  }, i);

  test('ни один экран не вылезает за края телефона', async ({ page }) => {
    const errors = await openGame(page);
    const screens = ['menu', 'pause', 'over', 'records', 'settings', 'online', 'duel', 'feedback', 'achievements', 'install', 'no3d', 'dpad-layout'];
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
    expect(await lastTurn(page), 'короткое движение — ещё не свайп').toEqual({ x: 1, y: 0 });
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

  // Змейка почти стоит: между событиями пальца она не успевает сделать шаг и очередь поворотов не пустеет.
  const freeze = (page) => page.evaluate(() => { globalThis.__snakeE2E.game.opts.speedFactor = 0.02; });
  const queue = (page) => page.evaluate(() => globalThis.__snakeE2E.game.turnQueue.map((d) => `${d.x},${d.y}`));

  test('свайп с лёгким уводом в сторону — один поворот, а не «вверх и ещё вправо»', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic' });
    await page.locator('#screen-menu [data-action="play"]').click();
    await freeze(page);
    // Палец ведёт вверх на 140 px, но уходит вправо на ~20°: раньше это давало «вверх, вправо».
    const path = Array.from({ length: 14 }, (_, i) => ({ x: 200 + (i + 1) * 3.6, y: 500 - (i + 1) * 10 }));
    await swipe(page, { x: 200, y: 500 }, path);
    expect(await queue(page)).toEqual(['0,-1']);
    await releaseFinger(page);
    expect(errors).toEqual([]);
  });

  test('три быстрых свайпа подряд не теряются: очередь поворотов вмещает три', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic' });
    await page.locator('#screen-menu [data-action="play"]').click();
    await freeze(page);
    // Змейка едет вправо: вверх, влево, вниз — три допустимых поворота подряд.
    await swipe(page, { x: 200, y: 500 }, [{ x: 200, y: 470 }]);
    await swipe(page, { x: 200, y: 500 }, [{ x: 170, y: 500 }]);
    await swipe(page, { x: 200, y: 500 }, [{ x: 200, y: 530 }]);
    expect(await queue(page)).toEqual(['0,-1', '-1,0', '0,1']);
    await releaseFinger(page);
    expect(errors).toEqual([]);
  });

  test('кнопки-стрелки: нажатие рядом с кнопкой работает, подсветка снимается при отпускании', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic', controls: 'buttons' });
    await page.locator('#screen-menu [data-action="play"]').click();
    await freeze(page);
    await expect(page.locator('#dpad')).toBeVisible();
    // Нажимаем над верхней кнопкой, на поле вокруг креста: сами кнопки там не лежат.
    const pressed = await page.evaluate(() => {
      const dpad = globalThis.document.querySelector('#dpad');
      const r = dpad.getBoundingClientRect();
      const fire = (type) => dpad.dispatchEvent(new globalThis.PointerEvent(type, {
        pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true,
        clientX: r.left + r.width / 2, clientY: r.top - 14,
      }));
      fire('pointerdown');
      const during = [...dpad.querySelectorAll('.pressed')].map((b) => b.dataset.dir);
      fire('pointerup');
      return { during, after: dpad.querySelectorAll('.pressed').length };
    });
    expect(pressed.during).toEqual(['UP']);
    expect(pressed.after, 'подсветка снята сразу после отпускания').toBe(0);
    expect(await queue(page)).toEqual(['0,-1']);
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

  test('своё расположение кнопок: перетащить, «Справа», размер — запоминается и работает в игре', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic', controls: 'buttons' });
    const center = () => page.locator('#dpad').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    });
    await page.locator('#screen-menu [data-action="settings"]').click();
    await page.locator('#btn-dpad-layout').click();
    await expect(page.locator('#screen-dpad-layout')).toBeVisible();
    await expect(page.locator('#dpad')).toBeVisible();
    await expect(page.locator('#dpad')).toHaveClass(/editing/);

    // Тащим крест пальцем вверх и влево.
    const start = await center();
    await page.evaluate(({ x, y }) => {
      const dpad = globalThis.document.querySelector('#dpad');
      const fire = (type, cx, cy) => dpad.dispatchEvent(new globalThis.PointerEvent(type, {
        pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: cx, clientY: cy,
      }));
      fire('pointerdown', x, y);
      fire('pointermove', x - 60, y - 120);
      fire('pointermove', x - 80, y - 200);
      fire('pointerup', x - 80, y - 200);
    }, start);
    const moved = await center();
    expect(start.y - moved.y).toBeGreaterThan(100); // на низком экране упирается в панель редактора — так и надо
    expect(await gameState(page)).not.toBe('playing'); // перетаскивание — не поворот и не игра

    // Быстрое место «Справа» и крупнее.
    await page.locator('#dpad-preset [data-value="right"]').click();
    await page.locator('#dpad-scale').evaluate((el) => {
      el.value = '1.3';
      el.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    });
    const right = await center();
    const viewport = page.viewportSize();
    expect(right.x).toBeGreaterThan(viewport.width / 2);
    expect(right.w).toBeGreaterThan(start.w * 1.2);
    await page.locator('[data-action="dpad-done"]').click();
    await expect(page.locator('#screen-settings')).toBeVisible();
    await expect(page.locator('#dpad')).toBeHidden();

    // В игре крест там же и по-прежнему поворачивает змейку.
    await page.locator('#screen-settings [data-action="back"]').click();
    await page.locator('#screen-menu [data-action="play"]').click();
    await expect(page.locator('#dpad')).toBeVisible();
    await expect(page.locator('#dpad')).not.toHaveClass(/editing/);
    const inGame = await center();
    expect(Math.abs(inGame.x - right.x)).toBeLessThan(2);
    await page.locator('#dpad [data-dir="UP"]').dispatchEvent('pointerdown');
    expect(await lastTurn(page)).toEqual({ x: 0, y: -1 });
    const saved = await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('snake3d.settings.v1')).dpad);
    expect(saved.scale).toBeCloseTo(1.3);
    expect(saved.x).toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
  });

  test('«Сбросить» возвращает кнопки вниз по центру', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic', controls: 'buttons', dpad: { x: 0.8, y: 0.4, scale: 1.2 } });
    await page.locator('#screen-menu [data-action="settings"]').click();
    await page.locator('#btn-dpad-layout').click();
    await expect.poll(() => page.locator('#dpad').evaluate((el) => el.style.top)).not.toBe('');
    await page.locator('[data-action="dpad-reset"]').click();
    expect(await page.locator('#dpad').evaluate((el) => el.style.top)).toBe('');
    const box = await page.locator('#dpad').boundingBox();
    const viewport = page.viewportSize();
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    await page.locator('[data-action="dpad-done"]').click();
    const saved = await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('snake3d.settings.v1')).dpad);
    expect(saved).toBeNull();
    expect(errors).toEqual([]);
  });

  test('«Кнопки на экране»: поле сдвигается вверх над крестом и не прячется под пальцами; свой крест сбоку — не сдвигает', async ({ page }) => {
    const errors = await openGame(page, { mode: 'classic', controls: 'buttons' });
    const insets = () => page.evaluate(() => globalThis.__snakeE2E.insets);
    await page.locator('#screen-menu [data-action="play"]').click();
    await expect(page.locator('#dpad')).toBeVisible();
    const dpadTop = await page.locator('#dpad').evaluate((el) => el.getBoundingClientRect().top);
    const viewport = page.viewportSize();
    const lifted = await insets();
    expect(lifted.bottom, 'поле поднято над крестом').toBeGreaterThan(viewport.height - dpadTop - 2);
    const hudBottom = await page.locator('#hud').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(lifted.top, 'поле ниже панели со счётом').toBeGreaterThanOrEqual(Math.floor(hudBottom));
    // Пауза → меню: поле на месте.
    await page.locator('#btn-pause').click();
    await page.locator('#screen-pause [data-action="menu"]').click();
    expect((await insets()).bottom).toBe(0);
    // Свои кнопки выше середины экрана — поле не сдвигаем.
    await page.evaluate(() => {
      const s = JSON.parse(globalThis.localStorage.getItem('snake3d.settings.v1'));
      s.dpad = { x: 0.8, y: 0.3, scale: 1 };
      globalThis.localStorage.setItem('snake3d.settings.v1', JSON.stringify(s));
    });
    await page.reload();
    await waitForGame(page); // меню есть в самом HTML — нажатие до загрузки игры терялось
    await page.locator('#screen-menu [data-action="play"]').click();
    await expect(page.locator('#dpad')).toBeVisible();
    expect((await insets()).bottom, 'крест выше середины — поле на месте').toBe(0);
    // Свайпы: поле на месте.
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
