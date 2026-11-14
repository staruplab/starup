-- STAR UP! Missions + photo evidence workflow
create table if not exists public.missions (
 id uuid primary key default gen_random_uuid(), classroom_id uuid not null references public.classrooms(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 100), description text not null default '',
 reward_stars integer not null default 1 check(reward_stars between 1 and 100), active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists missions_room_idx on public.missions(classroom_id,active,created_at desc);
create table if not exists public.mission_submissions (
 id uuid primary key default gen_random_uuid(), classroom_id uuid not null references public.classrooms(id) on delete cascade,
 mission_id uuid not null references public.missions(id) on delete cascade, student_id uuid not null references public.students(id) on delete cascade,
 image_path text not null, student_note text not null default '', status text not null default 'pending' check(status in ('pending','approved','rejected')),
 teacher_note text not null default '', reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists mission_submissions_room_idx on public.mission_submissions(classroom_id,status,created_at desc);
alter table public.missions enable row level security;
alter table public.mission_submissions enable row level security;
drop policy if exists missions_teacher_all on public.missions;
create policy missions_teacher_all on public.missions for all to authenticated using(public.is_member(classroom_id)) with check(public.is_member(classroom_id));
drop policy if exists mission_submissions_teacher_read on public.mission_submissions;
create policy mission_submissions_teacher_read on public.mission_submissions for select to authenticated using(public.is_member(classroom_id));
-- Public student access is only via token-validated SECURITY DEFINER RPCs, never direct table access.
create or replace function public.student_submit_mission(p_token text,p_mission_id uuid,p_image_path text,p_note text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.students%rowtype; m public.missions%rowtype; v_id uuid;
begin
 if p_token is null or char_length(p_token)<20 then raise exception 'รหัสนักเรียนไม่ถูกต้อง'; end if;
 select * into s from public.students where qr_token=p_token and active;
 if not found then raise exception 'ไม่พบนักเรียน'; end if;
 select * into m from public.missions where id=p_mission_id and classroom_id=s.classroom_id and active;
 if not found then raise exception 'ไม่พบภารกิจหรือภารกิจปิดแล้ว'; end if;
 if p_image_path is null or split_part(p_image_path,'/',1)<>p_token then raise exception 'หลักฐานภาพไม่ถูกต้อง'; end if;
 if exists(select 1 from public.mission_submissions where mission_id=m.id and student_id=s.id and status='pending') then raise exception 'คุณส่งภารกิจนี้แล้ว กรุณารอครูตรวจสอบ'; end if;
 insert into public.mission_submissions(classroom_id,mission_id,student_id,image_path,student_note)
 values(s.classroom_id,m.id,s.id,p_image_path,left(coalesce(p_note,''),500)) returning id into v_id;
 return v_id;
end $$;
create or replace function public.teacher_review_mission(p_submission_id uuid,p_approve boolean,p_note text default '')
returns void language plpgsql security definer set search_path=public as $$
declare q public.mission_submissions%rowtype; m public.missions%rowtype;
begin
 select * into q from public.mission_submissions where id=p_submission_id for update;
 if not found or not public.is_member(q.classroom_id) then raise exception 'ไม่พบรายการหรือไม่มีสิทธิ์'; end if;
 if q.status<>'pending' then raise exception 'รายการนี้ถูกตรวจแล้ว'; end if;
 if p_approve then
  select * into m from public.missions where id=q.mission_id;
  update public.students set stars=stars+m.reward_stars where id=q.student_id;
  insert into public.star_transactions(classroom_id,student_id,stars_delta,reason,created_by)
  values(q.classroom_id,q.student_id,m.reward_stars,'ภารกิจ: '||m.title,auth.uid());
 end if;
 update public.mission_submissions set status=case when p_approve then 'approved' else 'rejected' end,
 teacher_note=left(coalesce(p_note,''),500),reviewed_by=auth.uid(),reviewed_at=now() where id=q.id;
end $$;
grant execute on function public.student_submit_mission(text,uuid,text,text) to anon,authenticated;
grant execute on function public.teacher_review_mission(uuid,boolean,text) to authenticated;
-- Storage: public student QR token is a bearer credential. Limit writes to a folder matching an active student token.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mission-evidence','mission-evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create or replace function public.mission_token_is_active(p_token text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.students where qr_token=p_token and active)
$$;
grant execute on function public.mission_token_is_active(text) to anon,authenticated;
drop policy if exists mission_evidence_student_upload on storage.objects;
create policy mission_evidence_student_upload on storage.objects for insert to anon,authenticated with check(
 bucket_id='mission-evidence' and public.mission_token_is_active(split_part(name,'/',1))
);
drop policy if exists mission_evidence_teacher_read on storage.objects;
create policy mission_evidence_teacher_read on storage.objects for select to authenticated using(
 bucket_id='mission-evidence' and exists(select 1 from public.mission_submissions q where q.image_path=name and public.is_member(q.classroom_id))
);

-- Extend student QR portal with active missions and own submission status
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
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description,
                                          'emoji', r.emoji, 'cost', r.cost, 'stock', r.stock)
                       order by r.cost, r.created_at)
      from public.reward_items r where r.classroom_id = v_stu.classroom_id and r.active), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'reward_id', q.reward_id, 'reward_name', r.name,
                                          'emoji', r.emoji, 'cost', q.cost, 'status', q.status,
                                          'teacher_note', q.teacher_note, 'created_at', q.created_at)
                       order by q.created_at desc)
      from public.redemption_requests q join public.reward_items r on r.id = q.reward_id
      where q.student_id = v_stu.id), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('stars_delta', t.stars_delta, 'reason', t.reason, 'created_at', t.created_at) as x
        from public.star_transactions t where t.student_id = v_stu.id
        order by t.created_at desc limit 10) s), '[]'::jsonb),
    'missions', coalesce((select jsonb_agg(jsonb_build_object('id',mi.id,'title',mi.title,'description',mi.description,'reward_stars',mi.reward_stars) order by mi.created_at desc) from public.missions mi where mi.classroom_id=v_stu.classroom_id and mi.active), '[]'::jsonb),
    'mission_submissions', coalesce((select jsonb_agg(jsonb_build_object('id',ms.id,'mission_id',ms.mission_id,'mission_title',mi.title,'status',ms.status,'teacher_note',ms.teacher_note,'created_at',ms.created_at) order by ms.created_at desc) from public.mission_submissions ms join public.missions mi on mi.id=ms.mission_id where ms.student_id=v_stu.id), '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object('name', l.full_name, 'stars', l.stars) order by l.stars desc, l.full_name)
      from public.students l where l.classroom_id = v_stu.classroom_id and l.active), '[]'::jsonb)
  );
