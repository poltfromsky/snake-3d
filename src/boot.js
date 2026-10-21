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

if (webglAvailable()) {
  await import('./main.js');
} else {
  for (const screen of document.querySelectorAll('.screen')) screen.classList.add('hidden');
  document.querySelector('#screen-no3d').classList.remove('hidden');
}
