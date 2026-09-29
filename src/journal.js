const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const defaultProfile = {goalDistanceKm:5,targetSeconds:1200,days:[1,6]};
let state = JSON.parse(localStorage.getItem('veyvo-state') || 'null') || {};
state.profile ||= {...defaultProfile};
state.profile.days=[1,6];
delete state.sharedChatUrl;
state.runHistory ||= [];
state.milestones ||= [];
state.recoveryLogs ||= [];
state.stravaActivityIds ||= [];
state.theme ||= 'dark';
state.language ||= 'cs';
function save(){localStorage.setItem('veyvo-state',JSON.stringify(state))}
function toast(message){const item=$('#toast');item.textContent=message;item.classList.add('show');setTimeout(()=>item.classList.remove('show'),2800)}
function escapeHtml(value){const el=document.createElement('div');el.textContent=String(value??'');return el.innerHTML}
function formatDuration(seconds){return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')}
function go(page){$$('.page').forEach(el=>el.classList.toggle('active',el.id===page+'Page'));$$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));$('#pageTitle').textContent={home:'Přehled',plan:'Další běh',progress:'Výkonnost',connections:'Propojení'}[page];$('#pageEyebrow').textContent='VEYVO'}
$('#nav').addEventListener('click',e=>{const item=e.target.closest('[data-page]');if(item)go(item.dataset.page)});
function applyTheme(){document.documentElement.dataset.theme=state.theme;$('#themeIcon').textContent=state.theme==='dark'?'☾':'☀';$('#themeText').textContent=state.theme==='dark'?'Tmavý režim':'Světlý režim';$$('[data-set-theme]').forEach(el=>el.classList.toggle('active',el.dataset.setTheme===state.theme))}
function setTheme(theme){state.theme=theme;save();applyTheme()}
$('#themeToggle').addEventListener('click',()=>setTheme(state.theme==='dark'?'light':'dark'));
function nextRun(){const runs=state.runHistory;if(!runs.length)return null;const latest=[...runs].sort((a,b)=>new Date(b.date)-new Date(a.date))[0],baseline=runs.find(r=>r.type==='Test 5 km');return VeyvoTraining.nextRunAfterRun(latest,state.profile.days,VeyvoTraining.dateKey(),baseline)}
let calendarWeekOffset=0;
function renderCalendar(){
 const today=VeyvoTraining.dateKey(),days=VeyvoCalendar.weekDays(new Date(),calendarWeekOffset),first=new Date(days[0]+'T12:00:00'),last=new Date(days[6]+'T12:00:00');
 const dateLabel=date=>new Intl.DateTimeFormat('cs-CZ',{day:'numeric',month:'long',year:'numeric'}).format(date);
 $('#calendarWeekLabel').textContent=dateLabel(first)+' – '+dateLabel(last);
 const workoutDays=days.filter(date=>state.runHistory.some(run=>String(run.date).slice(0,10)===date)).length;
 const milestoneDays=days.filter(date=>state.milestones.some(item=>item.date===date)).length;
 $('#calendarWeekSummary').textContent=workoutDays+' dní s během · '+milestoneDays+' dní s milníkem';
 const suggested=nextRun();
 const latestRun=[...state.runHistory].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
 const latestWorkout=[...state.milestones].reverse().find(entry=>/intervaly|běh\s+\d/i.test(entry.label));
 const plannedDescription=suggested?.returnAfterBreak?'25–30 min lehce · podle dechu, bez rychlého konce':latestWorkout&&(!latestRun||latestWorkout.date>String(latestRun.date).slice(0,10))?'20–30 min podle pocitu · po doběhu zapiš výsledek':null;
 $('#calendarDays').innerHTML=days.map(date=>{
  const day=new Date(date+'T12:00:00'),weekday=new Intl.DateTimeFormat('cs-CZ',{weekday:'long'}).format(day);
  const entries=VeyvoCalendar.entriesForDay(date,{runs:state.runHistory,milestones:state.milestones,availableDays:state.profile.days,nextRun:suggested,plannedDescription,today});
  const kind=entries[0].kind;
  const label={run:'ZAPSÁNO',milestone:'Z HISTORIE',planned:'DALŠÍ BĚH',unlogged:'BEZ ZÁZNAMU',rest:'VOLNO',pending:'ČEKÁ NA VÝSLEDEK'}[kind];
  const details=entries.map(item=>'<div class="calendar-entry"><b>'+escapeHtml(item.title)+'</b><span>'+escapeHtml(item.detail)+'</span></div>').join('');
  const log=date<=today?'<button type="button" class="calendar-log" data-log-date="'+date+'">＋ Zapsat běh</button>':'';
  return '<div class="calendar-day '+(date===today?'today ':'')+kind+'"><div class="calendar-date"><small>'+escapeHtml(weekday)+'</small><strong>'+escapeHtml(date.slice(8))+'</strong></div><div class="calendar-content">'+details+'</div><div class="calendar-side"><span>'+label+'</span>'+log+'</div></div>';
 }).join('');
}
$('#calendarPrevious').addEventListener('click',()=>{calendarWeekOffset=Math.max(-52,calendarWeekOffset-1);renderCalendar()});
$('#calendarNext').addEventListener('click',()=>{calendarWeekOffset=Math.min(52,calendarWeekOffset+1);renderCalendar()});
$('#calendarToday').addEventListener('click',()=>{calendarWeekOffset=0;renderCalendar()});
$('#calendarLatest').addEventListener('click',()=>{
 const dates=[...state.runHistory.map(run=>String(run.date).slice(0,10)),...state.milestones.map(item=>item.date)].sort();
 if(!dates.length)return;
 const latest=new Date(dates.at(-1)+'T12:00:00');
 calendarWeekOffset=Math.round(VeyvoTraining.dayDifference(VeyvoCalendar.weekStart(latest),VeyvoCalendar.weekStart(new Date()))/7);
 renderCalendar();
});
$('#calendarDays').addEventListener('click',event=>{const date=event.target.closest('[data-log-date]')?.dataset.logDate;if(date)openRunLog(date)});
function renderAll(){
 const runs=state.runHistory,next=nextRun(),count=runs.length;
 const latestRun=[...runs].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
 const latestWorkout=[...state.milestones].reverse().find(entry=>/intervaly|běh\s+\d/i.test(entry.label));
 const laterRecordedWorkout=latestWorkout&&(!latestRun||latestWorkout.date>String(latestRun.date).slice(0,10));
 $('#historyIntro').hidden=count>0||state.milestones.length>0;$('#nextRunIntro').hidden=!next;$('#nextRunEmpty').hidden=!!next;
 $('#planStatusTitle').textContent=count?count+' zaznamenaných běhů':'Zatím žádný běh';
 $('#planStatusText').textContent=laterRecordedWorkout?'Poslední trénink v historii: '+latestWorkout.date:count?'Poslední běh: '+String(runs[count-1].date).slice(0,10):'Zapiš první běh a sleduj svůj pokrok.';
 $('#planGoalChip').textContent='CÍL · '+state.profile.goalDistanceKm+' KM';
 if(next){$('#nextRunTitle').textContent=next.kind==='rest'?'Nejdřív odpočívej':next.returnAfterBreak?next.date+' · 25–30 min lehký návrat':laterRecordedWorkout?next.date+' · 20–30 min lehký návrat':next.date+' · Lehký běh '+next.distanceKm+' km';$('#nextRunText').textContent=next.kind==='rest'?'Běh byl maximálně náročný. Pokud máš bolesti nebo se necítíš dobře, další běh odlož.':next.returnAfterBreak?'Poslední zaznamenaný běh byl '+String(latestRun.date).slice(0,10)+'. Začni 5 min velmi volně, pak běž pohodlně podle dechu (náročnost 2–3/10). Neřeš tempo, nedávej intervaly ani rychlý závěr. Pokud se ozve koleno nebo tříslo a bolest se zhoršuje, běh ukonči. Po doběhu zapiš čas a pocit; další trénink se upraví podle výsledku.':laterRecordedWorkout?'Poslední známý trénink byly intervaly '+latestWorkout.date+'. Po pauze běž pohodlně tak, abys mohl mluvit. Pokud se vrátí bolest, běh ukonči. Po doběhu zapiš čas, vzdálenost a náročnost.':'Běž tempem, při kterém můžeš mluvit. Pokud jsi stále unavený, běh odlož nebo zkrať.'}
 $('#todayPlanText').textContent=next?'Návrh dalšího běhu':'Zapiš běh a sleduj pokrok';$('#todayWorkout').textContent=next?(next.kind==='rest'?'Odpočinek':next.returnAfterBreak?next.date+' · 25–30 min lehce':laterRecordedWorkout?next.date+' · 20–30 min lehce':next.date+' · lehký běh '+next.distanceKm+' km'):'Tvoje běhy na jednom místě';$('#planPhaseLabel').textContent=count?count+' běhů':'Pokračuj ve své cestě';
 $('#progressCount').textContent=count;$('#progressDistance').textContent=runs.reduce((sum,r)=>sum+Number(r.distance||0),0).toFixed(1)+' km';
 $('#progressWeek').textContent=runs.filter(r=>new Date(r.date)>=new Date(Date.now()-7*86400000)).reduce((sum,r)=>sum+Number(r.distance||0),0).toFixed(1)+' km';
 const five=runs.filter(r=>r.distance>=4.95&&r.distance<=5.05).map(r=>r.movingSeconds||VeyvoTraining.durationSeconds(r.time)).filter(Boolean);$('#progressBest5k').textContent=five.length?formatDuration(Math.min(...five)):'—';
 $('#progressRuns').innerHTML=count?[...runs].reverse().map(r=>'<p>'+escapeHtml(String(r.date).slice(0,10))+' · '+escapeHtml(r.type||'Běh')+' · '+escapeHtml(r.distance)+' km · '+escapeHtml(r.time||formatDuration(r.movingSeconds))+'</p>').join(''):'<p>Zatím žádný běh.</p>';
 $('#progressMilestones').innerHTML=state.milestones.length?[...state.milestones].reverse().map(entry=>'<p>'+escapeHtml(entry.date)+' · '+escapeHtml(entry.label)+'</p>').join(''):'<p>Zatím žádný milník.</p>';
 renderRecovery();
 renderCalendar();
}
function openRunLog(date=VeyvoTraining.dateKey()){$('#logDate').value=date;$('#logDate').max=VeyvoTraining.dateKey();$('#logDistance').readOnly=false;$('#logDistance').value='';$('#logTime').value='';$('#logType').value='Běh';$('#effort').value='6';$('#effortOutput').value='6 / 10';$('#logNote').value='';$('#logDialog').showModal()}
$('#quickLog').addEventListener('click',()=>openRunLog());$('#startWorkout').addEventListener('click',()=>openRunLog());
$('#effort').addEventListener('input',e=>$('#effortOutput').value=e.target.value+' / 10');
$('#saveLog').addEventListener('click',e=>{e.preventDefault();const date=VeyvoTraining.parseDate($('#logDate').value),distance=Number($('#logDistance').value),seconds=VeyvoTraining.durationSeconds($('#logTime').value);if(!date||date>new Date()||!Number.isFinite(distance)||distance<=0||distance>300||!seconds){toast('Zadej platné datum, vzdálenost a čas.');return}const first=state.runHistory.length===0;state.runHistory.push({id:Date.now(),source:'manual',date:VeyvoTraining.dateKey(date)+'T00:00:00',type:$('#logType').value,distance,time:$('#logTime').value,movingSeconds:seconds,effort:Number($('#effort').value),effortRecorded:true,note:$('#logNote').value.trim()});state.runHistory.sort((a,b)=>new Date(a.date)-new Date(b.date));save();$('#logDialog').close();renderAll();if(first)go('plan');toast('Běh uložen')});
function todayRecovery(){return [...state.recoveryLogs].reverse().find(log=>log.date===VeyvoTraining.dateKey())}
function renderRecovery(){const log=todayRecovery();$('#recoveryScoreLabel').textContent=log?'REGENERACE · ZAPSÁNO':'REGENERACE · DOPLŇ CHECK-IN';$('#recoverySleep').textContent=log?log.sleepHours+' h':'—';$('#recoveryFatigue').textContent=log?log.fatigue+'/10':'—';$('#recoveryLoad').textContent=log?(log.fatigue>=8||log.soreness>=7?'Odpočinek':'Podle pocitu'):'—';$('#recoverySummary').textContent=log?(log.fatigue>=8||log.soreness>=7?'Dnes dej přednost odpočinku.':'Sleduj svůj pocit před dalším během.'):'Zapiš spánek a pocitovou únavu pro vlastní přehled.'}
$('#openRecovery').addEventListener('click',()=>{const log=todayRecovery();$('#recoverySleepInput').value=log?.sleepHours??'';$('#recoveryFatigueInput').value=log?.fatigue??3;$('#recoverySorenessInput').value=log?.soreness??1;$('#recoveryNote').value=log?.note||'';$('#recoveryDialog').showModal()});
$('#recoveryFatigueInput').addEventListener('input',e=>$('#recoveryFatigueOutput').value=e.target.value+' / 10');$('#recoverySorenessInput').addEventListener('input',e=>$('#recoverySorenessOutput').value=e.target.value+' / 10');
$('#saveRecovery').addEventListener('click',e=>{e.preventDefault();const sleep=Number($('#recoverySleepInput').value);if(!Number.isFinite(sleep)||sleep<0||sleep>24){toast('Zadej spánek 0–24 hodin.');return}state.recoveryLogs=state.recoveryLogs.filter(log=>log.date!==VeyvoTraining.dateKey());state.recoveryLogs.push({date:VeyvoTraining.dateKey(),sleepHours:sleep,fatigue:Number($('#recoveryFatigueInput').value),soreness:Number($('#recoverySorenessInput').value),note:$('#recoveryNote').value.trim()});save();$('#recoveryDialog').close();renderRecovery();toast('Regenerace uložena')});
$('#resetDemo').addEventListener('click',()=>{if(!confirm('Smazat místní běhy, milníky a regeneraci?'))return;state.runHistory=[];state.milestones=[];state.recoveryLogs=[];calendarWeekOffset=0;save();renderAll();go('home')});
function renderStravaState(){const connected=!!state.stravaConnected;for(const id of ['stravaStatus','settingsStravaStatus'])$('#'+id).textContent=connected?'PŘIPOJENO':'NEPŘIPOJENO';$('#settingsOpenStrava').textContent=connected?'Připojeno':'Nastavit propojení Stravy';$('#connectStrava').hidden=connected;$('#disconnectStrava').hidden=!connected;$('#stravaSyncState').textContent=connected?(state.stravaLastSync?'Naposledy '+new Date(state.stravaLastSync).toLocaleString('cs-CZ'):'Připojeno'):'Čeká na propojení'}
function importStravaActivities(activities){let imported=0;for(const a of activities){if(state.stravaActivityIds.includes(a.id))continue;const date=a.startDateLocal||a.startDate;if(!Number.isFinite(new Date(date).getTime())||!(a.distanceKm>0)||!(a.movingTime>0))continue;const duplicate=state.runHistory.find(r=>r.source!=='strava'&&VeyvoTraining.dateKey(new Date(r.date))===VeyvoTraining.dateKey(new Date(date))&&Math.abs(r.distance-a.distanceKm)<.15&&Math.abs((r.movingSeconds||VeyvoTraining.durationSeconds(r.time))-a.movingTime)<60);const record={id:'strava-'+a.id,stravaActivityId:a.id,source:'strava',date,type:duplicate?.type||'Běh',name:a.name,distance:a.distanceKm,time:formatDuration(a.movingTime),movingSeconds:a.movingTime,effort:duplicate?.effort??null,effortRecorded:!!duplicate?.effort,note:duplicate?.note||'',averageHeartrate:a.averageHeartrate,elevationGain:a.totalElevationGain};if(duplicate)Object.assign(duplicate,record);else state.runHistory.push(record);state.stravaActivityIds.push(a.id);imported++}if(imported){state.runHistory.sort((a,b)=>new Date(a.date)-new Date(b.date));save();renderAll()}return imported}
async function syncStrava(show=false){try{const count=importStravaActivities(await window.veyvo.syncStrava());state.stravaLastSync=new Date().toISOString();save();renderStravaState();if(show||count)toast(count?count+' běhů načteno':'Strava je aktuální')}catch(e){if(show)toast(e.message||'Synchronizace se nezdařila')}}
$('#connectStrava').addEventListener('click',()=>$('#stravaDialog').showModal());
$('#authorizeStrava').addEventListener('click',async e=>{e.preventDefault();if($('#stravaClientSecret').value.trim().length<8||!$('#stravaConsent').checked){toast('Zadej Client Secret a potvrď oprávnění');return}try{await window.veyvo.connectStrava($('#stravaClientSecret').value.trim());$('#stravaDialog').close();$('#stravaClientSecret').value='';toast('Dokonči přihlášení v prohlížeči')}catch(err){toast(err.message)}});
$('#disconnectStrava').addEventListener('click',async()=>{await window.veyvo.disconnectStrava();state.stravaConnected=false;save();renderStravaState()});
window.veyvo?.onStravaEvent(event=>{if(event.type==='connected'){state.stravaConnected=true;save();renderStravaState();syncStrava(true)}else toast(event.message||'Strava se nepřipojila')});
window.veyvo?.stravaStatus().then(status=>{state.stravaConnected=status.connected;save();renderStravaState();if(status.connected)syncStrava()});renderStravaState();setInterval(()=>{if(state.stravaConnected)syncStrava()},300000);
const settings=$('#settingsDialog'),menu=$('#profileMenu');$('#profileMenuButton').addEventListener('click',e=>{e.stopPropagation();menu.hidden=!menu.hidden});document.addEventListener('click',e=>{if(!menu.contains(e.target)&&e.target!==$('#profileMenuButton'))menu.hidden=true});$('#menuLight').addEventListener('click',()=>setTheme('light'));$('#menuDark').addEventListener('click',()=>setTheme('dark'));$('#openSettings').addEventListener('click',()=>{menu.hidden=true;settings.showModal()});
$$('[data-set-theme]').forEach(el=>el.addEventListener('click',()=>setTheme(el.dataset.setTheme)));$$('[data-settings-view]').forEach(tab=>tab.addEventListener('click',()=>{$$('[data-settings-view]').forEach(el=>el.classList.toggle('active',el===tab));$$('[data-settings-panel]').forEach(el=>el.hidden=el.dataset.settingsPanel!==tab.dataset.settingsView)}));$('#settingsOpenStrava').addEventListener('click',()=>{settings.close();go('connections')});
$('#openFirstLog').addEventListener('click',()=>openRunLog());$('#appLanguage').addEventListener('change',e=>{state.language=e.target.value;save();toast(state.language==='en'?'Language saved':'Jazyk uložen')});
let updateReady=false;
window.veyvo?.version().then(version=>{$('#installedVersion').textContent='v'+version});
$('#checkUpdates').addEventListener('click',()=>updateReady?window.veyvo?.installUpdate():window.veyvo?.checkForUpdates());
window.veyvo?.onUpdaterStatus(status=>{
 const labels={
  checking:['Hledám novou verzi','Kontrola obvykle trvá jen chvíli.','KONTROLA','⌕'],
  available:['Nová verze '+(status.version||'')+' je dostupná','Stahuji aktualizaci na pozadí.','STAHOVÁNÍ','↓'],
  progress:['Stahuji aktualizaci','Staženo '+Math.max(0,Math.min(100,Number(status.percent)||0))+' %.','STAHOVÁNÍ','↓'],
  ready:['Aktualizace je připravená','Restartuj VEYVO a nainstaluj verzi '+(status.version||'')+'.','PŘIPRAVENO','✓'],
  current:['Máš nejnovější verzi','VEYVO v'+(status.version||$('#installedVersion').textContent.replace(/^v/,''))+' je aktuální.','AKTUÁLNÍ','✓'],
  error:['Kontrola se nezdařila','Zkontroluj internetové připojení a zkus to znovu.','CHYBA','!'],
  development:['Vývojová verze','Kontrola aktualizací funguje až v nainstalované aplikaci.','VÝVOJ','i']
 };
 const [title,detail,badge,icon]=labels[status.type]||labels.error;
 $('#updateResult').dataset.state=status.type;$('#updateResult').title=status.type==='error'?(status.message||''):'';
 $('#updateStatusTitle').textContent=title;$('#updateStatusDetail').textContent=detail;$('#updateStatusIcon').textContent=icon;$('#updateStateBadge').textContent=badge;
 const downloading=status.type==='progress';$('#updateProgress').hidden=!downloading;
 if(downloading)$('#updateProgressBar').style.width=Math.max(0,Math.min(100,Number(status.percent)||0))+'%';
 updateReady=status.type==='ready';const button=$('#checkUpdates');button.disabled=['checking','available','progress'].includes(status.type);
 button.innerHTML=updateReady?'Restartovat a aktualizovat <span>↗</span>':'Zkontrolovat aktualizace <span>→</span>';
});
function refreshClock(){const now=new Date();$('#localClock').textContent=now.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'});$('#localClock').title=now.toLocaleDateString('cs-CZ')}refreshClock();setInterval(refreshClock,10000);
save();applyTheme();renderAll();go('home');
