-- =====================================================================
-- STAR UP! — Supabase schema (ตรงกับโค้ดใน STAR_UP_V3_FIXED.html)
-- วิธีใช้: Supabase Dashboard > SQL Editor > New query > วางทั้งไฟล์ > Run
-- รันซ้ำได้ (idempotent) ยกเว้นส่วนที่เป็น DROP POLICY/CREATE POLICY ซึ่งจัดการไว้แล้ว
-- =====================================================================

-- ---------- 0) ลบฟังก์ชันเวอร์ชันเก่า (ถ้ามี) เพื่อกัน error ชื่อพารามิเตอร์/ชนิดข้อมูลไม่ตรง ----------
-- ไม่ลบข้อมูลในตาราง; CASCADE จะลบ policy เก่าที่เรียกฟังก์ชันเหล่านี้ ซึ่งไฟล์นี้สร้างใหม่ให้ด้านล่าง
drop function if exists public.is_member(uuid) cascade;
drop function if exists public.create_classroom(text) cascade;
drop function if exists public.create_classroom_invite(uuid) cascade;
drop function if exists public.accept_classroom_invite(text) cascade;
drop function if exists public.get_classroom_teachers(uuid) cascade;
drop function if exists public.teacher_set_student_icon(uuid, text) cascade;
drop function if exists public.teacher_update_student(uuid, text, text) cascade;
drop function if exists public.teacher_adjust_stars(uuid, integer, text) cascade;
drop function if exists public.teacher_handle_redemption(uuid, boolean, text) cascade;
drop function if exists public.teacher_regenerate_qr(uuid) cascade;
drop function if exists public.teacher_delete_students(uuid, uuid) cascade;
drop function if exists public.get_student_portal(text) cascade;
drop function if exists public.student_set_profile_icon(text, text) cascade;
drop function if exists public.student_request_reward(text, uuid, text) cascade;
drop function if exists public.teacher_rename_classroom(uuid, text) cascade;
drop function if exists public.teacher_delete_classroom(uuid) cascade;
drop function if exists public.teacher_adjust_stars_bulk(uuid[], integer, text) cascade;
drop function if exists public.owner_promote_teacher(uuid, uuid) cascade;
drop function if exists public.owner_remove_teacher(uuid, uuid) cascade;

-- ---------- 1) ตาราง ----------
create table if not exists public.teacher_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'คุณครู',
  profile_icon text not null default '👩‍🏫',
  created_at   timestamptz not null default now()
);

create table if not exists public.classrooms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.classroom_members (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  teacher_id   uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'teacher' check (role in ('owner','teacher')),
  created_at   timestamptz not null default now(),
  primary key (classroom_id, teacher_id)
);

create table if not exists public.classroom_invites (
  token        text primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  created_by   uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null default now() + interval '7 days',
  created_at   timestamptz not null default now()
);

create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  full_name    text not null check (char_length(full_name) between 1 and 80),
  profile_icon text not null default '⭐' check (char_length(profile_icon) <= 16),
  qr_token     text not null unique
               default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  stars        integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists students_classroom_idx on public.students(classroom_id);

create table if not exists public.reward_items (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null default '',
  emoji        text not null default '🎁',
  cost         integer not null check (cost >= 1),
  stock        integer not null default 0 check (stock >= 0),
  active       boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists reward_items_classroom_idx on public.reward_items(classroom_id);

create table if not exists public.redemption_requests (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  reward_id    uuid not null references public.reward_items(id) on delete cascade,
  cost         integer not null check (cost >= 1),
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  note         text not null default '',
  teacher_note text not null default '',
  handled_by   uuid references auth.users(id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists redemption_classroom_idx on public.redemption_requests(classroom_id, created_at desc);
create index if not exists redemption_student_idx on public.redemption_requests(student_id);

create table if not exists public.star_transactions (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  stars_delta  integer not null,
  reason       text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists star_tx_student_idx on public.star_transactions(student_id, created_at desc);

-- ---------- 2) สร้างโปรไฟล์ครูอัตโนมัติเมื่อสมัคร ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.teacher_profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'คุณครู')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3) ตัวช่วยตรวจสิทธิ์ ----------
create or replace function public.is_member(p_classroom_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classroom_members
    where classroom_id = p_classroom_id and teacher_id = auth.uid()
  );
$$;

-- ---------- 4) RLS + สิทธิ์ระดับคอลัมน์ ----------
alter table public.teacher_profiles    enable row level security;
alter table public.classrooms          enable row level security;
alter table public.classroom_members   enable row level security;
alter table public.classroom_invites   enable row level security;
alter table public.students            enable row level security;
alter table public.reward_items        enable row level security;
alter table public.redemption_requests enable row level security;
alter table public.star_transactions   enable row level security;

