-- STAR UP! Reward Library: reusable reward templates for each teacher account.
-- Existing public.reward_items are not modified; rewards copied from the library become room-specific items.
create table if not exists public.reward_library (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '',
  emoji text not null default '🎁',
  cost integer not null check (cost between 1 and 1000000),
  stock integer not null default 1 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reward_library_teacher_created_idx
  on public.reward_library (teacher_id, created_at desc);

alter table public.reward_library enable row level security;

drop policy if exists reward_library_select_own on public.reward_library;
create policy reward_library_select_own
  on public.reward_library for select to authenticated
  using (teacher_id = auth.uid());

drop policy if exists reward_library_insert_own on public.reward_library;
create policy reward_library_insert_own
  on public.reward_library for insert to authenticated
  with check (teacher_id = auth.uid());

drop policy if exists reward_library_update_own on public.reward_library;
create policy reward_library_update_own
  on public.reward_library for update to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists reward_library_delete_own on public.reward_library;
create policy reward_library_delete_own
  on public.reward_library for delete to authenticated
  using (teacher_id = auth.uid());

grant select, insert, update, delete on public.reward_library to authenticated;

create or replace function public.reward_library_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reward_library_updated_at on public.reward_library;
create trigger reward_library_updated_at
before update on public.reward_library
for each row execute function public.reward_library_set_updated_at();
