/** Что за устройство и как с ним обращаться: сенсорный экран, установка, экран без сна. */

/** Сенсорный экран без мыши (телефон, планшет). Ноутбук с тачскрином сюда не попадает. */
export function isTouchDevice() {
  return globalThis.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
}

/** Игра запущена как приложение с экрана «Домой», а не во вкладке браузера. */
export function isStandalone() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
}

/**
 * Как установить игру в этом браузере, если он не показал своё окно установки.
 * ios — Safari на iPhone/iPad (на iPad в режиме «как на компьютере» Safari называет себя Mac —
 * отличаем по сенсорному экрану); android — Chrome, Яндекс, Samsung на Android; firefox-android;
 * desktop — Chrome, Edge, Яндекс, Opera на компьютере; safari-mac — Safari 17+ («Добавить в Dock»);
 * firefox-desktop — Firefox на компьютере (устанавливать сайты не умеет); inapp — браузер внутри Telegram и т. п.
 */
export function installKind(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0) {
  if (/Telegram|FBAN|FBAV|Instagram|VKClient/i.test(ua)) return 'inapp';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return /Firefox/.test(ua) ? 'firefox-android' : 'android';
  if (/Firefox/.test(ua)) return 'firefox-desktop';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|YaBrowser|OPR/.test(ua)) return 'safari-mac';
  return 'desktop';
}

/**
 * Экран не гаснет, пока идёт партия (Screen Wake Lock: Chrome, Safari 16.4+, Firefox 126+).
 * Где не поддерживается — просто ничего не делает. Браузер сам снимает блокировку,
 * когда вкладку сворачивают, поэтому при возвращении её нужно запросить снова.
 */
export class WakeLock {
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wanted) this.acquire();
    });
  }

  set(on) {
    this.wanted = on;
    if (on) this.acquire();
    else this.release();
  }

  async acquire() {
    if (this.sentinel || !navigator.wakeLock) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => { this.sentinel = null; });
    } catch {
      // Отказ (экономия батареи, вкладка в фоне) — не страшно, игра работает и так.
    }
  }

  release() {
    this.sentinel?.release().catch(() => {});
    this.sentinel = null;
  }
}