-- ถอนสิทธิ์ค่าเริ่มต้นของ Supabase ทั้งหมดก่อน แล้วให้เฉพาะที่จำเป็น
revoke all on public.teacher_profiles, public.classrooms, public.classroom_members,
              public.classroom_invites, public.students, public.reward_items,
              public.redemption_requests, public.star_transactions
  from anon, authenticated;

grant select on public.teacher_profiles, public.classrooms, public.classroom_members,
                public.students, public.reward_items, public.redemption_requests,
                public.star_transactions to authenticated;
grant update (display_name, profile_icon) on public.teacher_profiles to authenticated;
grant insert (classroom_id, full_name, profile_icon) on public.students to authenticated;
grant update (full_name, profile_icon, active)       on public.students to authenticated;
grant delete on public.students to authenticated;
grant insert (classroom_id, name, description, emoji, cost, stock, active, created_by)
  on public.reward_items to authenticated;
grant update (name, description, emoji, cost, stock, active) on public.reward_items to authenticated;
grant delete on public.reward_items to authenticated;
-- ดาว/การแลกของ/ประวัติ แก้ได้ผ่านฟังก์ชัน RPC เท่านั้น (กันแก้ยอดดาวตรง ๆ)

drop policy if exists tp_select on public.teacher_profiles;
drop policy if exists tp_update on public.teacher_profiles;
create policy tp_select on public.teacher_profiles for select to authenticated using (id = auth.uid());
create policy tp_update on public.teacher_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists cr_select on public.classrooms;
create policy cr_select on public.classrooms for select to authenticated using (public.is_member(id));

drop policy if exists cm_select on public.classroom_members;
create policy cm_select on public.classroom_members for select to authenticated using (teacher_id = auth.uid());

drop policy if exists st_select on public.students;
drop policy if exists st_insert on public.students;
drop policy if exists st_update on public.students;
drop policy if exists st_delete on public.students;
create policy st_select on public.students for select to authenticated using (public.is_member(classroom_id));
create policy st_insert on public.students for insert to authenticated with check (public.is_member(classroom_id));
create policy st_update on public.students for update to authenticated
  using (public.is_member(classroom_id)) with check (public.is_member(classroom_id));
create policy st_delete on public.students for delete to authenticated using (public.is_member(classroom_id));

drop policy if exists ri_select on public.reward_items;
drop policy if exists ri_insert on public.reward_items;
drop policy if exists ri_update on public.reward_items;
drop policy if exists ri_delete on public.reward_items;
create policy ri_select on public.reward_items for select to authenticated using (public.is_member(classroom_id));
create policy ri_insert on public.reward_items for insert to authenticated
  with check (public.is_member(classroom_id) and created_by = auth.uid());
create policy ri_update on public.reward_items for update to authenticated
  using (public.is_member(classroom_id)) with check (public.is_member(classroom_id));
create policy ri_delete on public.reward_items for delete to authenticated using (public.is_member(classroom_id));

drop policy if exists rr_select on public.redemption_requests;
create policy rr_select on public.redemption_requests for select to authenticated using (public.is_member(classroom_id));

drop policy if exists tx_select on public.star_transactions;
create policy tx_select on public.star_transactions for select to authenticated using (public.is_member(classroom_id));

