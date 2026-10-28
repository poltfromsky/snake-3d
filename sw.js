/**
 * Service worker: хранит файлы игры в телефоне (PWA).
 *
 * Сборка для сайта (CI, tools/stamp-sw.mjs) подставляет VERSION — номер коммита —
 * и PRECACHE — полный список файлов игры. Тогда:
 *   - новая версия скачивается в фоне целиком в свой кэш и включается только
 *     по кнопке «Обновить» — старые и новые файлы не смешиваются;
 *   - игра открывается без интернета (одиночная, боты): всё уже в телефоне.
 * Без подстановки (VERSION = 'dev', локальная разработка) файлы всегда берутся
 * из сети, а кэш нужен только на случай, если сети нет.
 *
 * Не трогаем: запросы к игровому серверу (другой адрес — рекорды, онлайн),
 * музыку (Safari грузит её кусками, Range-запросы из кэша ломают звук) и всё, кроме GET.
 */
const VERSION = 'dev';
const PRECACHE = [];

const CACHE = `snake3d-${VERSION}`;
// Сторонние файлы с версией в адресе (Three.js, шрифты) не меняются — общий кэш на все версии.
const VENDOR_CACHE = 'snake3d-vendor';
const VENDOR_HOSTS = new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const DEV = VERSION === 'dev';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' — мимо HTTP-кэша браузера, чтобы не положить старый файл в новую версию.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    // Первая установка — включаемся сразу; обновление ждёт кнопки «Обновить».
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([CACHE, VENDOR_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('snake3d-') && !keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'SKIP_WAITING') self.skipWaiting();
  // Страница присылает адреса сторонних файлов, которые она уже загрузила, —
  // кладём их в кэш, чтобы игра открылась без интернета уже со второго раза.
  if (msg?.type === 'CACHE_VENDOR' && Array.isArray(msg.urls)) {
    event.waitUntil(cacheVendor(msg.urls));
  }
});

async function cacheVendor(urls) {
  const cache = await caches.open(VENDOR_CACHE);
  for (const url of urls) {
    try {
      if (!VENDOR_HOSTS.has(new URL(url).hostname) || await cache.match(url)) continue;
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (response.ok) await cache.put(url, response);
    } catch {
      // Нет сети — попробуем в другой раз.
    }
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range') || request.destination === 'audio') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    // Список изменений — всегда свежий с сайта: по нему игрок узнаёт, что в новой версии.
    const fresh = DEV || url.pathname.endsWith('/changelog.json');
    event.respondWith(fresh ? networkFirst(request) : fromVersion(request));
  } else if (VENDOR_HOSTS.has(url.hostname)) {
    event.respondWith(vendor(request));
  }
  // Остальное (игровой сервер) — напрямую в сеть, без кэша.
});

/**
 * Игра с любыми параметрами (?room=…, ?e2e) — это всегда index.html.
 * Другие страницы сайта (privacy.html) — сами по себе, без параметров.
 */
function cacheKey(request) {
  if (request.mode !== 'navigate') return request;
  const url = new URL(request.url);
  const page = url.pathname.split('/').pop();
  return new URL(page && page !== 'index.html' ? page : 'index.html', self.registration.scope).href;
}

/** Сайт: файлы этой версии из кэша, недостающие — из сети с сохранением. */
async function fromVersion(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(cacheKey(request));
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(cacheKey(request), response.clone());
  return response;
}

/** Разработка: всегда свежие файлы из сети, кэш — только когда сети нет. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok && response.type === 'basic') cache.put(cacheKey(request), response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(cacheKey(request));
    if (hit) return hit;
    throw err;
  }
}

async function vendor(request) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
