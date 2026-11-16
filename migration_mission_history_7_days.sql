-- STAR UP! Mission history retention window support
-- Track the actual time a teacher closes a mission so the 7-day history
-- can include older missions that were closed recently.
alter table public.missions
  add column if not exists closed_at timestamptz;

create index if not exists missions_room_closed_at_idx
  on public.missions(classroom_id, closed_at desc);
