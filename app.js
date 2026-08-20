// ═══════════════════════════════════════════════════════════
// ESTADO E STORAGE
// ═══════════════════════════════════════════════════════════
const STORE = 'meu-plano-v3';
const DAY = 86400000;

const defaultState = {
  settings: {
    cycleStart: '2026-08-19',
    weeks: 5,
    targetHours: 12,
    plannedFastTime: '02:00',
    studyTargetMinutes: 45,
    workoutTargetMinutes: 60,
    intention: '',
    currentBook: 'Harry Potter: A Pedra Filosofal'
  },
  fasts: [], activeFast: null,
  studySessions: [], activeStudy: null,
  workouts: [], activeWorkout: null,
  dailyNotes: {}, dailyGoals: {}, planTasks: {}, weeklyTasks: {},
  weights: [] // [{date, kg}]
};

let state = loadState();
let selectedWeekDate = todayKey();
let deferredPrompt = null;
let toastTimer = null;

function cloneDefault() { return JSON.parse(JSON.stringify(defaultState)); }

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE));
    if (!parsed) return cloneDefault();
    const base = cloneDefault();
    const s = { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings||{}) } };
    s.workouts ||= [];
    s.weeklyTasks ||= {};
    s.weights ||= [];
    return s;
  } catch { return cloneDefault(); }
}

