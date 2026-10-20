-- Общая таблица по скоростям и значок платформы у рекорда.
--
-- speed    — скорость партии (Медленно / Нормально / Быстро): у каждой своя вкладка таблицы,
--            у ника своя лучшая строка на каждой скорости. Старые записи скорость не знали —
--            они попадают в «normal» (скорость по умолчанию).
-- platform — чем играли: клавиатура, свайпы или кнопки на экране; только для значка у ника.
--
-- Миграция только добавляет столбцы и индекс, ничего не удаляет.

ALTER TABLE records ADD COLUMN speed TEXT NOT NULL DEFAULT 'normal' CHECK (speed IN ('slow', 'normal', 'fast'));
ALTER TABLE records ADD COLUMN platform TEXT CHECK (platform IS NULL OR platform IN ('pc', 'touch', 'buttons'));

CREATE INDEX IF NOT EXISTS records_mode_speed_key_score ON records (mode, speed, name_key, score DESC);
