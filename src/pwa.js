/**
 * Игра как приложение (PWA): установка на экран «Домой» и обновления.
 *
 * Service worker (sw.js) хранит файлы игры в телефоне: она открывается мгновенно
 * и работает без интернета (одиночная игра и боты). Новая версия скачивается
 * в фоне целиком и включается только по кнопке «Обновить» — старые и новые файлы
 * никогда не смешиваются, и не нужно чистить кэш браузера.
 */
import { installKind, isStandalone } from './ui/device.js';

const UPDATE_EVERY_MS = 15 * 60 * 1000;

/**
 * @param {object} hooks
 * @param {() => void} hooks.onUpdateReady новая версия скачана и ждёт включения
 * @param {boolean} [hooks.enabled] регистрировать ли service worker
 * @returns {{applyUpdate(): void, checkNow(): Promise<string>}}
 */
export function registerServiceWorker({ onUpdateReady, enabled = true }) {
  let waiting = null;
  let registered = null; // Promise<ServiceWorkerRegistration | null>
  let hasWorker = false;
  const api = {
    /**
     * Включить скачанную версию: страница перезагрузится уже с ней.
     * Без service worker (старый браузер) — просто перезагрузить страницу: файлы возьмутся с сайта.
     */
    applyUpdate() {
      if (!waiting) {
        if (!hasWorker) window.location.reload();
        return;
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
    },
    /**
     * Проверить обновление сейчас (кнопка «Проверить обновления»).
     * 'ready' — новая версия скачана и ждёт кнопки «Обновить»; 'downloading' — нашлась и качается
     * (когда докачается, придёт onUpdateReady); 'none' — на сайте ничего нового (или сайт ещё
     * отдаёт старый sw.js из своего кэша); 'unsupported' — service worker не работает.
     */
    async checkNow() {
      const registration = await registered;
      if (!registration) return 'unsupported';
      if (waiting) return 'ready';
      try {
        await registration.update();
      } catch {
        return 'none';
      }
      if (registration.waiting && updatable) {
        notify(registration.waiting);
        return 'ready';
      }
      return registration.installing ? 'downloading' : 'none';
    },
  };
  if (!enabled || !('serviceWorker' in navigator)) return api;
  // Обновление — это когда страница уже работает под прошлой версией приложения.
  // Первая установка — не обновление: без этой проверки Safari успевал подключить
  // service worker раньше, чем страница узнавала об установке, и показывал плашку зря.
  const updatable = Boolean(navigator.serviceWorker.controller);

  const notify = (worker) => {
    waiting = worker;
    onUpdateReady();
  };

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      hasWorker = true;
      resolveRegistered(registration);
      // Уже скачанная версия ждёт с прошлого раза.
      if (registration.waiting && updatable) notify(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && updatable) notify(worker);
        });
      });
      // Сторонние файлы (Three.js, шрифты) страница уже загрузила — пусть service worker
      // сохранит их, тогда игра откроется без интернета уже со второго раза.
      const ready = await navigator.serviceWorker.ready;
      const vendor = performance.getEntriesByType('resource').map((e) => e.name)
        .filter((url) => !url.startsWith(window.location.origin));
      ready.active?.postMessage({ type: 'CACHE_VENDOR', urls: vendor });
      // Приложение на телефоне могут не закрывать днями — проверяем обновления при возвращении в него.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
      // И пока игра открыта — раз в 15 минут: сайт отдаёт новый sw.js не сразу после выкладки
      // (свой кэш у хостинга до 10 минут), поэтому одной проверки при запуске мало.
      setInterval(() => { if (!document.hidden) registration.update().catch(() => {}); }, UPDATE_EVERY_MS);
    } catch {
      // Без service worker игра работает как обычный сайт.
      resolveRegistered(null);
    }
  };
  let resolveRegistered;
  registered = new Promise((resolve) => { resolveRegistered = resolve; });
  // После загрузки страницы, чтобы не отнимать сеть у самой игры. Игра грузится
  // через boot.js и может стартовать уже после события load — тогда сразу.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
  return api;
}

/**
 * Стоит ли игра на этом устройстве как приложение. Браузер отвечает только на вопрос про приложения,
 * перечисленные в манифесте (related_applications), и не везде (Chrome и Edge; Safari и Firefox — нет).
 * Нет ответа — считаем «не знаем», то есть false: игрок увидит обычную инструкцию.
 */
export async function isAppInstalled() {
  try {
    if (!navigator.getInstalledRelatedApps) return false;
    return (await navigator.getInstalledRelatedApps()).length > 0;
  } catch {
    return false;
  }
}

/**
 * Кнопка «Установить как приложение» — видна всегда, пока игра открыта во вкладке браузера.
 * Если браузер дал своё окно установки (Chrome, Edge, Samsung Internet, Яндекс), открываем его.
 * Иначе — инструкция под этот браузер: Safari на iPhone такого окна не даёт вовсе, а Chrome
 * после удаления приложения или отказа в окне надолго перестаёт его предлагать.
 * @param {object} hooks
 * @param {(visible: boolean) => void} hooks.setVisible показать или спрятать кнопку
 * @param {(kind: string) => void} hooks.showHelp открыть инструкцию (вид — installKind())
 * @returns {{install(): Promise<void>}}
 */
export function setupInstall({ setVisible, showHelp }) {
  let deferred = globalThis.__installPrompt ?? null; // поймано в boot.js, пока игра грузилась
  if (isStandalone()) {
    setVisible(false);
    return { install: async () => {} };
  }
  setVisible(true);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    setVisible(false);
  });
  return {
    async install() {
      if (deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
        if (outcome === 'accepted') setVisible(false);
        deferred = null;
      } else {
        showHelp((await isAppInstalled()) ? 'installed' : installKind());
      }
    },
  };
}