function persist() { localStorage.setItem(STORE, JSON.stringify(state)); }

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS DE DATA
// ═══════════════════════════════════════════════════════════
function pad(n) { return String(n).padStart(2,'0'); }
function nowMs() { return Date.now(); }
function localKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayKey() { return localKey(); }
function fromKey(k) { const [y,m,d] = k.split('-').map(Number); return new Date(y,m-1,d,12); }
function formatDate(v, opts = {weekday:'long',day:'numeric',month:'long'}) { return new Intl.DateTimeFormat('pt-BR',opts).format(typeof v==='string'?fromKey(v):v); }
function formatShort(v) { return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(typeof v==='string'?fromKey(v):v); }
function formatTime(ms) { const d=new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function durationText(ms, short=false) { const t=Math.max(0,Math.floor(ms/60000)); const h=Math.floor(t/60); const m=t%60; return short?`${h}h${pad(m)}`:(h?`${h}h ${m}min`:`${m}min`); }
function timerText(ms) { const s=Math.max(0,Math.floor(ms/1000)); return `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`; }
function uid() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function esc(v='') { return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

// ═══════════════════════════════════════════════════════════
// ROTINA SEMANAL — coração do plano
// ═══════════════════════════════════════════════════════════
// 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
const WEEK_ROUTINE = {
  0: { label:'Domingo', emoji:'🚶', tags:['walk','study'], activities:['Caminhada 30 min (descanso ativo)','Estudos livres ou revisão da semana'], tip:'Dia leve. Recuperação ativa — não precisa forçar.' },
  1: { label:'Segunda', emoji:'🥊', tags:['muay','study'], activities:['Muay Thai (manhã — 06h30)','Estudo: Psicanálise (30–45 min)','Lanche leve antes de dormir — amanhã é jejum'], tip:'Jante bem hoje — última refeição antes do jejum de amanhã.' },
  2: { label:'Terça',  emoji:'⚡', tags:['fast','gym'],   activities:['Jejum (terça — rotina de jejum)','Academia após 20h30 (pós quebra do jejum)','Estudo: Neurociência (30 min)'], tip:'Jejum toda terça. Academia só depois de comer às 14h+.' },
  3: { label:'Quarta', emoji:'🏋️', tags:['gym','study'],  activities:['Academia (manhã — 06h30)','Estudo: Livro — Harry Potter: A Pedra Filosofal (20–30 min)'], tip:'Dia de força. Come bem no pós-treino.' },
  4: { label:'Quinta', emoji:'🥊', tags:['muay','study'], activities:['Muay Thai (manhã — 06h30)','Estudo: Psicanálise (30–45 min)'], tip:'Segundo dia de Muay Thai. Hidrate bem.' },
  5: { label:'Sexta',  emoji:'🏋️', tags:['gym','esport','study'], activities:['Academia (manhã — 06h30)','Estudo: Neurociência (30 min)','Esport (noite — após 20h)'], tip:'Dia cheio mas possível. Esport é relaxamento, não obrigação.' },
  6: { label:'Sábado', emoji:'🏋️', tags:['gym','study'],  activities:['Academia (manhã — 06h30)','Estudo: Livro — Harry Potter: A Pedra Filosofal (30–40 min)'], tip:'Último treino da semana. Amanhã é descanso.' },
};

const STUDY_ROTATION = [
  'Psicanálise','Neurociência','Livro — Harry Potter: A Pedra Filosofal',
  'Psicanálise','Neurociência','Livro — Harry Potter: A Pedra Filosofal','Revisão livre'
];

// ═══════════════════════════════════════════════════════════
// CICLO E PLANO
// ═══════════════════════════════════════════════════════════
function cycleStart() { return fromKey(state.settings.cycleStart); }
function cycleDay(key=todayKey()) { return Math.floor((fromKey(key)-cycleStart())/DAY); }
function inCycle(key) { const d=cycleDay(key); return d>=0 && d<state.settings.weeks*7; }
function weekNum(key=todayKey()) { return Math.floor(cycleDay(key)/7)+1; }

function fastTargetForWeek(w) {
  if(w<=2) return 12;
  if(w<=4) return 16;
  return 24;
}

function dayPlan(key=todayKey()) {
  const weekday = fromKey(key).getDay();
  const r = WEEK_ROUTINE[weekday];
  const w = weekNum(key);
  const isFast = weekday===2;
  const fh = fastTargetForWeek(w);
  if(!inCycle(key)) return { label:'Ciclo encerrado', detail:'Inicie novo ciclo nos ajustes.', kind:'livre', activities:[] };
  return {
    label: isFast ? `Jejum ${fh}h + Academia noite` : r.activities[0] || r.label,
    detail: r.tip,
    kind: isFast ? 'fast' : r.tags[0] || 'routine',
    activities: r.activities,
    tags: r.tags,
    tip: r.tip
  };
}

// ═══════════════════════════════════════════════════════════
// TOAST E NAVEGAÇÃO
// ═══════════════════════════════════════════════════════════
function toast(msg) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('.nav button').forEach((b,i)=>{
    const views=['today','routine','food','planner','history','analysis','settings'];
    b.classList.toggle('active',views[i]===name);
  });
  if(name==='planner') renderPlanner();
  if(name==='history') renderHistory();
  if(name==='analysis') renderAnalysis();
  if(name==='routine') renderRoutine();
  if(name==='settings') renderSettings();
  window.scrollTo({top:0,behavior:'smooth'});
}

// ═══════════════════════════════════════════════════════════
// HEADER E CARDS DE HOJE
// ═══════════════════════════════════════════════════════════
function renderHeader() {
  const today=new Date(); const plan=dayPlan(); const wd=today.getDay();
  const r=WEEK_ROUTINE[wd];
  document.getElementById('dateStamp').textContent=formatDate(today,{weekday:'long',day:'numeric',month:'short'});
  document.getElementById('cycleStamp').textContent=inCycle()?`Dia ${cycleDay()+1} de ${state.settings.weeks*7} do ciclo`:'Ciclo concluído';
  document.getElementById('dayTitle').textContent=formatDate(today,{weekday:'long',day:'numeric',month:'long'});

  // Badges do dia
  const tagMap={fast:'pill-fast ⚡ Jejum',muay:'pill-muay 🥊 Muay Thai',gym:'pill-gym 🏋️ Academia',walk:'pill-walk 🚶 Caminhada',study:'pill-study 📚 Estudo',esport:'pill-esport 🎮 Esport'};
  const badges=document.getElementById('dayBadges');
  badges.innerHTML=(r?.tags||[]).map(t=>{const[cls,...txt]=tagMap[t]?.split(' ')||[]; return`<span class="day-pill ${cls}">${txt.join(' ')}</span>`;}).join('');

  document.getElementById('dayStatus').textContent=state.activeFast?'Jejum em andamento.':state.activeStudy?'Sessão de estudo ativa.':state.activeWorkout?'Treino em andamento.':r?.emoji+' '+r?.label||'Bom dia!';
  document.getElementById('dayDetail').textContent=state.activeFast?'A contagem segue até sua meta.':state.activeStudy?'O tempo será salvo no histórico.':state.activeWorkout?'Tempo e descrição salvos ao encerrar.':r?.tip||'';
  document.getElementById('heroCopy').textContent=state.settings.intention||'Jejum, treino, estudo — um passo de cada vez.';
  document.getElementById('heroEyebrow').textContent=state.settings.intention?'Intenção do ciclo':'Hoje, com calma';
}

// ═══════════════════════════════════════════════════════════
// JEJUM
// ═══════════════════════════════════════════════════════════
function renderFast() {
  const active=state.activeFast;
  const th=Number(active?.targetHours||state.settings.targetHours);
  const target=th*3600000;
  const dur=active?nowMs()-active.start:0;
  const pct=active?Math.min(100,Math.round(dur/target*100)):0;
  document.getElementById('fastRing').style.background=`conic-gradient(var(--clay) ${pct*3.6}deg, var(--paper-deep) ${pct*3.6}deg)`;
  document.getElementById('fastDuration').textContent=active?durationText(dur,true):`${th}h`;
  document.getElementById('fastRingLabel').textContent=active?`${pct}%`:'alvo';
  document.getElementById('fastTarget').value=th;
  document.getElementById('fastPlannedTime').value=state.settings.plannedFastTime;
  const ps=fromKey(todayKey());
  const [ph,pm]=state.settings.plannedFastTime.split(':').map(Number);
  ps.setHours(ph,pm,0,0);
  const pe=new Date(ps.getTime()+target);
  document.getElementById('fastSchedule').innerHTML=active?`<strong>Meta: ${th}h</strong> · fim às ${formatTime(active.start+target)}`:`<strong>Meta: ${th}h</strong> · se iniciar às ${state.settings.plannedFastTime}, termina às ${formatTime(pe)}`;
  const act=document.getElementById('fastAction'), badge=document.getElementById('fastBadge');
  if(active){
    document.getElementById('fastSubtitle').textContent=`Iniciou às ${formatTime(active.start)}.`;
    document.getElementById('fastStatusTitle').textContent=pct>=100?'Alvo alcançado!':'Em jejum agora';
    document.getElementById('fastStatusCopy').textContent=pct>=100?'Você chegou na meta. Encerre quando quiser.':    `Faltam ${durationText(Math.max(0,target-dur))}.`;
    badge.textContent='em jejum'; badge.className='badge fast'; act.textContent='Encerrar jejum';
    document.getElementById('fastTarget').disabled=true;
  } else {
    document.getElementById('fastSubtitle').textContent='Sem registro ativo.';
    document.getElementById('fastStatusTitle').textContent='Ainda não começou';
    document.getElementById('fastStatusCopy').textContent='Toda terça-feira. O cronômetro inicia quando você tocar em começar.';
    badge.textContent='em preparo'; badge.className='badge fast'; act.textContent='Começar agora';
    document.getElementById('fastTarget').disabled=false;
  }
  document.getElementById('targetHoursText').textContent=th;
}

function toggleFastNote(){const el=document.getElementById('fastNote');el.style.display=el.style.display==='none'?'block':'none';if(el.style.display==='block')el.focus();}
function updateFastTarget(){state.settings.targetHours=Number(document.getElementById('fastTarget').value);persist();renderFast();}
function updateFastPlannedTime(){state.settings.plannedFastTime=document.getElementById('fastPlannedTime').value;persist();renderFast();}
function toggleFast(){
  if(!state.activeFast){
    state.activeFast={id:uid(),start:nowMs(),targetHours:Number(state.settings.targetHours),note:document.getElementById('fastNote').value.trim()};
    persist();toast('Jejum iniciado!');
  } else {
    const a=state.activeFast,end=nowMs();
    state.fasts.unshift({...a,end,duration:end-a.start,note:document.getElementById('fastNote').value.trim()||a.note||''});
    state.activeFast=null;document.getElementById('fastNote').value='';document.getElementById('fastNote').style.display='none';
    persist();toast('Jejum registrado no histórico.');
  }
  renderAll();
}

// ═══════════════════════════════════════════════════════════
// ESTUDO
// ═══════════════════════════════════════════════════════════
function renderStudy(){
  const active=state.activeStudy,act=document.getElementById('studyAction'),badge=document.getElementById('studyBadge'),sel=document.getElementById('studySubject');
  const target=Number(active?.targetMinutes||state.settings.studyTargetMinutes);
  document.getElementById('studyTarget').value=target;
  if(active){
    const el=nowMs()-active.start,rem=target*60000-el;
    document.getElementById('studySubtitle').textContent=`${active.subject} — desde ${formatTime(active.start)}.`;
    document.getElementById('studyTimer').textContent=timerText(el);
    document.getElementById('studySchedule').innerHTML=rem>0?`<strong>Faltam ${durationText(rem)}</strong> para ${target} min.`:`<strong>Meta alcançada!</strong> Encerre quando quiser.`;
    act.textContent='Encerrar estudo';badge.textContent='em sessão';badge.className='badge ok';sel.value=active.subject;sel.disabled=true;document.getElementById('studyTarget').disabled=true;
  } else {
    document.getElementById('studySubtitle').textContent='Uma sessão curta também conta.';
    document.getElementById('studyTimer').textContent='00:00:00';
    document.getElementById('studySchedule').innerHTML=`<strong>Meta: ${target} min.</strong> O cronômetro inicia quando você começar.`;
    act.textContent='Iniciar estudo';badge.textContent='livre';badge.className='badge ok';sel.disabled=false;document.getElementById('studyTarget').disabled=false;
  }
}
function updateStudyTarget(){state.settings.studyTargetMinutes=Number(document.getElementById('studyTarget').value);persist();renderStudy();}
function toggleStudy(){
  const sel=document.getElementById('studySubject');
  if(!state.activeStudy){
    state.activeStudy={id:uid(),subject:sel.value,targetMinutes:Number(state.settings.studyTargetMinutes),start:nowMs()};
    persist();toast(`Sessão de ${sel.value} iniciada.`);
  } else {
    const a=state.activeStudy,end=nowMs();
    state.studySessions.unshift({...a,end,duration:end-a.start,note:document.getElementById('studyNote').value.trim()});
    state.activeStudy=null;document.getElementById('studyNote').value='';persist();toast('Sessão salva!');
  }
  renderAll();
}

// ═══════════════════════════════════════════════════════════
// TREINO
// ═══════════════════════════════════════════════════════════
function renderWorkout(){
  const active=state.activeWorkout,act=document.getElementById('workoutAction'),badge=document.getElementById('workoutBadge'),sel=document.getElementById('workoutType');
  const target=Number(active?.targetMinutes||state.settings.workoutTargetMinutes);
  document.getElementById('workoutTarget').value=target;
  const isMuay=active?.type==='Muay Thai'||sel.value==='Muay Thai';
  document.getElementById('workoutTitle').textContent=active?(active.type==='Muay Thai'?'Muay Thai':'Academia'):'Treino';
  if(active){
    const el=nowMs()-active.start,rem=target*60000-el;
    document.getElementById('workoutSubtitle').textContent=`${active.type} — desde ${formatTime(active.start)}.`;
    document.getElementById('workoutTimer').textContent=timerText(el);
    document.getElementById('workoutSchedule').innerHTML=rem>0?`<strong>Faltam ${durationText(rem)}</strong>`:`<strong>Meta alcançada!</strong>`;
    act.textContent='Encerrar treino';badge.textContent='em treino';badge.className='badge ok';sel.value=active.type;sel.disabled=true;document.getElementById('workoutTarget').disabled=true;
  } else {
    document.getElementById('workoutSubtitle').textContent='Registre o que você realmente fez.';
    document.getElementById('workoutTimer').textContent='00:00:00';
    document.getElementById('workoutSchedule').innerHTML=`<strong>Meta: ${target} min.</strong>`;
    act.textContent='Iniciar treino';badge.textContent='livre';badge.className='badge';sel.disabled=false;document.getElementById('workoutTarget').disabled=false;
  }
}
function updateWorkoutTarget(){state.settings.workoutTargetMinutes=Number(document.getElementById('workoutTarget').value);persist();renderWorkout();}
function toggleWorkout(){
  const sel=document.getElementById('workoutType');
  if(!state.activeWorkout){
    state.activeWorkout={id:uid(),type:sel.value,targetMinutes:Number(state.settings.workoutTargetMinutes),start:nowMs()};
    persist();toast(`${sel.value} iniciado!`);
  } else {
    const a=state.activeWorkout,end=nowMs();
    state.workouts.unshift({...a,end,duration:end-a.start,note:document.getElementById('workoutNote').value.trim()});
    state.activeWorkout=null;document.getElementById('workoutNote').value='';persist();toast('Treino salvo!');
  }
  renderAll();
}

// ═══════════════════════════════════════════════════════════
// TAREFAS DO DIA
// ═══════════════════════════════════════════════════════════
function scheduledTaskMarkup(key,compact=false){
  const plan=dayPlan(key);const done=!!state.planTasks[key];
  if(plan.kind==='livre') return '';
  return `<div class="${compact?'week-task scheduled':'plan-task'} ${done?'done':''}"><input class="check" type="checkbox" ${done?'checked':''} onchange="togglePlanTask('${key}')"><div class="${compact?'week-task-text':'task-text'}"><strong>${esc(plan.label)}</strong>${compact?'':`<small>${esc(plan.detail)}</small>`}</div></div>`;
}
function customTaskMarkup(key,compact=false){
  return (state.weeklyTasks[key]||[]).map(t=>`<div class="${compact?'week-task':'plan-task'} ${t.done?'done':''}"><input class="check" type="checkbox" ${t.done?'checked':''} onchange="toggleWeeklyTask('${key}','${t.id}')"><div class="${compact?'week-task-text':'task-text'}"><strong>${esc(t.text)}</strong>${compact?'':'<small>Tarefa do planejamento semanal.</small>'}</div>${compact?'':`<button class="icon-button" onclick="removeWeeklyTask('${key}','${t.id}')">×</button>`}</div>`).join('');
}
function renderPlanToday(){
  const plan=dayPlan(),key=todayKey(),custom=state.weeklyTasks[key]||[],acts=state.dailyGoals[key]||[];
  document.getElementById('planTodaySubtitle').textContent=inCycle()?`Dia ${cycleDay()+1} do ciclo — ${WEEK_ROUTINE[fromKey(key).getDay()]?.label||''}` :'Ciclo encerrado.';
  document.getElementById('planKind').textContent=plan.kind==='fast'?'jejum':plan.kind==='muay'?'muay thai':plan.kind==='gym'?'academia':plan.kind==='walk'?'caminhada':'estudo';
  const actMarkup=acts.map(a=>`<div class="plan-task ${a.done?'done':''}"><input class="check" type="checkbox" ${a.done?'checked':''} onchange="toggleActivityDone('${a.id}')"><div class="task-text"><strong>${esc(a.text)}</strong><small>Atividade extra.</small></div></div>`).join('');
  document.getElementById('planTask').innerHTML=scheduledTaskMarkup(key)+customTaskMarkup(key)+actMarkup||'<p class="empty">Nenhuma tarefa. Adicione na aba Plano.</p>';
}
function togglePlanTask(key=todayKey()){state.planTasks[key]=!state.planTasks[key];persist();renderAll();}
function toggleWeeklyTask(key,id){const t=(state.weeklyTasks[key]||[]).find(i=>i.id===id);if(!t)return;t.done=!t.done;persist();renderAll();}
function removeWeeklyTask(key,id){state.weeklyTasks[key]=(state.weeklyTasks[key]||[]).filter(i=>i.id!==id);persist();renderAll();}
function addWeeklyTask(){const inp=document.getElementById('weekTaskInput'),text=inp.value.trim();if(!text)return;const key=selectedWeekDate||todayKey();state.weeklyTasks[key]||=[];state.weeklyTasks[key].push({id:uid(),text,done:false});inp.value='';persist();renderAll();toast('Tarefa adicionada.');}
function renderActivities(){
  const acts=state.dailyGoals[todayKey()]||[];
  document.getElementById('activityCount').textContent=`${acts.length} criada${acts.length===1?'':'s'}`;
  document.getElementById('activityList').innerHTML=acts.length?acts.map(a=>`<div class="goal ${a.done?'done':''}"><span>${esc(a.text)}</span><small style="color:var(--sage-deep);font-size:10px;font-weight:700">EM TAREFAS</small><button class="icon-button" onclick="removeActivity('${a.id}')">×</button></div>`).join(''):'<p class="empty">Crie atividades extras acima.</p>';
}
function addActivity(){const inp=document.getElementById('activityInput'),text=inp.value.trim();if(!text)return;const key=todayKey();state.dailyGoals[key]||=[];state.dailyGoals[key].push({id:uid(),text,selected:true,done:false});inp.value='';persist();renderAll();toast('Atividade criada.');}
function toggleActivityDone(id){const a=(state.dailyGoals[todayKey()]||[]).find(i=>i.id===id);if(!a)return;a.done=!a.done;persist();renderAll();}
function removeActivity(id){state.dailyGoals[todayKey()]=(state.dailyGoals[todayKey()]||[]).filter(i=>i.id!==id);persist();renderAll();}
function saveDailyNote(){state.dailyNotes[todayKey()]=document.getElementById('dailyNote').value;persist();const s=document.getElementById('noteSaved');s.classList.add('show');clearTimeout(window.noteTimer);window.noteTimer=setTimeout(()=>s.classList.remove('show'),1000);}

// ═══════════════════════════════════════════════════════════
// ESTATÍSTICAS E GRÁFICOS
// ═══════════════════════════════════════════════════════════
function streak(){
  let n=0,d=fromKey(todayKey());
  for(let i=0;i<60;i++){const key=localKey(d);if(state.planTasks[key]){n++;d.setDate(d.getDate()-1);}else break;}
  return n;
}
function renderStats(){
  const tf=state.fasts.reduce((s,f)=>s+(f.duration||0),0);
  const ts=state.studySessions.reduce((s,x)=>s+(x.duration||0),0);
  const tw=state.workouts.reduce((s,w)=>s+(w.duration||0),0);
  document.getElementById('streakStat').textContent=streak();
  document.getElementById('fastStat').textContent=tf?durationText(tf,true):'0h';
  document.getElementById('studyStat').textContent=ts?durationText(ts).replace('min','m'):'0m';
  document.getElementById('workoutStat').textContent=tw?durationText(tw).replace('min','m'):'0m';
  renderWeekChart();
}
function renderWeekChart(){
  const chart=document.getElementById('weekChart');
  const days=['D','S','T','Q','Q','S','S'];
  const today=new Date();
  let html='';
  let maxVal=1;
  const vals=[];
  for(let i=6;i>=0;i--){
    const d=new Date(today);d.setDate(today.getDate()-i);
    const key=localKey(d);
    const fast=state.fasts.filter(f=>localKey(new Date(f.start))===key).reduce((s,f)=>s+(f.duration||0),0);
    const study=state.studySessions.filter(s=>localKey(new Date(s.start))===key).reduce((s,x)=>s+(x.duration||0),0);
    const workout=state.workouts.filter(w=>localKey(new Date(w.start))===key).reduce((s,w)=>s+(w.duration||0),0);
    const total=(fast/3600000*30)+(study/60000)+(workout/60000);
    vals.push({total,key,d});
    if(total>maxVal) maxVal=total;
  }
  vals.forEach((v,i)=>{
    const h=Math.round((v.total/maxVal)*70)||3;
    const isToday=v.key===todayKey();
    html+=`<div class="bar-col"><div class="bar-fill" style="height:${h}px;background:${isToday?'var(--sage)':'var(--line)'}"></div><div class="bar-label">${days[v.d.getDay()]}</div></div>`;
  });
  chart.innerHTML=html;
}

// ═══════════════════════════════════════════════════════════
// ROTINA
// ═══════════════════════════════════════════════════════════
function renderRoutine(){
  const list=document.getElementById('routineList');
  const dayOrder=[1,2,3,4,5,6,0];
  list.innerHTML=dayOrder.map(wd=>{
    const r=WEEK_ROUTINE[wd];
    return `<div class="routine-day">
      <div class="routine-day-title">${r.emoji} ${r.label}
        ${r.tags.map(t=>({fast:'<span class="day-pill pill-fast" style="font-size:8px">Jejum</span>',muay:'<span class="day-pill pill-muay" style="font-size:8px">Muay Thai</span>',gym:'<span class="day-pill pill-gym" style="font-size:8px">Academia</span>',walk:'<span class="day-pill pill-walk" style="font-size:8px">Caminhada</span>',study:'<span class="day-pill pill-study" style="font-size:8px">Estudo</span>',esport:'<span class="day-pill pill-esport" style="font-size:8px">Esport</span>'})[t]).join('')}
      </div>
      <div class="routine-items">${r.activities.map(a=>`<div class="routine-item"><b>✓</b>${a}</div>`).join('')}</div>
      <p style="font-size:11px;color:var(--muted);margin:6px 0 0;font-style:italic">💡 ${r.tip}</p>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// PESO
// ═══════════════════════════════════════════════════════════
function saveWeight(){
  const val=parseFloat(document.getElementById('currentWeight').value);
  if(isNaN(val)||val<30||val>300){toast('Peso inválido.');return;}
  const key=todayKey();
  state.weights=state.weights.filter(w=>w.date!==key);
  state.weights.push({date:key,kg:val});
  state.weights.sort((a,b)=>a.date.localeCompare(b.date));
  persist();
  updateWeightUI();
  toast(`Peso ${val}kg registrado!`);
}
function updateWeightUI(){
  const goal=85,start=104;
  const last=state.weights[state.weights.length-1];
  const curr=last?last.kg:start;
  const lost=start-curr;
  const total=start-goal;
  const pct=Math.max(0,Math.min(100,Math.round(lost/total*100)));
  const prog=document.getElementById('weightProgress');
  const pctEl=document.getElementById('weightPct');
  const note=document.getElementById('weightNote');
  if(prog){prog.style.width=pct+'%';}
  if(pctEl){pctEl.textContent=pct+'%';}
  if(note){note.textContent=last?`Último registro: ${last.kg}kg em ${formatShort(last.date)}. Meta: 85kg.`:'Registre seu peso toda semana, de manhã, em jejum.';}
  if(document.getElementById('currentWeight')) document.getElementById('currentWeight').value='';
}

// ═══════════════════════════════════════════════════════════
// HISTÓRICO
// ═══════════════════════════════════════════════════════════
function renderHistory(){
  const fL=document.getElementById('fastHistory'),sL=document.getElementById('studyHistory'),wL=document.getElementById('workoutHistory');
  document.getElementById('fastHistoryTotal').textContent=`${state.fasts.length}`;
  document.getElementById('studyHistoryTotal').textContent=`${state.studySessions.length}`;
  document.getElementById('workoutHistoryTotal').textContent=`${state.workouts.length}`;
  fL.innerHTML=state.fasts.length?state.fasts.slice(0,15).map(f=>`<article class="record"><div><h3>${formatShort(new Date(f.start))}</h3><p>${formatTime(f.start)} → ${formatTime(f.end)}${f.note?` · ${esc(f.note)}`:''}</p></div><div class="record-time">${durationText(f.duration)}</div></article>`).join(''):'<p class="empty">Nenhum jejum ainda.</p>';
  sL.innerHTML=state.studySessions.length?state.studySessions.slice(0,15).map(s=>`<article class="record"><div><h3>${esc(s.subject)}</h3><p>${formatShort(new Date(s.start))} · ${formatTime(s.start)}${s.note?` · ${esc(s.note)}`:''}</p></div><div class="record-time">${durationText(s.duration)}</div></article>`).join(''):'<p class="empty">Nenhuma sessão ainda.</p>';
  wL.innerHTML=state.workouts.length?state.workouts.slice(0,15).map(w=>`<article class="record"><div><h3>${esc(w.type)}</h3><p>${formatShort(new Date(w.start))} · ${formatTime(w.start)}${w.note?` · ${esc(w.note)}`:''}</p></div><div class="record-time">${durationText(w.duration)}</div></article>`).join(''):'<p class="empty">Nenhum treino ainda.</p>';

  // Gráfico de peso
  const wc=document.getElementById('weightChart');
  if(state.weights.length>1){
    const max=Math.max(...state.weights.map(w=>w.kg));
    const min=Math.min(...state.weights.map(w=>w.kg));
    const range=max-min||1;
    wc.innerHTML=state.weights.slice(-10).map(w=>{
      const h=Math.round(((w.kg-min)/range)*80)+10;
      return `<div class="bar-col"><div class="bar-fill" style="height:${h}px;background:var(--clay)"></div><div class="bar-label">${w.kg}kg</div></div>`;
    }).join('');
  } else {
    wc.innerHTML='<p class="empty">Registre seu peso na aba Alimentação para ver o gráfico.</p>';
  }
}

// ═══════════════════════════════════════════════════════════
// ANÁLISE
// ═══════════════════════════════════════════════════════════
function renderAnalysis(){
  const grid=document.getElementById('analysisGrid');
  const insights=document.getElementById('insightList');
  const cons=document.getElementById('consistencyBars');
  const wa=document.getElementById('weightAnalysis');

  // Últimos 7 dias
  const today=new Date();
  let fastDays=0,studyDays=0,workoutDays=0,totalFastH=0,totalStudyM=0,totalWorkoutM=0;
  for(let i=0;i<7;i++){
    const d=new Date(today);d.setDate(today.getDate()-i);const key=localKey(d);
    if(state.fasts.some(f=>localKey(new Date(f.start))===key)){fastDays++;totalFastH+=state.fasts.filter(f=>localKey(new Date(f.start))===key).reduce((s,f)=>s+(f.duration||0),0)/3600000;}
    if(state.studySessions.some(s=>localKey(new Date(s.start))===key)){studyDays++;totalStudyM+=state.studySessions.filter(s=>localKey(new Date(s.start))===key).reduce((s,x)=>s+(x.duration||0),0)/60000;}
    if(state.workouts.some(w=>localKey(new Date(w.start))===key)){workoutDays++;totalWorkoutM+=state.workouts.filter(w=>localKey(new Date(w.start))===key).reduce((s,w)=>s+(w.duration||0),0)/60000;}
  }

  grid.innerHTML=`
    <div class="analysis-card ${fastDays>=1?'good':'warn'}">
      <h3>⚡ Jejum</h3>
      <p>${fastDays} jejum${fastDays!==1?'s':''} nos últimos 7 dias · ${totalFastH.toFixed(1)}h total. ${fastDays===0?'Nenhum jejum registrado ainda.':fastDays>=1?'Consistência boa — toda terça!':'Continue!'}</p>
    </div>
    <div class="analysis-card ${studyDays>=4?'good':studyDays>=2?'':'warn'}">
      <h3>📚 Estudos</h3>
      <p>${studyDays} dia${studyDays!==1?'s':''} de estudo · ${Math.round(totalStudyM)}min total. ${studyDays===0?'Nenhuma sessão esta semana.':studyDays>=4?'Excelente ritmo de estudos!':'Tente estudar mais dias.'}</p>
    </div>
    <div class="analysis-card ${workoutDays>=4?'good':workoutDays>=2?'':'warn'}">
      <h3>💪 Treinos</h3>
      <p>${workoutDays} treino${workoutDays!==1?'s':''} · ${Math.round(totalWorkoutM)}min total. ${workoutDays===0?'Nenhum treino registrado.':workoutDays>=4?'Semana de treino completa!':workoutDays>=2?'Bom começo, pode mais.':'Abaixo do planejado.'}</p>
    </div>
  `;

  // Barras de consistência
  const cats=[
    {label:'Muay Thai',target:2,actual:state.workouts.filter(w=>{const d=new Date(w.start);return w.type==='Muay Thai'&&(nowMs()-w.start)<7*DAY;}).length},
    {label:'Academia',target:3,actual:state.workouts.filter(w=>{const d=new Date(w.start);return w.type!=='Muay Thai'&&w.type!=='Caminhada'&&(nowMs()-w.start)<7*DAY;}).length},
    {label:'Estudo',target:5,actual:studyDays},
    {label:'Jejum',target:1,actual:fastDays},
    {label:'Caminhada',target:1,actual:state.workouts.filter(w=>w.type==='Caminhada'&&(nowMs()-w.start)<7*DAY).length},
  ];
  cons.innerHTML=cats.map(c=>{
    const pct=Math.min(100,Math.round(c.actual/c.target*100));
    return `<div class="progress-row"><span class="progress-label">${c.label}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><span class="progress-val">${c.actual}/${c.target}</span></div>`;
  }).join('');

  // Insights
  const tips=[];
  if(fastDays===0) tips.push({t:'warn',title:'Sem jejum registrado',text:'Use o botão "Começar agora" na aba Hoje quando iniciar o jejum de terça.'});
  if(workoutDays<3) tips.push({t:'warn',title:'Poucos treinos',text:'O plano prevê 5 treinos por semana. Tente manter Muay Thai (seg/qui) e academia (qua/sex/sáb).'});
  if(studyDays>=5) tips.push({t:'good',title:'Estudos em dia!',text:'Você está mantendo uma frequência excelente. Continue no ritmo!'});
  if(streak()>=3) tips.push({t:'good',title:`${streak()} dias no ritmo!`,text:'Você está criando um hábito real. Cada dia conta.'});
  if(tips.length===0) tips.push({t:'good',title:'Continue assim',text:'Registre suas atividades diariamente para ver análises mais precisas.'});
  insights.innerHTML=tips.map(t=>`<div class="analysis-card ${t.t}"><h3>${t.title}</h3><p>${t.text}</p></div>`).join('');

  // Peso
  if(state.weights.length>=2){
    const first=state.weights[0],last=state.weights[state.weights.length-1];
    const lost=(first.kg-last.kg).toFixed(1);
    const toGoal=(last.kg-85).toFixed(1);
    wa.innerHTML=`<div class="analysis-card ${lost>0?'good':'warn'}"><h3>${lost>0?`−${lost}kg perdidos`:'Sem perda ainda'}</h3><p>De ${first.kg}kg para ${last.kg}kg. Faltam ${toGoal}kg para chegar em 85kg.</p></div>`;
  } else {
    wa.innerHTML='<p class="empty">Registre seu peso na aba Alimentação para ver a análise.</p>';
  }
}

// ═══════════════════════════════════════════════════════════
// PLANNER E CALENDÁRIO
// ═══════════════════════════════════════════════════════════
function mondayOf(key){const d=fromKey(key);const off=(d.getDay()+6)%7;d.setDate(d.getDate()-off);return d;}
function renderWeekAgenda(){
  const start=mondayOf(selectedWeekDate);const names=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];let html='';
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const key=localKey(d);
    const isToday=key===todayKey(),isSel=key===selectedWeekDate;
    const plan=scheduledTaskMarkup(key,true),custom=customTaskMarkup(key,true);
    html+=`<article class="week-day ${isToday?'today':''} ${isSel?'week-day-selected':''}"><button class="week-day-top" style="width:100%;border:0;background:transparent;padding:0" onclick="selectWeekDay('${key}')"><span>${names[i]}</span><strong>${d.getDate()}</strong></button>${plan||custom?plan+custom:'<p class="week-empty">Sem tarefas.</p>'}</article>`;
  }
  document.getElementById('weekAgenda').innerHTML=html;
  const end=new Date(start);end.setDate(start.getDate()+6);
  document.getElementById('weekAgendaText').textContent=`${formatDate(localKey(start),{day:'numeric',month:'short'})} a ${formatDate(localKey(end),{day:'numeric',month:'short'})}.`;
  document.getElementById('weekAgendaBadge').textContent=selectedWeekDate===todayKey()?'semana atual':'semana escolhida';
  renderSelectedDay();
}
function selectWeekDay(key){selectedWeekDate=key;renderWeekAgenda();}
function renderSelectedDay(){
  const key=selectedWeekDate;const plan=dayPlan(key);const count=(state.weeklyTasks[key]||[]).length;
  const wd=fromKey(key).getDay();const r=WEEK_ROUTINE[wd];
  document.getElementById('selectedDay').innerHTML=`<strong>${formatDate(key,{weekday:'long',day:'numeric',month:'long'})}</strong><p>${r?.emoji||''} ${esc(plan.label)}. ${count?`${count} tarefa${count===1?'':'s'} adicional.`:'Adicione tarefas abaixo.'}</p>`;
  document.getElementById('weekTaskInput').placeholder=`Tarefa para ${formatDate(key,{weekday:'long',day:'numeric'})}`;
}
function renderPlanner(){
  const cal=document.getElementById('calendar');
  const names=['D','S','T','Q','Q','S','S'];
  let html=names.map(n=>`<div class="cal-head">${n}</div>`).join('');
  const start=cycleStart(),total=Number(state.settings.weeks)*7;
  for(let i=0;i<total;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const key=localKey(d);
    const plan=dayPlan(key),isToday=key===todayKey();
    const wd=d.getDay(),isMuay=wd===1||wd===4;
    if(i%7===0) html+=`<div class="calendar-week">Semana ${Math.floor(i/7)+1} ${Math.floor(i/7)<2?'· 12h jejum':Math.floor(i/7)<4?'· 16h jejum':'· 24h jejum'}</div>`;
    html+=`<button class="cal-day ${isToday?'today':''} ${plan.kind==='fast'?'fast':''} ${isMuay&&plan.kind!=='fast'?'muay-day':''}" onclick="selectWeekDay('${key}')"><span class="num">${d.getDate()}</span><span class="kind ${plan.kind==='fast'?'fast':''} ${isMuay&&plan.kind!=='fast'?'muay':''}">${plan.kind==='fast'?`⚡ ${fastTargetForWeek(weekNum(key))}h`:isMuay?'🥊 Muay':WEEK_ROUTINE[wd]?.emoji+' '+WEEK_ROUTINE[wd]?.label.slice(0,3)}</span></button>`;
  }
  cal.innerHTML=html;
  document.getElementById('plannerCycleText').textContent=`${state.settings.weeks} semanas a partir de ${formatShort(state.settings.cycleStart)}.`;
  document.getElementById('cycleProgress').textContent=inCycle()?`dia ${cycleDay()+1}`:'concluído';
  renderWeekAgenda();
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
function renderSettings(){
  document.getElementById('setStart').value=state.settings.cycleStart;
  document.getElementById('setWeeks').value=state.settings.weeks;
  document.getElementById('setTarget').value=state.settings.targetHours;
  document.getElementById('setFastTime').value=state.settings.plannedFastTime;
  document.getElementById('setCycleNote').value=state.settings.intention||'';
  document.getElementById('setCurrentBook').value=state.settings.currentBook||'Harry Potter: A Pedra Filosofal';
}
function saveSettings(){
  const start=document.getElementById('setStart').value;
  if(!start){toast('Escolha uma data de início.');return;}
  state.settings={...state.settings,cycleStart:start,weeks:Number(document.getElementById('setWeeks').value),targetHours:Number(document.getElementById('setTarget').value),plannedFastTime:document.getElementById('setFastTime').value,intention:document.getElementById('setCycleNote').value.trim(),currentBook:document.getElementById('setCurrentBook').value.trim()||'Harry Potter: A Pedra Filosofal'};
  // Atualiza nome do livro no select de estudos
  const sel=document.getElementById('studySubject');
  if(sel) sel.options[2].text=`Livro — ${state.settings.currentBook}`;
  persist();renderAll();toast('Ajustes salvos!');
}

// ═══════════════════════════════════════════════════════════
// BACKUP
// ═══════════════════════════════════════════════════════════
function exportBackup(){
  const blob=new Blob([JSON.stringify({app:'Meu Plano',version:3,exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=`meu-plano-backup-${todayKey()}.json`;a.click();URL.revokeObjectURL(url);
  toast('Backup exportado!');
}
function importBackup(e){
  const file=e.target.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const p=JSON.parse(reader.result);
      if(!p?.state?.settings) throw new Error('invalid');
      if(!confirm('Restaurar backup substitui os dados atuais. Continuar?')) return;
      state={...cloneDefault(),...p.state,settings:{...cloneDefault().settings,...p.state.settings}};
      persist();renderAll();toast('Backup restaurado!');
    } catch{toast('Arquivo inválido.');}
    finally{e.target.value='';}
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════
// PWA
// ═══════════════════════════════════════════════════════════
function installApp(){
  if(deferredPrompt){deferredPrompt.prompt();deferredPrompt.userChoice.then(()=>{deferredPrompt=null;document.getElementById('installButton').style.display='none';});}
  else toast('No iPhone: Compartilhar → Adicionar à Tela de Início.');
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;document.getElementById('installButton').style.display='inline-flex';});
window.addEventListener('appinstalled',()=>{document.getElementById('installButton').style.display='none';document.getElementById('installText').textContent='Aplicativo instalado!';});

// ═══════════════════════════════════════════════════════════
// RENDER GERAL
// ═══════════════════════════════════════════════════════════
function renderAll(){
  renderHeader();renderFast();renderStudy();renderWorkout();
  renderPlanToday();renderActivities();renderStats();
  updateWeightUI();
  const note=document.getElementById('dailyNote');
  if(note&&document.activeElement!==note) note.value=state.dailyNotes[todayKey()]||'';
}

// Init
renderAll();
if(new URLSearchParams(window.location.search).get('tab')==='planner') switchView('planner');

// Tick a cada segundo para atualizar timers ativos
setInterval(()=>{
  if(state.activeFast) renderFast();
  if(state.activeStudy) renderStudy();
  if(state.activeWorkout) renderWorkout();
},1000);
// Registra o Service Worker para funcionamento offline
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('SW registrado — app funciona offline!'))
      .catch(err => console.log('SW erro:', err));
  });
}

// ═══════════════════════════════════════════════════════════
// ASSISTENTE IA
// ═══════════════════════════════════════════════════════════
let aiHistory = [];
let aiTyping = false;

function buildAIContext() {
  const today = new Date();
  const wd = today.getDay();
  const r = WEEK_ROUTINE[wd];
  const lastWeight = state.weights[state.weights.length - 1];
  const w = weekNum();
  const fastHours = state.fasts.reduce((s,f)=>s+(f.duration||0),0)/3600000;

  return `Você é o assistente pessoal de saúde e rotina dentro do app Meu Plano Diário.
Responda sempre em português brasileiro, de forma direta e motivadora. Máximo 3 parágrafos curtos.

DADOS DO USUÁRIO HOJE (${today.toLocaleDateString('pt-BR')}):
- Dia: ${r?.label||'Hoje'} | Rotina: ${r?.activities?.join(', ')||'livre'}
- Semana ${w} do ciclo | Jejum desta fase: ${fastTargetForWeek(w)}h
- Jejum ativo: ${state.activeFast?'SIM':'não'}
- Treino ativo: ${state.activeWorkout?state.activeWorkout.type:'não'}
- Estudo ativo: ${state.activeStudy?state.activeStudy.subject:'não'}
- Total jejuns: ${state.fasts.length} (${fastHours.toFixed(1)}h total)
- Total treinos: ${state.workouts.length}
- Peso atual: ${lastWeight?lastWeight.kg+'kg':'não registrado'} | Meta: 85kg
- Livro: ${state.settings.currentBook||'Harry Potter: A Pedra Filosofal'}`;
}

function addAIMessage(role, text, isTyping=false) {
  const chat = document.getElementById('aiChat');
  if (!chat) return;
  const div = document.createElement('div');
  div.style.cssText = role==='user'
    ? 'background:var(--ink);color:white;align-self:flex-end;padding:10px 14px;border-radius:14px 14px 4px 14px;font-size:13px;line-height:1.5;max-width:85%'
    : 'background:var(--surface);border:1px solid var(--line);color:var(--ink);align-self:flex-start;padding:10px 14px;border-radius:14px 14px 14px 4px;font-size:13px;line-height:1.5;max-width:85%';
  if (isTyping) {
    div.innerHTML = '<span style="color:var(--muted)">Digitando...</span>';
    div.dataset.typing = 'true';
  } else {
    div.innerHTML = text.replace(/\n/g,'<br>');
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function sendAIMessage() {
  const input = document.getElementById('aiInput');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg || aiTyping) return;

  const apiKey = localStorage.getItem('ai_key');
  if (!apiKey) { toast('Configure sua chave na seção abaixo!'); return; }

  input.value = '';
  addAIMessage('user', msg);
  aiTyping = true;
  addAIMessage('assistant', '', true);

  aiHistory.push({role:'user', content:msg});

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: buildAIContext(),
        messages: aiHistory.slice(-10)
      })
    });
    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Não consegui responder. Tente novamente.';
    document.querySelector('[data-typing="true"]')?.remove();
    aiHistory.push({role:'assistant', content:reply});
    addAIMessage('assistant', reply);
  } catch(e) {
    document.querySelector('[data-typing="true"]')?.remove();
    addAIMessage('assistant', 'Erro de conexão. Verifique sua internet.');
  }
  aiTyping = false;
}

function askAI(text) {
  const input = document.getElementById('aiInput');
  if (input) { input.value = text; sendAIMessage(); }
}

function saveAPIKey() {
  const key = document.getElementById('apiKeyInput')?.value.trim();
  if (!key || !key.startsWith('sk-ant-')) { toast('Chave inválida. Deve começar com sk-ant-'); return; }
  localStorage.setItem('ai_key', key);
  const input = document.getElementById('apiKeyInput');
  if (input) input.value = '';
  const status = document.getElementById('aiKeyStatus');
  if (status) status.textContent = '✅ Assistente ativado!';
  toast('Assistente ativado!');
  const chat = document.getElementById('aiChat');
  if (chat) {
    chat.innerHTML = '';
    addAIMessage('assistant', '👋 Olá! Estou pronto. Tenho acesso aos seus dados de jejum, treino e estudos. O que quer saber?');
  }
}

function removeAPIKey() {
  localStorage.removeItem('ai_key');
  aiHistory = [];
  const status = document.getElementById('aiKeyStatus');
  if (status) status.textContent = 'Cole sua chave para ativar o assistente.';
  const chat = document.getElementById('aiChat');
  if (chat) chat.innerHTML = '';
  toast('Chave removida.');
}

// Verifica se já tem chave salva ao entrar na aba IA
function checkSavedKey() {
  const key = localStorage.getItem('ai_key');
  const status = document.getElementById('aiKeyStatus');
  const chat = document.getElementById('aiChat');
  if (key && status) {
    status.textContent = '✅ Assistente ativo — pronto para perguntas!';
    if (chat && chat.children.length === 0) {
      addAIMessage('assistant', '👋 Bem-vindo de volta! Tenho acesso aos seus dados. O que quer saber?');
    }
  }
}

// initAIChat — chamada ao entrar na aba IA
function initAIChat() {
  checkSavedKey();
}

// checkSavedKey — verifica se já tem chave salv