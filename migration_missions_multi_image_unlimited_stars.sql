-- STAR UP! patch: allow >100 mission stars and up to 4 evidence images per submission.
-- Run this ONCE in Supabase SQL Editor after the existing migration_missions.sql.

-- Remove the old generated 1..100 check and retain a positive integer check.
alter table public.missions drop constraint if exists missions_reward_stars_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.missions'::regclass
      and conname='missions_reward_stars_min_check'
  ) then
    alter table public.missions
      add constraint missions_reward_stars_min_check check (reward_stars >= 1);
  end if;
end $$;

-- image_path stores one or more Storage object paths separated by |.
-- Keep the existing single-image rows valid and allow teachers to read every attached image.
drop policy if exists mission_evidence_teacher_read on storage.objects;
create policy mission_evidence_teacher_read on storage.objects
for select to authenticated using (
  bucket_id='mission-evidence'
  and exists (
    select 1 from public.mission_submissions q
    where name = any(string_to_array(q.image_path, '|'))
      and public.is_member(q.classroom_id)
  )
);

-- Existing bucket limits are per file. Keep each optimized image below 5 MB.
update storage.buckets
set public=false, file_size_limit=5242880,
    allowed_mime_types=array['image/jpeg','image/png','image/webp']
where id='mission-evidence';
