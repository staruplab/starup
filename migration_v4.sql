-- STAR UP! migration v4: เปิดให้ครูหักดาวจนยอดติดลบได้ และให้ดาวหลายคนแบบ atomic
-- รันใน Supabase SQL Editor หลัง migration_v3.sql (หรือหลัง schema.sql ฉบับล่าสุด)
-- ไม่ลบตาราง ไม่ลบข้อมูล และไม่เปลี่ยนสิทธิ์ของตาราง

create or replace function public.teacher_adjust_stars(p_student_id uuid, p_stars_delta integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_stu public.students%rowtype; v_new integer;
begin
  select * into v_stu from public.students where id = p_student_id for update;
  if not found or not public.is_member(v_stu.classroom_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not v_stu.active then raise exception 'นักเรียนถูกปิดใช้งาน'; end if;
  if p_stars_delta is null or p_stars_delta = 0 or abs(p_stars_delta) > 100000 then raise exception 'จำนวนดาวไม่ถูกต้อง'; end if;
  v_new := v_stu.stars + p_stars_delta;
  update public.students set stars = v_new where id = p_student_id;
  insert into public.star_transactions(classroom_id, student_id, stars_delta, reason, created_by)
  values (v_stu.classroom_id, p_student_id, p_stars_delta, coalesce(left(p_reason, 200), ''), auth.uid());
  return v_new;
end $$;

create or replace function public.teacher_adjust_stars_bulk(p_student_ids uuid[], p_stars_delta integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; v_count integer;
begin
  if p_stars_delta is null or p_stars_delta = 0 or abs(p_stars_delta) > 100000 then raise exception 'จำนวนดาวไม่ถูกต้อง'; end if;
  if p_student_ids is null or cardinality(p_student_ids) = 0 or cardinality(p_student_ids) > 500 then raise exception 'เลือกนักเรียน 1-500 คน'; end if;
  if cardinality(p_student_ids) <> (select count(distinct x) from unnest(p_student_ids) x) then raise exception 'มีรายชื่อนักเรียนซ้ำในรายการ'; end if;
  -- ล็อกทุกแถวก่อนตรวจและแก้ไข เพื่อให้การให้/หักดาวทั้งชุดเป็น atomic
  perform 1 from public.students s where s.id = any(p_student_ids) order by s.id for update;
  select count(*) into v_count from public.students s
   where s.id = any(p_student_ids) and s.active and public.is_member(s.classroom_id);
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

revoke execute on function public.teacher_adjust_stars(uuid, integer, text), public.teacher_adjust_stars_bulk(uuid[], integer, text) from public, anon;
grant execute on function public.teacher_adjust_stars(uuid, integer, text), public.teacher_adjust_stars_bulk(uuid[], integer, text) to authenticated;
