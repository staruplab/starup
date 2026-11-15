-- STAR UP! urgent missions, persistent categories, and teacher self-leave
-- Run once in Supabase SQL Editor after the existing mission migrations.

alter table public.missions
  add column if not exists is_urgent boolean not null default false,
  add column if not exists urgent_until timestamptz,
  add column if not exists alert_seconds integer not null default 10;

alter table public.missions
  drop constraint if exists missions_alert_seconds_check;
alter table public.missions
  add constraint missions_alert_seconds_check check (alert_seconds between 5 and 30);

create table if not exists public.mission_categories (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (classroom_id, name)
);
create index if not exists mission_categories_room_idx
  on public.mission_categories(classroom_id, name);
alter table public.mission_categories enable row level security;
drop policy if exists mission_categories_member_all on public.mission_categories;
create policy mission_categories_member_all on public.mission_categories
  for all to authenticated
  using (public.is_member(classroom_id))
  with check (public.is_member(classroom_id));

-- A teacher may leave a room voluntarily. Owners must transfer ownership first.
create or replace function public.teacher_leave_classroom(p_classroom_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  select role into v_role
  from public.classroom_members
  where classroom_id=p_classroom_id and teacher_id=auth.uid()
  for update;
  if not found then raise exception 'คุณไม่ได้เป็นสมาชิกห้องนี้'; end if;
  if v_role='owner' then
    raise exception 'เจ้าของห้องไม่สามารถออกจากห้องได้ กรุณาโอนสิทธิ์เจ้าของห้องก่อน';
  end if;
  delete from public.classroom_members
  where classroom_id=p_classroom_id and teacher_id=auth.uid();
end $$;
grant execute on function public.teacher_leave_classroom(uuid) to authenticated;

-- Include urgent metadata in the public token-validated student portal.
create or replace function public.get_student_portal(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_stu public.students%rowtype; v_room public.classrooms%rowtype;
begin
  if p_token is null or char_length(p_token)<20 then return null; end if;
  select * into v_stu from public.students where qr_token=p_token and active;
  if not found then return null; end if;
  select * into v_room from public.classrooms where id=v_stu.classroom_id;
  return jsonb_build_object(
    'student',jsonb_build_object('id',v_stu.id,'full_name',v_stu.full_name,'profile_icon',v_stu.profile_icon,'stars',v_stu.stars),
    'classroom',jsonb_build_object('id',v_room.id,'name',v_room.name),
    'rewards',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'description',r.description,'emoji',r.emoji,'cost',r.cost,'stock',r.stock) order by r.cost,r.created_at) from public.reward_items r where r.classroom_id=v_stu.classroom_id and r.active),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'reward_id',q.reward_id,'reward_name',r.name,'emoji',r.emoji,'cost',q.cost,'status',q.status,'teacher_note',q.teacher_note,'created_at',q.created_at) order by q.created_at desc) from public.redemption_requests q join public.reward_items r on r.id=q.reward_id where q.student_id=v_stu.id),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(x) from (select jsonb_build_object('stars_delta',t.stars_delta,'reason',t.reason,'created_at',t.created_at) as x from public.star_transactions t where t.student_id=v_stu.id order by t.created_at desc limit 10) s),'[]'::jsonb),
    'missions',coalesce((select jsonb_agg(jsonb_build_object('id',mi.id,'title',mi.title,'description',mi.description,'category',mi.category,'due_at',mi.due_at,'reward_stars',mi.reward_stars,'is_urgent',mi.is_urgent,'urgent_until',mi.urgent_until,'alert_seconds',mi.alert_seconds) order by mi.is_urgent desc,mi.created_at desc) from public.missions mi where mi.classroom_id=v_stu.classroom_id and mi.active and (mi.due_at is null or mi.due_at>=now())),'[]'::jsonb),
    'mission_submissions',coalesce((select jsonb_agg(jsonb_build_object('id',ms.id,'mission_id',ms.mission_id,'mission_title',mi.title,'status',ms.status,'teacher_note',ms.teacher_note,'created_at',ms.created_at) order by ms.created_at desc) from public.mission_submissions ms join public.missions mi on mi.id=ms.mission_id where ms.student_id=v_stu.id),'[]'::jsonb),
    'leaderboard',coalesce((select jsonb_agg(jsonb_build_object('name',l.full_name,'stars',l.stars,'profile_icon',l.profile_icon) order by l.stars desc,l.full_name) from public.students l where l.classroom_id=v_stu.classroom_id and l.active),'[]'::jsonb)
  );
end $$;
grant execute on function public.get_student_portal(text) to anon,authenticated;
