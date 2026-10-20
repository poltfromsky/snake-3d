/**
 * Сценарии игры в настоящем браузере. Главное, что они ловят, — ошибки интерфейса,
 * которые не видят юнит-тесты логики: не показался экран, упал скрипт, не выдалось
 * достижение. Каждый тест падает и при любой ошибке JavaScript на странице.
 */
import { expect, test } from '@playwright/test';

import {
  gameState, openGame, openGameFromLink, waitForGame,
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
  await expect(page.locator('#achievements-progress')).toHaveText('Открыто 1 из 6');
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
  try {
    for (const page of [a, b]) {
      await expect(page.locator('#screen-duel')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#duel-title')).toHaveText('Ничья');
    }
  } catch (err) {
    // Чтобы по логу CI было видно, где застрял каждый игрок.
    const where = (page) => page.evaluate(() => ({
      state: globalThis.__snakeE2E?.state,
      kind: globalThis.__snakeE2E?.kind,
      online: globalThis.document.querySelector('#online-status')?.textContent,
    }));
    console.log('онлайн: хозяин', JSON.stringify(await where(a)), 'гость', JSON.stringify(await where(b)));
    throw err;
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

test('ник вводится один раз: из настроек — в итоги партии без формы и в отзыв, переживает перезагрузку', async ({ page }) => {
  const errors = await openGame(page);
  await page.locator('#screen-menu [data-action="settings"]').click();
  await page.locator('#set-name').pressSequentially('Питон');
  await page.locator('#screen-settings [data-action="back"]').click();
  await page.reload();
  await waitForGame(page);

  await page.locator('#screen-menu [data-action="play"]').click();
  // Очки, чтобы результат можно было сохранить; дальше змейка сама врежется в стену.
  await page.evaluate(() => { globalThis.__snakeE2E.game.score = 5; });
  await expect(page.locator('#screen-over')).toBeVisible();
  // Ник уже есть — формы нет: попытка сохранена сама, ник показан, рекорд можно отправить кнопкой.
  await expect(page.locator('#record-form')).toBeHidden();
  await expect(page.locator('#record-auto')).toBeVisible();
  await expect(page.locator('#record-auto-name')).toHaveText('Питон');
  await expect(page.locator('#record-auto-title')).toHaveText('Новый личный рекорд!');
  await expect(page.locator('#record-auto-title svg')).toHaveCount(1); // звезда — своя иконка
  await expect(page.locator('#btn-publish')).toBeVisible();

  await page.locator('#screen-over [data-action="menu"]').click();
  await page.locator('[data-action="feedback"]').click();
  await expect(page.locator('#feedback-name')).toHaveValue('Питон');
  expect(errors).toEqual([]);
});

test('браузер без 3D видит объяснение, а не мёртвые кнопки', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Как будто WebGL выключен: getContext для 3D возвращает null.
  await page.addInitScript(() => {
    const original = globalThis.HTMLCanvasElement.prototype.getContext;
    globalThis.HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      return /webgl/.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  await page.goto('/?e2e');
  await expect(page.locator('#screen-no3d')).toBeVisible();
  await expect(page.locator('#screen-menu')).toBeHidden();
  expect(errors).toEqual([]);
});

/**
 * Свой «адрес» на каждую отправку рекорда: иначе сработает ограничение частоты (в бою его ставит Cloudflare).
 * Запрос отправляет сам Playwright и отдаёт ответ браузеру.
 */
async function uniqueSenderForRecords(page) {
  let n = 0;
  const base = `10.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
  // Отправка рекордов и действия с профилем — те же ограничения по адресу.
  for (const pattern of ['**/api/records', '**/api/account/*']) {
    await page.route(pattern, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      n += 1;
      const response = await route.fetch({ headers: { ...route.request().headers(), 'cf-connecting-ip': `${base}.${n}` } });
      return route.fulfill({ response });
    });
  }
}

/**
 * Сыграть одиночную партию примерно с заданным счётом: змейка сама врежется в стену («Стены»).
 * Возвращает итоговый счёт с экрана: по пути змейка может успеть съесть яблоко (+10).
 */
async function playSolo(page, score, start = '#screen-menu [data-action="play"]') {
  await page.locator(start).click();
  await expect.poll(() => page.evaluate(() => globalThis.__snakeE2E.state)).toBe('playing');
  await page.evaluate((s) => { globalThis.__snakeE2E.game.score = s; }, score);
  await expect(page.locator('#screen-over')).toBeVisible();
  return Number(await page.locator('#over-score').textContent());
}

test.describe('рекорды', () => {
  // Без service worker: в WebKit запросы через него идут мимо перехвата Playwright,
  // а для рекордов он ни при чём (сервер — другой адрес, мимо кэша).
  test.use({ serviceWorkers: 'block' });

  test('автоотправка: в общей таблице одна строка на ник — лучший результат, в «Мои» — все попытки', async ({ page }, testInfo) => {
    const nick = `Тест${testInfo.project.name.slice(0, 3)}${Date.now().toString(36).slice(-4)}`;
    const errors = await openGame(page, { playerName: nick, autoSubmit: 'on' });
    await uniqueSenderForRecords(page);

    // Счёт небольшой: сервер проверяет, что его можно набрать за время партии.
    const first = await playSolo(page, 20);
    await expect(page.locator('#record-auto-status')).toHaveText(`В общей таблице: ${nick} — ${first}`);
    await expect(page.locator('#btn-publish')).toBeHidden();

    // Хуже прошлого (почти без очков) — не личный рекорд: в таблицу не отправляется, только в историю.
    await playSolo(page, 0, '#screen-over [data-action="play"]');
    await expect(page.locator('#record-auto-title')).toHaveText(`Ваш лучший результат: ${first}`);
    await expect(page.locator('#record-auto-status')).toHaveText('');

    const best = await playSolo(page, first + 30, '#screen-over [data-action="play"]');
    await expect(page.locator('#record-auto-status')).toHaveText(`В общей таблице: ${nick} — ${best}`);

    await page.locator('#screen-over [data-action="menu"]').click();
    await page.locator('#screen-menu [data-action="records"]').click();
    await page.locator('#records-tabs [data-mode="walls"]').click();
    await page.locator('#records-scope [data-scope="global"]').click();
    // У ника в общей таблице одна строка — лучшая; своё место видно и вне топ-10.
    await expect(page.locator('#records-me')).toContainText(`Ваш лучший результат в общей таблице: ${best}`);
    expect(await page.locator('#records-list li.me').count()).toBeLessThanOrEqual(1);

    await page.locator('#records-scope [data-scope="local"]').click();
    await expect(page.locator('#records-list li')).toHaveCount(3);
    await expect(page.locator('#records-list li.best b')).toHaveText(`${best}`);
    await expect(page.locator('#records-list li.best b svg')).toHaveCount(1); // звезда — иконка
    await expect(page.locator('#records-me')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('без ника форма появляется один раз, дальше ник подставляется сам', async ({ page }) => {
    const errors = await openGame(page);
    await uniqueSenderForRecords(page);
    await playSolo(page, 15);
    await expect(page.locator('#record-form')).toBeVisible();
    await page.locator('#record-public').uncheck();
    await page.locator('#record-name').fill('Удав');
    await page.locator('#record-form button[type="submit"]').click();
    await expect(page.locator('#record-form')).toBeHidden();
    await expect(page.locator('#record-auto-name')).toHaveText('Удав');

    await playSolo(page, 50, '#screen-over [data-action="play"]');
    await expect(page.locator('#record-form')).toBeHidden();
    await expect(page.locator('#record-auto-title')).toHaveText('Новый личный рекорд!');
    expect(errors).toEqual([]);
  });
});

test.describe('защита общей таблицы', () => {
  test.use({ serviceWorkers: 'block' });

  test('накрутку сервер не принимает, а игрок видит понятное объяснение', async ({ page }, testInfo) => {
    const nick = `Чест${testInfo.project.name.slice(0, 3)}${Date.now().toString(36).slice(-4)}`;
    const errors = await openGame(page, { playerName: nick, autoSubmit: 'on' });
    await uniqueSenderForRecords(page);
    // 4000 очков за секунду — так сыграть невозможно.
    await playSolo(page, 4000);
    await expect(page.locator('#record-auto-title')).toHaveText('Новый личный рекорд!');
    await expect(page.locator('#record-auto-status')).toHaveText(/невозможно набрать за это время/);
    expect(errors).toEqual([]);
  });

  test('чужой ник занять нельзя: другое устройство получает отказ', async ({ browser }, testInfo) => {
    const nick = `Мой${testInfo.project.name.slice(0, 3)}${Date.now().toString(36).slice(-4)}`;
    // Два «устройства» — два отдельных браузера. Закрываем их в конце: иначе они продолжают
    // рисовать 3D в фоне и тормозят следующие тесты.
    const ownerContext = await browser.newContext({ serviceWorkers: 'block' });
    const strangerContext = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const owner = await ownerContext.newPage();
      await openGame(owner, { playerName: nick, autoSubmit: 'on' });
      await uniqueSenderForRecords(owner);
      await playSolo(owner, 20);
      await expect(owner.locator('#record-auto-status')).toHaveText(/^В общей таблице:/);
      await ownerContext.close();

      const stranger = await strangerContext.newPage();
      const errors = await openGame(stranger, { playerName: nick, autoSubmit: 'on' });
      await uniqueSenderForRecords(stranger);
      await playSolo(stranger, 30);
      await expect(stranger.locator('#record-auto-status')).toHaveText(`Ник «${nick}» уже занят другим игроком. Если это ваш ник — войдите в профиль в настройках.`);
      expect(errors).toEqual([]);
    } finally {
      await ownerContext.close();
      await strangerContext.close();
    }
  });
});

test.describe('рекорды по скоростям', () => {
  test.use({ serviceWorkers: 'block' });

  test('вкладки скорости: «Мои» и общая таблица отдельно для каждой скорости, у ника значок платформы', async ({ page }) => {
    // Своя история на устройстве: попытки на разных скоростях.
    await page.addInitScript(() => {
      if (localStorage.getItem('snake3d.history.v1')) return;
      localStorage.setItem('snake3d.history.v1', JSON.stringify({
        walls: [
          { score: 70, length: 9, date: 3, speed: 'slow' },
          { score: 40, length: 7, date: 2, speed: 'normal' },
          { score: 30, length: 6, date: 1 }, // из прошлой версии — без скорости, считается «normal»
        ],
      }));
    });
    // Общая таблица: ответ сервера подставляем, проверяем только то, как экран его показывает.
    const asked = [];
    await page.route('**/api/records?*', (route) => {
      const url = new URL(route.request().url());
      asked.push(url.searchParams.get('speed'));
      const rows = url.searchParams.get('speed') === 'fast'
        ? [{ name: 'Кобра', score: 90, length: 11, comment: null, platform: 'buttons', created_at: '2026-10-19 10:00:00' },
          { name: 'Удав', score: 80, length: 10, comment: null, platform: 'pc', created_at: '2026-10-19 10:00:00' },
          { name: 'Полоз', score: 70, length: 9, comment: null, platform: null, created_at: '2026-10-19 10:00:00' }]
        : [];
      return route.fulfill({ json: rows, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    const errors = await openGame(page);
    await page.locator('#screen-menu [data-action="records"]').click();
    await page.locator('#records-tabs [data-mode="walls"]').click();
    await expect(page.locator('#records-speed [data-speed="normal"]')).toHaveClass(/active/);

    // «Мои»: на нормальной — две попытки (с явной скоростью и из прошлой версии), на медленной — одна.
    await page.locator('#records-scope [data-scope="local"]').click();
    await expect(page.locator('#records-list li')).toHaveCount(2);
    await expect(page.locator('#records-list li.best b')).toHaveText('40');
    await page.locator('#records-speed [data-speed="slow"]').click();
    await expect(page.locator('#records-list li')).toHaveCount(1);
    await expect(page.locator('#records-list li.best b')).toHaveText('70');

    // Общая таблица на быстрой: значки платформы с подписью, у строки без платформы значка нет.
    await page.locator('#records-scope [data-scope="global"]').click();
    await page.locator('#records-speed [data-speed="fast"]').click();
    await expect(page.locator('#records-list li')).toHaveCount(3);
    await expect(page.locator('#records-list li').nth(0).locator('.platform-icon')).toHaveAttribute('aria-label', 'Телефон, кнопки на экране');
    await expect(page.locator('#records-list li').nth(1).locator('.platform-icon')).toHaveAttribute('aria-label', 'Компьютер');
    await expect(page.locator('#records-list li').nth(2).locator('.platform-icon')).toHaveCount(0);
    expect(asked).toContain('fast');
    expect(errors).toEqual([]);
  });
});

test.describe('профиль с паролем', () => {
  test.use({ serviceWorkers: 'block' });

  const openProfile = async (page) => {
    await page.locator('#screen-menu [data-action="settings"]').click();
    await page.locator('#screen-settings [data-action="profile"]').click();
    await expect(page.locator('#screen-profile')).toBeVisible();
  };

  test('пароль защищает ник: профиль создаётся, код показывается один раз, с другого устройства можно войти', async ({ page, browser }, testInfo) => {
    const nick = `Проф${testInfo.project.name.slice(0, 3)}${Date.now().toString(36).slice(-4)}`;
    const password = 'пароль-для-теста-1';
    const errors = await openGame(page, { playerName: nick });
    await uniqueSenderForRecords(page);
    await openProfile(page);

    // Создание: пароли должны совпадать и быть не короче 8 знаков.
    await page.locator('#profile-new-pass').fill(password);
    await page.locator('#profile-new-pass2').fill('другой-пароль-2');
    await page.locator('#profile-create button[type=submit]').click();
    await expect(page.locator('#profile-status')).toHaveText('Пароли не совпадают.');
    await page.locator('#profile-new-pass').fill('коротко');
    await page.locator('#profile-new-pass2').fill('коротко');
    await page.locator('#profile-create button[type=submit]').click();
    await expect(page.locator('#profile-status')).toContainText('не короче 8');
    await page.locator('#profile-new-pass').fill(password);
    await page.locator('#profile-new-pass2').fill(password);
    await page.locator('#profile-create button[type=submit]').click();

    // Код восстановления: показан, уйти не сохранив нельзя, «Готово» — только после отметки.
    await expect(page.locator('#profile-code')).toBeVisible({ timeout: 20_000 });
    const code = (await page.locator('#profile-code-text').textContent()).trim();
    expect(code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    await expect(page.locator('#profile-code-done')).toBeDisabled();
    await page.locator('#screen-profile [data-action="profile-back"]').click();
    await expect(page.locator('#screen-profile')).toBeVisible();
    await expect(page.locator('#profile-state')).toContainText('сохраните код');
    await page.locator('#profile-code-saved').check();
    await page.locator('#profile-code-done').click();
    await expect(page.locator('#profile-state')).toContainText('защищён паролем');
    await expect(page.locator('#profile-code')).toBeHidden();
    await page.locator('#screen-profile [data-action="profile-back"]').click();
    await expect(page.locator('#settings-profile-state')).toHaveText('Ник защищён паролем.');

    // Другое устройство: чистое хранилище. Неверный пароль — отказ, верный — вход под тем же ником.
    const other = await browser.newContext();
    try {
      const phone = await other.newPage();
      const phoneErrors = await openGame(phone, { playerName: '' });
      await uniqueSenderForRecords(phone);
      await openProfile(phone);
      await expect(phone.locator('#profile-create')).toBeHidden();
      await phone.locator('#profile-login-name').fill(nick);
      await phone.locator('#profile-login-pass').fill('не-тот-пароль-9');
      await phone.locator('#profile-login button[type=submit]').click();
      await expect(phone.locator('#profile-status')).toHaveText('Неверный ник или пароль.', { timeout: 20_000 });
      await phone.locator('#profile-login-pass').fill(password);
      await phone.locator('#profile-login button[type=submit]').click();
      await expect(phone.locator('#profile-status')).toContainText(`Вы вошли как «${nick}»`, { timeout: 20_000 });
      await expect(phone.locator('#profile-state')).toContainText('защищён паролем');
      await phone.locator('#screen-profile [data-action="profile-back"]').click();
      await expect(phone.locator('#set-name')).toHaveValue(nick);
      expect(phoneErrors).toEqual([]);
    } finally {
      await other.close();
    }
    expect(errors).toEqual([]);
  });
});
