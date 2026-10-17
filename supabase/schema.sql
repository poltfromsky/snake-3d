-- «Изгиб Питона 3D»: общая таблица рекордов и отзывы тестировщиков.
--
-- Выполнить один раз в Supabase: SQL Editor → New query → вставить → Run.
--
-- Безопасность. Игра обращается к базе с публичным anon-ключом — он виден
-- любому в коде страницы, так задумано в Supabase. Поэтому права задаются
-- политиками RLS прямо в базе:
--   * рекорды: любой может читать и добавлять, но не менять и не удалять;
--   * отзывы: любой может добавить, а читать — только владелец проекта
--     (в панели Supabase). Чужие отзывы через игру не видны.
-- Ограничения CHECK отсекают мусор: длинные имена, огромные очки, пустые отзывы.

create table if not exists public.records (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null check (char_length(btrim(name)) between 1 and 16),
  mode text not null check (mode in ('classic', 'walls', 'timed')),
  score integer not null check (score between 1 and 5000),
  length integer not null check (length between 1 and 600),
  comment text check (comment is null or char_length(comment) <= 200)
);

create index if not exists records_mode_score_idx on public.records (mode, score desc);

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text check (name is null or char_length(name) <= 32),
  rating smallint check (rating is null or rating between 1 and 5),
  message text not null check (char_length(btrim(message)) between 3 and 1000),
  app_version text check (app_version is null or char_length(app_version) <= 20)
);

alter table public.records enable row level security;
alter table public.feedback enable row level security;

drop policy if exists "records are public" on public.records;
create policy "records are public" on public.records
  for select to anon using (true);

drop policy if exists "anyone can add a record" on public.records;
create policy "anyone can add a record" on public.records
  for insert to anon with check (true);

drop policy if exists "anyone can leave feedback" on public.feedback;
create policy "anyone can leave feedback" on public.feedback
  for insert to anon with check (true);

-- Политик update/delete нет — значит, через anon-ключ менять и удалять нельзя.
-- Политики select для feedback нет — значит, отзывы читает только владелец.

grant select, insert on public.records to anon;
grant insert on public.feedback to anon;
