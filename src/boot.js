/**
 * Точка входа страницы: сначала проверяем, умеет ли браузер 3D (WebGL), и только
 * потом загружаем игру. Без проверки игра на таком браузере падала при создании
 * сцены, и человек видел меню с кнопками, которые ничего не делают.
 */

// Браузер присылает beforeinstallprompt один раз и сразу, как сайт признан устанавливаемым — это бывает
// раньше, чем загрузится игра (3D-библиотека тянется по сети). Ловим событие здесь, в самом начале,
// и отдаём кнопке «Установить как приложение» (setupInstall в pwa.js); иначе оно терялось.
globalThis.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // своя кнопка в меню вместо баннера браузера поверх игры
  globalThis.__installPrompt = e;
});

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Вступление (src/ui/intro.js). Новому игроку: «Нажми, чтобы начать» → заставка → обложка → обучение.
 * Вернувшемуся: сразу обложка, нажатие — в меню. Игра грузится позади; main.js ждёт ответ
 * в globalThis.__snakeIntro. Не показываем в автотестах (?e2e) и по ссылке-приглашению (?room).
 * Для проверки: ?intro — вступление новичка всегда, ?intro=fast — его короткая версия,
 * ?intro=back — обложка вернувшегося.
 */
async function startIntro() {
  const params = new URLSearchParams(globalThis.location.search);
  const forced = params.get('intro');
  if (forced === null && (params.has('e2e') || params.has('room'))) return;
  const { isNewPlayer } = await import('./storage.js');
  const returning = forced === null ? !isNewPlayer() : forced === 'back';
  const { playIntro } = await import('./ui/intro.js');
  globalThis.__snakeIntro = playIntro({ fast: forced === 'fast', returning });
}

if (webglAvailable()) {
  await startIntro();
  await import('./main.js');
} else {
  for (const screen of document.querySelectorAll('.screen')) screen.classList.add('hidden');
  document.querySelector('#screen-no3d').classList.remove('hidden');
}
