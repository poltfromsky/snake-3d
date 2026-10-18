/**
 * «Что нового»: список изменений для игроков (changelog.json).
 *
 *   - Скачалась новая версия → плашка «Вышла версия X · Что нового · Обновить».
 *     Список берётся с сайта свежим: запущенная старая версия не знает, что в новой.
 *   - После обновления — один раз окно «Что нового» с изменениями с прошлой версии.
 *   - Внизу меню и в настройках — номер версии и вся история обновлений.
 *
 * Текст списка пишется вручную и проверяется тестом tests/changelog.test.js:
 * в нём только то, что игроку можно и полезно знать.
 */
import { changesSince, compareVersions, latestVersion } from '../core/versions.js';
import { loadSeenVersion, saveSeenVersion } from '../storage.js';
import { $ } from './dom.js';

const dateText = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * @param {object} deps
 * @param {string} deps.version версия запущенной игры
 * @param {(name: string) => void} deps.open показать экран «Что нового» (из меню)
 */
export function createWhatsNew({ version, open }) {
  let pendingEntries = []; // что нового в скачанной, но ещё не включённой версии

  async function fetchChangelog() {
    try {
      const res = await fetch('changelog.json', { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** Список изменений: заголовок версии, дата, пункты. Только textContent. */
  function render(entries, { title, offerUpdate = false }) {
    $('#whats-new-title').textContent = title;
    const list = $('#whats-new-list');
    list.replaceChildren();
    for (const v of entries) {
      const block = document.createElement('section');
      const head = document.createElement('h3');
      head.textContent = `Версия ${v.version}`;
      const date = document.createElement('small');
      date.textContent = dateText(v.date);
      head.append(' ', date);
      const name = document.createElement('b');
      name.textContent = v.title;
      const ul = document.createElement('ul');
      for (const change of v.changes) {
        const li = document.createElement('li');
        li.textContent = change;
        ul.append(li);
      }
      block.append(head, name, ul);
      list.append(block);
    }
    if (!entries.length) {
      const p = document.createElement('p');
      p.className = 'subtitle';
      p.textContent = 'Список изменений сейчас недоступен — нужна связь с сайтом.';
      list.append(p);
    }
    $('#btn-update-now').classList.toggle('hidden', !offerUpdate);
  }

  function markSeen() {
    saveSeenVersion(version);
    $('#whats-new-dot').classList.add('hidden');
  }

  $('#app-version').textContent = `Версия ${version}`;
  $('#settings-version').textContent = version;

  $('#btn-whats-new-update').addEventListener('click', () => {
    render(pendingEntries, { title: 'Что нового в обновлении', offerUpdate: true });
    open('whats-new');
  });

  return {
    /** Новая версия скачана: показать её номер и кнопку «Что нового». */
    async onUpdateReady() {
      $('#update-banner').classList.remove('hidden');
      const changelog = await fetchChangelog();
      const latest = latestVersion(changelog);
      if (!latest || compareVersions(latest, version) <= 0) return;
      pendingEntries = changesSince(changelog, version);
      $('#update-text').textContent = `Вышла версия ${latest}`;
      $('#btn-whats-new-update').classList.remove('hidden');
    },

    /** При запуске: если игра обновилась с прошлого раза — один раз показать, что нового. */
    async afterStart({ canShow }) {
      const seen = loadSeenVersion();
      if (!seen) {
        markSeen(); // новый игрок: показывать «что изменилось» не с чем
        return;
      }
      if (compareVersions(version, seen) <= 0) return;
      $('#whats-new-dot').classList.remove('hidden');
      if (!canShow()) return; // идёт обучение или вход по ссылке — не мешаем, точка в меню останется
      const changelog = await fetchChangelog();
      const entries = changesSince(changelog, seen, version);
      if (!entries.length || !canShow()) return;
      render(entries, { title: 'Что нового' });
      open('whats-new');
      markSeen();
    },

    /** «Что нового» из меню или настроек — вся история. */
    async showHistory() {
      const changelog = await fetchChangelog();
      render(changesSince(changelog, '0.0.0'), { title: 'История обновлений' });
      open('whats-new');
      markSeen();
    },
  };
}
