-- Общая таблица рекордов и отзывы тестировщиков (Cloudflare D1, SQLite).
-- Применяется командой: npx wrangler d1 migrations apply izgib-pitona-db --remote
--
-- client_hash — хэш IP с солью для защиты от спама; сам IP не хранится.
-- CHECK дублируют проверки сервера на случай ошибки в коде.

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 16),
  mode TEXT NOT NULL CHECK (mode IN ('classic', 'walls', 'timed')),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5000),
  length INTEGER NOT NULL CHECK (length BETWEEN 1 AND 600),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 200),
  client_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS records_mode_score ON records (mode, score DESC);
CREATE INDEX IF NOT EXISTS records_client_time ON records (client_hash, created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT CHECK (name IS NULL OR length(name) <= 32),
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 3 AND 1000),
  app_version TEXT CHECK (app_version IS NULL OR length(app_version) <= 20),
  client_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_client_time ON feedback (client_hash, created_at);
