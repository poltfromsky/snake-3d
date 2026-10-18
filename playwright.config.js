/**
 * Браузерные автотесты (Playwright): настоящая игра в настоящем браузере.
 * Запуск: `npm run e2e`. Поднимает сайт (tools/serve.mjs) и игровой сервер
 * (wrangler dev в server/), если они ещё не запущены.
 *
 * Четыре устройства — три движка, на которых работают почти все браузеры:
 *   desktop-chrome  — Chromium: Chrome, Edge, Яндекс, Opera на компьютере;
 *   android-chrome  — Chromium с экраном и сенсором Pixel 7: Chrome, Samsung Internet,
 *                     Яндекс и браузер Telegram на Android;
 *   iphone-safari   — WebKit с экраном iPhone 14: на iPhone все браузеры работают на WebKit;
 *   desktop-firefox — Firefox.
 * Один проект: `npx playwright test --project=iphone-safari`.
 */
import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);
// WebGL без видеокарты (программный рендер), звук без клика пользователя.
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Один поток: тесты делят локальный игровой сервер, а WebGL в программном режиме небыстрый.
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // Без записей трейсов и видео: в публичном CI они попали бы в открытые артефакты.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], launchOptions: { args: CHROMIUM_ARGS } } },
    { name: 'android-chrome', use: { ...devices['Pixel 7'], launchOptions: { args: CHROMIUM_ARGS } } },
    { name: 'iphone-safari', use: { ...devices['iPhone 14'] } },
    {
      name: 'desktop-firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Без экрана (headless) Firefox на Linux не создаёт WebGL. В CI он работает
        // в виртуальном дисплее (xvfb-run) с программным 3D — как обычный браузер.
        headless: !CI,
        launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'webgl.force-enabled': true } },
      },
    },
  ],
  webServer: [
    {
      command: 'node tools/serve.mjs',
      url: 'http://localhost:5173',
      reuseExistingServer: !CI,
    },
    {
      // Сначала таблицы в локальной базе: у неё своя копия на каждый database_id,
      // и без миграций сервер отвечал бы на рекорды и отзывы ошибкой.
      command: 'npm run db:local && npx wrangler dev --port 8787 --ip 127.0.0.1',
      cwd: 'server',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
