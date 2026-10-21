-- Личная статистика профиля: партии игрока со всех его устройств (src/core/stats.js).
--
-- Пишут и читают только устройства, вошедшие в профиль этого ника (nicks / nick_devices),
-- и только при наличии профиля (accounts). В записи — цифры партии: ни IP, ни ключа устройства.
-- На профиль — не больше 1000 последних партий (лишние старые удаляет сервер при записи).
-- Игрок может удалить свою статистику с сервера сам (POST /api/stats/delete).
--
-- seq     — порядковый номер записи: по нему устройство догружает только новое («с seq»).
-- game_id — id партии с устройства: повторная отправка не создаёт дублей.
--
-- stats_meta.epoch — «поколение» статистики профиля: растёт, когда игрок удаляет её. Устройство,
-- увидев новое поколение, стирает у себя старые партии профиля — удаление доходит до всех устройств.
--
-- Миграция только добавляет таблицы, ничего не удаляет.

CREATE TABLE IF NOT EXISTS game_stats (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  name_key TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 16),
  game_id TEXT NOT NULL CHECK (length(game_id) BETWEEN 8 AND 64),
  at_ms INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('solo', 'bot', 'online')),
  mode TEXT CHECK (mode IS NULL OR mode IN ('classic', 'walls', 'timed')),
  speed TEXT CHECK (speed IS NULL OR speed IN ('slow', 'normal', 'fast')),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 5000),
  length INTEGER CHECK (length IS NULL OR length BETWEEN 1 AND 600),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 86400000),
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('wall', 'self', 'stone', 'poison', 'rival', 'headOn', 'time')),
  result TEXT CHECK (result IS NULL OR result IN ('win', 'loss', 'draw')),
  level TEXT CHECK (level IS NULL OR level IN ('easy', 'medium', 'hard', 'claude')),
  platform TEXT CHECK (platform IS NULL OR platform IN ('pc', 'touch', 'buttons')),
  apples INTEGER CHECK (apples IS NULL OR apples BETWEEN 0 AND 1000),
  bonus_slow INTEGER NOT NULL DEFAULT 0 CHECK (bonus_slow BETWEEN 0 AND 1000),
  bonus_ghost INTEGER NOT NULL DEFAULT 0 CHECK (bonus_ghost BETWEEN 0 AND 1000),
  bonus_bad INTEGER NOT NULL DEFAULT 0 CHECK (bonus_bad BETWEEN 0 AND 1000),
  legacy INTEGER NOT NULL DEFAULT 0 CHECK (legacy IN (0, 1)),
  received_ms INTEGER NOT NULL,
  UNIQUE (name_key, game_id)
);

CREATE INDEX IF NOT EXISTS game_stats_owner_seq ON game_stats (name_key, seq);
CREATE INDEX IF NOT EXISTS game_stats_owner_at ON game_stats (name_key, at_ms);
CREATE INDEX IF NOT EXISTS game_stats_owner_received ON game_stats (name_key, received_ms);
CREATE INDEX IF NOT EXISTS game_stats_bots ON game_stats (kind, level, name_key);

CREATE TABLE IF NOT EXISTS stats_meta (
  name_key TEXT PRIMARY KEY CHECK (length(name_key) BETWEEN 1 AND 16),
  epoch INTEGER NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  reset_ms INTEGER
);
