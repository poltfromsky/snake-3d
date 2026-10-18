-- Защита общей таблицы: ник принадлежит устройству, результат — только из настоящей партии.
--
-- nicks — кому принадлежит ник: owner_hash — хэш секретного ключа устройства (сам ключ
--         хранится только на устройстве игрока), client_hash — хэш IP с солью (для лимита
--         новых ников, сам IP не хранится).
-- runs  — билеты партий: выдаются при старте одиночной игры, по билету можно отправить
--         ровно один результат. По времени выдачи сервер проверяет, что счёт правдоподобен.
--         Билеты старше суток сервер удаляет сам: это служебные записи без данных игрока.

CREATE TABLE IF NOT EXISTS nicks (
  name_key TEXT PRIMARY KEY CHECK (length(name_key) BETWEEN 1 AND 16),
  owner_hash TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS nicks_owner_time ON nicks (owner_hash, created_at);
CREATE INDEX IF NOT EXISTS nicks_client_time ON nicks (client_hash, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('classic', 'walls', 'timed')),
  client_hash TEXT NOT NULL,
  issued_ms INTEGER NOT NULL,
  used_ms INTEGER
);

CREATE INDEX IF NOT EXISTS runs_client_time ON runs (client_hash, issued_ms);
CREATE INDEX IF NOT EXISTS runs_issued ON runs (issued_ms);
