/**
 * Браузерные автотесты (Playwright): настоящая игра в настоящем браузере.
 * Запуск: `npm run e2e`. Поднимает сайт (tools/serve.mjs) и игровой сервер
 * (wrangler dev в server/), если они ещё не запущены.
 */
import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

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
    launchOptions: {
      // WebGL без видеокарты (программный рендер), звук без клика пользователя.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
