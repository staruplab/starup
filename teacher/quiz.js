/* STAR UP! Quiz module — ใช้ร่วมกันทั้งหน้าครูและนักเรียน (ต้องรัน migration_quiz_system.sql ก่อน) */
(function(){
const Q={lib:[],sessions:[],attempts:[],room:null,loaded:false,ch:null,chRoom:null,timer:null};
const num=(v,d)=>{v=Number(v);return Number.isFinite(v)?v:d};
function chan(room,onMsg){if(!(typeof supa!=='undefined'&&supa)||!room)return null;if(Q.ch&&Q.chRoom===room)return Q.ch;try{if(Q.ch)supa.removeChannel(Q.ch)}catch(e){}Q.chRoom=room;Q.ch=supa.channel('quiz:'+room,{config:{broadcast:{self:false}}});if(onMsg)Q.ch.on('broadcast',{event:'q'},onMsg);Q.ch.subscribe();return Q.ch}
function ping(){try{chan(activeRoom)?.send({type:'broadcast',event:'q',payload:{t:Date.now()}})}catch(e){}}
const isTeacherPage=()=>typeof renderTeacher==='function'&&typeof teacherContent==='function';

/* ================= ฝั่งครู ================= */
async function quizLoad(){
  if(!(typeof supa!=='undefined'&&supa)||!activeRoom)return;const room=activeRoom;
  try{
    const [a,b]=await Promise.all([supa.from('quizzes').select('*,quiz_questions(*)').eq('teacher_id',user.id).order('updated_at',{ascending:false}),
      supa.from('quiz_sessions').select('*').eq('classroom_id',room).order('created_at',{ascending:false}).limit(12)]);
    if(a.error)throw a.error;if(b.error)throw b.error;
    Q.lib=a.data||[];Q.sessions=b.data||[];Q.room=room;Q.loaded=true;
    const live=Q.sessions.find(s=>s.status!=='finished');
    if(live){const r=await supa.from('quiz_attempts').select('student_id,submitted_at').eq('session_id',live.id);Q.attempts=r.data||[]}else Q.attempts=[];
    if(view==='quiz')renderTeacher();
  }catch(e){toast('โหลด Quiz ไม่สำเร็จ (ต้องรัน migration_quiz_system.sql ก่อน): '+(e.message||e))}
}
function quizTick(){clearInterval(Q.timer);Q.timer=setInterval(()=>{if(view!=='quiz'||document.hidden||document.getElementById('modalback')?.classList.contains('show'))return;quizLoad()},4000)}
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
  const names=a=>a.map(s=>esc(s.full_name)).join(', ')||'-',pct=roster.length?Math.round(done.length*100/roster.length):0;
  const liveHtml=live?`<article class="itemcard" style="margin-top:8px"><div class="split"><h4 style="margin:0">${esc(live.title)}</h4>${chip(live.status==='lobby'?'⏳ รอเริ่ม':'🔴 กำลังทำ','#fff3d8','#94600e')}</div><div class="tiny muted">${live.mode==='host_paced'?'ครูคุมทีละข้อ':'ทำพร้อมกัน มีเวลารวม'}${live.mode==='host_paced'&&live.status==='live'?` • ข้อที่ ${live.current_index+1}/${live.questions.length}`:''}</div>
  <div style="background:#eee;border-radius:8px;height:10px;margin:10px 0"><div style="width:${pct}%;background:#34c38f;height:10px;border-radius:8px"></div></div>
  <div class="actions">${chip('👥 ทั้งห้อง '+roster.length,'#f2efff','#5546a3')}${chip('✍️ กำลังทำ '+doing.length,'#fff3d8','#94600e')}${chip('✅ เสร็จแล้ว '+done.length,'#e6f7ee','#2c7a4b')}${chip('⚪ ยังไม่ได้ทำ '+wait.length,'#fde8eb','#a43d54')}</div>
  <details open style="margin-top:8px"><summary><b>⚪ ยังไม่ได้ทำ (${wait.length})</b></summary><div class="tiny">${names(wait)}</div></details>
  <details style="margin-top:6px"><summary><b>✍️ กำลังทำ (${doing.length})</b></summary><div class="tiny">${names(doing)}</div></details>
  <details style="margin-top:6px"><summary><b>✅ เสร็จแล้ว (${done.length})</b></summary><div class="tiny">${names(done)}</div></details>
  <div class="actions" style="margin-top:10px">${live.status==='lobby'?`<button class="btn primary small" onclick="quizBegin('${live.id}')">▶ เริ่ม Quiz</button>`:''}${live.status==='live'&&live.mode==='host_paced'?`<button class="btn primary small" onclick="quizNext('${live.id}')">${live.current_index+1>=live.questions.length?'จบ Quiz':'ข้อถัดไป ➡'}</button>`:''}<button class="btn gold small" onclick="quizFinish('${live.id}')">⏹ จบรอบและเฉลย</button></div></article>`:'<div class="empty">🎉 ไม่มี Quiz ที่กำลังดำเนินอยู่</div>';
  const hist=Q.sessions.filter(s=>s.status==='finished');
  const row=s=>`<div class="listrow"><div><b>${esc(s.title)}</b><div class="tiny muted">${new Date(s.created_at).toLocaleString('th-TH')}</div></div><button class="btn soft small" onclick="quizResults('${s.id}')">ดูผล</button></div>`;
  const histHtml=Q.histOpen?(hist.length?hist.slice(0,Q.histLimit).map(row).join('')+(hist.length>Q.histLimit?`<button class="btn soft" style="width:100%;margin-top:10px" onclick="quizHistMore()">ดูเพิ่มเติม (${hist.length-Q.histLimit} รายการ)</button>`:''):'<div class="empty">ยังไม่มีประวัติ Quiz ในห้องนี้</div>'):'';
  return `<section class="panel"><div class="split"><div><h3>🧠 จัดการ Quiz</h3><div class="tiny muted">เปิด Quiz ให้ทั้งห้องทำพร้อมกัน ดูสถานะสดและผลคะแนนได้ที่นี่</div></div><div class="actions"><button class="btn soft" onclick="quizLibrary()">📚 คลัง Quiz</button><button class="btn primary" onclick="quizEdit(null)">＋ สร้าง Quiz</button></div></div><div style="margin:16px 0 8px;padding:10px 12px;border-radius:12px;background:#f2efff;color:#5546a3;font-weight:800">🟢 Quiz ที่กำลังดำเนินอยู่ (${live?1:0})</div>${liveHtml}<div class="split" style="margin-top:16px"><div><strong>🗂️ ประวัติ Quiz</strong><div class="tiny muted">ผลคะแนนและอันดับของแต่ละรอบ</div></div><button class="btn soft" onclick="quizHistToggle()">${Q.histOpen?'ซ่อนประวัติ':'ดูประวัติ Quiz'}</button></div>${histHtml}</section>`;
}
window.quizLibrary=()=>{
  const live=Q.sessions.find(s=>s.status!=='finished');
  modal(`<h3>📚 คลัง Quiz ส่วนตัว</h3><p class="tiny muted">เลือก Quiz เพื่อเปิดในห้องเรียนปัจจุบัน ใช้ซ้ำได้ทุกห้อง ต้นฉบับในคลังจะไม่เปลี่ยน</p><div style="max-height:62vh;overflow:auto">${Q.lib.map(z=>`<div class="listrow"><div style="min-width:0;flex:1"><b>${esc(z.title)}</b><div class="tiny muted">${(z.quiz_questions||[]).length} ข้อ • ${z.mode==='host_paced'?'ครูคุมทีละข้อ':'เวลารวม '+Math.round(z.time_limit_seconds/60*10)/10+' นาที'}${z.shuffle?' • สลับข้อ':''}</div></div><div class="actions"><button class="btn primary small" ${live?'disabled':''} onclick="quizOpen('${z.id}')">นำไปใช้</button><button class="btn soft small" onclick="quizEdit('${z.id}')">แก้ไข</button><button class="btn red small" onclick="quizDelete('${z.id}')">ลบ</button></div></div>`).join('')||'<div class="empty">ยังไม่มี Quiz ในคลัง กด “＋ สร้าง Quiz” ได้เลย</div>'}</div><div class="modalfoot"><button class="btn white" onclick="closeModal()">ปิด</button></div>`)
};
function qBlock(q,i){const ch=q?.choices||['',''];return `<div class="panel qz-q" style="padding:10px;margin:8px 0"><textarea class="field qz-body" rows="2" placeholder="โจทย์ข้อที่ ${i+1}">${esc(q?.body||'')}</textarea><div class="qz-choices">${ch.map((c,k)=>chBlock(c,k,q?.correct_index===k||(!q&&k===0),i)).join('')}</div><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn white small" onclick="quizAddChoice(this)">+ ตัวเลือก</button><label class="tiny">คะแนน <input class="field qz-pts" type="number" min="1" value="${q?.points||1}" style="width:70px"></label><button type="button" class="btn white small" onclick="this.closest('.qz-q').remove()">ลบข้อนี้</button></div></div>`}
function chBlock(c,k,checked,i){return `<div class="row" style="gap:6px;margin:4px 0"><input type="radio" name="qzc${i}" class="qz-correct" ${checked?'checked':''} title="ข้อที่ถูก"><input class="field qz-choice" value="${esc(c)}" placeholder="ตัวเลือก ${k+1}"></div>`}
let qzSeq=1000;
window.quizAddChoice=btn=>{const box=btn.closest('.qz-q').querySelector('.qz-choices');if(box.children.length>=6)return toast('ได้สูงสุด 6 ตัวเลือก');const name=box.querySelector('.qz-correct').name;const d=document.createElement('div');d.innerHTML=chBlock('',box.children.length,false,0);const e=d.firstChild;e.querySelector('.qz-correct').name=name;box.append(e)};
window.quizAddQuestion=()=>{const d=document.createElement('div');d.innerHTML=qBlock(null,++qzSeq);document.getElementById('qzQs').append(d.firstChild)};
window.quizEdit=id=>{
  const z=id?Q.lib.find(x=>x.id===id):null,qs=z?[...(z.quiz_questions||[])].sort((a,b)=>a.position-b.position):[null];
  const R=(z?.star_rules||[{min_pct:90,stars:5},{min_pct:70,stars:3},{min_pct:50,stars:1}]);
  modal(`<h3>${z?'✏️ แก้ไข Quiz':'➕ สร้าง Quiz'}</h3><div style="max-height:70vh;overflow:auto"><input class="field" id="qzTitle" placeholder="ชื่อ Quiz" value="${esc(z?.title||'')}"><div class="fieldrow"><label>รูปแบบ</label><select class="field" id="qzMode"><option value="self_paced" ${z?.mode!=='host_paced'?'selected':''}>ทุกคนเริ่มพร้อมกัน มีเวลารวม</option><option value="host_paced" ${z?.mode==='host_paced'?'selected':''}>ครูคุมทีละข้อ (ทุกคนเห็นข้อเดียวกัน)</option></select></div><div class="fieldrow"><label>เวลารวม (นาที) / เวลาต่อข้อ (วินาที)</label><div class="row" style="gap:8px"><input class="field" id="qzTime" type="number" min="1" value="${Math.round((z?.time_limit_seconds||600)/60*10)/10}"><input class="field" id="qzPer" type="number" min="5" value="${z?.per_question_seconds||20}"></div></div><label class="tiny"><input type="checkbox" id="qzShuffle" ${z?.shuffle?'checked':''}> สลับลำดับข้อและตัวเลือกของนักเรียนแต่ละคน</label><div class="fieldrow"><label>เกณฑ์ให้ดาว (คะแนน % ขึ้นไป → ดาว)</label>${[0,1,2].map(i=>`<div class="row" style="gap:6px;margin:3px 0"><input class="field qz-rp" type="number" placeholder="% ขึ้นไป" value="${R[i]?.min_pct??''}"><input class="field qz-rs" type="number" placeholder="ดาว" value="${R[i]?.stars??''}"></div>`).join('')}</div><div class="fieldrow"><label>โบนัสดาวอันดับ 1, 2, 3 (คั่นด้วยจุลภาค เช่น 3,2,1 เว้นว่างถ้าไม่ใช้)</label><input class="field" id="qzBonus" value="${esc((z?.rank_bonus||[]).join(','))}"></div><div id="qzQs">${qs.map((q,i)=>qBlock(q,i)).join('')}</div><button type="button" class="btn white" onclick="quizAddQuestion()">➕ เพิ่มข้อ</button></div><div class="modalfoot"><button class="btn white" onclick="closeModal()">ยกเลิก</button><button class="btn primary" onclick="quizSave('${id||''}')">บันทึก</button></div>`)
};
window.quizSave=async id=>{
  try{
    const title=$('#qzTitle').value.trim();if(!title)return toast('กรุณาตั้งชื่อ Quiz');
    const qs=[...document.querySelectorAll('.qz-q')].map((el,i)=>{const ch=[...el.querySelectorAll('.qz-choice')].map(x=>x.value.trim());const ci=[...el.querySelectorAll('.qz-correct')].findIndex(x=>x.checked);return {body:el.querySelector('.qz-body').value.trim(),choices:ch,correct_index:ci,points:Math.max(1,num(el.querySelector('.qz-pts').value,1)),position:i}});
    if(!qs.length)return toast('ต้องมีอย่างน้อย 1 ข้อ');
    for(const [i,q] of qs.entries()){if(!q.body||q.choices.some(c=>!c)||q.choices.length<2||q.correct_index<0)return toast(`ข้อ ${i+1}: กรอกโจทย์/ตัวเลือกให้ครบและเลือกข้อที่ถูก`)}
    const rp=[...document.querySelectorAll('.qz-rp')],rs=[...document.querySelectorAll('.qz-rs')];
    const rules=rp.map((x,i)=>({min_pct:num(x.value,null),stars:num(rs[i].value,null)})).filter(r=>r.min_pct!==null&&r.stars!==null&&r.stars>0);
    const bonus=($('#qzBonus').value||'').split(',').map(x=>Math.max(0,Math.floor(num(x.trim(),0)))).filter((x,i,a)=>a.slice(i).some(Boolean)||x>0);
    const row={title,mode:$('#qzMode').value,time_limit_seconds:Math.max(30,Math.round(num($('#qzTime').value,10)*60)),per_question_seconds:Math.max(5,num($('#qzPer').value,20)),shuffle:$('#qzShuffle').checked,rank_bonus:bonus.some(Boolean)?bonus:[],star_rules:rules,updated_at:new Date().toISOString()};
    let qid=id;
    if(id){const r=await supa.from('quizzes').update(row).eq('id',id);if(r.error)throw r.error;const d=await supa.from('quiz_questions').delete().eq('quiz_id',id);if(d.error)throw d.error}
    else{const r=await supa.from('quizzes').insert({...row,teacher_id:user.id}).select().single();if(r.error)throw r.error;qid=r.data.id}
    const ins=await supa.from('quiz_questions').insert(qs.map(q=>({...q,quiz_id:qid})));if(ins.error)throw ins.error;
    await quizLoad();quizLibrary();toast('บันทึก Quiz แล้ว')
  }catch(e){toast(e.message||String(e))}
};
window.quizDelete=id=>askConfirmButtons('ลบ Quiz นี้ออกจากคลัง? (ประวัติผลในห้องยังอยู่)','ลบ',async()=>{const r=await supa.from('quizzes').delete().eq('id',id);if(r.error)return toast(r.error.message);await quizLoad();quizLibrary()});
async function rpcDo(name,args,msg){try{const r=await supa.rpc(name,args);if(r.error)throw r.error;ping();await quizLoad();if(msg)toast(msg);return r.data}catch(e){toast(e.message||String(e))}}
window.quizOpen=async id=>{const r=await rpcDo('teacher_open_quiz',{p_quiz_id:id,p_classroom_id:activeRoom},'เปิด Quiz แล้ว นักเรียนจะเห็นหน้าต่างแจ้งเตือน');if(r)closeModal()};
window.quizBegin=id=>rpcDo('teacher_begin_quiz',{p_session:id},'เริ่ม Quiz แล้ว');
window.quizNext=id=>rpcDo('teacher_next_question',{p_session:id});
window.quizFinish=id=>askConfirmButtons('จบรอบนี้และเฉลยให้นักเรียนทุกคนใช่ไหม? ผู้ที่ยังไม่ส่งจะถูกตรวจจากคำตอบที่มี','จบรอบ',()=>rpcDo('teacher_finish_quiz',{p_session:id},'จบรอบและให้ดาวเรียบร้อย'));
window.quizResults=async sid=>{
  try{
    const s=Q.sessions.find(x=>x.id===sid);
    const [a,st]=await Promise.all([supa.from('quiz_attempts').select('*,students(full_name)').eq('session_id',sid),supa.rpc('teacher_quiz_stats',{p_session:sid})]);
    if(a.error)throw a.error;if(st.error)throw st.error;
    const at=(a.data||[]).filter(x=>x.submitted_at).sort((x,y)=>y.score-x.score||(new Date(x.submitted_at)-new Date(x.started_at))-(new Date(y.submitted_at)-new Date(y.started_at)));
    const doneIds=new Set(at.map(x=>x.student_id)),missing=students.filter(x=>!doneIds.has(x.id));
    window.__quizCsv={title:s.title,rows:at.map((x,i)=>[i+1,x.students?.full_name,x.score,x.max_score,x.stars_awarded])};
    modal(`<h3>📊 ${esc(s.title)}</h3><div style="max-height:68vh;overflow:auto"><h4>🏆 อันดับ</h4>${at.map((x,i)=>`<div class="listrow"><div class="row"><b class="rank">${['🥇','🥈','🥉'][i]||i+1}</b><span>${esc(x.students?.full_name||'')}</span></div><b>${x.score}/${x.max_score} • ⭐${x.stars_awarded}</b></div>`).join('')||'<p class="muted">ไม่มีผู้ส่งคำตอบ</p>'}<h4>📈 สถิติรายข้อ (ตอบถูกกี่ %)</h4>${(st.data||[]).map(q=>{const p=q.answered?Math.round(q.correct*100/q.answered):0;return `<div class="listrow"><span>${q.index+1}. ${esc(q.body).slice(0,60)}</span><b style="color:${p<50?'#c0392b':'inherit'}">${p}% (${q.correct}/${q.answered})</b></div>`}).join('')}${missing.length?`<h4>⚪ ไม่ได้ทำ (${missing.length})</h4><div class="tiny">${missing.map(x=>esc(x.full_name)).join(', ')}</div>`:''}</div><div class="modalfoot"><button class="btn white" onclick="quizCsv()">⬇ CSV</button><button class="btn white" onclick="closeModal()">ปิด</button></div>`)
  }catch(e){toast(e.message||String(e))}
};
window.quizCsv=()=>{const c=window.__quizCsv;if(!c)return;const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const t='\ufeff'+['อันดับ,ชื่อ,คะแนน,เต็ม,ดาว',...c.rows.map(r=>r.map(q).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/csv;charset=utf-8'}));a.download=`quiz-${c.title}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
if(isTeacherPage()){const _tc=teacherContent;window.teacherContent=teacherContent=function(){return view==='quiz'?quizTeacherPage():_tc.apply(this,arguments)}}

/* ================= ฝั่งนักเรียน ================= */
const S={entered:new Set(),errShown:false,st:null,off:0,dismissed:null,res:null,timer:null,poll:null,busy:false,tick:null,sig:''};
const now=()=>Date.now()+S.off;
function seeded(seed){let h=1779033703^seed.length;for(let i=0;i<seed.length;i++){h=Math.imul(h^seed.charCodeAt(i),3432918353);h=h<<13|h>>>19}return()=>{h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);h^=h>>>16;return(h>>>0)/4294967296}}
function shuf(a,rnd){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function overlay(html){let o=document.getElementById('quizOverlay');if(!o){o=document.createElement('div');o.id='quizOverlay';o.style.cssText='position:fixed;inset:0;z-index:80;background:#f7f3ff;overflow:auto;padding:14px;font-family:inherit';document.body.append(o)}o.innerHTML=`<div style="max-width:560px;margin:0 auto">${html}</div>`}
function hideOverlay(){document.getElementById('quizOverlay')?.remove()}
function fab(on,id){let b=document.getElementById('quizFab');if(!on){b?.remove();return}if(b)return;b=document.createElement('button');b.id='quizFab';b.className='btn primary';b.style.cssText='position:fixed;right:14px;bottom:70px;z-index:79;box-shadow:0 4px 14px rgba(0,0,0,.25)';b.textContent='🧠 เข้าทำ Quiz';b.onclick=()=>{S.dismissed=null;S.entered.add(id);S.sig='';fab(false);sRender()};document.body.append(b)}
function popup(ses){try{typeof playUrgentSound==='function'&&playUrgentSound()}catch(e){}overlay(`<div class="panel center" style="margin-top:18vh"><div class="big">🧠📢</div><span class="badge">Quiz ใหม่!</span><h2>${esc(ses.title)}</h2><p>ครูเปิด Quiz แล้ว กดเข้าไปทำได้เลย</p><button class="btn primary" style="width:100%;margin-top:10px" onclick="quizEnter('${ses.id}')">เข้าทำ Quiz 🚀</button><button class="btn white small" style="margin-top:8px" onclick="quizDismiss('${ses.id}')">ไว้ก่อน</button></div>`)}
window.quizEnter=id=>{S.entered.add(id);S.sig='';fab(false);sRender()};
async function sGet(){
  if(typeof studentToken==='undefined'||!studentToken||!(typeof supa!=='undefined'&&supa)||S.busy||(typeof previewMode!=='undefined'&&previewMode))return;
  S.busy=true;
  try{
    const r=await supa.rpc('student_get_quiz_state',{p_token:studentToken});if(r.error)throw r.error;
    S.st=r.data;S.off=new Date(r.data.server_now).getTime()-Date.now();
    const ses=S.st.session;
    if(!ses){hideOverlay();fab(false);return}
    if(S.dismissed===ses.id){hideOverlay();fab(ses.status!=='finished',ses.id);return}
    if(ses.status==='finished'&&S.st.submitted){if(!S.res||S.res.sid!==ses.id||!S.res.ready){const x=await supa.rpc('student_get_quiz_result',{p_token:studentToken,p_session:ses.id});if(x.error)throw x.error;S.res={...x.data,sid:ses.id}}}
    sRender()
  }catch(e){console.warn('quiz state:',e);if(!S.errShown&&e&&e.message&&!/fetch|network/i.test(e.message)){S.errShown=true;toast('Quiz ใช้งานไม่ได้: '+e.message)}}
  finally{S.busy=false}
}
function sRender(){
  const st=S.st,ses=st?.session;if(!ses)return;
  const sig=JSON.stringify([ses.id,ses.status,ses.current_index,st.submitted,st.makeup,st.attempt_started_at,Object.keys(st.my_answers||{}).length,S.res?.ready]);
  if(sig===S.sig&&document.getElementById('quizOverlay'))return;S.sig=sig;
  if(ses.status==='finished'&&st.submitted)return sResult();
  if((ses.status==='lobby'||ses.status==='live')&&!st.makeup&&!st.submitted&&!S.entered.has(ses.id))return popup(ses);
  if(ses.status==='lobby')return overlay(`<div class="panel center"><div class="big">🧠</div><h2>${esc(ses.title)}</h2><p>รอครูกดเริ่ม Quiz… เตรียมตัวให้พร้อมนะ!</p></div>`);
  if(st.submitted)return overlay(`<div class="panel center"><div class="big">✅</div><h2>ส่งคำตอบแล้ว</h2><p>รอเพื่อน ๆ ทำเสร็จ แล้วจะเฉลยและแสดงอันดับ</p></div>`);
  const host=ses.mode==='host_paced'&&!st.makeup,rnd=seeded(studentToken+ses.id);
  let qs=[...st.questions];if(ses.shuffle&&!host)qs=shuf(qs,rnd);
  const body=qs.map((q,n)=>{let ch=q.choices.map((c,k)=>[c,k]);if(ses.shuffle)ch=shuf(ch,seeded(studentToken+ses.id+q.index));const mine=st.my_answers?.[q.index];
    return `<div class="panel" style="margin:10px 0"><b>${host?'':(n+1)+'. '}${esc(q.body)}</b>${ch.map(([c,k])=>`<button class="btn ${mine===k||mine==String(k)?'primary':'white'}" style="display:block;width:100%;margin:6px 0;text-align:left" onclick="quizAnswer('${ses.id}',${q.index},${k})">${esc(c)}</button>`).join('')}</div>`}).join('');
  overlay(`<div class="panel center"><h3>${esc(ses.title)}</h3><div style="font-size:28px;font-weight:800" id="quizClock">--</div>${host?`<div class="tiny muted">ข้อที่ ${ses.current_index+1} / ${ses.question_count}</div>`:''}</div>${body}${host?'<p class="tiny muted center">ตอบได้ครั้งเดียวต่อข้อ รอครูไปข้อถัดไป</p>':`<button class="btn primary" style="width:100%" onclick="quizSubmit('${ses.id}')">ส่งคำตอบ</button>`}`);
}
function sClock(){
  const st=S.st,ses=st?.session,el=document.getElementById('quizClock');if(!ses||!el||ses.status!=='live'&&!st.makeup)return;
  let end;if(st.makeup)end=new Date(st.attempt_started_at).getTime()+ses.time_limit_seconds*1000;else if(ses.mode==='host_paced')end=new Date(ses.question_started_at).getTime()+ses.per_question_seconds*1000;else end=new Date(ses.ends_at).getTime();
  const left=Math.max(0,Math.ceil((end-now())/1000));el.textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;
  if(!left&&!st.submitted&&ses.mode==='self_paced'&&!S.auto){S.auto=ses.id;quizSubmit(ses.id,true)}
}
function sResult(){
  const r=S.res,ses=S.st.session;if(!r||!r.ready)return overlay(`<div class="panel center"><div class="big">⏳</div><h2>ส่งคำตอบแล้ว</h2><p>รอครูจบรอบเพื่อเฉลย</p></div>`);
  const medals=['🥇','🥈','🥉'];
  overlay(`<div class="panel center"><div class="big">${r.makeup?'⏪':'🏆'}</div><h2>${esc(r.title)}</h2><h1>${r.score}/${r.max}</h1><p>ได้ ⭐ ${r.stars} ดาว • ${r.makeup?'ถ้าทำในรอบสดจะได้อันดับประมาณ':'อันดับของคุณ'} ${r.my_rank??'-'}</p></div><div class="panel"><h3>🏆 อันดับ</h3>${(r.ranking||[]).map(x=>`<div class="listrow" style="${x.me?'background:#fff3c4':''}"><div class="row"><b class="rank">${medals[x.rank-1]||x.rank}</b><span>${esc(x.icon||'')} ${esc(x.name)}</span></div><b>${x.score}/${x.max}</b></div>`).join('')}</div><div class="panel"><h3>✅ เฉลย</h3>${(r.review||[]).map((q,i)=>`<div style="margin:10px 0"><b>${i+1}. ${esc(q.body)}</b>${q.choices.map((c,k)=>`<div style="padding:5px 8px;border-radius:8px;margin:3px 0;background:${k===q.correct_index?'#d9f5df':k===q.my_answer?'#ffdede':'transparent'}">${k===q.correct_index?'✅':k===q.my_answer?'❌':'▫️'} ${esc(c)}${k===q.my_answer?' ← คำตอบของคุณ':''}</div>`).join('')}${q.my_answer==null?'<div class="tiny muted">ไม่ได้ตอบข้อนี้</div>':''}</div>`).join('')}</div><button class="btn primary" style="width:100%" onclick="quizDismiss('${ses.id}')">ปิด</button>`);
}
window.quizDismiss=id=>{S.dismissed=id;hideOverlay();const s=S.st?.session;if(s&&s.status!=='finished')fab(true,id)};
window.quizAnswer=async(sid,q,k)=>{try{const r=await supa.rpc('student_answer',{p_token:studentToken,p_session:sid,p_q:q,p_choice:k});if(r.error)throw r.error;S.st.my_answers={...(S.st.my_answers||{}),[q]:k};S.sig='';sRender()}catch(e){toast(e.message||String(e))}};
window.quizSubmit=async(sid,auto)=>{try{const r=await supa.rpc('student_submit_quiz',{p_token:studentToken,p_session:sid});if(r.error)throw r.error;S.st.submitted=true;S.sig='';sRender();sGet()}catch(e){if(!auto)toast(e.message||String(e))}};
function sStart(){
  if(S.timer)return;
  S.timer=setInterval(sClock,500);
  const loop=()=>{clearTimeout(S.poll);if(!document.hidden)sGet();const active=S.st?.session&&S.dismissed!==S.st.session.id;S.poll=setTimeout(loop,active?3000:10000)};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)loop()});
  const sub=setInterval(()=>{const room=typeof studentData!=='undefined'&&studentData?.classroom?.id;if(room&&(typeof supa!=='undefined'&&supa)){clearInterval(sub);chan(room,()=>sGet())}},1500);
  loop();
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
  return `<section class="panel"><h3>📚 ประวัติ Quiz ของฉัน</h3><div class="row" style="gap:6px;flex-wrap:wrap;align-items:end"><label class="tiny">ตั้งแต่<br><input type="date" class="field" id="qhFrom" value="${H.from}" onchange="quizHFilter()"></label><label class="tiny">ถึง<br><input type="date" class="field" id="qhTo" value="${H.to}" onchange="quizHFilter()"></label></div><div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn white small" onclick="quizHQuick(7)">7 วันล่าสุด</button><button class="btn white small" onclick="quizHQuick(30)">30 วันล่าสุด</button><button class="btn white small" onclick="quizHQuick(0)">ทั้งหมด</button></div></section>
  <section class="panel"><div class="row" style="gap:14px;flex-wrap:wrap"><div><b style="font-size:22px">${took.length}</b><div class="tiny muted">Quiz ที่ทำ</div></div><div><b style="font-size:22px">${avg}%</b><div class="tiny muted">คะแนนเฉลี่ยของฉัน</div></div><div><b style="font-size:22px">⭐${stars}</b><div class="tiny muted">ดาวจาก Quiz</div></div></div></section>
  <section class="panel"><div class="row" style="justify-content:space-between;gap:6px;flex-wrap:wrap"><h3>รายการ Quiz (${L.length})</h3><div><button class="btn white small" onclick="quizHAll(true)">ขยายทั้งหมด</button> <button class="btn white small" onclick="quizHAll(false)">ย่อทั้งหมด</button></div></div>${H.loading&&!L.length?'<p class="muted">กำลังโหลด…</p>':H.err?`<p class="muted">โหลดไม่สำเร็จ: ${esc(H.err)}</p>`:(cards?cards+(L.length>H.limit?`<button class="btn soft" style="width:100%;margin-top:8px" onclick="quizHMore()">แสดงเพิ่ม (${L.length-H.limit})</button>`:''):'<p class="muted">ไม่พบ Quiz ในช่วงวันที่นี้</p>')}</section>`;
}
if(typeof studentContent==='function'){const _sc=studentContent;window.studentContent=studentContent=function(){return typeof studentTab!=='undefined'&&studentTab==='quiz'?quizHistoryPage():_sc.apply(this,arguments)}}
const wait=setInterval(()=>{if(typeof studentToken!=='undefined'&&studentToken&&!isTeacherPage()||(typeof studentToken!=='undefined'&&studentToken&&typeof logoutStudent==='function')){clearInterval(wait);sStart()}},800);
})();
