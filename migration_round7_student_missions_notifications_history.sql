-- STAR UP! Round 7: student mission excitement, schedule-aware notices and history
-- Additive only: does not delete, reset, or rewrite student data, submissions, stars or rewards.

create table if not exists public.student_notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null,
  title text not null,
  message text not null default '',
  mission_id uuid references public.missions(id) on delete cascade,
  schedule_key text,
  stars_delta integer not null default 0,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create unique index if not exists student_notifications_mission_schedule_uq
  on public.student_notifications(student_id, mission_id, schedule_key)
  where mission_id is not null and schedule_key is not null;
create index if not exists student_notifications_student_queue_idx
  on public.student_notifications(student_id, acknowledged_at, created_at);
alter table public.student_notifications enable row level security;

-- Baseline existing missions as already seen so installing this update does not
-- flood every student's queue with old assignments.
insert into public.student_notifications(student_id,kind,title,message,mission_id,schedule_key,acknowledged_at)
select st.id,case when m.is_urgent then 'urgent_mission' else 'mission' end,
       case when m.is_urgent then '🚨 ภารกิจด่วนเข้ามาแล้ว!' else '🌱 มีภารกิจใหม่รอคุณอยู่!' end,
       m.title || E'\n' || 'ภารกิจพร้อมให้ทำแล้ว' || E'\n' || 'รางวัล ' || m.reward_stars::text || ' ดาว',
       m.id,concat_ws('|',m.title,coalesce(m.start_at::text,''),coalesce(m.due_at::text,''),coalesce(m.urgent_until::text,''),m.is_urgent::text,m.active::text),now()
from public.students st join public.missions m on m.classroom_id=st.classroom_id
where st.active and m.active and (m.start_at is null or m.start_at<=now())
  and (case when m.is_urgent and m.urgent_until is not null then m.urgent_until else m.due_at end is null
       or (case when m.is_urgent and m.urgent_until is not null then m.urgent_until else m.due_at end)>now())
on conflict do nothing;