-- ---------- 5) ฟังก์ชันฝั่งครู (ต้องล็อกอิน) ----------
create or replace function public.create_classroom(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if p_name is null or char_length(trim(p_name)) = 0 then raise exception 'กรุณากรอกชื่อห้อง'; end if;
  insert into public.classrooms(name, owner_id) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into public.classroom_members(classroom_id, teacher_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

create or replace function public.create_classroom_invite(p_classroom_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.is_member(p_classroom_id) then raise exception 'ไม่มีสิทธิ์ในห้องนี้'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.classroom_invites(token, classroom_id, created_by) values (v_token, p_classroom_id, auth.uid());
  return v_token;
end $$;

create or replace function public.accept_classroom_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_room uuid;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select classroom_id into v_room from public.classroom_invites
   where token = p_token and expires_at > now();
  if v_room is null then raise exception 'ลิงก์เชิญไม่ถูกต้องหรือหมดอายุ'; end if;
  insert into public.classroom_members(classroom_id, teacher_id, role)
  values (v_room, auth.uid(), 'teacher') on conflict do nothing;
  return v_room;
end $$;

create or replace function public.get_classroom_teachers(p_classroom_id uuid)
returns table(teacher_id uuid, name text, profile_icon text, role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_classroom_id) then raise exception 'ไม่มีสิทธิ์ในห้องนี้'; end if;
  return query
    select cm.teacher_id, tp.display_name, tp.profile_icon, cm.role
    from public.classroom_members cm
    join public.teacher_profiles tp on tp.id = cm.teacher_id
    where cm.classroom_id = p_classroom_id
    order by (cm.role = 'owner') desc, cm.created_at;
end $$;

create or replace function public.teacher_set_student_icon(p_student_id uuid, p_profile_icon text)
returns void language plpgsql security definer set search_path = public as $$
declare v_room uuid;
begin
  select classroom_id into v_room from public.students where id = p_student_id;
  if v_room is null or not public.is_member(v_room) then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_profile_icon is null or char_length(p_profile_icon) not between 1 and 16 then raise exception 'ไอคอนไม่ถูกต้อง'; end if;
  update public.students set profile_icon = p_profile_icon where id = p_student_id;
end $$;

create or replace function public.teacher_update_student(p_student_id uuid, p_full_name text, p_profile_icon text)
returns void language plpgsql security definer set search_path = public as $$
declare v_room uuid;
begin
  if p_full_name is null or char_length(trim(p_full_name)) not between 1 and 80 then raise exception 'ชื่อนักเรียนต้องยาว 1-80 ตัวอักษร'; end if;
  if p_profile_icon is null or char_length(p_profile_icon) not between 1 and 16 then raise exception 'ไอคอนไม่ถูกต้อง'; end if;
  select classroom_id into v_room from public.students where id = p_student_id for update;
  if v_room is null or not public.is_member(v_room) then raise exception 'ไม่มีสิทธิ์'; end if;
  update public.students set full_name = trim(p_full_name), profile_icon = p_profile_icon where id = p_student_id;
end $$;

create or replace function public.teacher_adjust_stars(p_student_id uuid, p_stars_delta integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_stu public.students%rowtype; v_new integer;
begin
  select * into v_stu from public.students where id = p_student_id for update;
  if not found or not public.is_member(v_stu.classroom_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_stars_delta is null or p_stars_delta = 0 or abs(p_stars_delta) > 100000 then raise exception 'จำนวนดาวไม่ถูกต้อง'; end if;
  v_new := v_stu.stars + p_stars_delta;
  -- อนุญาตยอดดาวติดลบได้: ครูใช้หักดาวเป็นการตักเตือน/ทำโทษตามกติกาห้องเรียน
  update public.students set stars = v_new where id = p_student_id;
  insert into public.star_transactions(classroom_id, student_id, stars_delta, reason, created_by)
  values (v_stu.classroom_id, p_student_id, p_stars_delta, coalesce(left(p_reason, 200), ''), auth.uid());
  return v_new;
end $$;

create or replace function public.teacher_handle_redemption(p_request_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_req public.redemption_requests%rowtype; v_stu public.students%rowtype; v_rw public.reward_items%rowtype;
begin
  select * into v_req from public.redemption_requests where id = p_request_id for update;
  if not found or not public.is_member(v_req.classroom_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if v_req.status <> 'pending' then raise exception 'คำขอนี้ถูกจัดการแล้ว'; end if;

  if p_approve then
    select * into v_stu from public.students where id = v_req.student_id for update;
    select * into v_rw  from public.reward_items where id = v_req.reward_id for update;
    if v_stu.id is null or v_rw.id is null then raise exception 'ไม่พบข้อมูลนักเรียนหรือของรางวัล'; end if;
    if v_stu.stars < v_req.cost then raise exception 'ดาวของนักเรียนไม่พอ'; end if;
    if v_rw.stock < 1 then raise exception 'ของรางวัลหมดแล้ว'; end if;
    update public.students    set stars = stars - v_req.cost where id = v_stu.id;
    update public.reward_items set stock = stock - 1          where id = v_rw.id;
    insert into public.star_transactions(classroom_id, student_id, stars_delta, reason, created_by)
    values (v_req.classroom_id, v_stu.id, -v_req.cost, 'แลกรางวัล: ' || v_rw.name, auth.uid());
  end if;

  update public.redemption_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         teacher_note = coalesce(left(p_note, 200), ''),
         handled_by = auth.uid(), handled_at = now()
   where id = p_request_id;
end $$;

create or replace function public.teacher_regenerate_qr(p_student_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_room uuid; v_token text;
begin
  select classroom_id into v_room from public.students where id = p_student_id;
  if v_room is null or not public.is_member(v_room) then raise exception 'ไม่มีสิทธิ์'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.students set qr_token = v_token where id = p_student_id;
  return v_token;
end $$;

-- p_student_id = null  => ลบนักเรียนทั้งห้อง; คืนจำนวนที่ลบ
create or replace function public.teacher_delete_students(p_classroom_id uuid, p_student_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_member(p_classroom_id) then raise exception 'ไม่มีสิทธิ์ในห้องนี้'; end if;
  delete from public.students
   where classroom_id = p_classroom_id and (p_student_id is null or id = p_student_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- 6) ฟังก์ชันฝั่งนักเรียน (ไม่ต้องล็อกอิน ใช้ qr_token เป็นกุญแจ) ----------
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
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object('name', l.full_name, 'stars', l.stars) order by l.stars desc, l.full_name)
      from public.students l where l.classroom_id = v_stu.classroom_id and l.active), '[]'::jsonb)
  );
end $$;

create or replace function public.student_set_profile_icon(p_token text, p_profile_icon text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_profile_icon is null or char_length(p_profile_icon) not between 1 and 16 then raise exception 'ไอคอนไม่ถูกต้อง'; end if;
  update public.students set profile_icon = p_profile_icon where qr_token = p_token and active;
  if not found then raise exception 'ไม่พบนักเรียน'; end if;
end $$;

create or replace function public.student_request_reward(p_token text, p_reward_id uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_stu public.students%rowtype; v_rw public.reward_items%rowtype;
        v_pending_cost integer; v_reserved integer; v_id uuid;
begin
  select * into v_stu from public.students where qr_token = p_token and active for update;
  if not found then raise exception 'ไม่พบนักเรียน'; end if;
  select * into v_rw from public.reward_items
   where id = p_reward_id and classroom_id = v_stu.classroom_id and active for update;
  if not found then raise exception 'ไม่พบของรางวัล'; end if;

  select coalesce(sum(cost), 0) into v_pending_cost from public.redemption_requests
   where student_id = v_stu.id and status = 'pending';
  if v_stu.stars - v_pending_cost < v_rw.cost then raise exception 'ดาวไม่พอ'; end if;

  select count(*) into v_reserved from public.redemption_requests
   where reward_id = v_rw.id and status = 'pending';
  if v_rw.stock - v_reserved < 1 then raise exception 'ของรางวัลหมดหรือถูกจองครบแล้ว'; end if;

  insert into public.redemption_requests(classroom_id, student_id, reward_id, cost, note)
  values (v_stu.classroom_id, v_stu.id, v_rw.id, v_rw.cost, coalesce(left(p_note, 200), ''))
  returning id into v_id;
  return v_id;
end $$;

-- ---------- ห้องเรียน: เปลี่ยนชื่อ / ลบห้อง ----------
create or replace function public.teacher_rename_classroom(p_classroom_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_classroom_id) then raise exception 'ไม่มีสิทธิ์ในห้องนี้'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'ชื่อห้องต้องยาว 1-80 ตัวอักษร'; end if;
  update public.classrooms set name = trim(p_name) where id = p_classroom_id;
end $$;

-- ลบห้องได้เฉพาะเจ้าของห้อง (ข้อมูลนักเรียน รางวัล ประวัติ คำขอ ถูกลบตามด้วย)
create or replace function public.teacher_delete_classroom(p_classroom_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classroom_members
                  where classroom_id = p_classroom_id and teacher_id = auth.uid() and role = 'owner') then
    raise exception 'เฉพาะเจ้าของห้องเท่านั้นที่ลบห้องได้';
  end if;
  delete from public.classrooms where id = p_classroom_id;
end $$;


-- ---------- ให้/หักดาวหลายคน ----------
create or replace function public.teacher_adjust_stars_bulk(p_student_ids uuid[], p_stars_delta integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; v_count integer;
begin
  if p_stars_delta is null or p_stars_delta = 0 or abs(p_stars_delta) > 100000 then raise exception 'จำนวนดาวไม่ถูกต้อง'; end if;
  if p_student_ids is null or cardinality(p_student_ids) = 0 or cardinality(p_student_ids) > 500 then raise exception 'เลือกนักเรียน 1-500 คน'; end if;
  if cardinality(p_student_ids) <> (select count(distinct x) from unnest(p_student_ids) x) then raise exception 'มีรายชื่อนักเรียนซ้ำในรายการ'; end if;
  -- ล็อกทุกแถวก่อนตรวจและแก้ไข เพื่อป้องกันยอดดาวติดลบจากคำสั่งที่ทำพร้อมกัน
  perform 1 from public.students s where s.id = any(p_student_ids) order by s.id for update;
  select count(*) into v_count from public.students s
   where s.id = any(p_student_ids) and s.active and public.is_member(s.classroom_id)
;
  if v_count <> cardinality(p_student_ids) then
    if exists (select 1 from public.students s where s.id = any(p_student_ids) and not public.is_member(s.classroom_id)) then raise exception 'ไม่มีสิทธิ์'; end if;
    if exists (select 1 from public.students s where s.id = any(p_student_ids) and not s.active) then raise exception 'มีนักเรียนที่ถูกปิดใช้งาน'; end if;
    raise exception 'ไม่พบนักเรียนบางคน';
  end if;
  with upd as (
    update public.students s set stars = s.stars + p_stars_delta
     where s.id = any(p_student_ids) and s.active
    returning s.id, s.classroom_id)
  insert into public.star_transactions(classroom_id, student_id, stars_delta, reason, created_by)
  select classroom_id, id, p_stars_delta, coalesce(left(p_reason, 200), ''), auth.uid() from upd;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- ทีมครู: แต่งตั้งเจ้าของห้อง / ลบครู ----------
-- เจ้าของห้องแต่งตั้งครูร่วมดูแลให้เป็นเจ้าของห้อง
create or replace function public.owner_promote_teacher(p_classroom_id uuid, p_teacher_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classroom_members
                  where classroom_id = p_classroom_id and teacher_id = auth.uid() and role = 'owner') then
    raise exception 'เฉพาะเจ้าของห้องเท่านั้นที่ทำได้';
  end if;
  update public.classroom_members set role = 'owner'
   where classroom_id = p_classroom_id and teacher_id = p_teacher_id and role = 'teacher';
  if not found then raise exception 'ไม่พบครูท่านนี้ในห้อง หรือเป็นเจ้าของห้องอยู่แล้ว'; end if;
end $$;

-- เจ้าของห้องลบครูร่วมดูแลออกจากห้อง (ลบเจ้าของห้อง/ลบตัวเองไม่ได้) และยกเลิกลิงก์เชิญเดิมของห้อง
create or replace function public.owner_remove_teacher(p_classroom_id uuid, p_teacher_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classroom_members
                  where classroom_id = p_classroom_id and teacher_id = auth.uid() and role = 'owner') then
    raise exception 'เฉพาะเจ้าของห้องเท่านั้นที่ทำได้';
  end if;
  if p_teacher_id = auth.uid() then raise exception 'ไม่สามารถลบตัวเองออกจากห้องได้'; end if;
  delete from public.classroom_members
   where classroom_id = p_classroom_id and teacher_id = p_teacher_id and role = 'teacher';
  if not found then raise exception 'ไม่พบครูท่านนี้ หรือเป็นเจ้าของห้อง (ลบเจ้าของห้องไม่ได้)'; end if;
  delete from public.classroom_invites where classroom_id = p_classroom_id;
end $$;

-- ---------- 7) สิทธิ์การเรียกฟังก์ชัน ----------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_member(uuid),
  public.create_classroom(text),
  public.create_classroom_invite(uuid),
  public.accept_classroom_invite(text),
  public.get_classroom_teachers(uuid),
  public.teacher_set_student_icon(uuid, text),
  public.teacher_update_student(uuid, text, text),
  public.teacher_adjust_stars(uuid, integer, text),
  public.teacher_handle_redemption(uuid, boolean, text),
  public.teacher_regenerate_qr(uuid),
  public.teacher_delete_students(uuid, uuid),
  public.teacher_rename_classroom(uuid, text),
  public.teacher_delete_classroom(uuid),
  public.teacher_adjust_stars_bulk(uuid[], integer, text),
  public.owner_promote_teacher(uuid, uuid),
  public.owner_remove_teacher(uuid, uuid)
to authenticated;

grant execute on function
  public.get_student_portal(text),
  public.student_set_profile_icon(text, text),
  public.student_request_reward(text, uuid, text)
to anon, authenticated;

-- handle_new_user ถูกเรียกโดย trigger เท่านั้น ไม่ต้องให้ใครเรียกตรง ๆ
