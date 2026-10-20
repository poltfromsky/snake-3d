import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveLoginKey, isLoginKey, isRecoveryCode, makeRecoveryCode, normalizeRecoveryCode,
  passwordProblem, safeEqual, KDF_ITERATIONS,
} from '../src/core/auth.js';

// В тестах итераций меньше, чтобы не ждать: проверяем устройство функции, а не её стойкость.
const FAST = 1000;

test('пароль: длина, пробелы по краям и однообразные пароли отсекаются', () => {
  assert.equal(passwordProblem('хорошийпароль1'), null);
  assert.match(passwordProblem('коротко'), /не короче 8/);
  assert.match(passwordProblem('x'.repeat(65)), /не длиннее 64/);
  assert.match(passwordProblem(' пробелпробел '), /пробелы/);
  assert.match(passwordProblem('aaaaaaaaaa'), /повторяющегося/);
  assert.notEqual(passwordProblem(''), null);
  assert.notEqual(passwordProblem(undefined), null);
});

test('ключ входа: 64 знака, один и тот же для пароля и ника, разный для разных', async () => {
  const a = await deriveLoginKey('мой пароль 123', 'Питон', FAST);
  assert.ok(isLoginKey(a));
  assert.equal(a, await deriveLoginKey('мой пароль 123', 'Питон', FAST), 'повторяемо');
  assert.equal(a, await deriveLoginKey('мой пароль 123', '  питон ', FAST), 'ник без учёта регистра и пробелов');
  assert.notEqual(a, await deriveLoginKey('мой пароль 124', 'Питон', FAST), 'другой пароль');
  assert.notEqual(a, await deriveLoginKey('мой пароль 123', 'Удав', FAST), 'другой ник — другая соль');
  assert.notEqual(a, await deriveLoginKey('мой пароль 123', 'Питон', FAST + 1), 'другое число итераций');
});

test('ключ входа не содержит пароля и не похож на него', async () => {
  const password = 'secret-pass-8';
  const key = await deriveLoginKey(password, 'Питон', FAST);
  assert.ok(!key.includes(password));
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('в игре число итераций — рекомендованное, не меньше 600 000', () => {
  assert.ok(KDF_ITERATIONS >= 600_000);
});

test('код восстановления: формат, алфавит без похожих знаков, повторяемость нормализации', () => {
  const code = makeRecoveryCode();
  assert.match(code, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  assert.ok(!/[01OIL]/.test(code), 'нет 0, 1, O, I, L');
  assert.ok(isRecoveryCode(code));
  assert.equal(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), code.replace(/-/g, ''));
  assert.ok(isRecoveryCode(code.toLowerCase()), 'регистр не важен');
  assert.equal(isRecoveryCode('ABCDE-FGHJK'), false, 'слишком короткий');
  assert.equal(isRecoveryCode('0'.repeat(20)), false, 'знаки не из алфавита');
  assert.notEqual(makeRecoveryCode(), makeRecoveryCode(), 'каждый раз новый');
});

test('код восстановления без перекоса: все знаки алфавита встречаются, ни один не доминирует', () => {
  const counts = new Map();
  for (let i = 0; i < 400; i += 1) for (const c of makeRecoveryCode().replace(/-/g, '')) counts.set(c, (counts.get(c) ?? 0) + 1);
  assert.equal(counts.size, 31);
  const values = [...counts.values()];
  assert.ok(Math.max(...values) < Math.min(...values) * 1.6, 'частоты близки');
});

test('safeEqual: равные строки — да, разные и разной длины — нет', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});
