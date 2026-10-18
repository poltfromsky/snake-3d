-- Одна строка на ник в каждом режиме: общая таблица показывает только лучший результат игрока.
-- name_key — ник без учёта регистра («Polt» и «polt» — один игрок). Новые записи получают
-- его от сервера (toLowerCase понимает и кириллицу).
--
-- Миграция ничего не удаляет: старые записи остаются как есть, им только проставляется
-- ключ. SQLite lower() знает лишь латиницу, поэтому у старых кириллических ников регистр
-- может остаться — это не страшно: таблица выбирает лучшую строку запросом.

ALTER TABLE records ADD COLUMN name_key TEXT;

UPDATE records SET name_key = lower(trim(name)) WHERE name_key IS NULL;

CREATE INDEX IF NOT EXISTS records_mode_key_score ON records (mode, name_key, score DESC);