end $$;


-- STAR UP! Missions enhancements (safe to run after the original missions migration)
-- Add classification and optional deadline for better classroom organization.
alter table public.missions add column if not exists category text not null default 'ภารกิจทั่วไป';
alter table public.missions add column if not exists due_at timestamptz;

-- One approved completion per student per mission. Rejected submissions may be retried.
with ranked as (
 select id, row_number() over(partition by mission_id,student_id order by reviewed_at nulls last,created_at,id) as rn
 from public.mission_submissions where status='approved'
)
update public.mission_submissions ms set status='rejected', teacher_note=case when coalesce(ms.teacher_note,'')='' then 'ปิดรายการซ้ำจากการปรับปรุงระบบ' else ms.teacher_note end
from ranked r where ms.id=r.id and r.rn>1;
create unique index if not exists mission_one_approved_per_student
 on public.mission_submissions(mission_id, student_id)
 where status = 'approved';

create or replace function public.student_submit_mission(p_token text,p_mission_id uuid,p_image_path text,p_note text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.students%rowtype; m public.missions%rowtype; v_id uuid;
begin
 if p_token is null or char_length(p_token)<20 then raise exception 'รหัสนักเรียนไม่ถูกต้อง'; end if;
 select * into s from public.students where qr_token=p_token and active;
 if not found then raise exception 'ไม่พบนักเรียน'; end if;
 select * into m from public.missions where id=p_mission_id and classroom_id=s.classroom_id and active;
 if not found then raise exception 'ไม่พบภารกิจหรือภารกิจปิดแล้ว'; end if;
 if m.due_at is not null and now()>m.due_at then raise exception 'หมดเขตส่งภารกิจนี้แล้ว'; end if;
 if p_image_path is null or split_part(p_image_path,'/',1)<>p_token then raise exception 'หลักฐานภาพไม่ถูกต้อง'; end if;
 if exists(select 1 from public.mission_submissions where mission_id=m.id and student_id=s.id and status='approved') then raise exception 'คุณทำภารกิจนี้สำเร็จและได้รับดาวแล้ว'; end if;
 if exists(select 1 from public.mission_submissions where mission_id=m.id and student_id=s.id and status='pending') then raise exception 'คุณส่งภารกิจนี้แล้ว กรุณารอครูตรวจสอบ'; end if;
 insert into public.mission_submissions(classroom_id,mission_id,student_id,image_path,student_note)
 values(s.classroom_id,m.id,s.id,p_image_path,left(coalesce(p_note,''),500)) returning id into v_id;
 return v_id;
end $$;

create or replace function public.teacher_review_mission(p_submission_id uuid,p_approve boolean,p_note text default '')
returns void language plpgsql security definer set search_path=public as $$
declare q public.mission_submissions%rowtype; m public.missions%rowtype; v_student_id uuid;
begin
 select * into q from public.mission_submissions where id=p_submission_id for update;
 if not found or not public.is_member(q.classroom_id) then raise exception 'ไม่พบรายการหรือไม่มีสิทธิ์'; end if;
 if q.status<>'pending' then raise exception 'รายการนี้ถูกตรวจแล้ว'; end if;
 if p_approve then
  select * into m from public.missions where id=q.mission_id;
  select id into v_student_id from public.students where id=q.student_id for update;
  if exists(select 1 from public.mission_submissions where mission_id=q.mission_id and student_id=q.student_id and status='approved') then
   raise exception 'นักเรียนได้รับรางวัลภารกิจนี้แล้ว';
  end if;
  update public.students set stars=stars+m.reward_stars where id=q.student_id;
  insert into public.star_transactions(classroom_id,student_id,stars_delta,reason,created_by)
  values(q.classroom_id,q.student_id,m.reward_stars,'ภารกิจ: '||m.title,auth.uid());
 end if;
 update public.mission_submissions set status=case when p_approve then 'approved' else 'rejected' end,
 teacher_note=left(coalesce(p_note,''),500),reviewed_by=auth.uid(),reviewed_at=now() where id=q.id;
end $$;

-- Include category and deadline in the student portal response.
create or replace function public.get_student_portal(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_stu public.students%rowtype; v_room public.classrooms%rowtype;
begin
  if p_token is null or char_length(p_token) < 20 then return null; end if;
  select * into v_stu from public.students where qr_token = p_token and active;
  if not found then return null; end if;
  select * into v_room from public.classrooms where id = v_stu.classroom_id;
  return jsonb_build_object(
    'student', jsonb_build_object('id', v_stu.id, 'full_name', v_stu.full_name, 'profile_icon', v_stu.profile_icon, 'stars', v_stu.stars),
    'classroom', jsonb_build_object('id', v_room.id, 'name', v_room.name),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'description',r.description,'emoji',r.emoji,'cost',r.cost,'stock',r.stock) order by r.cost,r.created_at) from public.reward_items r where r.classroom_id=v_stu.classroom_id and r.active),'[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'reward_id',q.reward_id,'reward_name',r.name,'emoji',r.emoji,'cost',q.cost,'status',q.status,'teacher_note',q.teacher_note,'created_at',q.created_at) order by q.created_at desc) from public.redemption_requests q join public.reward_items r on r.id=q.reward_id where q.student_id=v_stu.id),'[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (select jsonb_build_object('stars_delta',t.stars_delta,'reason',t.reason,'created_at',t.created_at) as x from public.star_transactions t where t.student_id=v_stu.id order by t.created_at desc limit 10) s),'[]'::jsonb),
    'missions', coalesce((select jsonb_agg(jsonb_build_object('id',mi.id,'title',mi.title,'description',mi.description,'category',mi.category,'due_at',mi.due_at,'reward_stars',mi.reward_stars) order by mi.created_at desc) from public.missions mi where mi.classroom_id=v_stu.classroom_id and mi.active and (mi.due_at is null or mi.due_at>=now())),'[]'::jsonb),
    'mission_submissions', coalesce((select jsonb_agg(jsonb_build_object('id',ms.id,'mission_id',ms.mission_id,'mission_title',mi.title,'status',ms.status,'teacher_note',ms.teacher_note,'created_at',ms.created_at) order by ms.created_at desc) from public.mission_submissions ms join public.missions mi on mi.id=ms.mission_id where ms.student_id=v_stu.id),'[]'::jsonb),
    'leaderboard', coalesce((select jsonb_agg(jsonb_build_object('name',l.full_name,'stars',l.stars,'profile_icon',l.profile_icon) order by l.stars desc,l.full_name) from public.students l where l.classroom_id=v_stu.classroom_id and l.active),'[]'::jsonb)
  );
end $$;
