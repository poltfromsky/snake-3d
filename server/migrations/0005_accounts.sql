-- Профили игроков: вход по нику и паролю с любого устройства.
--
-- Пароль сервер не видит: браузер растягивает его (PBKDF2) в длинный ключ, а здесь хранится только
-- SHA-256 от этого ключа. Забытый пароль заменяется кодом восстановления, у него тоже хранится
-- только хэш. Профиль необязателен: без него ник по-прежнему принадлежит одному устройству.
--
-- accounts       — профиль ника: проверочный хэш пароля и хэш кода восстановления
-- nick_devices   — устройства, допущенные к нику (кроме того, что занял его первым)
-- auth_attempts  — попытки входа и восстановления: нужны только чтобы ограничить подбор пароля,
--                  старше суток удаляются
--
-- Миграция только добавляет таблицы, ничего не удаляет.

CREATE TABLE IF NOT EXISTS accounts (
  name_key TEXT PRIMARY KEY CHECK (length(name_key) BETWEEN 1 AND 16),
  auth_hash TEXT NOT NULL CHECK (length(auth_hash) = 64),
  recovery_hash TEXT NOT NULL CHECK (length(recovery_hash) = 64),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nick_devices (
  name_key TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 16),
  owner_hash TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (name_key, owner_hash)
);

CREATE INDEX IF NOT EXISTS nick_devices_owner ON nick_devices (owner_hash);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_key TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_attempts_name_time ON auth_attempts (name_key, at_ms);
CREATE INDEX IF NOT EXISTS auth_attempts_client_time ON auth_attempts (client_hash, at_ms);
