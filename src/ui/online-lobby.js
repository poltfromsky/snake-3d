/**
 * Экран «Игра по сети»: создать комнату, войти по коду или ссылке, статус подключения.
 * Когда сервер принял игрока, отдаёт соединение приложению (onJoined).
 */
import { createRoom, normalizeRoomCode, RoomConnection, roomLink } from '../net/online.js';
import { $ } from './dom.js';

/**
 * Колбэки получают соединение, от которого пришло событие: приложение
 * сверяет его с текущим и не путает старую комнату с новой.
 * @param {object} deps
 * @param {string} deps.apiBase адрес игрового сервера
 * @param {object} deps.settings режим и скорость создателя комнаты
 * @param {(connection: RoomConnection, joined: {slot: number}) => void} deps.onJoined
 * @param {(msg: object, connection: RoomConnection) => void} deps.onMessage сообщения сервера
 * @param {(connection: RoomConnection) => void} deps.onClose связь оборвалась (своё закрытие сюда не попадает)
 */
export function createOnlineLobby({ apiBase, settings, onJoined, onMessage, onClose }) {
  function status(text, isError = false) {
    const el = $('#online-status');
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  function busy(selector, on, busyText, idleText) {
    const button = $(selector);
    button.disabled = on;
    button.textContent = on ? busyText : idleText;
  }

  /** Сбросить экран к выбору «создать / войти». */
  function reset() {
    $('#online-start').classList.remove('hidden');
    $('#online-room').classList.add('hidden');
    status('');
  }

  async function connect(code) {
    const connection = new RoomConnection(apiBase, code, {
      onMessage: (msg) => onMessage(msg, connection),
      onClose: () => onClose(connection),
    });
    try {
      onJoined(connection, await connection.connect());
    } catch (err) {
      connection.close();
      throw err;
    }
  }

  async function create() {
    busy('[data-action="create-room"]', true, 'Создаём…', 'Создать комнату');
    status('Создаём комнату…');
    try {
      const code = await createRoom(apiBase, { mode: settings.mode, speed: settings.speed });
      await connect(code);
      $('#online-start').classList.add('hidden');
      $('#online-room').classList.remove('hidden');
      $('#room-link').value = roomLink(code);
      $('#room-code').textContent = code;
      status('Ждём друга… Отправьте ему ссылку.');
    } catch (err) {
      status(err?.message || 'Не удалось создать комнату.', true);
    } finally {
      busy('[data-action="create-room"]', false, '', 'Создать комнату');
    }
  }

  async function join(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (code.length < 4) {
      status('Введите код комнаты из ссылки друга.', true);
      return;
    }
    busy('#join-form button[type=submit]', true, 'Подключаемся…', 'Войти');
    status(`Подключаемся к комнате ${code}…`);
    try {
      await connect(code);
      status('Подключено! Начинаем…');
    } catch (err) {
      status(err?.message || 'Не удалось подключиться.', true);
    } finally {
      busy('#join-form button[type=submit]', false, '', 'Войти');
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText($('#room-link').value);
      status('Ссылка скопирована — отправьте её другу. Ждём…');
    } catch {
      $('#room-link').select();
      status('Скопируйте ссылку вручную (Ctrl+C).');
    }
  }

  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    join($('#join-code').value);
  });

  /** Пришли по ссылке друга: подставить код и сразу подключиться. */
  function joinInvite(code) {
    $('#join-code').value = normalizeRoomCode(code);
    join(code);
  }

  return { reset, status, create, joinInvite, copyLink };
}
