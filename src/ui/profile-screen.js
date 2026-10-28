/**
 * Экран «Профиль» — как в играх:
 *   не вошли → вкладки «Вход» и «Регистрация», под входом «Забыли пароль?» (код восстановления);
 *   вошли    → «Мой профиль»: ник, попытки и достижения на этом устройстве, лучшие результаты
 *              в общей таблице (с местом и значком платформы), смена пароля, выход, удаление профиля.
 * Регистрация — только с согласием с политикой конфиденциальности (privacy.html).
 *
 * Пароль никуда не отправляется: браузер превращает его в ключ входа (src/core/auth.js, ~0,5 с),
 * и на сервер уходит только он. Профиль необязателен: без него ник принадлежит этому устройству.
 */
import {
  deriveLoginKey, isRecoveryCode, normalizeRecoveryCode, passwordProblem,
} from '../core/auth.js';
import { plural } from '../core/stats.js';
import { cleanText, LIMITS, nameKey } from '../core/validate.js';
import {
  deviceKey, loadHistory, loadProfile, logoutProfile, saveProfile, setPlayerName,
} from '../storage.js';
import { $, markActive, serverMessage } from './dom.js';
import { iconSvg } from './icons.js';
import { addPasswordToggles, hidePasswords } from './password-field.js';
import { PLATFORM_ICONS } from './records-screen.js';

const MODE_LABELS = Object.freeze({ classic: 'Классика', walls: 'Стены', timed: 'На время' });
const SPEED_LABELS = Object.freeze({ slow: 'Медленно', normal: 'Нормально', fast: 'Быстро' });
const PARTS = ['#profile-vpn', '#profile-tabs', '#profile-login', '#profile-create', '#profile-recover', '#profile-me', '#profile-password',
  '#profile-code', '#profile-delete'];
const PASSWORD_FIELDS = ['#profile-login-pass', '#profile-new-pass', '#profile-new-pass2', '#profile-recover-pass',
  '#profile-recover-pass2', '#profile-current-pass', '#profile-change-pass', '#profile-change-pass2', '#profile-delete-pass'];
/** Сколько ждать второго нажатия «Выйти из профиля». */
const LOGOUT_CONFIRM_MS = 5000;

/**
 * @param {object} deps
 * @param {object} deps.settings здесь хранится ник
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 * @param {() => {open: number, total: number}} deps.achievementsSummary
 * @param {() => {playTime: string, streak: number}} [deps.statsBrief] коротко из «Моей статистики»
 * @param {() => void} [deps.onChange] вошли, вышли, создали профиль — обновить остальные экраны
 */
