// Политика конфиденциальности (152-ФЗ, ч. 2 ст. 18.1): опубликована, заполнена, на неё есть ссылки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const policy = read('privacy.html');
const html = read('index.html');

test('в политике нет незаполненных мест: оператор и почта для обращений указаны', () => {
  assert.doesNotMatch(policy, /\[(ФИО|ПОЧТА)[^\]]*\]/, 'заполните оператора и почту в privacy.html');
});

test('политика выкладывается на сайт вместе с игрой', () => {
  assert.match(read('.github/workflows/ci.yml'), /cp -r [^\n]*\bprivacy\.html\b/);
});

test('ссылки на политику: регистрация (с галочкой согласия), отзыв, настройки', () => {
  assert.match(html, /id="profile-consent"/);
  assert.equal((html.match(/href="privacy\.html"/g) ?? []).length, 3);
});

test('в политике описано удаление профиля — как в игре', () => {
  assert.match(policy, /Удалить профиль и данные/);
  assert.match(html, /Удалить профиль и данные/);
});
