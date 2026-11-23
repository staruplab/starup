/* STAR UP! Quiz module — ใช้ร่วมกันทั้งหน้าครูและนักเรียน (ต้องรัน migration_quiz_system.sql ก่อน) */
(function(){
const Q={lib:[],sessions:[],attempts:[],dailySchedules:[],room:null,loaded:false,ch:null,chRoom:null,timer:null,clock:null,wizardStep:1,lastSchedulerTick:0};
const num=(v,d)=>{v=Number(v);return Number.isFinite(v)?v:d};
function chan(room,onMsg){if(!(typeof supa!=='undefined'&&supa)||!room)return null;if(Q.ch&&Q.chRoom===room)return Q.ch;try{if(Q.ch)supa.removeChannel(Q.ch)}catch(e){}Q.chRoom=room;Q.ch=supa.channel('quiz:'+room,{config:{broadcast:{self:false}}});if(onMsg)Q.ch.on('broadcast',{event:'q'},onMsg);Q.ch.subscribe();return Q.ch}
function ping(){try{chan(activeRoom)?.send({type:'broadcast',event:'q',payload:{t:Date.now()}})}catch(e){}}
const isTeacherPage=()=>typeof renderTeacher==='function'&&typeof teacherContent==='function';

/* ================= ฝั่งครู ================= */
async function quizLoad(){
  if(!(typeof supa!=='undefined'&&supa)||!activeRoom)return;const room=activeRoom;
  try{
    if(Date.now()-Q.lastSchedulerTick>30000){Q.lastSchedulerTick=Date.now();await supa.rpc('quiz_scheduler_tick')}
    const [a,b]=await Promise.all([supa.from('quizzes').select('*,quiz_questions(*)').eq('teacher_id',user.id).order('updated_at',{ascending:false}),
      supa.from('quiz_sessions').select('*').eq('classroom_id',room).order('created_at',{ascending:false}).limit(12)]);
    if(a.error)throw a.error;if(b.error)throw b.error;
    Q.lib=a.data||[];Q.sessions=b.data||[];Q.room=room;Q.loaded=true;
    const ds=await supa.rpc('teacher_list_daily_quiz_schedules',{p_classroom_id:room});Q.dailySchedules=ds.error?[]:(ds.data||[]);
    const live=Q.sessions.find(s=>s.status!=='finished');
    if(live){const r=await supa.from('quiz_attempts').select('student_id,submitted_at,started_at,answers').eq('session_id',live.id);Q.attempts=r.data||[]}else Q.attempts=[];
    if(view==='quiz')renderTeacher();
  }catch(e){toast('โหลด Quiz ไม่สำเร็จ (ต้องรัน migration_quiz_system.sql ก่อน): '+(e.message||e))}
}
function quizTick(){clearInterval(Q.timer);clearInterval(Q.clock);Q.timer=setInterval(()=>{if(view!=='quiz'||document.hidden||document.getElementById('modalback')?.classList.contains('show'))return;quizLoad()},7000);Q.clock=setInterval(()=>{document.querySelectorAll('[data-quiz-end]').forEach(el=>{const left=Math.max(0,Math.ceil((Number(el.dataset.quizEnd)-Date.now())/1000));el.textContent=`${el.dataset.quizPrefix||'เวลาเหลือ'} ${el.dataset.quizPrefix==='เริ่มใน'?fmtLeft(left):Math.floor(left/60)+':'+String(left%60).padStart(2,'0')}`;if(left===0)quizLoad()})},1000)}
Q.histOpen=false;Q.histLimit=5;
const chip=(t,bg,fg)=>`<span class="badge" style="background:${bg};color:${fg}">${t}</span>`;
window.quizHistToggle=()=>{Q.histOpen=!Q.histOpen;renderTeacher(isDemo())};
window.quizHistMore=()=>{Q.histLimit+=5;renderTeacher(isDemo())};
function quizTeacherPage(){
  if(!Q.loaded||Q.room!==activeRoom){Q.loaded=false;quizLoad()}
  chan(activeRoom);quizTick();
  const live=Q.sessions.find(s=>s.status!=='finished');
  const roster=(typeof currentStudents==='function'?currentStudents():students)||[];
  const am=new Map(Q.attempts.map(a=>[a.student_id,a]));
  const done=roster.filter(s=>am.get(s.id)?.submitted_at),doing=roster.filter(s=>am.has(s.id)&&!am.get(s.id).submitted_at),wait=roster.filter(s=>!am.has(s.id));
  const names=a=>a.map(s=>esc(s.full_name)).join(', ')||'-',pct=roster.length?Math.round(done.length*100/roster.length):0,answered=a=>Object.keys(am.get(a.id)?.answers||{}).length;
  const liveHtml=live?`<article class="itemcard" style="margin-top:8px"><div class="split"><h4 style="margin:0">${esc(live.title)}</h4>${chip(live.status==='scheduled'?'🗓️ ตั้งเวลาแล้ว':live.status==='lobby'?'⏳ รอเริ่ม':live.status==='paused'?'⏸ พักชั่วคราว':'🔴 กำลังทำ',live.status==='paused'?'#eee':'#fff3d8',live.status==='paused'?'#555':'#94600e')}</div><div class="tiny muted">ทำพร้อมกันด้วยเวลารวม • ${live.questions?.length||0} ข้อ • ${Math.round((live.time_limit_seconds||0)/60)} นาที</div>${live.status==='scheduled'?`<div class="quiz-room-clock" data-quiz-end="${new Date(live.scheduled_start_at||0).getTime()}" data-quiz-prefix="เริ่มใน" style="font-size:24px;font-weight:800;text-align:center;margin:8px 0">รอเวลาเริ่ม…</div>`:live.status==='live'?`<div class="quiz-room-clock" data-quiz-end="${new Date(live.ends_at||0).getTime()}" style="font-size:24px;font-weight:800;text-align:center;margin:8px 0">กำลังนับเวลา…</div>`:''}
  <div style="background:#eee;border-radius:8px;height:10px;margin:10px 0"><div style="width:${pct}%;background:#34c38f;height:10px;border-radius:8px"></div></div>
  <div class="actions">${chip('👥 ทั้งห้อง '+roster.length,'#f2efff','#5546a3')}${chip('✍️ กำลังทำ '+doing.length,'#fff3d8','#94600e')}${chip('✅ เสร็จแล้ว '+done.length,'#e6f7ee','#2c7a4b')}${chip('⚪ ยังไม่ได้ทำ '+wait.length,'#fde8eb','#a43d54')}</div>
  <details open style="margin-top:8px"><summary><b>⚪ ยังไม่ได้ทำ (${wait.length})</b></summary><div class="tiny">${names(wait)}</div></details>
  <details style="margin-top:6px" open><summary><b>✍️ กำลังทำ (${doing.length})</b></summary>${doing.map(st=>`<div class="listrow"><span>${esc(st.full_name)}</span><b>${answered(st)}/${live.questions?.length||0} ข้อ</b></div>`).join('')||'<div class="tiny muted">ยังไม่มีนักเรียนกำลังทำ</div>'}</details>
  <details style="margin-top:6px"><summary><b>✅ เสร็จแล้ว (${done.length})</b></summary><div class="tiny">${names(done)}</div></details>
  <div class="actions" style="margin-top:10px">${live.status==='lobby'?`<button class="btn primary small" onclick="quizBegin('${live.id}')">▶ เริ่ม Quiz</button>`:''}${live.status==='live'?`<button class="btn white small" onclick="quizPause('${live.id}')">⏸ พัก Quiz</button>`:''}${live.status==='paused'?`<button class="btn primary small" onclick="quizResume('${live.id}')">▶ ทำต่อ</button>`:''}<button class="btn gold small" onclick="quizFinish('${live.id}')">⏹ จบรอบและเฉลย</button></div></article>`:'<div class="empty">🎉 ไม่มี Quiz ที่กำลังดำเนินอยู่</div>';
  const hist=Q.sessions.filter(s=>s.status==='finished');
  const row=s=>`<div class="listrow"><div><b>${esc(s.title)}</b><div class="tiny muted">${new Date(s.created_at).toLocaleString('th-TH')}</div></div><button class="btn soft small" onclick="quizResults('${s.id}')">ดูผล</button></div>`;
  const histHtml=Q.histOpen?(hist.length?hist.slice(0,Q.histLimit).map(row).join('')+(hist.length>Q.histLimit?`<button class="btn soft" style="width:100%;margin-top:10px" onclick="quizHistMore()">ดูเพิ่มเติม (${hist.length-Q.histLimit} รายการ)</button>`:''):'<div class="empty">ยังไม่มีประวัติ Quiz ในห้องนี้</div>'):'';
  return `<section class="panel"><div class="split"><div><h3>🧠 จัดการ Quiz</h3><div class="tiny muted">เปิด Quiz ให้ทั้งห้องทำพร้อมกัน ดูสถานะสดและผลคะแนนได้ที่นี่</div></div><div class="actions"><button class="btn soft" onclick="quizLibrary()">📚 คลัง Quiz</button><button class="btn primary" onclick="quizEdit(null)">＋ สร้าง Quiz</button></div></div><div style="margin:16px 0 8px;padding:10px 12px;border-radius:12px;background:#f2efff;color:#5546a3;font-weight:800">🟢 Quiz ที่กำลังดำเนินอยู่ (${live?1:0})</div>${liveHtml}<section class="panel" style="margin-top:14px"><div class="split"><div><strong>🔁 Quiz ประจำวัน</strong><div class="tiny muted">ระบบเปิด Quiz อัตโนมัติตามวันที่และเวลาที่กำหนด</div></div><span class="badge">${Q.dailySchedules.filter(x=>x.active).length} ตาราง</span></div>${Q.dailySchedules.filter(x=>x.active).map(x=>`<div class="listrow"><div><b>${esc(x.quiz_title||'Quiz')}</b><div class="tiny muted">${String(x.start_time||'').slice(0,5)} น. · ${(x.repeat_days||[]).length===7?'ทุกวัน':(x.repeat_days||[]).map(d=>['','จ','อ','พ','พฤ','ศ','ส','อา'][d]).join(' ')}</div></div><button class="btn red small" onclick="quizCancelDaily('${x.id}')">ปิดตาราง</button></div>`).join('')||'<div class="empty">ยังไม่มี Quiz ประจำวัน</div>'}</section><div class="split" style="margin-top:16px"><div><strong>🗂️ ประวัติ Quiz</strong><div class="tiny muted">ผลคะแนนและอันดับของแต่ละรอบ</div></div><button class="btn soft" onclick="quizHistToggle()">${Q.histOpen?'ซ่อนประวัติ':'ดูประวัติ Quiz'}</button></div>${histHtml}</section>`;
}
window.quizLibrary=()=>{
  const live=Q.sessions.find(s=>s.status!=='finished');
  modal(`<h3>📚 คลัง Quiz ส่วนตัว</h3><p class="tiny muted">เลือก Quiz เพื่อเปิดในห้องเรียนปัจจุบัน ใช้ซ้ำได้ทุกห้อง ต้นฉบับในคลังจะไม่เปลี่ยน</p><div style="max-height:62vh;overflow:auto">${Q.lib.map(z=>`<div class="listrow"><div style="min-width:0;flex:1"><b>${esc(z.title)}</b><div class="tiny muted">${(z.quiz_questions||[]).length} ข้อ • ${z.mode==='host_paced'?'ครูคุมทีละข้อ':'เวลารวม '+Math.round(z.time_limit_seconds/60*10)/10+' นาที'}${z.shuffle?' • สลับข้อ':''}</div></div><div class="actions"><button class="btn primary small" ${live?'disabled':''} onclick="quizOpen('${z.id}')">นำไปใช้</button><button class="btn soft small" onclick="quizEdit('${z.id}')">แก้ไข</button><button class="btn white small" onclick="quizDuplicate('${z.id}')">คัดลอก</button><button class="btn red small" onclick="quizDelete('${z.id}')">ลบ</button></div></div>`).join('')||'<div class="empty">ยังไม่มี Quiz ในคลัง กด “＋ สร้าง Quiz” ได้เลย</div>'}</div><div class="modalfoot"><button class="btn white" onclick="closeModal()">ปิด</button></div>`)
};
function qBlock(q,i){const ch=q?.choices||['',''];return `<div class="panel qz-q" style="padding:10px;margin:8px 0"><textarea class="field qz-body" rows="2" placeholder="โจทย์ข้อที่ ${i+1}">${esc(q?.body||'')}</textarea><div class="qz-choices">${ch.map((c,k)=>chBlock(c,k,q?.correct_index===k||(!q&&k===0),i)).join('')}</div><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn white small" onclick="quizAddChoice(this)">+ ตัวเลือก</button><label class="tiny">คะแนน <input class="field qz-pts" type="number" min="1" value="${q?.points||1}" style="width:70px"></label><button type="button" class="btn white small" onclick="this.closest('.qz-q').remove()">ลบข้อนี้</button></div></div>`}
function chBlock(c,k,checked,i){return `<div class="row" style="gap:6px;margin:4px 0"><input type="radio" name="qzc${i}" class="qz-correct" ${checked?'checked':''} title="ข้อที่ถูก"><input class="field qz-choice" value="${esc(c)}" placeholder="ตัวเลือก ${k+1}"></div>`}
let qzSeq=1000;
window.quizAddChoice=btn=>{const box=btn.closest('.qz-q').querySelector('.qz-choices');if(box.children.length>=6)return toast('ได้สูงสุด 6 ตัวเลือก');const name=box.querySelector('.qz-correct').name;const d=document.createElement('div');d.innerHTML=chBlock('',box.children.length,false,0);const e=d.firstChild;e.querySelector('.qz-correct').name=name;box.append(e)};
window.quizAddQuestion=()=>{const d=document.createElement('div');d.innerHTML=qBlock(null,++qzSeq);document.getElementById('qzQs').append(d.firstChild)};
window.quizEdit=id=>{
  const z=id?Q.lib.find(x=>x.id===id):null,qs=z?[...(z.quiz_questions||[])].sort((a,b)=>a.position-b.position):[null];
  Q.wizardStep=1;
  modal(`<h3>${z?'✏️ แก้ไข Quiz':'➕ สร้าง Quiz ใหม่'}</h3>
  <div class="tiny muted" style="margin:6px 0 12px">ทำทีละขั้นตอน ตั้งค่า → เพิ่มคำถาม → ตรวจสอบ → บันทึก</div>
  <div style="display:flex;gap:5px;margin-bottom:14px">${[1,2,3,4].map((n)=>`<div id="qzStepDot${n}" style="height:6px;flex:1;border-radius:9px;background:${n===1?'#25a56a':'#e5e7eb'}"></div>`).join('')}</div>
  <div id="qzWizardBody" style="max-height:62vh;overflow:auto">
    <section data-qz-step="1"><h4>ขั้นที่ 1 · ข้อมูล Quiz</h4><label>ชื่อ Quiz</label><input class="field" id="qzTitle" placeholder="เช่น แบบทดสอบเรื่องเศษส่วน" value="${esc(z?.title||'')}"><label>คำอธิบาย (ไม่บังคับ)</label><textarea class="field" id="qzDescription" rows="2" placeholder="รายละเอียดหรือคำชี้แจง">${esc(z?.description||'')}</textarea><label>เวลารวม (นาที)</label><input class="field" id="qzTime" type="number" min="1" max="240" value="${Math.max(1,Math.round((z?.time_limit_seconds||600)/60))}"><div class="notice info" style="margin-top:10px">เมื่่อครูกดเริ่ม นักเรียนทุกคนจะเริ่มนับเวลาพร้อมกัน ผู้เข้าทีหลังจะได้เฉพาะเวลาที่เหลือ</div><label style="display:block;margin-top:10px"><input type="checkbox" id="qzShuffle" ${z?.shuffle?'checked':''}> สุ่มลำดับข้อและตัวเลือก (เลือกเปิด/ปิดได้)</label></section>
    <section data-qz-step="2" hidden><h4>ขั้นที่ 2 · เพิ่มคำถามและตัวเลือก</h4><div class="tiny muted">ตอบถูก 1 ข้อ = 1 คะแนน = 1 ดาว</div><div id="qzQs">${qs.map((q,i)=>qBlock(q,i)).join('')}</div><button type="button" class="btn white" onclick="quizAddQuestion()">＋ เพิ่มข้อคำถาม</button></section>
    <section data-qz-step="3" hidden><h4>ขั้นที่ 3 · ตรวจสอบตัวอย่าง</h4><div id="qzPreview" class="panel" style="padding:12px"></div><div class="notice info">ตรวจคำถาม ตัวเลือก และคำตอบที่ถูกต้องก่อนบันทึก</div></section>
    <section data-qz-step="4" hidden><h4>ขั้นที่ 4 · พร้อมใช้งาน</h4><div class="notice success">บันทึก Quiz ลงคลังส่วนตัวแล้ว จากนั้นเลือก “นำไปใช้” เพื่อเปิดรอบในห้องเรียน</div><p>การบันทึกในขั้นนี้ยังไม่เริ่มจับเวลานักเรียน ครูเป็นผู้กดเริ่มรอบเอง</p></section>
  </div>
  <div class="modalfoot"><button class="btn white" onclick="closeModal()">ยกเลิก</button><button class="btn white" id="qzPrev" onclick="quizWizardMove(-1)" style="display:none">ย้อนกลับ</button><button class="btn primary" id="qzNext" onclick="quizWizardMove(1)">ถัดไป</button><button class="btn primary" id="qzSave" onclick="quizSave('${id||''}')" style="display:none">บันทึก Quiz</button></div>`);
};
function quizWizardValidate(step){
 if(step===1){if(!$('#qzTitle')?.value.trim())return toast('กรุณาตั้งชื่อ Quiz'),false;const t=num($('#qzTime')?.value,0);if(t<1||t>240)return toast('กำหนดเวลา 1–240 นาที'),false}
 if(step===2){const els=[...document.querySelectorAll('.qz-q')];if(!els.length)return toast('เพิ่มคำถามอย่างน้อย 1 ข้อ'),false;for(const [i,el] of els.entries()){const ch=[...el.querySelectorAll('.qz-choice')].map(x=>x.value.trim()),ci=[...el.querySelectorAll('.qz-correct')].findIndex(x=>x.checked);if(!el.querySelector('.qz-body').value.trim()||ch.length<2||ch.some(x=>!x)||ci<0)return toast(`ข้อ ${i+1}: กรอกโจทย์ ตัวเลือก และเลือกคำตอบที่ถูกให้ครบ`),false}}
 return true;
}
window.quizWizardMove=dir=>{if(dir>0&&!quizWizardValidate(Q.wizardStep))return;Q.wizardStep=Math.max(1,Math.min(4,Q.wizardStep+dir));document.querySelectorAll('[data-qz-step]').forEach(x=>x.hidden=Number(x.dataset.qzStep)!==Q.wizardStep);for(let i=1;i<=4;i++){const d=$('#qzStepDot'+i);if(d)d.style.background=i<=Q.wizardStep?'#25a56a':'#e5e7eb'}$('#qzPrev').style.display=Q.wizardStep===1?'none':'';$('#qzNext').style.display=Q.wizardStep===4?'none':'';$('#qzSave').style.display=Q.wizardStep===4?'':'none';if(Q.wizardStep===3){const title=esc($('#qzTitle').value),items=[...document.querySelectorAll('.qz-q')].map((el,i)=>{const choices=[...el.querySelectorAll('.qz-choice')].map(x=>x.value.trim()),ci=[...el.querySelectorAll('.qz-correct')].findIndex(x=>x.checked);return `<div style="margin:10px 0"><b>${i+1}. ${esc(el.querySelector('.qz-body').value)}</b>${choices.map((c,k)=>`<div style="padding:5px 8px;background:${k===ci?'#e2f6e9':'#f6f6f6'};border-radius:7px;margin:3px 0">${k===ci?'✓ ':''}${esc(c)}</div>`).join('')}</div>`}).join('');$('#qzPreview').innerHTML=`<h4>${title}</h4><div class="tiny muted">${$('#qzTime').value} นาที • ${items?document.querySelectorAll('.qz-q').length:0} ข้อ</div>${items}`}};
window.quizSave=async id=>{
 try{
  if(!quizWizardValidate(1)||!quizWizardValidate(2))return;
  const title=$('#qzTitle').value.trim(),description=$('#qzDescription').value.trim();
  const qs=[...document.querySelectorAll('.qz-q')].map((el,i)=>{const ch=[...el.querySelectorAll('.qz-choice')].map(x=>x.value.trim());const ci=[...el.querySelectorAll('.qz-correct')].findIndex(x=>x.checked);return {body:el.querySelector('.qz-body').value.trim(),choices:ch,correct_index:ci,points:1,position:i}});
  const row={title,description,mode:'self_paced',time_limit_seconds:Math.max(60,Math.round(num($('#qzTime').value,10)*60)),per_question_seconds:20,shuffle:$('#qzShuffle').checked,rank_bonus:[],star_rules:[],updated_at:new Date().toISOString()};
  let qid=id;
  if(id){const r=await supa.from('quizzes').update(row).eq('id',id);if(r.error)throw r.error;const d=await supa.from('quiz_questions').delete().eq('quiz_id',id);if(d.error)throw d.error}
  else{const r=await supa.from('quizzes').insert({...row,teacher_id:user.id}).select().single();if(r.error)throw r.error;qid=r.data.id}
  const ins=await supa.from('quiz_questions').insert(qs.map(q=>({...q,quiz_id:qid})));if(ins.error)throw ins.error;
  await quizLoad();quizLibrary();toast('บันทึก Quiz แล้ว');
 }catch(e){toast(e.message||String(e))}
};
window.quizDuplicate=async id=>{try{const z=Q.lib.find(x=>x.id===id);if(!z)throw new Error('ไม่พบ Quiz ต้นฉบับ');const row={teacher_id:user.id,title:(z.title||'Quiz')+' (สำเนา)',description:z.description||'',mode:'self_paced',time_limit_seconds:z.time_limit_seconds||600,per_question_seconds:z.per_question_seconds||20,shuffle:!!z.shuffle,rank_bonus:[],star_rules:[]};const r=await supa.from('quizzes').insert(row).select().single();if(r.error)throw r.error;const qs=(z.quiz_questions||[]).map((q,i)=>({quiz_id:r.data.id,position:i,body:q.body,choices:q.choices,correct_index:q.correct_index,points:1}));if(qs.length){const a=await supa.from('quiz_questions').insert(qs);if(a.error)throw a.error}await quizLoad();quizLibrary();toast('คัดลอก Quiz แล้ว ต้นฉบับไม่เปลี่ยนแปลง')}catch(e){toast(e.message||String(e))}};
window.quizDelete=id=>askConfirmButtons('ลบ Quiz นี้ออกจากคลัง? (ประวัติผลในห้องยังอยู่)','ลบ',async()=>{const r=await supa.from('quizzes').delete().eq('id',id);if(r.error)return toast(r.error.message);await quizLoad();quizLibrary()});
async function rpcDo(name,args,msg){try{const r=await supa.rpc(name,args);if(r.error)throw r.error;ping();await quizLoad();if(msg)toast(msg);return r.data}catch(e){toast(e.message||String(e))}}
window.quizOpen=id=>{
  const z=Q.lib.find(x=>x.id===id);if(!z)return toast('ไม่พบ Quiz ในคลัง');
  const d=new Date(Date.now()+5*60000);d.setSeconds(0,0);d.setMinutes(Math.ceil(d.getMinutes()/5)*5);
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  modal(`<h3>🚀 เปิดใช้ Quiz: ${esc(z.title)}</h3>
    <p class="tiny muted">เลือกเริ่มทันที หรือกำหนดวันและเวลาให้ระบบเริ่มอัตโนมัติ</p>
    <div class="panel" style="padding:12px;margin:10px 0">
      <label style="display:block;margin:6px 0"><input type="radio" name="qzStartMode" value="now" checked onchange="quizStartModeChanged()"> เริ่มทันที (ครูเป็นผู้กดเริ่ม)</label>
      <label style="display:block;margin:6px 0"><input type="radio" name="qzStartMode" value="scheduled" onchange="quizStartModeChanged()"> กำหนดวันและเวลา เริ่มครั้งเดียวอัตโนมัติ</label>
      <label style="display:block;margin:6px 0"><input type="radio" name="qzStartMode" value="daily" onchange="quizStartModeChanged()"> Quiz ประจำวัน เริ่มอัตโนมัติตามตาราง</label>
      <div id="qzScheduleFields" hidden style="margin-top:12px">
        <label>วันและเวลาเริ่ม</label><input class="field" id="qzScheduledAt" type="datetime-local" value="${local}" min="${local}">
        <div class="tiny muted">ระบบใช้เวลาเขตประเทศไทย (Asia/Bangkok) และเริ่มตามเวลาที่กำหนด</div>
      </div>
      <div id="qzDailyFields" hidden style="margin-top:12px">
        <label>เวลาเริ่มประจำวัน</label><input class="field" id="qzDailyTime" type="time" value="08:00">
        <label style="display:block;margin:10px 0 6px">วันที่ให้เปิด Quiz</label>
        <div class="row" style="gap:7px;flex-wrap:wrap">${[[1,'จ'],[2,'อ'],[3,'พ'],[4,'พฤ'],[5,'ศ'],[6,'ส'],[7,'อา']].map(([d,n])=>`<label class="badge" style="cursor:pointer"><input type="checkbox" class="qzDailyDay" value="${d}" checked> ${n}</label>`).join('')}</div>
        <div class="tiny muted" style="margin-top:7px">เมื่อถึงเวลานี้ในวันที่เลือก ระบบจะเปิด Quiz และเริ่มจับเวลาเองทุกวัน ไม่ต้องให้ครูกดเริ่ม</div>
      </div>
    </div>
    <div class="modalfoot"><button class="btn white" onclick="closeModal()">ยกเลิก</button><button class="btn primary" onclick="quizConfirmOpen('${id}')">ยืนยันเปิด Quiz</button></div>`)
};
window.quizStartModeChanged=()=>{const mode=document.querySelector('input[name="qzStartMode"]:checked')?.value||'now';const a=$('#qzScheduleFields'),b=$('#qzDailyFields');if(a)a.hidden=mode!=='scheduled';if(b)b.hidden=mode!=='daily'};
window.quizConfirmOpen=async id=>{
  const mode=document.querySelector('input[name="qzStartMode"]:checked')?.value||'now';let r;
  if(mode==='scheduled'){
    const raw=$('#qzScheduledAt')?.value;if(!raw)return toast('กรุณากำหนดวันและเวลา');
    const dt=new Date(raw);if(!Number.isFinite(dt.getTime())||dt.getTime()<=Date.now()+5000)return toast('เวลาเริ่มต้องเป็นเวลาในอนาคต');
    r=await rpcDo('teacher_schedule_quiz',{p_quiz_id:id,p_classroom_id:activeRoom,p_scheduled_start_at:dt.toISOString()},'ตั้งเวลา Quiz แล้ว ระบบจะเริ่มให้อัตโนมัติตามกำหนด');
  }else if(mode==='daily'){
    const tm=$('#qzDailyTime')?.value,days=[...document.querySelectorAll('.qzDailyDay:checked')].map(x=>Number(x.value));
    if(!tm)return toast('กรุณากำหนดเวลาเริ่มประจำวัน');if(!days.length)return toast('กรุณาเลือกวันที่อย่างน้อย 1 วัน');
    r=await rpcDo('teacher_create_daily_quiz_schedule',{p_quiz_id:id,p_classroom_id:activeRoom,p_start_time:tm,p_repeat_days:days},'ตั้ง Quiz ประจำวันแล้ว ระบบจะเปิดให้อัตโนมัติตามตาราง');
  }else r=await rpcDo('teacher_open_quiz',{p_quiz_id:id,p_classroom_id:activeRoom},'เปิด Quiz แล้ว นักเรียนจะเห็นหน้าต่างแจ้งเตือน');
  if(r)closeModal();
};
window.quizCancelDaily=id=>askConfirmButtons('ปิดตาราง Quiz ประจำวันนี้หรือไม่? รอบที่เริ่มไปแล้วจะไม่ถูกลบ','ปิดตาราง',()=>rpcDo('teacher_cancel_daily_quiz_schedule',{p_schedule_id:id},'ปิดตาราง Quiz ประจำวันแล้ว'));
window.quizBegin=id=>rpcDo('teacher_begin_quiz',{p_session:id},'เริ่ม Quiz แล้ว');
window.quizPause=id=>rpcDo('teacher_pause_quiz',{p_session:id},'พัก Quiz แล้ว');
window.quizResume=id=>rpcDo('teacher_resume_quiz',{p_session:id},'ทำ Quiz ต่อแล้ว');
window.quizNext=id=>rpcDo('teacher_next_question',{p_session:id});
window.quizFinish=id=>askConfirmButtons('จบรอบนี้และเฉลยให้นักเรียนทุกคนใช่ไหม? ผู้ที่ยังไม่ส่งจะถูกตรวจจากคำตอบที่มี','จบรอบ',()=>rpcDo('teacher_finish_quiz',{p_session:id},'จบรอบและให้ดาวเรียบร้อย'));
window.quizResults=async sid=>{
  try{
    const s=Q.sessions.find(x=>x.id===sid);
    const [a,st]=await Promise.all([supa.from('quiz_attempts').select('*,students(full_name)').eq('session_id',sid),supa.rpc('teacher_quiz_stats',{p_session:sid})]);
    if(a.error)throw a.error;if(st.error)throw st.error;
    const at=(a.data||[]).filter(x=>x.submitted_at).sort((x,y)=>y.score-x.score||(new Date(x.submitted_at)-new Date(x.started_at))-(new Date(y.submitted_at)-new Date(y.started_at)));
    const doneIds=new Set(at.map(x=>x.student_id)),missing=students.filter(x=>!doneIds.has(x.id));
    window.__quizExport={title:s.title,questions:s.questions||[],rows:at.map((x,i)=>[i+1,x.students?.full_name,x.submitted_at?'ส่งแล้ว':'ไม่ส่ง',Object.keys(x.answers||{}).length,x.score,x.max_score,x.stars_awarded,x.submitted_at||''])};
    modal(`<h3>📊 ${esc(s.title)}</h3><div style="max-height:68vh;overflow:auto"><h4>🏆 อันดับ</h4>${at.map((x,i)=>`<div class="listrow"><div class="row"><b class="rank">${['🥇','🥈','🥉'][i]||i+1}</b><span>${esc(x.students?.full_name||'')}</span></div><b>${x.score}/${x.max_score} • ⭐${x.stars_awarded}</b></div>`).join('')||'<p class="muted">ไม่มีผู้ส่งคำตอบ</p>'}<h4>📈 สถิติรายข้อ (ตอบถูกกี่ %)</h4>${(st.data||[]).map(q=>{const p=q.answered?Math.round(q.correct*100/q.answered):0;return `<div class="listrow"><span>${q.index+1}. ${esc(q.body).slice(0,60)}</span><b style="color:${p<50?'#c0392b':'inherit'}">${p}% (${q.correct}/${q.answered})</b></div>`}).join('')}${missing.length?`<h4>⚪ ไม่ได้ทำ (${missing.length})</h4><div class="tiny">${missing.map(x=>esc(x.full_name)).join(', ')}</div>`:''}</div><div class="modalfoot"><button class="btn white" onclick="quizExportXlsx('${sid}')">⬇ Excel (.xlsx)</button><button class="btn white" onclick="closeModal()">ปิด</button></div>`)
  }catch(e){toast(e.message||String(e))}
};
function quizLoadExcelLib(){return new Promise((resolve,reject)=>{if(window.ExcelJS)return resolve();const t=document.createElement('script');t.src='https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';t.onload=()=>window.ExcelJS?resolve():reject(new Error('ไม่พบ ExcelJS'));t.onerror=()=>reject(new Error('โหลด ExcelJS ไม่สำเร็จ'));document.head.append(t)})}
window.quizExportXlsx=async sid=>{try{await quizLoadExcelLib();const s=Q.sessions.find(x=>x.id===sid);if(!s)throw new Error('ไม่พบข้อมูล Quiz');const [ar]=await Promise.all([supa.from('quiz_attempts').select('*,students(full_name)').eq('session_id',sid)]);if(ar.error)throw ar.error;const attempts=ar.data||[];const wb=new ExcelJS.Workbook();const qws=wb.addWorksheet('ข้อสอบ');qws.addRow(['ลำดับ','คำถาม','ตัวเลือก A','ตัวเลือก B','ตัวเลือก C','ตัวเลือก D','คำตอบที่ถูก']);(s.questions||[]).forEach((q,i)=>qws.addRow([i+1,q.body,...(q.choices||[]),String.fromCharCode(65+(q.correct_index||0))]));const rws=wb.addWorksheet('ผลนักเรียน');rws.addRow(['อันดับ','ชื่อนักเรียน','สถานะ','จำนวนข้อที่ตอบ','คะแนน','คะแนนเต็ม','ดาว','เวลาส่ง']);attempts.sort((a,b)=>(b.score||0)-(a.score||0)).forEach((a,i)=>rws.addRow([i+1,a.students?.full_name||'',a.submitted_at?'ส่งแล้ว':'ยังไม่ส่ง',Object.keys(a.answers||{}).length,a.score||0,a.max_score||s.questions?.length||0,a.stars_awarded||0,a.submitted_at||'']));for(const ws of [qws,rws]){ws.getRow(1).font={bold:true};ws.columns.forEach(c=>c.width=22)}const buf=await wb.xlsx.writeBuffer();const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Quiz_${(s.title||'STARUP').replace(/[^\wก-๙-]/g,'_')}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000)}catch(e){toast('ส่งออก Excel ไม่สำเร็จ: '+(e.message||e))}};

if(isTeacherPage()){const _tc=teacherContent;window.teacherContent=teacherContent=function(){return view==='quiz'?quizTeacherPage():_tc.apply(this,arguments)}}

/* ================= ฝั่งนักเรียน ================= */
const S={entered:new Set(),errShown:false,st:null,off:0,dismissed:null,res:null,timer:null,poll:null,busy:false,tick:null,sig:'',warned:new Set(),answerBusy:new Set()};
const now=()=>Date.now()+S.off;
const quizDismissKey=id=>`starup-quiz-dismissed:${id}`;
/* จำการปิดไว้ก่อน "ตามสถานะ" ของรอบนั้น: เมื่อเปลี่ยนจากรอเวลา -> เริ่มทำได้ จะเด้งแจ้งเตือนใหม่เสมอ */
function quizStage(ses){if(!ses)return '';if(ses.status!=='scheduled')return ses.status;const left=Math.ceil((new Date(ses.scheduled_start_at||0).getTime()-now())/1000);return 'scheduled:'+(left<=300?'5':left<=1800?'30':'far')}
function quizWasDismissed(id){try{return localStorage.getItem(quizDismissKey(id))===quizStage(S.st?.session)}catch(e){return S.dismissed===id}}
function quizRememberDismissed(id){S.dismissed=id;try{localStorage.setItem(quizDismissKey(id),quizStage(S.st?.session))}catch(e){}}
const fmtLeft=s=>{s=Math.max(0,s);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),ss=s%60;return d?`${d} วัน ${h} ชม. ${m} นาที`:h?`${h} ชม. ${m} นาที`:`${m} นาที ${String(ss).padStart(2,'0')} วินาที`};
const fmtDT=d=>new Date(d).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'});
function seeded(seed){let h=1779033703^seed.length;for(let i=0;i<seed.length;i++){h=Math.imul(h^seed.charCodeAt(i),3432918353);h=h<<13|h>>>19}return()=>{h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);h^=h>>>16;return(h>>>0)/4294967296}}
function shuf(a,rnd){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
/* ลำดับความสำคัญ (มาก = สำคัญกว่า): ทำ Quiz อยู่ 110 > Quiz เริ่มแล้วเข้าทีหลัง 100 > Quiz ใกล้เริ่ม ≤5 นาที 90 > ภารกิจด่วน 80 > Quiz เตรียมตัว ≤30 นาที 70 > หน้ารอเริ่ม 60 > ภารกิจสำเร็จ/ได้รางวัล 50 > ผลคะแนน/รอเฉลย 40 > ข่าวทั่วไป 30 */
const noticePri=k=>k==='urgent_mission'?80:(k==='approved'||k==='reward_approved')?50:30;
const noticeShownPri=()=>Number(document.getElementById('starupStudentNotice')?.dataset.pri||0);
const quizPriNow=()=>Number(document.getElementById('quizOverlay')?.dataset.pri||0);
const kickNotices=ms=>setTimeout(()=>{try{showNextStudentNotice()}catch(e){}},ms);
function overlay(html,pri){
  if(pri==null)pri=/quizWaitClock|aria-label="ผลคะแนน Quiz"|รอหมดเวลาหรือครูจบ/.test(html)?40:110;
  let o=document.getElementById('quizOverlay');const old=o?Number(o.dataset.pri||0):0;
  if(!o){o=document.createElement('div');o.id='quizOverlay';o.style.cssText='position:fixed;inset:0;z-index:80;background:#f7f3ff;overflow:auto;padding:14px;font-family:inherit';document.body.append(o)}
  o.dataset.pri=String(pri);o.innerHTML=`<div style="max-width:560px;margin:0 auto">${html}</div>`;
  const nb=document.getElementById('starupStudentNotice');
  if(nb&&pri>Number(nb.dataset.pri||0)){try{clearInterval(studentNoticeCountdownTimer)}catch(e){}nb.remove()}   /* หน้าต่างแจ้งเตือนที่สำคัญน้อยกว่า ถูกพักไว้ในคิว แล้วค่อยเด้งใหม่ภายหลัง */
  if(old&&pri<old)kickNotices(300);
}
function hideOverlay(){const had=document.getElementById('quizOverlay');had?.remove();if(had)kickNotices(250)}
function fab(on,id){let b=document.getElementById('quizFab');if(!on){b?.remove();return}const lab=S.st?.session?.status==='scheduled'?'🧠 ดู Quiz ที่กำลังจะเริ่ม':'🧠 เข้าทำ Quiz';if(b){b.textContent=lab;return}b=document.createElement('button');b.id='quizFab';b.className='btn primary';b.style.cssText='position:fixed;right:14px;bottom:70px;z-index:79;box-shadow:0 4px 14px rgba(0,0,0,.25)';b.textContent=lab;b.onclick=()=>{try{localStorage.removeItem(quizDismissKey(id))}catch(e){}S.dismissed=null;S.entered.add(id);S.sig='';fab(false);sRender()};document.body.append(b)}
function popup(ses){
  try{typeof playUrgentSound==='function'&&playUrgentSound()}catch(e){}
  const ends=ses.ends_at?new Date(ses.ends_at).getTime():0;
  const left=ends?`<div style="margin:10px 0;padding:11px;border-radius:14px;background:#fff4d9;color:#8c5b0b"><div style="font-size:12px;font-weight:800">⏳ เวลาที่เหลือ</div><div data-quiz-tab-end="${ends}" data-quiz-tab-prefix="" style="font-size:24px;font-weight:900;font-variant-numeric:tabular-nums">--</div></div>`:'';
  overlay(`<div class="panel center" style="margin-top:14vh"><div class="big">🧠📢</div><span class="badge">${ends?'Quiz เริ่มแล้ว!':'Quiz ใหม่!'}</span><h2>${esc(ses.title)}</h2><p>${ends?'Quiz กำลังดำเนินอยู่ รีบเข้าไปทำก่อนหมดเวลานะ':'ครูเปิด Quiz แล้ว กดเข้าไปทำได้เลย'}</p>${left}<button class="btn primary" style="width:100%;margin-top:10px" onclick="quizEnter('${ses.id}')">เข้าทำ Quiz 🚀</button><button class="btn white small" style="margin-top:8px" onclick="quizDismiss('${ses.id}')">ไว้ก่อน</button></div>`,100)
}
function preStartPopup(ses,stage){
  const t=new Date(ses.scheduled_start_at||0).getTime(),soon=stage==='scheduled:5';
  try{soon&&typeof playUrgentSound==='function'&&playUrgentSound()}catch(e){}
  overlay(`<div class="panel center" style="margin-top:12vh"><div class="big">⏰🧠</div><span class="badge">${soon?'ใกล้ถึงเวลาแล้ว!':'เตรียมตัวทำ Quiz'}</span><h2>${esc(ses.title)}</h2><p>Quiz จะเริ่ม ${fmtDT(t)}</p><div data-quiz-tab-end="${t}" data-quiz-tab-prefix="เริ่มในอีก" style="font-size:24px;font-weight:900;margin:10px 0">--</div><div class="tiny muted" style="text-align:left;margin:6px 0 12px">✔ หาที่นั่งที่เงียบ ๆ<br>✔ เช็กอินเทอร์เน็ตและแบตเตอรี่<br>✔ เมื่อถึงเวลา กดเข้าทำ Quiz ได้ทันที</div><button class="btn primary" style="width:100%" onclick="quizGoTab('${ses.id}')">ไปที่หน้า Quiz เพื่อรอเวลา 🧠</button><button class="btn white small" style="margin-top:8px" onclick="quizDismiss('${ses.id}')">ไว้ก่อน</button></div>`,soon?90:70)
}
window.quizGoTab=id=>{quizRememberDismissed(id);hideOverlay();fab(false);try{studentTab='quiz';renderStudent();window.scrollTo(0,0)}catch(e){}};
window.quizEnter=id=>{S.entered.add(id);S.sig='';fab(false);sRender()};
async function sGet(){
  if(typeof studentToken==='undefined'||!studentToken||!(typeof supa!=='undefined'&&supa)||S.busy||(typeof previewMode!=='undefined'&&previewMode))return;
  S.busy=true;
  try{
    const r=await supa.rpc('student_get_quiz_state',{p_token:studentToken});if(r.error)throw r.error;
    S.st=r.data;S.off=new Date(r.data.server_now).getTime()-Date.now();
    const ses=S.st.session;
    const tabSig=JSON.stringify([ses?.id,ses?.status,S.st.submitted]);
    if(S.tabSig!==tabSig){S.tabSig=tabSig;dLoad();if(typeof studentTab!=='undefined'&&studentTab==='quiz'&&typeof renderStudent==='function')setTimeout(renderStudent,0)}
    if(!ses){hideOverlay();fab(false);return}
    if(quizWasDismissed(ses.id)){S.dismissed=ses.id;hideOverlay();if(ses.status!=='finished'&&!(ses.status==='scheduled'&&typeof studentTab!=='undefined'&&studentTab==='quiz'))fab(true,ses.id);else fab(false);return}
    S.dismissed=null;
    if(ses.status==='finished'&&S.st.submitted){if(!S.res||S.res.sid!==ses.id||!S.res.ready){const x=await supa.rpc('student_get_quiz_result',{p_token:studentToken,p_session:ses.id});if(x.error)throw x.error;S.res={...x.data,sid:ses.id}}}
    sRender()
  }catch(e){console.warn('quiz state:',e);if(!S.errShown&&e&&e.message&&!/fetch|network/i.test(e.message)){S.errShown=true;toast('Quiz ใช้งานไม่ได้: '+e.message)}}
  finally{S.busy=false}
}
function sRender(){
  const st=S.st,ses=st?.session;if(!ses)return;
  const sig=JSON.stringify([ses.id,ses.status,ses.current_index,ses.scheduled_start_at,ses.ends_at,st.submitted,st.makeup,st.attempt_started_at,Object.keys(st.my_answers||{}).length,S.res?.ready,quizStage(ses)]);
  if(sig===S.sig&&document.getElementById('quizOverlay'))return;S.sig=sig;
  if(ses.status==='finished'&&st.submitted)return sResult();
  if(ses.status==='paused')return overlay(`<div class="panel center" style="margin-top:16vh"><div class="big">⏸️</div><h2>${esc(ses.title)}</h2><p>ครูพัก Quiz ชั่วคราว กรุณารอสักครู่</p></div>`);
  // กำหนดเวลาแล้วให้ทุกคนเห็นตัวนับทันที และเปิดหน้าทำข้อสอบอัตโนมัติเมื่อถึงเวลา
  if(ses.status==='scheduled'){
    if(S.entered.has(ses.id))return overlay(`<div class="panel center"><div class="big">🗓️</div><h2>${esc(ses.title)}</h2><p>กำหนดเริ่ม Quiz อัตโนมัติ</p><div id="quizScheduleClock" data-quiz-end="${new Date(ses.scheduled_start_at||0).getTime()}" style="font-size:26px;font-weight:800;margin:12px 0">--</div><p class="tiny muted">เมื่อถึงเวลา ระบบจะเปิดให้ทุกคนกดเข้าทำ Quiz ได้ทันที และเริ่มนับเวลาตามที่ครูกำหนด</p><button class="btn white" style="width:100%;margin-top:10px" onclick="quizDismiss('${ses.id}')">ปิดไว้ก่อน</button></div>`,60);
    const stg=quizStage(ses);
    if(stg==='scheduled:far'){hideOverlay();return}   /* ยังอีกนาน: ดูได้ที่การ์ดในแท็บ Quiz ไม่เด้งรบกวน */
    const want=stg==='scheduled:5'?90:70;
    if(noticeShownPri()>=want)return;                  /* มีแจ้งเตือนที่สำคัญกว่าอยู่ ให้รอก่อน (รอบโพลถัดไปจะเด้งเอง) */
    return preStartPopup(ses,stg)
  }
  if((ses.status==='lobby'||ses.status==='live')&&!st.makeup&&!st.submitted&&!S.entered.has(ses.id))return popup(ses);
  if(ses.status==='lobby')return overlay(`<div class="panel center"><div class="big">🧠</div><h2>${esc(ses.title)}</h2><p>รอครูกดเริ่ม Quiz… เตรียมตัวให้พร้อมนะ!</p></div>`);
  if(st.submitted)return overlay(`<div class="panel center"><div class="big">✅</div><h2>ส่งคำตอบแล้ว</h2><p>ระบบบันทึกคำตอบของคุณเรียบร้อยแล้ว</p><div id="quizWaitClock" data-quiz-end="${new Date(ses.ends_at||0).getTime()}" style="font-size:36px;font-weight:900;font-variant-numeric:tabular-nums;margin:12px 0">--:--</div><p class="tiny muted">เวลาที่เหลือก่อนหมดเวลา Quiz<br>เมื่อหมดเวลา หรือครูกดจบ จะเฉลยพร้อมกันทุกคน</p><button class="btn white" style="width:100%;margin-top:12px" onclick="quizDismiss('${ses.id}')">ปิดหน้าต่าง (ยังรอผลคะแนนได้)</button></div>`);
  const host=ses.mode==='host_paced'&&!st.makeup,rnd=seeded(studentToken+ses.id);
  let qs=[...st.questions];if(ses.shuffle&&!host)qs=shuf(qs,rnd);
  const answered=Object.keys(st.my_answers||{}).length,total=ses.question_count||qs.length;
  const body=qs.map((q,n)=>{let ch=q.choices.map((c,k)=>[c,k]);if(ses.shuffle)ch=shuf(ch,seeded(studentToken+ses.id+q.index));const mine=st.my_answers?.[q.index];
    return `<div class="panel" style="margin:10px 0"><b>${host?'':(n+1)+'. '}${esc(q.body)}</b>${ch.map(([c,k])=>`<button class="btn ${mine===k||mine==String(k)?'primary':'white'}" data-quiz-question="${q.index}" data-quiz-choice="${k}" style="display:block;width:100%;margin:6px 0;text-align:left" onclick="quizAnswer('${ses.id}',${q.index},${k})">${esc(c)}</button>`).join('')}</div>`}).join('');
  overlay(`<div class="panel center"><h3>${esc(ses.title)}</h3><div style="font-size:30px;font-weight:800;font-variant-numeric:tabular-nums" id="quizClock">--:--</div><div class="tiny muted" id="quizProgressCount">ตอบแล้ว ${answered}/${total} ข้อ</div><div style="height:7px;background:#e9e7ef;border-radius:9px;overflow:hidden;margin:8px 0"><div id="quizProgressBar" style="height:7px;width:${total?Math.round(answered/total*100):0}%;background:#16a34a;border-radius:9px"></div></div><div class="tiny" id="quizSaveStatus" style="color:#16834a">✓ คำตอบที่เลือกจะบันทึกอัตโนมัติ</div>${host?`<div class="tiny muted">ข้อที่ ${ses.current_index+1} / ${ses.question_count}</div>`:''}</div>${body}${host?'<p class="tiny muted center">ตอบได้ครั้งเดียวต่อข้อ รอครูไปข้อถัดไป</p>':`<button class="btn primary" style="width:100%" onclick="quizSubmit('${ses.id}')">ส่งคำตอบ</button>`}`);
}
function quizReminder(key,message){
  if(S.warned.has(key))return;S.warned.add(key);
  try{if(typeof toast==='function')toast(message)}catch(e){}
}
function quizThresholdWarnings(kind,id,left){
  if(kind==='start')return;   /* ก่อนเริ่มใช้หน้าต่างเตือนแทน toast */
  if(left<=300&&left>0)quizReminder(`${kind}:${id}:300`,kind==='start'?'Quiz จะเริ่มใน 5 นาที':'เหลือเวลาทำ Quiz อีก 5 นาที');
  if(left<=60&&left>0)quizReminder(`${kind}:${id}:60`,kind==='start'?'Quiz จะเริ่มใน 1 นาที':'เหลือเวลาทำ Quiz อีก 1 นาที');
}
function sClock(){
  const st=S.st,ses=st?.session;
  document.querySelectorAll('[data-quiz-tab-end]').forEach(el=>{const left=Math.max(0,Math.ceil((Number(el.dataset.quizTabEnd)-now())/1000));el.textContent=`${el.dataset.quizTabPrefix||''} ${fmtLeft(left)}`;if(left===0&&!el.dataset.fired){el.dataset.fired='1';sGet();setTimeout(dLoad,1500)}});
  if(!ses)return;
  const scheduleEl=document.getElementById('quizScheduleClock');
  if(scheduleEl){const left=Math.max(0,Math.ceil((new Date(ses.scheduled_start_at||0).getTime()-now())/1000));scheduleEl.textContent=`เริ่มในอีก ${fmtLeft(left)}`;quizThresholdWarnings('start',ses.id,left);if(left===0)sGet();return}
  const waitEl=document.getElementById('quizWaitClock');
  if(waitEl){const left=Math.max(0,Math.ceil((new Date(ses.ends_at||0).getTime()-now())/1000));waitEl.textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;quizThresholdWarnings('end',ses.id,left);if(left===0)sGet();return}
  const el=document.getElementById('quizClock');if(!el||ses.status!=='live'&&!st.makeup)return;
  let end;if(st.makeup)end=new Date(st.attempt_started_at).getTime()+ses.time_limit_seconds*1000;else if(ses.mode==='host_paced')end=new Date(ses.question_started_at).getTime()+ses.per_question_seconds*1000;else end=new Date(ses.ends_at).getTime();
  const left=Math.max(0,Math.ceil((end-now())/1000));el.textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;
  if(!st.makeup)quizThresholdWarnings('end',ses.id,left);
  if(!left&&!st.submitted&&ses.mode==='self_paced'&&!S.auto){S.auto=ses.id;quizSubmit(ses.id,true)}
}
function sResult(){
  const r=S.res,ses=S.st.session;if(!r||!r.ready)return overlay(`<div class="panel center"><div class="big">⏳</div><h2>ส่งคำตอบแล้ว</h2><p>รอหมดเวลาหรือครูจบ Quiz เพื่อดูเฉลยและอันดับ</p><button class="btn white" style="width:100%" onclick="quizDismiss('${ses.id}')">ปิดหน้าต่าง</button></div>`);
  const medals=['🥇','🥈','🥉'];
  overlay(`<div role="dialog" aria-modal="true" aria-label="ผลคะแนน Quiz" style="max-width:560px;margin:10px auto;background:#f7f3ff;border-radius:18px;padding:10px;box-shadow:0 12px 40px rgba(0,0,0,.22)"><div class="row" style="justify-content:flex-end"><button class="btn white small" aria-label="ปิดหน้าต่างผลคะแนน" onclick="quizDismiss('${ses.id}')">✕ ปิด</button></div><div class="panel center"><div class="big">${r.makeup?'⏪':'🏆'}</div><span class="badge">Quiz สิ้นสุดแล้ว</span><h2>${esc(r.title)}</h2><div style="font-size:42px;font-weight:900;font-variant-numeric:tabular-nums">${r.score}/${r.max}</div><p style="font-size:18px;font-weight:700">ได้รับ ⭐ ${r.stars} ดาว</p><p>${r.makeup?'ถ้าทำในรอบสดจะได้อันดับประมาณ':'อันดับของคุณ'} ${r.my_rank??'-'}</p></div><div class="panel"><h3>🏆 ตารางคะแนน</h3>${(r.ranking||[]).map(x=>`<div class="listrow" style="${x.me?'background:#fff3c4':''}"><div class="row"><b class="rank">${medals[x.rank-1]||x.rank}</b><span>${esc(x.icon||'')} ${esc(x.name)}</span></div><b>${x.score}/${x.max}</b></div>`).join('')}</div><div class="panel"><h3>✅ เฉลย</h3>${(r.review||[]).map((q,i)=>`<div style="margin:10px 0"><b>${i+1}. ${esc(q.body)}</b>${q.choices.map((c,k)=>`<div style="padding:5px 8px;border-radius:8px;margin:3px 0;background:${k===q.correct_index?'#d9f5df':k===q.my_answer?'#ffdede':'transparent'}">${k===q.correct_index?'✅':k===q.my_answer?'❌':'▫️'} ${esc(c)}${k===q.my_answer?' ← คำตอบของคุณ':''}</div>`).join('')}${q.my_answer==null?'<div class="tiny muted">ไม่ได้ตอบข้อนี้</div>':''}</div>`).join('')}</div><button class="btn primary" style="width:100%;position:sticky;bottom:8px" onclick="quizDismiss('${ses.id}')">ปิดหน้าต่างผลคะแนน</button></div>`);
}
window.quizDismiss=id=>{quizRememberDismissed(id);hideOverlay();const s=S.st?.session;if(s&&s.status!=='finished')fab(true,id);else fab(false)};
window.quizAnswer=async(sid,q,k)=>{
  const key=`${sid}:${q}`;if(S.answerBusy.has(key)||S.st?.submitted)return;S.answerBusy.add(key);
  const buttons=[...document.querySelectorAll(`[data-quiz-question="${q}"]`)];buttons.forEach(b=>b.disabled=true);
  try{
    const r=await supa.rpc('student_answer',{p_token:studentToken,p_session:sid,p_q:q,p_choice:k});if(r.error)throw r.error;
    S.st.my_answers={...(S.st.my_answers||{}),[q]:k};
    // อัปเดตเฉพาะสี/สถานะ/ความคืบหน้า ไม่สร้างหน้าจอใหม่ จึงไม่ทำให้นาฬิกากระพริบ
    buttons.forEach(b=>{const selected=Number(b.dataset.quizChoice)===Number(k);b.classList.toggle('primary',selected);b.classList.toggle('white',!selected);b.disabled=false});
    const total=S.st.session?.question_count||0,answered=Object.keys(S.st.my_answers||{}).length;
    const count=document.getElementById('quizProgressCount'),bar=document.getElementById('quizProgressBar'),status=document.getElementById('quizSaveStatus');
    if(count)count.textContent=`ตอบแล้ว ${answered}/${total} ข้อ`;
    if(bar)bar.style.width=`${total?Math.min(100,Math.round(answered/total*100)):0}%`;
    if(status)status.textContent='✓ บันทึกคำตอบแล้ว';
  }catch(e){buttons.forEach(b=>b.disabled=false);toast(e.message||String(e))}
  finally{S.answerBusy.delete(key)}
};
window.quizSubmit=async(sid,auto)=>{try{const r=await supa.rpc('student_submit_quiz',{p_token:studentToken,p_session:sid});if(r.error)throw r.error;S.st.submitted=true;S.sig='';sRender();sGet()}catch(e){if(!auto)toast(e.message||String(e))}};
function sStart(){
  if(S.timer)return;
  S.timer=setInterval(sClock,500);
  const loop=()=>{clearTimeout(S.poll);if(!document.hidden)sGet();const active=S.st?.session&&S.dismissed!==S.st.session.id;S.poll=setTimeout(loop,active?3000:10000)};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)loop()});
  const sub=setInterval(()=>{const room=typeof studentData!=='undefined'&&studentData?.classroom?.id;if(room&&(typeof supa!=='undefined'&&supa)){clearInterval(sub);chan(room,()=>sGet())}},1500);
  loop();
}

