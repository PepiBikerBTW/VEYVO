const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const defaultProfile = {goalDistanceKm:5,targetSeconds:1200,days:[1,2,4,6]};
let state = JSON.parse(localStorage.getItem('veyvo-state') || 'null') || {};
state.profile ||= {...defaultProfile};
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
function renderAll(){
 const runs=state.runHistory,next=nextRun(),count=runs.length;
 const latestRun=[...runs].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
 const latestWorkout=[...state.milestones].reverse().find(entry=>/intervaly|běh\s+\d/i.test(entry.label));
 const laterChatWorkout=latestWorkout&&(!latestRun||latestWorkout.date>String(latestRun.date).slice(0,10));
 $('#baselineIntro').hidden=count>0;$('#nextRunIntro').hidden=!next;$('#nextRunEmpty').hidden=!!next;
 $('#planStatusTitle').textContent=count?count+' zaznamenaných běhů':'Zatím žádný běh';
 $('#planStatusText').textContent=laterChatWorkout?'Poslední trénink v chatu: '+latestWorkout.date:count?'Poslední běh: '+String(runs[count-1].date).slice(0,10):'Zapiš první běh a sleduj svůj pokrok.';
 $('#planGoalChip').textContent='CÍL · '+state.profile.goalDistanceKm+' KM';
 if(next){$('#nextRunTitle').textContent=next.kind==='rest'?'Nejdřív odpočívej':laterChatWorkout?next.date+' · 20–30 min lehký návrat':next.date+' · Lehký běh '+next.distanceKm+' km';$('#nextRunText').textContent=next.kind==='rest'?'Běh byl maximálně náročný. Pokud máš bolesti nebo se necítíš dobře, další běh odlož.':laterChatWorkout?'Poslední známý trénink byly intervaly '+latestWorkout.date+'. Po pauze běž pohodlně tak, abys mohl mluvit. Pokud se vrátí bolest kolene nebo třísla, běh ukonči. Po doběhu zapiš čas, vzdálenost a náročnost.':latestRun?.source==='chatgpt'?'Po pauze běž lehce podle pocitu a v tempu, při kterém můžeš mluvit. Pokud se vrátí bolest kolene nebo třísla, běh ukonči. Po doběhu zapiš výsledek a náročnost.':'Běž tempem, při kterém můžeš mluvit. Orientačně '+VeyvoTraining.pace(next.paceFast)+'–'+VeyvoTraining.pace(next.paceSlow)+'/km. Pokud jsi stále unavený, běh odlož nebo zkrať.'}
 $('#todayPlanText').textContent=next?'Návrh dalšího běhu':'Zapiš běh a sleduj pokrok';$('#todayWorkout').textContent=next?(next.kind==='rest'?'Odpočinek':laterChatWorkout?next.date+' · 20–30 min lehce':next.date+' · lehký běh '+next.distanceKm+' km'):'Tvoje běhy na jednom místě';$('#planPhaseLabel').textContent=count?count+' běhů':'Začni 5 km testem';
 $('#progressCount').textContent=count;$('#progressDistance').textContent=runs.reduce((sum,r)=>sum+Number(r.distance||0),0).toFixed(1)+' km';
 $('#progressWeek').textContent=runs.filter(r=>new Date(r.date)>=new Date(Date.now()-7*86400000)).reduce((sum,r)=>sum+Number(r.distance||0),0).toFixed(1)+' km';
 const five=runs.filter(r=>r.distance>=4.95&&r.distance<=5.05).map(r=>r.movingSeconds||VeyvoTraining.durationSeconds(r.time)).filter(Boolean);$('#progressBest5k').textContent=five.length?formatDuration(Math.min(...five)):'—';
 $('#progressRuns').innerHTML=count?[...runs].reverse().map(r=>'<p>'+escapeHtml(String(r.date).slice(0,10))+' · '+escapeHtml(r.type||'Běh')+' · '+escapeHtml(r.distance)+' km · '+escapeHtml(r.time||formatDuration(r.movingSeconds))+'</p>').join(''):'<p>Zatím žádný běh.</p>';
 $('#progressMilestones').innerHTML=state.milestones.length?[...state.milestones].reverse().map(entry=>'<p>'+escapeHtml(entry.date)+' · '+escapeHtml(entry.label)+'</p>').join(''):'<p>Zatím žádný milník.</p>';
 renderRecovery();
}
function openRunLog(baseline=false){$('#logDate').value=VeyvoTraining.dateKey();$('#logDate').max=VeyvoTraining.dateKey();$('#logDistance').readOnly=baseline;$('#logDistance').value=baseline?'5':'';$('#logTime').value='';$('#logType').value='Běh';$('#effort').value=baseline?'9':'6';$('#effortOutput').value=$('#effort').value+' / 10';$('#logNote').value='';$('#logDialog').showModal()}
$('#quickLog').addEventListener('click',()=>openRunLog());$('#startWorkout').addEventListener('click',()=>openRunLog());$('#startBaseline').addEventListener('click',()=>openRunLog(true));
$('#effort').addEventListener('input',e=>$('#effortOutput').value=e.target.value+' / 10');
$('#saveLog').addEventListener('click',e=>{e.preventDefault();const date=VeyvoTraining.parseDate($('#logDate').value),distance=Number($('#logDistance').value),seconds=VeyvoTraining.durationSeconds($('#logTime').value);if(!date||date>new Date()||!Number.isFinite(distance)||distance<=0||distance>300||!seconds){toast('Zadej platné datum, vzdálenost a čas.');return}const first=state.runHistory.length===0,baseline=$('#logDistance').readOnly;state.runHistory.push({id:Date.now(),source:'manual',date:VeyvoTraining.dateKey(date)+'T00:00:00',type:baseline?'Test 5 km':$('#logType').value,distance,time:$('#logTime').value,movingSeconds:seconds,effort:Number($('#effort').value),effortRecorded:true,note:$('#logNote').value.trim()});state.runHistory.sort((a,b)=>new Date(a.date)-new Date(b.date));save();$('#logDialog').close();renderAll();if(first)go('plan');toast('Běh uložen')});
function todayRecovery(){return [...state.recoveryLogs].reverse().find(log=>log.date===VeyvoTraining.dateKey())}
function renderRecovery(){const log=todayRecovery();$('#recoveryScoreLabel').textContent=log?'REGENERACE · ZAPSÁNO':'REGENERACE · DOPLŇ CHECK-IN';$('#recoverySleep').textContent=log?log.sleepHours+' h':'—';$('#recoveryFatigue').textContent=log?log.fatigue+'/10':'—';$('#recoveryLoad').textContent=log?(log.fatigue>=8||log.soreness>=7?'Odpočinek':'Podle pocitu'):'—';$('#recoverySummary').textContent=log?(log.fatigue>=8||log.soreness>=7?'Dnes dej přednost odpočinku.':'Sleduj svůj pocit před dalším během.'):'Zapiš spánek a pocitovou únavu pro vlastní přehled.'}
$('#openRecovery').addEventListener('click',()=>{const log=todayRecovery();$('#recoverySleepInput').value=log?.sleepHours??'';$('#recoveryFatigueInput').value=log?.fatigue??3;$('#recoverySorenessInput').value=log?.soreness??1;$('#recoveryNote').value=log?.note||'';$('#recoveryDialog').showModal()});
$('#recoveryFatigueInput').addEventListener('input',e=>$('#recoveryFatigueOutput').value=e.target.value+' / 10');$('#recoverySorenessInput').addEventListener('input',e=>$('#recoverySorenessOutput').value=e.target.value+' / 10');
$('#saveRecovery').addEventListener('click',e=>{e.preventDefault();const sleep=Number($('#recoverySleepInput').value);if(!Number.isFinite(sleep)||sleep<0||sleep>24){toast('Zadej spánek 0–24 hodin.');return}state.recoveryLogs=state.recoveryLogs.filter(log=>log.date!==VeyvoTraining.dateKey());state.recoveryLogs.push({date:VeyvoTraining.dateKey(),sleepHours:sleep,fatigue:Number($('#recoveryFatigueInput').value),soreness:Number($('#recoverySorenessInput').value),note:$('#recoveryNote').value.trim()});save();$('#recoveryDialog').close();renderRecovery();toast('Regenerace uložena')});
$('#resetDemo').addEventListener('click',async()=>{if(!confirm('Smazat místní běhy, milníky a regeneraci?'))return;await window.veyvo.clearSharedHistoryUrl();state.runHistory=[];state.milestones=[];state.recoveryLogs=[];state.sharedChatUrl='';$('#sharedChatUrl').value='';save();renderAll();go('home')});
function renderStravaState(){const connected=!!state.stravaConnected;for(const id of ['stravaStatus','settingsStravaStatus'])$('#'+id).textContent=connected?'PŘIPOJENO':'NEPŘIPOJENO';$('#connectStrava').hidden=connected;$('#disconnectStrava').hidden=!connected;$('#stravaSyncState').textContent=connected?(state.stravaLastSync?'Naposledy '+new Date(state.stravaLastSync).toLocaleString('cs-CZ'):'Připojeno'):'Čeká na propojení'}
function importStravaActivities(activities){let imported=0;for(const a of activities){if(state.stravaActivityIds.includes(a.id))continue;const date=a.startDateLocal||a.startDate;if(!Number.isFinite(new Date(date).getTime())||!(a.distanceKm>0)||!(a.movingTime>0))continue;const duplicate=state.runHistory.find(r=>r.source!=='strava'&&VeyvoTraining.dateKey(new Date(r.date))===VeyvoTraining.dateKey(new Date(date))&&Math.abs(r.distance-a.distanceKm)<.15&&Math.abs((r.movingSeconds||VeyvoTraining.durationSeconds(r.time))-a.movingTime)<60);const record={id:'strava-'+a.id,stravaActivityId:a.id,source:'strava',date,type:duplicate?.type||'Běh',name:a.name,distance:a.distanceKm,time:formatDuration(a.movingTime),movingSeconds:a.movingTime,effort:duplicate?.effort??null,effortRecorded:!!duplicate?.effort,note:duplicate?.note||'',averageHeartrate:a.averageHeartrate,elevationGain:a.totalElevationGain};if(duplicate)Object.assign(duplicate,record);else state.runHistory.push(record);state.stravaActivityIds.push(a.id);imported++}if(imported){state.runHistory.sort((a,b)=>new Date(a.date)-new Date(b.date));save();renderAll()}return imported}
async function syncStrava(show=false){try{const count=importStravaActivities(await window.veyvo.syncStrava());state.stravaLastSync=new Date().toISOString();save();renderStravaState();if(show||count)toast(count?count+' běhů načteno':'Strava je aktuální')}catch(e){if(show)toast(e.message||'Synchronizace se nezdařila')}}
$('#connectStrava').addEventListener('click',()=>$('#stravaDialog').showModal());
$('#authorizeStrava').addEventListener('click',async e=>{e.preventDefault();if($('#stravaClientSecret').value.trim().length<8||!$('#stravaConsent').checked){toast('Zadej Client Secret a potvrď oprávnění');return}try{await window.veyvo.connectStrava($('#stravaClientSecret').value.trim());$('#stravaDialog').close();$('#stravaClientSecret').value='';toast('Dokonči přihlášení v prohlížeči')}catch(err){toast(err.message)}});
$('#disconnectStrava').addEventListener('click',async()=>{await window.veyvo.disconnectStrava();state.stravaConnected=false;save();renderStravaState()});
window.veyvo?.onStravaEvent(event=>{if(event.type==='connected'){state.stravaConnected=true;save();renderStravaState();syncStrava(true)}else toast(event.message||'Strava se nepřipojila')});
window.veyvo?.stravaStatus().then(status=>{state.stravaConnected=status.connected;save();renderStravaState();if(status.connected)syncStrava()});renderStravaState();setInterval(()=>{if(state.stravaConnected)syncStrava()},300000);
const settings=$('#settingsDialog'),menu=$('#profileMenu');$('#profileMenuButton').addEventListener('click',e=>{e.stopPropagation();menu.hidden=!menu.hidden});document.addEventListener('click',e=>{if(!menu.contains(e.target)&&e.target!==$('#profileMenuButton'))menu.hidden=true});$('#menuLight').addEventListener('click',()=>setTheme('light'));$('#menuDark').addEventListener('click',()=>setTheme('dark'));$('#openSettings').addEventListener('click',()=>{menu.hidden=true;renderProfile();settings.showModal()});
let sharedPreview=null;
$('#sharedChatUrl').value=state.sharedChatUrl||'';
$('#previewSharedChat').addEventListener('click',async()=>{
 const url=$('#sharedChatUrl').value.trim(),result=$('#sharedChatPreview'),button=$('#previewSharedChat');
 sharedPreview=null;$('#applySharedChat').hidden=true;result.textContent='Načítám sdílený chat…';button.disabled=true;
 try{
  sharedPreview=await window.veyvo.fetchSharedHistory(url);
  const runs=sharedPreview.runs,milestones=sharedPreview.milestones;
  result.innerHTML='<p><b>'+runs.length+' potvrzené běhy, '+milestones.length+' milníky.</b></p>'+
   runs.map(r=>'<p>'+escapeHtml(r.date.slice(0,10))+' · '+escapeHtml(r.distance)+' km · '+escapeHtml(r.time)+'</p>').join('')+
   milestones.map(m=>'<p>'+escapeHtml(m.date)+' · '+escapeHtml(m.label)+'</p>').join('');
  $('#applySharedChat').hidden=!runs.length&&!milestones.length;
 }catch(error){result.textContent=error.message||'Chat se nepodařilo načíst.'}finally{button.disabled=false}
});
function mergeSharedHistory(data){
 let addedRuns=0,addedMilestones=0;
 for(const run of data.runs){
  if(state.runHistory.some(existing=>existing.id===run.id||String(existing.date).slice(0,10)===run.date.slice(0,10)&&Math.abs(Number(existing.distance)-run.distance)<.15&&Math.abs(Number(existing.movingSeconds||VeyvoTraining.durationSeconds(existing.time))-run.movingSeconds)<60))continue;
  state.runHistory.push(run);addedRuns++;
 }
 for(const milestone of data.milestones){if(state.milestones.some(existing=>existing.id===milestone.id))continue;state.milestones.push(milestone);addedMilestones++}
 state.runHistory.sort((a,b)=>new Date(a.date)-new Date(b.date));state.milestones.sort((a,b)=>a.date.localeCompare(b.date));
 save();renderAll();return {addedRuns,addedMilestones};
}
$('#applySharedChat').addEventListener('click',async()=>{
 if(!sharedPreview)return;
 const firstImport=!state.sharedChatUrl;
 try{state.sharedChatUrl=await window.veyvo.saveSharedHistoryUrl($('#sharedChatUrl').value.trim())}catch(error){$('#sharedChatPreview').textContent=error.message;return}
 if(firstImport)state.profile={...state.profile,goalDistanceKm:5,targetSeconds:1200,days:[0,1,3,5,6]};
 const result=mergeSharedHistory(sharedPreview);renderProfile();$('#sharedChatPreview').textContent=`Importováno: ${result.addedRuns} běhů a ${result.addedMilestones} milníků. Další běhy můžeš zapisovat přímo ve VEYVO.`;$('#applySharedChat').hidden=true;sharedPreview=null;toast('Historie načtena');
});
$('#clearSharedChat').addEventListener('click',async()=>{await window.veyvo.clearSharedHistoryUrl();state.sharedChatUrl='';$('#sharedChatUrl').value='';$('#sharedChatPreview').textContent='Kontrola odkazu vypnutá. Importované záznamy zůstávají uložené.';$('#applySharedChat').hidden=true;sharedPreview=null;save()});
async function refreshSharedHistory(){
 const firstImport=!state.sharedChatUrl;
 const url=state.sharedChatUrl||await window.veyvo.savedSharedHistoryUrl();
 if(!url)return;
 try{const data=await window.veyvo.fetchSharedHistory(url);if(firstImport){state.profile={...state.profile,goalDistanceKm:5,targetSeconds:1200,days:[0,1,3,5,6]};renderProfile()}state.sharedChatUrl=url;$('#sharedChatUrl').value=url;const result=mergeSharedHistory(data);if(result.addedRuns||result.addedMilestones)toast('Nová historie načtena')}
 catch(error){$('#sharedChatPreview').textContent=error.message||'Aktualizace sdíleného chatu selhala.'}
}
setTimeout(refreshSharedHistory,2500);
setInterval(refreshSharedHistory,3600000);
$$('[data-set-theme]').forEach(el=>el.addEventListener('click',()=>setTheme(el.dataset.setTheme)));$$('[data-settings-view]').forEach(tab=>tab.addEventListener('click',()=>{$$('[data-settings-view]').forEach(el=>el.classList.toggle('active',el===tab));$$('[data-settings-panel]').forEach(el=>el.hidden=el.dataset.settingsPanel!==tab.dataset.settingsView)}));$('#settingsOpenStrava').addEventListener('click',()=>{settings.close();go('connections')});
function renderProfile(){$('#appLanguage').value=state.language;$('#goalDistance').value=state.profile.goalDistanceKm;$('#goalTime').value=state.profile.targetSeconds?formatDuration(state.profile.targetSeconds):'';$$('[data-running-day]').forEach(el=>el.checked=state.profile.days.includes(Number(el.dataset.runningDay)))}
$('#saveRunnerProfile').addEventListener('click',()=>{try{state.profile=VeyvoTraining.normalProfile({goalDistanceKm:Number($('#goalDistance').value),targetSeconds:$('#goalTime').value.trim()?VeyvoTraining.durationSeconds($('#goalTime').value):null,days:$$('[data-running-day]:checked').map(el=>Number(el.dataset.runningDay))});save();renderAll();$('#runnerProfileResult').textContent='Profil uložen'}catch(e){$('#runnerProfileResult').textContent=e.message}});
$('#appLanguage').addEventListener('change',e=>{state.language=e.target.value;save();toast(state.language==='en'?'Language saved':'Jazyk uložen')});
$('#checkUpdates').addEventListener('click',()=>window.veyvo?.checkForUpdates());window.veyvo?.onUpdaterStatus(status=>{const el=$('#updateResult');el.hidden=false;el.textContent=status.message||status.type+(status.version?' '+status.version:'')});
function refreshClock(){const now=new Date();$('#localClock').textContent=now.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'});$('#localClock').title=now.toLocaleDateString('cs-CZ')}refreshClock();setInterval(refreshClock,10000);
applyTheme();renderProfile();renderAll();go('home');
