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
 * iPhone или iPad. На iPad в режиме «как на компьютере» Safari называет себя Mac,
 * поэтому дополнительно смотрим на сенсорный экран.
 */
export function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
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