window.quizOpenFromTab=()=>{const s=S.st?.session;if(!s)return;try{localStorage.removeItem(quizDismissKey(s.id))}catch(e){}S.dismissed=null;S.entered.add(s.id);S.sig='';fab(false);sRender()};
function quizActiveCard(){
  const st=S.st,ses=st?.session;if(!ses||ses.status==='finished')return '';
  const box=inner=>`<section class="panel" style="border:2px solid #7c5cff"><h3>🧠 Quiz ตอนนี้: ${esc(ses.title)}</h3>${inner}</section>`;
  const clk=(ts,prefix)=>`<div data-quiz-tab-end="${ts}" data-quiz-tab-prefix="${prefix}" style="font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;margin:6px 0">--:--</div>`;
  const ends=new Date(ses.ends_at||0).getTime();
  if(ses.status==='scheduled'){const t=new Date(ses.scheduled_start_at||0).getTime();return box(`<div class="tiny muted">🗓️ เริ่ม ${fmtDT(t)}</div>${clk(t,'เริ่มในอีก')}<button class="btn white" style="width:100%" disabled>▶ เริ่มทำ Quiz (รอถึงเวลา)</button><button class="btn white small" style="margin-top:6px" onclick="quizOpenFromTab()">ดูหน้าจอรอเริ่ม</button>`)}
  if(ses.status==='paused')return box('<p>⏸ ครูพัก Quiz ชั่วคราว กรุณารอสักครู่</p>');
  if(ses.status==='lobby')return box('<p>ครูเปิดห้อง Quiz แล้ว รอครูกดเริ่ม</p><button class="btn primary" style="width:100%" onclick="quizOpenFromTab()">เข้าห้อง Quiz</button>');
  if(st.submitted)return box(`<p>✅ ส่งคำตอบแล้ว ผลคะแนนและเฉลยจะแสดงเมื่อหมดเวลา</p>${clk(ends,'หมดเวลาในอีก')}`);
  return box(`<p>ถึงเวลาแล้ว! กดเริ่มทำได้เลย</p>${clk(ends,'เหลือเวลา')}<button class="btn primary" style="width:100%" onclick="quizOpenFromTab()">▶ เริ่มทำ Quiz</button>`)
}
/* ===== ประวัติ Quiz ของนักเรียน (เลือกวันที่ได้ / ยุบ-ขยายได้) ===== */
const H={limit:8,from:'',to:'',list:null,loading:false,open:new Set(),rev:{},err:''};
const dth=d=>new Date(d).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
const pc=(a,b)=>b?Math.round(a*100/b):0;
function hLoad(){if(H.loading)return;H.loading=true;H.err='';H.limit=8;Promise.resolve(supa.rpc('student_get_quiz_history',{p_token:studentToken,p_from:H.from||null,p_to:H.to||null})).then(r=>{if(r.error)throw r.error;H.list=r.data||[]}).catch(e=>{H.err=e.message||String(e);H.list=[]}).finally(()=>{H.loading=false;if(studentTab==='quiz')renderStudent()})}
window.quizHFilter=()=>{H.from=document.getElementById('qhFrom').value;H.to=document.getElementById('qhTo').value;H.list=null;H.open.clear();renderStudent()};
window.quizHQuick=days=>{const f=d=>new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);H.to=days?f(new Date()):'';H.from=days?f(new Date(Date.now()-days*864e5)):'';H.list=null;H.open.clear();renderStudent()};
window.quizHToggle=(id,on)=>{on?H.open.add(id):H.open.delete(id)};
window.quizHMore=()=>{H.limit+=8;renderStudent()};
window.quizHAll=on=>{H.open=on?new Set((H.list||[]).map(x=>x.id)):new Set();renderStudent()};
window.quizHReview=async id=>{if(H.rev[id]){delete H.rev[id];return renderStudent()}try{const r=await supa.rpc('student_get_quiz_result',{p_token:studentToken,p_session:id});if(r.error)throw r.error;H.rev[id]=r.data;renderStudent()}catch(e){toast(e.message||String(e))}};
const bar=(label,p,color)=>`<div class="tiny" style="margin:4px 0">${label} <b>${p}%</b><div style="background:#eee;border-radius:8px;height:9px"><div style="width:${Math.min(100,p)}%;background:${color};height:9px;border-radius:8px"></div></div></div>`;
function quizHistoryPage(){
  if(H.list===null&&!H.loading)hLoad();
  const L=H.list||[],took=L.filter(x=>x.participated);
  const avg=took.length?Math.round(took.reduce((a,x)=>a+pc(x.score,x.max),0)/took.length):0,stars=took.reduce((a,x)=>a+(x.stars||0),0);
  const cards=L.slice(0,H.limit).map(x=>{const mine=x.participated?pc(x.score,x.max):null,cls=x.avg!=null&&x.max_possible?pc(x.avg,x.max_possible):null,rv=H.rev[x.id];
    return `<details ${H.open.has(x.id)?'open':''} ontoggle="quizHToggle('${x.id}',this.open)" class="panel" style="margin:8px 0;padding:10px"><summary style="cursor:pointer"><b>${esc(x.title)}</b> <span class="tiny muted">• ${dth(x.date)}</span><div class="tiny">${x.participated?`คุณ <b>${x.score}/${x.max}</b> • ⭐${x.stars} • อันดับ ${x.my_rank}`:'<span class="muted">ยังไม่ได้ทำ Quiz นี้</span>'}</div></summary>
    ${x.participated?bar('คะแนนของคุณ',mine,'#7c5cff')+(cls!=null?bar('เฉลี่ยทั้งห้อง',cls,'#f5a623'):''):''}
    <div class="tiny muted">ผู้ทำ ${x.count} คน • คะแนนสูงสุด ${x.top??'-'}${x.avg!=null?' • เฉลี่ย '+x.avg:''}</div>
    ${x.participated?`<button class="btn white small" style="margin-top:6px" onclick="quizHReview('${x.id}')">${rv?'ซ่อนเฉลย':'ดูเฉลย'}</button>`:''}
    ${rv?`<div style="margin-top:8px">${(rv.review||[]).map((q,i)=>`<div style="margin:8px 0"><b>${i+1}. ${esc(q.body)}</b>${q.choices.map((c,k)=>`<div style="padding:4px 8px;border-radius:8px;margin:2px 0;background:${k===q.correct_index?'#d9f5df':k===q.my_answer?'#ffdede':'transparent'}">${k===q.correct_index?'✅':k===q.my_answer?'❌':'▫️'} ${esc(c)}${k===q.my_answer?' ← คำตอบของคุณ':''}</div>`).join('')}</div>`).join('')}</div>`:''}</details>`}).join('');
  const dIds=new Set((D.list||[]).map(x=>x.session_id).filter(Boolean));
  return quizDailySection()+(S.st?.session&&dIds.has(S.st.session.id)?'':quizActiveCard())+`<section class="panel"><h3>📚 ประวัติ Quiz ของฉัน</h3><div class="row" style="gap:6px;flex-wrap:wrap;align-items:end"><label class="tiny">ตั้งแต่<br><input type="date" class="field" id="qhFrom" value="${H.from}" onchange="quizHFilter()"></label><label class="tiny">ถึง<br><input type="date" class="field" id="qhTo" value="${H.to}" onchange="quizHFilter()"></label></div><div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn white small" onclick="quizHQuick(7)">7 วันล่าสุด</button><button class="btn white small" onclick="quizHQuick(30)">30 วันล่าสุด</button><button class="btn white small" onclick="quizHQuick(0)">ทั้งหมด</button></div></section>
  <section class="panel"><div class="row" style="gap:14px;flex-wrap:wrap"><div><b style="font-size:22px">${took.length}</b><div class="tiny muted">Quiz ที่ทำ</div></div><div><b style="font-size:22px">${avg}%</b><div class="tiny muted">คะแนนเฉลี่ยของฉัน</div></div><div><b style="font-size:22px">⭐${stars}</b><div class="tiny muted">ดาวจาก Quiz</div></div></div></section>
  <section class="panel"><div class="row" style="justify-content:space-between;gap:6px;flex-wrap:wrap"><h3>รายการ Quiz (${L.length})</h3><div><button class="btn white small" onclick="quizHAll(true)">ขยายทั้งหมด</button> <button class="btn white small" onclick="quizHAll(false)">ย่อทั้งหมด</button></div></div>${H.loading&&!L.length?'<p class="muted">กำลังโหลด…</p>':H.err?`<p class="muted">โหลดไม่สำเร็จ: ${esc(H.err)}</p>`:(cards?cards+(L.length>H.limit?`<button class="btn soft" style="width:100%;margin-top:8px" onclick="quizHMore()">แสดงเพิ่ม (${L.length-H.limit})</button>`:''):'<p class="muted">ไม่พบ Quiz ในช่วงวันที่นี้</p>')}</section>`;
}

