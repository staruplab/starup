-- STAR UP! Student approval notifications
-- Safe additive replacement of get_student_portal: preserves the existing portal payload
-- and adds stable transaction IDs plus redemption handled_at for client-side notifications.
create or replace function public.get_student_portal(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
    'missions',coalesce((select jsonb_agg(jsonb_build_object('id',mi.id,'title',mi.title,'description',mi.description,'category',mi.category,'due_at',mi.due_at,'reward_stars',mi.reward_stars,'is_urgent',mi.is_urgent,'start_at',mi.start_at,'urgent_until',mi.urgent_until,'alert_seconds',mi.alert_seconds) order by mi.is_urgent desc,mi.created_at desc) from public.missions mi where mi.classroom_id=v_stu.classroom_id and mi.active and (mi.due_at is null or mi.due_at>=now())),'[]'::jsonb),
    'mission_submissions',coalesce((select jsonb_agg(jsonb_build_object('id',ms.id,'mission_id',ms.mission_id,'mission_title',mi.title,'status',ms.status,'teacher_note',ms.teacher_note,'created_at',ms.created_at) order by ms.created_at desc) from public.mission_submissions ms join public.missions mi on mi.id=ms.mission_id where ms.student_id=v_stu.id),'[]'::jsonb),
    'leaderboard',coalesce((select jsonb_agg(jsonb_build_object('name',l.full_name,'stars',l.stars,'profile_icon',l.profile_icon) order by l.stars desc,l.full_name) from public.students l where l.classroom_id=v_stu.classroom_id and l.active),'[]'::jsonb)
  );
end $$;
grant execute on function public.get_student_portal(text) to anon,authenticated;

notify pgrst, 'reload schema';
