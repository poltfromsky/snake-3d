# Сервер игры (Cloudflare Workers)

Сервер обслуживает онлайн-игру вдвоём и общую таблицу рекордов с отзывами. Работает на бесплатном тарифе Cloudflare и не засыпает без активности.

| Что | Чем сделано | Где код |
|---|---|---|
| HTTP API и маршрутизация | Worker | [`src/index.js`](src/index.js) |
| Онлайн-комнаты на двоих | Durable Object `Room` (одна копия на код комнаты), WebSocket | [`src/room.js`](src/room.js) |
| Правила комнаты: отсчёт, партия, реванш | общий модуль, тестируется в Node | [`../src/core/room.js`](../src/core/room.js) |
| Рекорды и отзывы | база D1 (SQLite) | [`migrations/`](migrations) |

Партию считает **сервер** тем же кодом `src/core/duel.js`, что и локальная игра. Игроки только присылают повороты и получают снимки. Поэтому у обоих одна и та же игра, и ни у кого нет преимущества. Прямое соединение между устройствами не нужно: если открывается обычный сайт, игра заработает.

## API

| Метод | Путь | Что делает |
|---|---|---|
| `POST` | `/api/rooms` | создать комнату `{mode, speed}` → `{code}` |
| `GET` | `/api/rooms/:code/ws` | WebSocket игрока |
| `GET` | `/api/records?mode=classic` | топ-10 режима |
| `POST` | `/api/records` | добавить рекорд `{name, mode, score, length, comment?}` |
| `POST` | `/api/feedback` | отзыв `{message, rating?, name?, version?}` |
| `GET` | `/api/health` | проверка, что сервер жив |

**Защита:** все данные проверяются на сервере (`src/core/validate.js`) и ещё раз ограничениями CHECK в базе. Рекорд можно отправлять не чаще раза в 20 секунд, отзыв не чаще раза в минуту с одного адреса. В базе хранится только хэш IP с секретной солью (`IP_SALT`), сам адрес не хранится. В логи сервера пишется только текст ошибки, без запросов и заголовков. API рекордов принимает запросы только с сайтов из `ALLOWED_ORIGINS` (`wrangler.jsonc`). Комната отбрасывает слишком частые и слишком большие сообщения.

**Ограничение:** браузерная игра не может доказать, что очки честные, поэтому подделать рекорд через API технически можно. Лишние строки удаляются командой из раздела «Отзывы и рекорды».

## Первый запуск

Нужен Node.js 22+ и бесплатный аккаунт Cloudflare.

```bash
cd server
npm install                       # ставит wrangler (инструмент Cloudflare)
npx wrangler login                # вход в Cloudflare через браузер, один раз
npx wrangler d1 create izgib-pitona-db
```

Последняя команда выведет `database_id`. Его нужно вписать в [`wrangler.jsonc`](wrangler.jsonc) вместо нулей. Затем:

```bash
npm run db:remote                 # создать таблицы в облачной базе
npx wrangler secret put IP_SALT   # секретная соль для хэша IP: вставить случайную строку
npm run deploy                    # выложить сервер
```

Случайную строку для соли даёт `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Соль хранится только в Cloudflare: её нельзя коммитить, присылать в чат или менять без причины (при смене старые хэши перестанут совпадать, это не страшно). Без соли сервер отказывается сохранять рекорды и отзывы.

`deploy` выведет адрес вида `https://izgib-pitona.<поддомен>.workers.dev`. Его нужно вписать в `PRODUCTION_API` в [`../src/config.js`](../src/config.js) и выложить сайт.

## Локальная разработка

```bash
cd server
cp .dev.vars.example .dev.vars    # и вписать свою случайную соль; файл в .gitignore
npm run db:local                  # таблицы в локальной базе
npm run dev                       # сервер на http://localhost:8787
npm run test:e2e                  # (в другом терминале) сквозной тест онлайн-комнаты
```

Игра, открытая с `localhost`, сама ходит на `localhost:8787` (см. `src/config.js`). Аккаунт Cloudflare для этого не нужен.

## Отзывы и рекорды

Читать в панели: **Cloudflare → Storage & Databases → D1 → izgib-pitona-db → Console**:

```sql
SELECT created_at, name, rating, message, app_version FROM feedback ORDER BY id DESC;
```

Или из терминала:

```bash
npx wrangler d1 execute izgib-pitona-db --remote --command "SELECT * FROM feedback ORDER BY id DESC LIMIT 20"
```

Удалить фальшивый рекорд: `DELETE FROM records WHERE id = …;`

## Бесплатные лимиты Cloudflare

100 000 запросов в день; около 28 часов активной комнаты в день; база D1 до 5 ГБ. Для игры с друзьями запас огромный. Если лимит кончится, до полуночи по UTC новые комнаты не создадутся, а одиночная игра продолжит работать.
