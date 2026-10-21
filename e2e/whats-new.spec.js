/**
 * «Что нового» и свои иконки: после обновления — один раз список изменений,
 * плашка новой версии — с номером и «Что нового», история — в настройках.
 * На экране не должно быть эмодзи: только свои иконки.
 */
import { expect, test } from '@playwright/test';

import { collectErrors, openGame, waitForGame } from './helpers.js';

const VERSION = (page) => page.locator('#app-version').textContent().then((t) => t.replace('Версия ', ''));

test('после обновления один раз показывается, что нового с прошлой версии', async ({ page }) => {
  const errors = await openGame(page);
  const current = await VERSION(page);
  // Как будто раньше игрок играл в 1.6.0.
  await page.evaluate(() => localStorage.setItem('snake3d.seen-version.v1', JSON.stringify('1.6.0')));
  await page.reload();
  await waitForGame(page).catch(() => {});
  await expect(page.locator('#screen-whats-new')).toBeVisible();
  await expect(page.locator('#whats-new-title')).toHaveText('Что нового');
  await expect(page.locator('#whats-new-list h3').first()).toContainText(`Версия ${current}`);
  await expect(page.locator('#whats-new-list')).toContainText('Версия 1.7.0');
  await expect(page.locator('#whats-new-list')).not.toContainText('Версия 1.6.0');
  await page.locator('#screen-whats-new [data-action="back"]').click();
  await expect(page.locator('#screen-menu')).toBeVisible();
  await expect(page.locator('#whats-new-dot')).toBeHidden();

  await page.reload();
  await waitForGame(page);
  await expect(page.locator('#screen-whats-new')).toBeHidden();
  expect(errors).toEqual([]);
});

test('история обновлений — из настроек, со всеми версиями', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#screen-menu [data-action="settings"]').click();
  await expect(page.locator('#settings-version')).toHaveText(await VERSION(page));
  await page.locator('#screen-settings [data-action="whats-new"]').click();
  await expect(page.locator('#whats-new-title')).toHaveText('История обновлений');
  await expect(page.locator('#whats-new-list')).toContainText('Версия 1.4.0');
  await expect(page.locator('#btn-update-now')).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe('плашка новой версии', () => {
  // Запросы через service worker идут мимо перехвата Playwright, а здесь проверяется плашка, не кэш.
  test.use({ serviceWorkers: 'block' });

  test('вышла новая версия: номер и «Что нового» прямо в плашке', async ({ page }) => {
    const errors = await openGame(page);
    // Сайт уже отдаёт список изменений новой версии.
    await page.route('**/changelog.json*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        versions: [
          { version: '9.9.0', date: '2030-01-01', title: 'Будущее', changes: ['Новая арена'] },
          { version: '1.0.0', date: '2026-01-01', title: 'Старое', changes: ['Было давно'] },
        ],
      }),
    }));
    await page.evaluate(() => globalThis.__snakeE2E.simulateUpdateReady());
    await expect(page.locator('#update-text')).toHaveText('Вышла версия 9.9.0');
    await page.locator('#btn-whats-new-update').click();
    await expect(page.locator('#whats-new-title')).toHaveText('Что нового в обновлении');
    await expect(page.locator('#whats-new-list')).toContainText('Новая арена');
    await expect(page.locator('#whats-new-list')).not.toContainText('Было давно');
    await expect(page.locator('#btn-update-now')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('кнопка «Проверить обновления»', () => {
  test.use({ serviceWorkers: 'block' });

  test('на сайте та же версия — «У вас последняя версия»', async ({ page }) => {
    const errors = await openGame(page);
    const current = await VERSION(page);
    await page.locator('#screen-menu [data-action="settings"]').click();
    await page.locator('#btn-check-update').click();
    await expect(page.locator('#update-check-status')).toHaveText(`У вас последняя версия — ${current}.`);
    await expect(page.locator('#btn-settings-update')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('на сайте версия новее — сразу видно номер и кнопку «Обновить сейчас»', async ({ page }) => {
    const errors = await openGame(page);
    let asked = '';
    await page.route('**/changelog.json*', (route) => {
      asked = route.request().url();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ versions: [{ version: '9.9.0', date: '2030-01-01', title: 'Будущее', changes: ['Новая арена'] }] }),
      });
    });
    await page.locator('#screen-menu [data-action="settings"]').click();
    await page.locator('#btn-check-update').click();
    await expect(page.locator('#update-check-status')).toContainText('Вышла версия 9.9.0');
    await expect(page.locator('#btn-settings-update')).toBeVisible();
    expect(asked).toMatch(/changelog\.json\?t=\d+/); // мимо кэша хостинга
    expect(errors).toEqual([]);
  });

  test('нет связи с сайтом — честно говорим, что проверить не вышло', async ({ page }) => {
    const errors = await openGame(page);
    await page.route('**/changelog.json*', (route) => route.abort());
    await page.locator('#screen-menu [data-action="settings"]').click();
    await page.locator('#btn-check-update').click();
    await expect(page.locator('#update-check-status')).toContainText('Не удалось проверить');
    expect(errors.filter((e) => !/changelog/.test(e))).toEqual([]);
  });
});

test('на экранах нет эмодзи — только свои иконки', async ({ page }) => {
  await openGame(page, { tutorial: false });
  // Открываем всё, где раньше были эмодзи: меню с плашкой, достижения, общую таблицу.
  await page.evaluate(() => {
    for (const s of globalThis.document.querySelectorAll('.screen')) s.classList.remove('hidden');
    for (const s of globalThis.document.querySelectorAll('.update-banner, #record-auto, #record-publish')) s.classList.remove('hidden');
  });
  await page.locator('#screen-menu [data-action="achievements"]').evaluate((b) => b.click());
  const text = await page.evaluate(() => globalThis.document.body.innerText);
  const emoji = text.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{25B6}\u{25C0}\u{2B05}-\u{2B07}\u{2B50}]/gu) ?? [];
  expect(emoji).toEqual([]);
  await expect(page.locator('#tutorial-banner svg')).toHaveCount(1);
  await expect(page.locator('#achievements-list .achievement-icon svg').first()).toBeVisible();
});

test('игрок со старой версии (до «Что нового») тоже видит, что изменилось', async ({ page }) => {
  // Настройки и обучение есть (играл раньше), а запомненной версии нет — так было до 1.8.0.
  const errors = await openGame(page);
  await page.evaluate(() => localStorage.removeItem('snake3d.seen-version.v1'));
  await page.reload();
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E));
  await expect(page.locator('#screen-whats-new')).toBeVisible();
  await expect(page.locator('#whats-new-list')).toContainText('Версия 1.8.0');
  await expect(page.locator('#whats-new-list')).not.toContainText('Версия 1.7.2');
  expect(errors).toEqual([]);
});

test('совсем новому игроку окно «Что нового» не показывается', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e');
  await page.waitForFunction(() => Boolean(globalThis.__snakeE2E));
  await page.waitForTimeout(1500);
  await expect(page.locator('#screen-whats-new')).toBeHidden();
  expect(errors).toEqual([]);
});