-- Queue is schedule-aware: a mission is announced when its start_at arrives.
-- If a teacher changes dates, the old unacknowledged schedule notice is superseded.
drop function if exists public.get_student_notifications(text);
create function public.get_student_notifications(p_token text)
returns table(id uuid, kind text, title text, message text, created_at timestamptz, stars_delta integer, deadline_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_stu public.students%rowtype;
begin
  if p_token is null or char_length(p_token)<20 then return; end if;
  select * into v_stu from public.students where qr_token=p_token and active;
  if not found then return; end if;

  update public.student_notifications n set acknowledged_at=now()
  where n.student_id=v_stu.id and n.mission_id is not null and n.acknowledged_at is null
    and exists(select 1 from public.missions m where m.id=n.mission_id
      and (n.schedule_key is distinct from concat_ws('|',m.title,coalesce(m.start_at::text,''),coalesce(m.due_at::text,''),coalesce(m.urgent_until::text,''),m.is_urgent::text,m.active::text)
      or not m.active or (m.start_at is not null and m.start_at>now())
      or (case when m.is_urgent and m.urgent_until is not null then m.urgent_until else m.due_at end is not null
          and (case when m.is_urgent and m.urgent_until is not null then m.urgent_until else m.due_at end)<=now())));

  insert into public.student_notifications(student_id,kind,title,message,mission_id,schedule_key)
  select v_stu.id,
         case when m.is_urgent then 'urgent_mission' else 'mission' end,
         case when m.is_urgent then '🚨 ภารกิจด่วนเข้ามาแล้ว!' else '🌱 มีภารกิจใหม่รอคุณอยู่!' end,
         m.title || E'\n' || case when m.is_urgent then 'ภารกิจด่วน! รีบทำก่อนหมดเวลานะ' else 'มาร่วมพิชิตภารกิจและสะสมดาวกัน!' end || E'\n' || 'รางวัล ' || m.reward_stars::text || ' ดาว',
         m.id,
         concat_ws('|',m.title,coalesce(m.start_at::text,''),coalesce(m.due_at::text,''),coalesce(m.urgent_until::text,''),m.is_urgent::text,m.active::text)
  from public.missions m
  where m.classroom_id=v_stu.classroom_id and m.active
    and (m.start_at is null or m.start_at<=now())
    and (case when m.is_urgent and m.urgent_until is not null then m.urgent_until else m.due_at end is null
         or (case when m.is_urgent and m.urgent_until is not null then m.urgent_until else m.due_at end)>now())
  on conflict do nothing;

  return query select n.id,n.kind,n.title,n.message,n.created_at,n.stars_delta,
      case when m.is_urgent and m.urgent_until is not null then m.urgent_until else m.due_at end as deadline_at
    from public.student_notifications n left join public.missions m on m.id=n.mission_id where n.student_id=v_stu.id and n.acknowledged_at is null
    order by case when n.kind='urgent_mission' then 0 else 1 end,n.created_at asc;
end $$;
grant execute on function public.get_student_notifications(text) to anon,authenticated;

create or replace function public.ack_student_notification(p_token text,p_notification_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_student_id uuid;
begin
  if p_token is null or char_length(p_token)<20 then raise exception 'รหัสนักเรียนไม่ถูกต้อง'; end if;
  select st.id into v_student_id from public.students st where st.qr_token=p_token and st.active;
  if v_student_id is null then raise exception 'ไม่พบนักเรียน'; end if;
  update public.student_notifications set acknowledged_at=now()
    where id=p_notification_id and student_id=v_student_id and acknowledged_at is null;
  if not found then raise exception 'ไม่พบการแจ้งเตือนหรือรับทราบไปแล้ว'; end if;
end $$;
grant execute on function public.ack_student_notification(text,uuid) to anon,authenticated;

create or replace function public.get_student_notification_history(p_token text)
returns table(id uuid,kind text,title text,message text,created_at timestamptz,acknowledged_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_student_id uuid;
begin
  if p_token is null or char_length(p_token)<20 then return; end if;
  select st.id into v_student_id from public.students st where st.qr_token=p_token and st.active;
  if v_student_id is null then return; end if;
  return query select n.id,n.kind,n.title,n.message,n.created_at,n.acknowledged_at
    from public.student_notifications n where n.student_id=v_student_id
    order by n.created_at desc limit 100;
end $$;
grant execute on function public.get_student_notification_history(text) to anon,authenticated;

-- Preserve the student portal response contract and include full mission lifecycle fields.
-- The client separates active missions from expired/completed history without deleting data.
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
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'reward_id',q.reward_id,'reward_name',r.name,'emoji',r.emoji,'cost',q.cost,'status',q.status,'teacher_note',q.teacher_note,'created_at',q.created_at,'handled_at',q.handled_at) order by q.created_at desc) from public.redemption_requests q join public.reward_items r on r.id=q.reward_id where q.student_id=v_stu.id),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(x) from (select jsonb_build_object('stars_delta',t.stars_delta,'reason',t.reason,'created_at',t.created_at) as x from public.star_transactions t where t.student_id=v_stu.id order by t.created_at desc limit 10) s),'[]'::jsonb),
    'notice_transactions',coalesce((select jsonb_agg(x) from (select jsonb_build_object('id',t.id,'stars_delta',t.stars_delta,'reason',t.reason,'created_at',t.created_at) as x from public.star_transactions t where t.student_id=v_stu.id and t.stars_delta>0 and t.reason like 'ภารกิจ:%' order by t.created_at desc limit 100) s),'[]'::jsonb),
    'missions',coalesce((select jsonb_agg(jsonb_build_object('id',mi.id,'title',mi.title,'description',mi.description,'category',mi.category,'due_at',mi.due_at,'reward_stars',mi.reward_stars,'is_urgent',mi.is_urgent,'start_at',mi.start_at,'urgent_until',mi.urgent_until,'alert_seconds',mi.alert_seconds,'active',mi.active,'created_at',mi.created_at,'closed_at',mi.closed_at) order by mi.is_urgent desc,mi.created_at desc) from public.missions mi where mi.classroom_id=v_stu.classroom_id),'[]'::jsonb),
    'mission_submissions',coalesce((select jsonb_agg(jsonb_build_object('id',ms.id,'mission_id',ms.mission_id,'mission_title',mi.title,'status',ms.status,'teacher_note',ms.teacher_note,'created_at',ms.created_at) order by ms.created_at desc) from public.mission_submissions ms join public.missions mi on mi.id=ms.mission_id where ms.student_id=v_stu.id),'[]'::jsonb),
    'leaderboard',coalesce((select jsonb_agg(jsonb_build_object('name',l.full_name,'stars',l.stars,'profile_icon',l.profile_icon) order by l.stars desc,l.full_name) from public.students l where l.classroom_id=v_stu.classroom_id and l.active),'[]'::jsonb)
  );
end $$;
grant execute on function public.get_student_portal(text) to anon,authenticated;
notify pgrst,'reload schema';
