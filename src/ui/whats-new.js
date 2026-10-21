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

/**
 * Последняя версия без «Что нового». Игроки, пришедшие с неё и раньше, не имеют сохранённой
 * «виденной версии» — им показываем изменения начиная со следующей.
 */
export const BEFORE_WHATS_NEW = '1.7.2';

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
      // Метка времени в адресе — мимо кэша хостинга: иначе он до 10 минут отдаёт прошлый список.
      const res = await fetch(`changelog.json?t=${Date.now()}`, { cache: 'no-store' });
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

  /** Строка под кнопкой «Проверить обновления» в настройках и кнопка «Обновить» рядом. */
  function checkStatus(text, { canUpdate = false } = {}) {
    $('#update-check-status').textContent = text;
    $('#update-check-status').classList.toggle('hidden', !text);
    $('#btn-settings-update').classList.toggle('hidden', !canUpdate);
  }

  let recheck = null; // повторные проверки, пока хостинг не начнёт отдавать новую версию
  let lastLatest = null;

  return {
    /**
     * Кнопка «Проверить обновления»: сверяем номер версии на сайте и просим service worker
     * скачать новую. checkNow() — из pwa.js (registerServiceWorker).
     */
    async checkForUpdate(checkNow) {
      clearInterval(recheck);
      recheck = null;
      const button = $('#btn-check-update');
      button.disabled = true;
      checkStatus('Проверяем…');
      const [changelog, sw] = await Promise.all([fetchChangelog(), checkNow()]);
      button.disabled = false;
      const latest = latestVersion(changelog);
      lastLatest = latest;
      const newer = latest && compareVersions(latest, version) > 0;
      if (sw === 'ready') {
        checkStatus(newer ? `Версия ${latest} скачана — можно обновиться.` : 'Новая версия скачана — можно обновиться.', { canUpdate: true });
      } else if (sw === 'downloading') {
        checkStatus(`Нашлась версия ${newer ? latest : 'новее'} — скачивается, это несколько секунд…`);
      } else if (newer && sw === 'unsupported') {
        checkStatus(`Вышла версия ${latest}. Обновите страницу, чтобы её загрузить.`, { canUpdate: true });
      } else if (newer) {
        // Номер уже новый, а сайт ещё отдаёт прошлую сборку из своего кэша — проверяем сами ещё.
        checkStatus(`Версия ${latest} уже вышла и вот-вот будет доступна — проверим ещё раз сами.`);
        let tries = 0;
        recheck = setInterval(async () => {
          tries += 1;
          const state = await checkNow();
          if (state === 'downloading') checkStatus(`Версия ${latest} скачивается…`);
          if (state !== 'none' || tries >= 20) {
            clearInterval(recheck);
            recheck = null;
          }
        }, 30_000);
      } else if (!changelog) {
        checkStatus('Не удалось проверить: нет связи с сайтом игры. Попробуйте позже.');
      } else {
        checkStatus(`У вас последняя версия — ${version}.`);
      }
    },

    /** Новая версия скачана: показать её номер и кнопку «Что нового». */
    async onUpdateReady() {
      $('#update-banner').classList.remove('hidden');
      checkStatus(lastLatest && compareVersions(lastLatest, version) > 0
        ? `Версия ${lastLatest} скачана — можно обновиться.`
        : 'Новая версия скачана — можно обновиться.', { canUpdate: true });
      const changelog = await fetchChangelog();
      const latest = latestVersion(changelog);
      if (!latest || compareVersions(latest, version) <= 0) return;
      pendingEntries = changesSince(changelog, version);
      $('#update-text').textContent = `Вышла версия ${latest}`;
      $('#btn-whats-new-update').classList.remove('hidden');
    },

    /**
     * При запуске: если игра обновилась с прошлого раза — один раз показать, что нового.
     * returning — у игрока уже были настройки, рекорды или обучение (он играл раньше).
     */
    async afterStart({ canShow, returning = false }) {
      let seen = loadSeenVersion();
      if (!seen && !returning) {
        markSeen(); // новый игрок: показывать «что изменилось» не с чем
        return;
      }
      // Играл раньше, но версия не запомнена — пришёл с версии, где «Что нового» ещё не было.
      if (!seen) seen = BEFORE_WHATS_NEW;
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
