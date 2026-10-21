# Благодарности и лицензии

## Библиотеки

- [Three.js](https://threejs.org) r170 — MIT License. Загружается с CDN jsDelivr.
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — Apache-2.0 / MIT. Инструмент Cloudflare для запуска и выкладки сервера (только для разработки, в игру не входит).
- Шрифты [Unbounded](https://fonts.google.com/specimen/Unbounded) и [Inter](https://fonts.google.com/specimen/Inter) — SIL Open Font License. Загружаются с Google Fonts.

## Иконки

- [Phosphor Icons](https://phosphoricons.com) 2.1.1 (пакет `@phosphor-icons/core`, толщина bold) — MIT License, Copyright (c) 2023 Phosphor Icons. Иконки встроены в `src/ui/icons.js` скриптом `tools/build-icons.mjs`; текст лицензии — в шапке этого файла. Пакет нужен только для сборки, в игру не загружается.
- Значок приложения и медали достижений нарисованы 3D-рендером самой игры (`tools/render-art.mjs`, сцены в `tools/art/scenes.js`).

## Звук

- Звуковые эффекты синтезируются в коде (Web Audio API), файлы не используются.

## Музыка

Оба трека пережаты в MP3 112 кбит/с (ffmpeg), метаданные удалены. Сама музыка не изменялась.

"Pixelland" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/
Файл: `assets/music/pixelland.mp3`

"Itty Bitty 8 Bit" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/
Файл: `assets/music/itty_bitty_8_bit.mp3`

Исходные файлы скачаны 2026-10-17 с https://incompetech.com/music/royalty-free/mp3-royaltyfree/.
SHA-256 оригиналов:
- Pixelland.mp3 — `889fd6f06fd077689d512d4169a0efc4a61b717af73ac64ecca361eb5a4c4b7d`
- Itty Bitty 8 Bit.mp3 — `abae7e4d020499466e3840643385c8ec608ba7bb8b62b16e1d9d7bda5e622416`
