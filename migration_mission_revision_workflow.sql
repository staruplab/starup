-- STAR UP! Mission revision workflow
-- Run once in Supabase SQL Editor after the existing mission migrations.
-- Keeps "ไม่อนุมัติ" (rejected) separate from "ส่งกลับแก้ไข" (needs_revision).

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.mission_submissions'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.mission_submissions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.mission_submissions
  add constraint mission_submissions_status_check
  check (status in ('pending','approved','rejected','needs_revision'));

create or replace function public.teacher_return_mission(p_submission_id uuid,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare q public.mission_submissions%rowtype;
begin
  select * into q from public.mission_submissions where id=p_submission_id for update;
  if not found or not public.is_member(q.classroom_id) then
    raise exception 'ไม่พบรายการหรือไม่มีสิทธิ์';
  end if;
  if q.status<>'pending' then raise exception 'รายการนี้ถูกตรวจแล้ว'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'กรุณาระบุเหตุผลที่ส่งกลับแก้ไข';
  end if;
  update public.mission_submissions
    set status='needs_revision',
        teacher_note=left(btrim(p_note),500),
        reviewed_by=auth.uid(),
        reviewed_at=now()
    where id=q.id;
end $$;

grant execute on function public.teacher_return_mission(uuid,text) to authenticated;

-- Include the teacher review timestamp in the student portal payload
-- so the student notice can show both submission and return times.
create or replace function public.get_student_portal(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_stu public.students%rowtype; v_room public.classrooms%rowtype;
begin
  if p_token is null or char_length(p_token) < 20 then return null; end if;
  select * into v_stu from public.students where qr_token = p_token and active;
  if not found then return null; end if;
  select * into v_room from public.classrooms where id = v_stu.classroom_id;
  return jsonb_build_object(
    'student', jsonb_build_object('id', v_stu.id, 'full_name', v_stu.full_name,
      'profile_icon', v_stu.profile_icon, 'stars', v_stu.stars),
    'classroom', jsonb_build_object('id', v_room.id, 'name', v_room.name),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'description',r.description,
        'emoji',r.emoji,'cost',r.cost,'stock',r.stock) order by r.cost,r.created_at)
      from public.reward_items r where r.classroom_id=v_stu.classroom_id and r.active
    ),'[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id',q.id,'reward_id',q.reward_id,'reward_name',r.name,
        'emoji',r.emoji,'cost',q.cost,'status',q.status,'teacher_note',q.teacher_note,'created_at',q.created_at)
        order by q.created_at desc)
      from public.redemption_requests q join public.reward_items r on r.id=q.reward_id
      where q.student_id=v_stu.id
    ),'[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('stars_delta',t.stars_delta,'reason',t.reason,'created_at',t.created_at) as x
        from public.star_transactions t where t.student_id=v_stu.id
        order by t.created_at desc limit 10
      ) s
    ),'[]'::jsonb),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object('id',mi.id,'title',mi.title,'description',mi.description,
        'reward_stars',mi.reward_stars) order by mi.created_at desc)
      from public.missions mi where mi.classroom_id=v_stu.classroom_id and mi.active
    ),'[]'::jsonb),
    'mission_submissions', coalesce((
      select jsonb_agg(jsonb_build_object('id',ms.id,'mission_id',ms.mission_id,
        'mission_title',mi.title,'status',ms.status,'teacher_note',ms.teacher_note,
        'created_at',ms.created_at,'reviewed_at',ms.reviewed_at)
        order by ms.created_at desc)
      from public.mission_submissions ms join public.missions mi on mi.id=ms.mission_id
      where ms.student_id=v_stu.id
    ),'[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object('name',l.full_name,'stars',l.stars)
        order by l.stars desc,l.full_name)
      from public.students l where l.classroom_id=v_stu.classroom_id and l.active
    ),'[]'::jsonb)
  );
end $$;

grant execute on function public.get_student_portal(text) to anon,authenticated;
