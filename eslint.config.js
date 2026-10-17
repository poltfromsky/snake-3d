/**
 * ESLint — проверка кода без запуска (как flake8 для Python).
 * Главное, ради чего он здесь: необъявленные и неиспользуемые переменные.
 * Запуск: `npm run lint`. В конвейере выкладка не идёт, пока есть ошибки.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['**/node_modules/**', 'server/.wrangler/**', '_site/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-shadow-restricted-names': 'error',
      // `x == null` — намеренная проверка «null или undefined», её разрешаем.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Игра в браузере.
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Сервер на Cloudflare Workers: окружение похоже на браузерное
    // плюс собственные объекты рантайма.
    files: ['server/src/**/*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, WebSocketPair: 'readonly' },
    },
  },
  {
    // Скрипты и тесты, которые запускаются в Node.
    files: ['tools/**/*.mjs', 'tests/**/*.js', 'server/test/**/*.mjs', 'e2e/**/*.js', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
