/**
 * Экран «Профиль»: защитить ник паролем, войти под своим ником с другого устройства,
 * восстановить доступ по коду. Пароль никуда не отправляется: браузер превращает его
 * в ключ входа (src/core/auth.js, ~0,5 с), и на сервер уходит только он.
 *
 * Профиль необязателен: без него ник просто принадлежит этому устройству, как раньше.
 */
import {
  deriveLoginKey, isRecoveryCode, normalizeRecoveryCode, passwordProblem,
} from '../core/auth.js';
import { cleanText, LIMITS, nameKey } from '../core/validate.js';
import {
  deviceKey, loadProfile, saveProfile, setPlayerName,
} from '../storage.js';
import { $, serverMessage } from './dom.js';

/**
 * @param {object} deps
 * @param {object} deps.settings здесь хранится ник
 * @param {import('../net/leaderboard.js').Leaderboard} deps.leaderboard
 * @param {() => void} [deps.onChange] профиль создан или выполнен вход — обновить остальные экраны
 */
export function createProfileScreen({ settings, leaderboard, onChange = () => {} }) {
  let busy = false;

  /** Профиль включён, если им защищён именно текущий ник этого устройства. */
  const isActive = () => {
    const profile = loadProfile();
    return Boolean(profile && settings.playerName && profile.nameKey === nameKey(settings.playerName));
  };

  function status(text, isError = false) {
    const el = $('#profile-status');
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  const forms = ['#profile-create', '#profile-login', '#profile-recover', '#profile-code'];
  function showOnly(...ids) {
    for (const id of forms) $(id).classList.toggle('hidden', !ids.includes(id));
  }

  /** Что показать: профиль уже есть / можно создать / можно только войти. */
  function render() {
    status('');
    const name = settings.playerName;
    if (isActive()) {
      $('#profile-state').textContent = `Ник «${name}» защищён паролем: им можно пользоваться на других устройствах.`;
      showOnly('#profile-recover');
      $('#profile-recover-name').value = name;
    } else if (name) {
      $('#profile-state').textContent = `Ник «${name}» пока принадлежит только этому устройству.`;
      showOnly('#profile-create', '#profile-login');
      $('#profile-login-name').value = name;
    } else {
      $('#profile-state').textContent = 'Чтобы защитить ник паролем, сначала введите его в настройках. Если ник уже есть на другом устройстве — войдите:';
      showOnly('#profile-login');
      $('#profile-login-name').value = '';
    }
    for (const id of ['#profile-new-pass', '#profile-new-pass2', '#profile-login-pass', '#profile-recover-pass', '#profile-recover-pass2']) {
      $(id).value = '';
    }
    $('#profile-recover-code').value = '';
  }

  /** Обёртка долгих действий: блокирует кнопки и объясняет ожидание. */
  async function run(message, action) {
    if (busy) return;
    busy = true;
    for (const b of document.querySelectorAll('#screen-profile button')) b.disabled = true;
    status(message);
    try {
      await action();
    } catch (err) {
      status(serverMessage(err, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'), true);
    } finally {
      busy = false;
      for (const b of document.querySelectorAll('#screen-profile button')) b.disabled = false;
      $('#profile-code-done').disabled = !$('#profile-code-saved').checked;
    }
  }

  /** Показать код восстановления: один раз, пока игрок не подтвердит, что сохранил. */
  function showCode(code) {
    $('#profile-code-text').textContent = code;
    $('#profile-code-saved').checked = false;
    $('#profile-code-done').disabled = true;
    showOnly('#profile-code');
    $('#profile-state').textContent = 'Профиль готов. Сохраните код восстановления.';
    status('');
  }

  function checkPasswords(first, second) {
    const problem = passwordProblem(first);
    if (problem) return problem;
    return first === second ? null : 'Пароли не совпадают.';
  }

  $('#profile-create').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = settings.playerName;
    const problem = checkPasswords($('#profile-new-pass').value, $('#profile-new-pass2').value);
    if (problem) {
      status(problem, true);
      return;
    }
    const password = $('#profile-new-pass').value;
    run('Защищаем пароль…', async () => {
      const key = await deriveLoginKey(password, name);
      const { recoveryCode } = await leaderboard.createProfile({ name, device: deviceKey(), key });
      saveProfile(nameKey(name));
      onChange();
      showCode(recoveryCode);
    });
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
      setPlayerName(settings, name);
      saveProfile(nameKey(name));
      onChange();
      render();
      status(`Вы вошли как «${name}». Рекорды в общей таблице теперь пишутся под этим ником.`);
    });
  });

  $('#profile-forgot').addEventListener('click', () => {
    showOnly('#profile-recover');
    $('#profile-recover-name').value = $('#profile-login-name').value;
    status('');
  });

  $('#profile-recover-cancel').addEventListener('click', render);

  $('#profile-recover').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanText($('#profile-recover-name').value, LIMITS.name);
    const code = $('#profile-recover-code').value;
    const problem = checkPasswords($('#profile-recover-pass').value, $('#profile-recover-pass2').value);
    if (!name) {
      status('Введите ник.', true);
      return;
    }
    if (!isRecoveryCode(code)) {
      status('Код восстановления — четыре группы по пять знаков: XXXXX-XXXXX-XXXXX-XXXXX.', true);
      return;
    }
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
      setPlayerName(settings, name);
      saveProfile(nameKey(name));
      onChange();
      showCode(recoveryCode);
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
    render();
    status('Профиль защищён паролем.');
  });

  return {
    render,
    /** Короткая строка для экрана настроек. */
    summary() {
      if (isActive()) return 'Ник защищён паролем.';
      return settings.playerName ? 'Ник только на этом устройстве.' : 'Ника пока нет.';
    },
    /** Идёт показ кода восстановления: уйти с экрана, не сохранив код, нельзя. */
    get showingCode() { return !$('#profile-code').classList.contains('hidden'); },
  };
}
