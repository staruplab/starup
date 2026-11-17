-- STAR UP! Personal mission library
-- Run once in Supabase SQL Editor after the existing STAR UP migrations.
create table if not exists public.mission_library (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '',
  category text not null default 'ภารกิจทั่วไป',
  reward_stars integer not null default 1 check (reward_stars >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, title)
);
create index if not exists mission_library_teacher_idx on public.mission_library(teacher_id, updated_at desc);
alter table public.mission_library enable row level security;
drop policy if exists mission_library_owner_all on public.mission_library;
create policy mission_library_owner_all on public.mission_library for all to authenticated
using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create or replace function public.set_mission_library_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists mission_library_updated_at on public.mission_library;
create trigger mission_library_updated_at before update on public.mission_library
for each row execute function public.set_mission_library_updated_at();
