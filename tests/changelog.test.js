import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_VERSION } from '../src/config.js';
import { changesSince, compareVersions, latestVersion } from '../src/core/versions.js';

const changelog = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'changelog.json'), 'utf8'));
const allText = changelog.versions.flatMap((v) => [v.title, ...v.changes]);

/**
 * Список изменений видят все игроки. В нём не должно быть ничего служебного:
 * адресов, файлов, кода, устройства сервера и подробностей защиты таблицы.
 */
const FORBIDDEN = [
  [/https?:\/\/|www\./i, 'адрес сайта или сервера'],
  [/[\w.+-]+@[\w-]+\.\w/, 'почта'],
  [/\b[0-9a-f]{7,40}\b/i, 'номер коммита или хэш'],
  [/\.(js|mjs|json|sql|html|css|md)\b|src\/|\/api\b/i, 'файл или путь'],
  [/\b[a-z]+[A-Z]\w*\b|\b[a-z]+_[a-z_]+\b/, 'имя из кода'],
  [/(?<![а-яё])(токен|секрет|пароль|хэш|сол[ьи](?![а-яё])|айпи|ключ)|token|secret|password|hash|salt|\bIP\b|\bkey\b/i, 'секреты и личные данные'],
  [/cloudflare|worker|\bd1\b|sql|(?<![а-яё])база данных|localstorage|github|\bapi\b|endpoint|wrangler|(?<![а-яё])сервис-воркер|service worker/i, 'устройство сервера'],
  [/(?<![а-яё])(билет|порог|лимит|антиспам|накрут)|anti-?cheat/i, 'подробности защиты таблицы'],
];

test('список изменений — только открытая информация для игроков', () => {
  for (const line of allText) {
    for (const [re, what] of FORBIDDEN) assert.doesNotMatch(line, re, `«${line}» — ${what}`);
    assert.ok(line.length <= 140, `слишком длинно: «${line}»`);
  }
});

test('сторож ловит служебное', () => {
  const leaks = [
    'Соль хранится в секрете',
    'Сервер теперь на https://example.workers.dev',
    'Исправлен src/main.js',
    'Коммит 3fa59d4',
    'Билет партии проверяется по времени',
    'Ник хранится по хэшу ключа устройства',
    'Добавлен endpoint для рекордов',
    'Новая переменная autoSubmit',
  ];
  for (const leak of leaks) {
    assert.ok(FORBIDDEN.some(([re]) => re.test(leak)), `не поймано: «${leak}»`);
  }
});

test('у текущей версии игры есть запись в списке изменений, записи по порядку', () => {
  assert.equal(latestVersion(changelog), APP_VERSION, 'перед выкладкой допишите изменения в changelog.json');
  const versions = changelog.versions.map((v) => v.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => compareVersions(b, a)), 'новые сверху');
  assert.equal(new Set(versions).size, versions.length, 'версии не повторяются');
  for (const v of changelog.versions) {
    assert.match(v.version, /^\d+\.\d+\.\d+$/);
    assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(v.title && v.changes.length >= 1 && v.changes.length <= 8, v.version);
  }
});

test('изменения между версиями: что нового после обновления', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0, 'сравнение по числам, а не по тексту');
  assert.equal(compareVersions('1.7.0', '1.7.0'), 0);
  const data = { versions: [{ version: '1.6.0' }, { version: '1.8.0' }, { version: '1.7.0' }] };
  assert.deepEqual(changesSince(data, '1.6.0').map((v) => v.version), ['1.8.0', '1.7.0']);
  assert.deepEqual(changesSince(data, '1.6.0', '1.7.0').map((v) => v.version), ['1.7.0']);
  assert.deepEqual(changesSince(data, '1.8.0'), []);
  assert.equal(latestVersion(data), '1.8.0');
  assert.equal(latestVersion(null), null);
});