export function createProfileScreen({
  settings, leaderboard, achievementsSummary, statsBrief = () => null, onChange = () => {},
}) {
  let busy = false;
  let statsRequest = 0;
  let logoutArmedUntil = 0;

  /** Вошли в профиль, если им защищён именно текущий ник этого устройства. */
  const isActive = () => {
    const profile = loadProfile();
    return Boolean(profile && settings.playerName && profile.nameKey === nameKey(settings.playerName));
  };

  function status(text, isError = false) {
    const el = $('#profile-status');
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  function only(...ids) {
    for (const id of PARTS) $(id).classList.toggle('hidden', !ids.includes(id));
    // Пока показан код восстановления или смена пароля — без лишних кнопок.
    $('#btn-profile-stats').classList.toggle('hidden', ['#profile-code', '#profile-password', '#profile-delete'].some((id) => ids.includes(id)));
  }

  function clearPasswords() {
    for (const id of PASSWORD_FIELDS) $(id).value = '';
    hidePasswords($('#screen-profile'));
  }

  function resetLogout() {
    logoutArmedUntil = 0;
    $('#profile-logout').textContent = 'Выйти из профиля';
  }

  /** Не вошли: вкладка «Вход» или «Регистрация». */
  function showAuth(tab) {
    $('#profile-title').textContent = 'Профиль';
    const name = settings.playerName;
    $('#profile-state').textContent = name
      ? `Ник «${name}» пока только на этом устройстве. Создайте профиль — и заходите под ним с телефона и компьютера.`
      : 'Войдите, если профиль уже есть, или создайте новый.';
    markActive($('#profile-tabs'), 'tab', tab);
    only('#profile-vpn', '#profile-tabs', tab === 'login' ? '#profile-login' : '#profile-create');
    $('#profile-login-name').value = name;
    $('#profile-new-name').value = name;
  }

  /** Строка лучшего результата: «Классика · Нормально», значок платформы, счёт и место. */
  function recordRow(r) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    const platform = PLATFORM_ICONS[r.platform];
    if (platform) {
      const icon = iconSvg(platform.icon, 'icon platform-icon');
      icon.setAttribute('aria-hidden', 'false');
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', platform.label);
      label.append(icon);
    }
    label.append(`${MODE_LABELS[r.mode] ?? r.mode} · ${SPEED_LABELS[r.speed] ?? r.speed}`);
    const score = document.createElement('b');
    score.textContent = r.score;
    const meta = document.createElement('small');
    meta.textContent = `длина ${r.length} · ${r.place}-е место`;
    li.append(label, score, meta);
    return li;
  }

  function recordsMessage(text) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    $('#profile-records').replaceChildren(li);
  }

  /** Вошли: «Мой профиль». */
  function showMe() {
    const name = settings.playerName;
    $('#profile-title').textContent = 'Мой профиль';
    $('#profile-state').textContent = '';
    $('#profile-me-name').textContent = name;
    const games = Object.values(loadHistory()).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    $('#profile-games').textContent = games;
    const { open, total } = achievementsSummary();
    $('#profile-achievements').textContent = `${open} из ${total}`;
    const brief = statsBrief();
    if (brief) {
      $('#profile-playtime').textContent = brief.playTime;
      $('#profile-streak').textContent = String(brief.streak);
      $('#profile-streak-label').textContent = `${plural(brief.streak, ['день', 'дня', 'дней'])} подряд`;
    }
    resetLogout();
    only('#profile-me');

    const id = ++statsRequest;
    recordsMessage('Загружаем…');
    leaderboard.playerStats(name).then((rows) => {
      if (id !== statsRequest) return;
      if (!rows.length) {
        recordsMessage('Пока нет — сыграйте и отправьте рекорд в общую таблицу.');
        return;
      }
      $('#profile-records').replaceChildren(...rows.map(recordRow));
    }, () => {
      if (id === statsRequest) recordsMessage('Не удалось загрузить — проверьте интернет (из России — с VPN).');
    });
  }

  function showRecover(name) {
    $('#profile-title').textContent = 'Восстановление';
    $('#profile-state').textContent = '';
    only('#profile-vpn', '#profile-recover');
    $('#profile-recover-name').value = name ?? '';
    $('#profile-recover-code').value = '';
  }

  function showPassword() {
    $('#profile-title').textContent = 'Смена пароля';
    $('#profile-state').textContent = '';
    only('#profile-password');
  }

  /** Код восстановления: один раз, пока игрок не подтвердит, что сохранил. */
  function showCode(code) {
    $('#profile-title').textContent = 'Профиль';
    $('#profile-state').textContent = 'Сохраните код восстановления.';
    $('#profile-code-text').textContent = code;
    $('#profile-code-saved').checked = false;
    $('#profile-code-done').disabled = true;
    only('#profile-code');
  }

  /** Открыть экран: вошли — «Мой профиль», нет — вход или регистрация. */
  function render() {
    status('');
    clearPasswords();
    if (isActive()) showMe();
    else showAuth(settings.playerName ? 'register' : 'login');
  }

  /** Обёртка долгих действий: блокирует кнопки и объясняет ожидание. */
  async function run(message, action) {
    if (busy) return;
    busy = true;
    // Глазок у пароля остаётся рабочим: пароль можно посмотреть, пока идёт проверка.
    for (const b of document.querySelectorAll('#screen-profile button:not(.pass-eye)')) b.disabled = true;
    status(message);
    try {
      await action();
    } catch (err) {
      status(serverMessage(err, 'Нет связи с сервером. Если вы в России — включите VPN и попробуйте ещё раз.'), true);
    } finally {
      busy = false;
      for (const b of document.querySelectorAll('#screen-profile button')) b.disabled = false;
      $('#profile-code-done').disabled = !$('#profile-code-saved').checked;
    }
  }

  function checkPasswords(first, second) {
    const problem = passwordProblem(first);
    if (problem) return problem;
    return first === second ? null : 'Пароли не совпадают.';
  }

  /** Профиль теперь на этом устройстве под ником name. */
  function enter(name) {
    setPlayerName(settings, name);
    saveProfile(nameKey(name));
    onChange();
  }

  addPasswordToggles($('#screen-profile'));

  $('#profile-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('button')?.dataset.tab;
    if (!tab) return;
    status('');
    showAuth(tab);
  });

  $('#profile-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanText($('#profile-login-name').value, LIMITS.name);
    const password = $('#profile-login-pass').value;
    if (!name || !password) {
      status('Введите ник и пароль.', true);
      return;
    }
    run('Проверяем пароль…', async () => {
      const key = await deriveLoginKey(password, name);
      await leaderboard.login({ name, device: deviceKey(), key });
      enter(name);
      clearPasswords();
      showMe();
      status(`Вы вошли как «${name}».`);
    });
  });

  $('#profile-create').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanText($('#profile-new-name').value, LIMITS.name);
    if (!name) {
      status('Введите ник.', true);
      return;
    }
    const problem = checkPasswords($('#profile-new-pass').value, $('#profile-new-pass2').value);
    if (problem) {
      status(problem, true);
      return;
    }
    if (!$('#profile-consent').checked) {
      status('Отметьте согласие с политикой конфиденциальности.', true);
      return;
    }
    const password = $('#profile-new-pass').value;
    run('Создаём профиль…', async () => {
      const key = await deriveLoginKey(password, name);
      const { recoveryCode } = await leaderboard.createProfile({ name, device: deviceKey(), key });
      enter(name);
      clearPasswords();
      status('');
      showCode(recoveryCode);
    });
  });

  $('#profile-forgot').addEventListener('click', () => {
    status('');
    showRecover(cleanText($('#profile-login-name').value, LIMITS.name));
  });

  $('#profile-recover-cancel').addEventListener('click', () => {
    status('');
    if (isActive()) showMe();
    else showAuth('login');
  });

  $('#profile-recover').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanText($('#profile-recover-name').value, LIMITS.name);
    const code = $('#profile-recover-code').value;
    if (!name) {
      status('Введите ник.', true);
      return;
    }
    if (!isRecoveryCode(code)) {
      status('Код восстановления — четыре группы по пять знаков: XXXXX-XXXXX-XXXXX-XXXXX.', true);
      return;
    }
    const problem = checkPasswords($('#profile-recover-pass').value, $('#profile-recover-pass2').value);
    if (problem) {
      status(problem, true);
      return;
    }
    const password = $('#profile-recover-pass').value;
    run('Задаём новый пароль…', async () => {
      const key = await deriveLoginKey(password, name);
      const { recoveryCode } = await leaderboard.recover({
        name, device: deviceKey(), code: normalizeRecoveryCode(code), key,
      });
      enter(name);
      clearPasswords();
      status('');
      showCode(recoveryCode);
    });
  });

  $('#profile-change-open').addEventListener('click', () => {
    status('');
    clearPasswords();
    showPassword();
  });

  $('#profile-change-cancel').addEventListener('click', () => {
    status('');
    clearPasswords();
    showMe();
  });

  $('#profile-change-forgot').addEventListener('click', () => {
    status('');
    clearPasswords();
    showRecover(settings.playerName);
  });

  $('#profile-password').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = settings.playerName;
    const current = $('#profile-current-pass').value;
    if (!current) {
      status('Введите текущий пароль.', true);
      return;
    }
    const problem = checkPasswords($('#profile-change-pass').value, $('#profile-change-pass2').value);
    if (problem) {
      status(problem, true);
      return;
    }
    const next = $('#profile-change-pass').value;
    run('Меняем пароль…', async () => {
      const [key, newKey] = await Promise.all([deriveLoginKey(current, name), deriveLoginKey(next, name)]);
      await leaderboard.changePassword({
        name, device: deviceKey(), key, newKey,
      });
      clearPasswords();
      showMe();
      status('Пароль изменён.');
    });
  });

  $('#profile-logout').addEventListener('click', () => {
    if (Date.now() > logoutArmedUntil) {
      // Первое нажатие — только предупреждение: выйти случайно было бы обидно.
      logoutArmedUntil = Date.now() + LOGOUT_CONFIRM_MS;
      $('#profile-logout').textContent = 'Точно выйти? Нажмите ещё раз';
      status('После выхода войти снова можно по нику и паролю. Попытки и достижения на устройстве останутся.');
      return;
    }
    const name = settings.playerName;
    logoutProfile(settings);
    onChange();
    resetLogout();
    showAuth('login');
    $('#profile-login-name').value = name;
    status(`Вы вышли из профиля «${name}».`);
  });

  $('#profile-delete-open').addEventListener('click', () => {
    status('');
    clearPasswords();
    $('#profile-title').textContent = 'Удаление профиля';
    $('#profile-state').textContent = '';
    only('#profile-delete');
    $('#profile-delete-pass').focus();
  });

  $('#profile-delete-cancel').addEventListener('click', () => {
    clearPasswords();
    status('');
    showMe();
  });

  $('#profile-delete').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = settings.playerName;
    const password = $('#profile-delete-pass').value;
    if (!password) {
      status('Введите пароль.', true);
      return;
    }
    run('Удаляем профиль…', async () => {
      const key = await deriveLoginKey(password, name);
      await leaderboard.deleteProfile({ name, device: deviceKey(), key });
      clearPasswords();
      // На этом устройстве профиль больше не нужен: выходим, как по кнопке «Выйти».
      logoutProfile(settings);
      onChange();
      showAuth('register');
      status(`Профиль «${name}» и его данные на сервере удалены.`);
    });
  });

  $('#profile-code-copy').addEventListener('click', async () => {
    const code = $('#profile-code-text').textContent;
    try {
      await navigator.clipboard.writeText(code);
      status('Код скопирован. Вставьте его в заметки.');
    } catch {
      status('Не удалось скопировать — выделите код и скопируйте вручную.', true);
    }
  });

  $('#profile-code-saved').addEventListener('change', (e) => {
    $('#profile-code-done').disabled = !e.target.checked;
  });

  $('#profile-code-done').addEventListener('click', () => {
    $('#profile-code-text').textContent = '';
    showMe();
    status('Профиль защищён паролем.');
  });

  return {
    render,
    /** Короткая строка для экрана настроек. */
    summary() {
      if (isActive()) return `Вы вошли как «${settings.playerName}».`;
      return settings.playerName ? 'Ник только на этом устройстве.' : 'Вы не вошли в профиль.';
    },
    /** Подпись кнопки в меню. */
    menuLabel() {
      return isActive() ? `Профиль · ${settings.playerName}` : 'Войти или создать профиль';
    },
    /** Идёт показ кода восстановления: уйти с экрана, не сохранив код, нельзя. */
    get showingCode() { return !$('#profile-code').classList.contains('hidden'); },
  };
}