/* ===== Quiz ประจำวัน (หน้าฝั่งนักเรียน) ===== */
const D={list:null,loading:false,again:false,err:'',timer:null};
const DNAMES=['','จ','อ','พ','พฤ','ศ','ส','อา'];
function dLoad(){
  if(typeof studentToken==='undefined'||!studentToken||(typeof previewMode!=='undefined'&&previewMode)||!(typeof supa!=='undefined'&&supa))return;
  if(D.loading){D.again=true;return}
  D.loading=true;D.err='';
  Promise.resolve(supa.rpc('student_get_daily_quizzes',{p_token:studentToken})).then(r=>{if(r.error)throw r.error;D.list=r.data||[]})
    .catch(e=>{D.err=e.message||String(e);if(!D.list)D.list=[]})
    .finally(()=>{
      D.loading=false;clearTimeout(D.timer);
      const nx=(D.list||[]).filter(x=>x.state==='upcoming'&&x.scheduled_start_at).map(x=>new Date(x.scheduled_start_at).getTime()-now()).filter(ms=>ms>-1500).sort((a,b)=>a-b)[0];
      if(nx!=null)D.timer=setTimeout(dLoad,Math.min(nx+2500,2147000000));
      if(D.again){D.again=false;return dLoad()}
      if(typeof studentTab!=='undefined'&&studentTab==='quiz'&&typeof renderStudent==='function')renderStudent();else quizPaintBadge();
    });
}
const dTodo=()=>(D.list||[]).filter(x=>x.state==='open'||x.state==='makeup').length;
function quizPaintBadge(){
  const b=[...document.querySelectorAll('.student-tabs .tab')].find(x=>/studentTab='quiz'/.test(x.getAttribute('onclick')||''));if(!b)return;
  const n=dTodo();b.innerHTML='🧠 Quiz'+(n?`<span class="tab-alert">${n}</span>`:'');
}
function dStreak(x){if(x.state==='missed')return 0;let n=x.state==='done'?1:0;for(const r of(x.recent||[])){if(r.done)n++;else break}return n}
window.quizDailyStart=sid=>{
  if(S.st?.session?.id===sid)return quizEnter(sid);
  sGet().then(()=>{if(S.st?.session?.id===sid)quizEnter(sid);else toast('ยังเข้าทำ Quiz นี้ไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง')});
};
function quizDailySection(){
  if(D.list===null&&!D.loading)dLoad();
  if(D.err&&!(D.list||[]).length)return `<section class="panel"><div class="tiny muted">โหลด Quiz ประจำวันไม่สำเร็จ: ${esc(D.err)}</div></section>`;
  const L=D.list||[];if(!L.length)return '';
  const clk=(ts,prefix)=>`<div data-quiz-tab-end="${ts}" data-quiz-tab-prefix="${prefix}" style="font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;margin:6px 0">--:--</div>`;
  const pill=(t,bg,fg)=>`<span class="badge" style="background:${bg};color:${fg}">${t}</span>`;
  const card=x=>{
    const days=(x.repeat_days||[]).length===7?'ทุกวัน':(x.repeat_days||[]).map(d=>DNAMES[d]).join(' '),sk=dStreak(x);
    const dots=(x.recent||[]).slice(0,7).reverse().map(r=>`<span title="${esc(dth(r.date+'T00:00:00'))}" style="margin-right:3px">${r.done?'✅':'❌'}</span>`).join('');
    let st='';
    switch(x.state){
      case 'done':st=x.stars!=null?pill(`✅ วันนี้ทำแล้ว · ได้ ${Number(x.stars)||0} ⭐ (${x.score}/${x.max})`,'#e3f7eb','#237b4e'):pill('✅ วันนี้ทำแล้ว · ส่งคำตอบแล้ว','#e3f7eb','#237b4e')+`<div class="tiny muted" style="margin-top:4px">ดาวและเฉลยจะแสดงเมื่อหมดเวลา${x.score!=null?` · ตอนนี้ได้ ${x.score}/${x.max}`:''}</div>`;st+='<button class="btn white" style="width:100%;margin-top:8px" disabled>ทำครบแล้ววันนี้ พรุ่งนี้มาใหม่นะ</button>';break;
      case 'open':st=clk(new Date(x.ends_at||0).getTime(),'เหลือเวลา')+`<button class="btn primary" style="width:100%" onclick="quizDailyStart('${x.session_id}')">▶ เริ่มทำ Quiz วันนี้</button>`;break;
      case 'makeup':st=pill('⏪ คุณครูเปิดให้ทำย้อนหลัง','#fff3d8','#94600e')+`<button class="btn primary" style="width:100%;margin-top:8px" onclick="quizDailyStart('${x.session_id}')">▶ ทำย้อนหลัง</button>`;break;
      case 'upcoming':st=`<div class="tiny muted">🗓️ วันนี้เริ่ม ${String(x.start_time||'').slice(0,5)} น.</div>`+clk(new Date(x.scheduled_start_at||0).getTime(),'เริ่มในอีก')+'<button class="btn white" style="width:100%" disabled>▶ เริ่มทำ (รอถึงเวลา)</button>';break;
      case 'paused':st=pill('⏸ ครูพัก Quiz ชั่วคราว','#fff3d8','#94600e');break;
      case 'missed':st=pill('⌛ วันนี้ไม่ได้ทำ · หมดเวลาแล้ว','#fde8eb','#a43d54');break;
      case 'rest':st=pill('😴 วันนี้ไม่มีรอบ','#eef0f6','#5b6478')+`<div class="tiny muted" style="margin-top:4px">มี Quiz ${days}</div>`;break;
      default:st=pill('วันนี้ไม่มีรอบ Quiz','#eef0f6','#5b6478');
    }
    return `<article class="itemcard student-mission-card"><div class="student-mission-top"><div class="emoji">🧠</div><span class="badge">Quiz ประจำวัน</span></div><h4>${esc(x.title)}</h4><div class="tiny muted">${String(x.start_time||'').slice(0,5)} น. · ${days} · ${x.question_count} ข้อ</div><div class="tiny muted">ทำสำเร็จแล้ว ${Number(x.done_total)||0} วัน · รวม ⭐ ${Number(x.stars_total)||0}${sk>=2?` · 🔥 ติดต่อกัน ${sk} วัน`:''}</div>${dots?`<div class="tiny" style="margin:6px 0">7 รอบล่าสุด ${dots}</div>`:''}${st}</article>`;
  };
  return `<section class="panel" style="margin-bottom:14px"><div class="split"><div><h3>🔁 Quiz ประจำวัน</h3><div class="tiny muted">ทำได้วันละ 1 ครั้ง เริ่มใหม่ทุกวัน · อยู่ที่นี่จนกว่าครูจะปิด</div></div><span class="badge">${dTodo()} รอทำวันนี้</span></div><div class="grid cards">${L.map(card).join('')}</div></section>`;
}
if(typeof renderStudent==='function'){const _rs=renderStudent;window.renderStudent=renderStudent=function(){const r=_rs.apply(this,arguments);try{quizPaintBadge()}catch(e){}return r}}
if(typeof showNextStudentNotice==='function'){const _sn=showNextStudentNotice;window.showNextStudentNotice=showNextStudentNotice=function(){
  try{const q=(typeof studentNoticeQueue!=='undefined'&&studentNoticeQueue)||[];
    if(q.length&&!document.getElementById('starupStudentNotice')){const top=Math.max(...q.map(n=>noticePri(n.kind)));if(quizPriNow()>top)return}}catch(e){}
  const r=_sn.apply(this,arguments);
  try{const b=document.getElementById('starupStudentNotice');if(b&&!b.dataset.pri){const n=(studentNoticeQueue||[]).find(x=>String(x.id)===String(b.dataset.notificationId));b.dataset.pri=String(noticePri(n&&n.kind))}}catch(e){}
  return r}}
if(typeof studentContent==='function'){const _sc=studentContent;window.studentContent=studentContent=function(){return typeof studentTab!=='undefined'&&studentTab==='quiz'?quizHistoryPage():_sc.apply(this,arguments)}}
const wait=setInterval(()=>{if(typeof studentToken!=='undefined'&&studentToken&&!isTeacherPage()||(typeof studentToken!=='undefined'&&studentToken&&typeof logoutStudent==='function')){clearInterval(wait);sStart()}},800);
})();
