const GITHUB_OWNER = 'PepiBikerBTW';
const GITHUB_REPO = 'VEYVO';
let PLAN_START = new Date(2026, 8, 7);
const defaultState = { theme: 'dark', language: 'cs', loggedRuns: 0, week: 1, planStart: '2026-09-07', profile: {goalDistanceKm:5,targetSeconds:1200,days:[1,2,4,6]} };
let state = JSON.parse(localStorage.getItem('veyvo-state') || 'null') || {...defaultState};
if (!state.planStart) { state = { ...state, week: 1, planStart: defaultState.planStart }; }
state.runHistory ||= [];
state.weekPlans ||= {};
state.weekReviews ||= {};
state.stravaActivityIds ||= [];
state.profile ||= {...defaultState.profile};
state.aiPlans ||= {};
state.aiPlanInputs ||= {};
state.chatHistory ||= [];
// Older imports assigned a guessed effort of 7; keep unknown effort unknown for AI.
for (const run of state.runHistory) if(run.source==='strava'&&!run.effortRecorded)run.effort=null;
localStorage.setItem('veyvo-state', JSON.stringify(state));
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function save() { localStorage.setItem('veyvo-state', JSON.stringify(state)); window.scheduleCloudSync?.(); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800); }
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('#themeIcon').textContent = state.theme === 'dark' ? '☾' : '☀';
  $('#themeText').textContent = state.theme === 'dark' ? 'Tmavý režim' : 'Světlý režim';
}
function localMidnight(date=new Date()){ return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
function dayDifference(a,b){ return VeyvoTime.dayDifference(a,b); }
function formatToday(){ return new Intl.DateTimeFormat(state.language==='en'?'en-GB':'cs-CZ',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toUpperCase(); }
function planPosition(){ const days=dayDifference(new Date(),PLAN_START); return {days,currentWeek:days<0?0:Math.min(10,Math.floor(days/7)+1)}; }

const pageMeta = {
  home: [formatToday(),VeyvoTime.context(new Date(),state.language).greeting],
  plan: ['TVŮJ ADAPTIVNÍ PROGRAM','Deset týdnů k cíli.'],
  coach: ['KONTEXTOVÝ AI TRENÉR','Na co dnes myslíš?'],
  progress: ['DATA, KTERÁ MAJÍ SMĚR','Tvoje výkonnost.'],
  connections: ['ÚČTY A SYNCHRONIZACE','Propoj svůj běžecký svět.']
};
function go(page) {
  $$('.page').forEach(p=>p.classList.remove('active')); $$('.nav-item').forEach(n=>n.classList.remove('active'));
  $(`#${page}Page`).classList.add('active'); const nav=$(`.nav-item[data-page="${page}"]`); if(nav)nav.classList.add('active');
  if(page==='home') pageMeta.home=[formatToday(),VeyvoTime.context(new Date(),state.language).greeting];
  [$('#pageEyebrow').textContent,$('#pageTitle').textContent]=pageMeta[page];
  setTimeout(() => applyLanguage());
}
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)go(b.dataset.page)});
$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.goto)));
$('#themeToggle').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';save();applyTheme()});

const baseWorkouts = ['PO','ÚT','ST','ČT','PÁ','SO','NE'].map(day=>[day,'Volno','Čeká na vytvoření AI plánu','—']);
function unlockedWeeks(){
  return [...new Set([1,...Object.keys(state.weekPlans).map(Number).filter(week=>week>=1&&week<=10)])].sort((a,b)=>a-b);
}
function maxUnlockedWeek(){ return Math.max(...unlockedWeeks()); }
function getWeekPlan(week){ return state.weekPlans[String(week)] || baseWorkouts; }
function formatKm(value){ return `${Math.round(value*10)/10}`.replace('.',','); }
function runsForWeek(week){ return state.runHistory.filter(run=>run.week===week); }
function renderWeeklyReview(){ renderAiPlanStatus(); }
function checkSundayPlanning(){ scheduleAiPlanning(); }
function formatDuration(seconds){const minutes=Math.floor(seconds/60),rest=seconds%60;return `${minutes}:${String(rest).padStart(2,'0')}`;}
function plannedPosition(dateValue){
  const date=new Date(dateValue),days=dayDifference(date,PLAN_START);
  if(days<0||days>=70)return null;
  return {week:Math.floor(days/7)+1,day:days%7};
}
function completedRun(week,day){return state.runHistory.find(run=>run.week===week&&run.plannedDay===day);}
function importStravaActivities(activities){
  let imported=0;
  for(const activity of activities){
    if(state.stravaActivityIds.includes(activity.id))continue;
    const date=activity.startDateLocal||activity.startDate;
    if(!Number.isFinite(new Date(date).getTime())||!(activity.distanceKm>0)||!(activity.movingTime>0))continue;
    const position=plannedPosition(date);
    const workout=position&&state.weekPlans[String(position.week)]?.[position.day];
    const duplicate=state.runHistory.find(run=>run.source!=='strava'&&VeyvoTraining.dateKey(new Date(run.date))===VeyvoTraining.dateKey(new Date(date))&&Math.abs(run.distance-activity.distanceKm)<.15&&Math.abs((run.movingSeconds||VeyvoTraining.durationSeconds(run.time))-activity.movingTime)<60);
    const record={id:'strava-'+activity.id,stravaActivityId:activity.id,source:'strava',date,week:position?.week||0,plannedDay:position?.day??null,
      type:duplicate?.type||(workout&&!['Regenerace','Volno'].includes(workout[1])?workout[1]:'Běh'),name:activity.name,
      distance:activity.distanceKm,time:formatDuration(activity.movingTime),movingSeconds:activity.movingTime,
      effort:duplicate?.effort??null,effortRecorded:Boolean(duplicate?.effort),note:duplicate?.note||'',
      averageHeartrate:activity.averageHeartrate,elevationGain:activity.totalElevationGain};
    if(duplicate)Object.assign(duplicate,record);else state.runHistory.push(record);
    state.stravaActivityIds.push(activity.id);imported++;
  }
  if(imported){state.runHistory.sort((a,b)=>new Date(a.date)-new Date(b.date));state.loggedRuns=state.runHistory.length;save();renderPlan();renderWeeklyReview();scheduleAiPlanning();}
  return imported;
}
async function syncStrava(showResult=false){
  if(!window.veyvo?.syncStrava)return;
  try{const activities=await window.veyvo.syncStrava();const imported=importStravaActivities(activities);state.stravaLastSync=new Date().toISOString();save();renderStravaState();if(showResult||imported)toast(imported?`${imported} běhů načteno pro AI`:'Strava je aktuální');}
  catch(error){if(showResult)toast(error.message||'Synchronizace Stravy se nezdařila');}
}
function renderPlan(){
  const availableWeeks=unlockedWeeks();
  if(!availableWeeks.includes(state.week)){state.week=maxUnlockedWeek();save()}
  const selectedStart=new Date(PLAN_START); selectedStart.setDate(selectedStart.getDate()+(state.week-1)*7);
  const today=localMidnight();
  $('#weekStrip').innerHTML=availableWeeks.map(week=>`<button class="${week===state.week?'active':''} ${state.aiPlans[String(week)]?'generated':''}" data-week="${week}">TÝDEN<b>${week}</b></button>`).join('');
  $('#calendar').innerHTML=getWeekPlan(state.week).map((w,i)=>{const date=new Date(selectedStart);date.setDate(date.getDate()+i);const isToday=date.getTime()===today.getTime();const done=completedRun(state.week,i);return `<div class="day-row ${isToday?'today':''} ${done?'completed':''}"><div class="day-date"><span>${escapeHtml(w[0])}</span><b>${String(date.getDate()).padStart(2,'0')}</b></div><div class="sport-icon">${done?'✓':(['Volno','Regenerace'].includes(w[1])?'◇':'↗')}</div><div class="day-workout"><b>${escapeHtml(done?.type||w[1])}</b><span>${escapeHtml(done?`${done.distance} km · ${done.time}`:w[2])}</span></div><div class="day-load"><span>${done?'DOKONČENO':(isToday?'DNES':'')}</span><b>${escapeHtml(done?(done.source==='strava'?'STRAVA ✓':'ZAPSÁNO ✓'):w[3])}</b></div></div>`}).join('');
  const meta=state.aiPlans[String(state.week)];
  const total=meta?meta.rules.completedKm+meta.days.reduce((sum,day)=>sum+day.distanceKm,0):null;
  $('#planVolume').textContent=total===null?'—':formatKm(total)+' km';
  $('#planHard').textContent=meta?getWeekPlan(state.week).filter(row=>['Tempo','Intervaly'].includes(row[1])).length:'—';
  $('#planRest').textContent=meta?getWeekPlan(state.week).filter(row=>['Volno','Regenerace'].includes(row[1])).length:'—';
  $('#planLoad').textContent=total===null?'—':formatKm(total);
  $('#planOrigin').textContent=meta?(aiStatus.cloud?'NVIDIA':'OPENAI'):'ČEKÁ NA AI';
  $('#planSummary').textContent='10 týdnů · až '+state.profile.days.length+' běžeckých dnů týdně · začátek '+PLAN_START.toLocaleDateString('cs-CZ');
  $('#planGoalChip').textContent='CÍL · '+state.profile.goalDistanceKm+' KM'+(state.profile.targetSeconds?' · '+VeyvoTraining.pace(state.profile.targetSeconds):'');
  $$('#weekStrip button').forEach(b=>b.addEventListener('click',()=>{state.week=+b.dataset.week;save();renderPlan();toast(`Zobrazen týden ${state.week}`);setTimeout(()=>applyLanguage())}));
}
function updatePlanTiming(){
  const {days,currentWeek}=planPosition();
  if($('#homePage').classList.contains('active')) $('#pageEyebrow').textContent=formatToday();
  if(currentWeek===0){const remaining=Math.abs(days);$('#planPhaseLabel').textContent=`Začíná za ${remaining} ${remaining===1?'den':'dny'}`;$('#planStatusTitle').textContent='Plán začne 7. 9. 2026';$('#planStatusText').textContent='První týden zatím ještě nezačal.';}
  else if(days>=70){$('#planPhaseLabel').textContent='Plán dokončen';$('#planStatusTitle').textContent='Desetitýdenní plán skončil';$('#planStatusText').textContent='Je čas připravit další program.';}
  else{$('#planPhaseLabel').textContent=`Týden ${currentWeek}/10`;$('#planStatusTitle').textContent=`Probíhá ${currentWeek}. týden`;$('#planStatusText').textContent='Plán odpovídá aktuálnímu datu.';if(state.week<1||state.week>10)state.week=currentWeek;}
}
const dialog=$('#logDialog');
function openRunLog(){
  $('#logDate').value=VeyvoTraining.dateKey();$('#logDate').max=VeyvoTraining.dateKey();
  const position=plannedPosition(new Date()),workout=position&&state.weekPlans[String(position.week)]?.[position.day];
  if(workout&&!['Volno','Regenerace'].includes(workout[1]))$('#logType').value=workout[1];
  dialog.showModal();
}
$('#quickLog').addEventListener('click',openRunLog);
$('#startWorkout').addEventListener('click',openRunLog);
$('#effort').addEventListener('input',e=>$('#effortOutput').value=`${e.target.value} / 10`);
$('#saveLog').addEventListener('click',e=>{
  e.preventDefault();
  const date=VeyvoTraining.parseDate($('#logDate').value),distance=+$('#logDistance').value,movingSeconds=VeyvoTraining.durationSeconds($('#logTime').value),effort=+$('#effort').value;
  if(!date||date>new Date()||!Number.isFinite(distance)||distance<=0||distance>300||!movingSeconds){toast('Zadej platné datum, vzdálenost a čas mm:ss nebo h:mm:ss.');return;}
  const position=plannedPosition(date);
  state.runHistory.push({id:Date.now(),source:'manual',date:VeyvoTraining.dateKey(date)+'T00:00:00',week:position?.week||0,plannedDay:position?.day??null,type:$('#logType').value,distance,time:$('#logTime').value,movingSeconds,effort,effortRecorded:true,note:$('#logNote').value.trim()});
  state.runHistory.sort((a,b)=>new Date(a.date)-new Date(b.date));state.loggedRuns=state.runHistory.length;
  save();dialog.close();renderPlan();renderWeeklyReview();scheduleAiPlanning();toast('Běh uložen pro AI adaptaci');
});
$('#adaptPlan').addEventListener('click',()=>{go('coach');setTimeout(()=>sendCoachMessage('Chci upravit plán podle toho, jak se dnes cítím.'),200)});

function escapeHtml(v){const d=document.createElement('div');d.textContent=v;return d.innerHTML}
$('#chatForm').addEventListener('submit',e=>{e.preventDefault();sendCoachMessage($('#chatInput').value);$('#chatInput').value=''});
$$('.suggestions button').forEach(b=>b.addEventListener('click',()=>sendCoachMessage(b.textContent)));
$('#resetDemo').addEventListener('click',()=>{state={...defaultState,runHistory:[],weekPlans:{},weekReviews:{},stravaActivityIds:[],aiPlans:{},aiPlanInputs:{},chatHistory:[]};resetAiSession();save();applyTheme();updatePlanTiming();renderPlan();renderWeeklyReview();checkSundayPlanning();go('home');toast('Ukázková data obnovena')});

applyTheme();updatePlanTiming();renderPlan();renderWeeklyReview();checkSundayPlanning();
window.veyvo?.version().then(v=>console.info(`VEYVO ${v}`));
setInterval(checkSundayPlanning, 15*60*1000);

const stravaDialog = $('#stravaDialog');
function renderStravaState() {
  const connected=Boolean(state.stravaConnected),statusText=connected?'PŘIPOJENO':'NEPŘIPOJENO';
  $('#stravaStatus').textContent=statusText; $('#stravaStatus').classList.toggle('connected',connected);
  $('#settingsStravaStatus').textContent=statusText; $('#settingsStravaStatus').classList.toggle('connected',connected);
  $('#connectStrava').hidden=connected; $('#disconnectStrava').hidden=!connected;
  $('#stravaSyncState').textContent=connected?(state.stravaLastSync?`Naposledy synchronizováno ${new Date(state.stravaLastSync).toLocaleString('cs-CZ')}`:'Připojeno · čekám na první synchronizaci'):'Čeká na propojení';
}
$('#connectStrava').addEventListener('click',()=>stravaDialog.showModal());
$('#authorizeStrava').addEventListener('click',async event=>{
  event.preventDefault(); const secret=$('#stravaClientSecret').value.trim();
  if(secret.length<8)return toast('Zadej Strava Client Secret');
  if(!$('#stravaConsent').checked)return toast('Nejdřív potvrď oprávnění k aktivitám');
  try{await window.veyvo.connectStrava(secret);stravaDialog.close();$('#stravaClientSecret').value='';toast('Dokonči přihlášení ve webovém prohlížeči');}catch(error){toast(error.message||'Stravu se nepodařilo otevřít');}
});
$('#disconnectStrava').addEventListener('click',async()=>{await window.veyvo.disconnectStrava();state.stravaConnected=false;save();renderStravaState();toast('Strava byla od VEYVO odpojena');});
window.veyvo?.onStravaEvent(event=>{if(event.type==='connected'){state.stravaConnected=true;save();renderStravaState();toast('Strava je připojená');syncStrava(true);}else toast(event.message||'Připojení Stravy se nezdařilo');});
window.veyvo?.stravaStatus().then(status=>{state.stravaConnected=status.connected;save();renderStravaState();if(status.connected)syncStrava();});
renderStravaState();
setInterval(()=>{if(state.stravaConnected)syncStrava();},5*60*1000);

// Profile menu, appearance and GitHub Releases updater
const profileMenu = $('#profileMenu');
const settingsDialog = $('#settingsDialog');
function renderProfilePreferences() {
  $('#menuLight').classList.toggle('selected', state.theme === 'light');
  $('#menuDark').classList.toggle('selected', state.theme === 'dark');
  $$('[data-set-theme]').forEach(button => button.classList.toggle('active', button.dataset.setTheme === state.theme));
  if ($('#appLanguage')) $('#appLanguage').value = state.language || 'cs';
}
function setTheme(theme) { state.theme = theme; save(); applyTheme(); renderProfilePreferences(); applyLanguage(); }
$('#profileMenuButton').addEventListener('click', event => {
  event.stopPropagation(); const opening = profileMenu.hidden; profileMenu.hidden = !opening;
  $('#profileMenuButton').setAttribute('aria-expanded', String(opening)); renderProfilePreferences();
});
document.addEventListener('click', event => { if (!profileMenu.hidden && !profileMenu.contains(event.target)) profileMenu.hidden = true; });
$('#menuLight').addEventListener('click', () => { setTheme('light'); profileMenu.hidden = true; });
$('#menuDark').addEventListener('click', () => { setTheme('dark'); profileMenu.hidden = true; });
$('#openSettings').addEventListener('click', () => { profileMenu.hidden = true; renderProfilePreferences(); settingsDialog.showModal(); });
$$('[data-set-theme]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.setTheme)));
$('#checkUpdates').addEventListener('click', () => window.veyvo?.checkForUpdates());
function updateMessage(status) {
  const en=state.language==='en', box=$('#updateResult'), progress=$('#updateProgress'), bar=$('#updateProgressBar');
  box.hidden=false;
  if(status.type==='checking') box.innerHTML=`<strong>${en?'Checking for updates…':'Kontroluji aktualizace…'}</strong>${en?'This only takes a moment.':'Zjišťuji nejnovější verzi.'}`;
  if(status.type==='available') box.innerHTML=`<strong>${en?'Update found':'Nalezena aktualizace'} ${escapeHtml(status.version||'')}</strong>${en?'Downloading automatically in the background.':'Automaticky ji stahuji na pozadí.'}`;
  if(status.type==='progress'){progress.hidden=false;bar.style.width=`${Math.max(0,Math.min(100,status.percent||0))}%`;box.innerHTML=`<strong>${en?'Downloading update':'Stahuji aktualizaci'} · ${status.percent||0} %</strong>${en?'VEYVO will restart and install it when ready.':'Po dokončení se VEYVO restartuje a aktualizaci nainstaluje.'}`}
  if(status.type==='ready'){progress.hidden=false;bar.style.width='100%';box.innerHTML=`<strong>${en?'Update is ready':'Aktualizace je připravena'} ${escapeHtml(status.version||'')}</strong>${en?'VEYVO will restart in 5 seconds and install it.':'VEYVO se za 5 sekund restartuje a samo ji nainstaluje.'}`}
  if(status.type==='current'){progress.hidden=true;box.innerHTML=`<strong>${en?'VEYVO is up to date':'VEYVO je aktuální'}</strong>${en?'You are using the latest version':'Používáš nejnovější verzi'} ${escapeHtml(status.version||'')}.`}
  if(status.type==='development'){progress.hidden=true;box.innerHTML=`<strong>${en?'Updater is ready':'Aktualizátor je připravený'}</strong>${en?'Automatic updates run in the installed application.':'Automatické aktualizace fungují v nainstalované aplikaci.'}`}
  if(status.type==='error'){progress.hidden=true;box.innerHTML=`<strong>${en?'Update failed':'Aktualizace se nezdařila'}</strong>${escapeHtml(status.message||'')}`}
}
window.veyvo?.onUpdaterStatus(updateMessage);renderProfilePreferences();
// Persistent Czech / English interface language
const textTranslations = {
  'Každý den':'Every day','má svůj plán.':'has its own plan.',
  'Dnešní trénink najdeš níže podle aktuálního data. Údaje připravenosti jsou zatím ukázkové.':'Find today’s workout below, based on the current date. Readiness figures are sample data.',
  'Zeptej se mě, kolik je hodin, co je dnes za den nebo jaký trénink máš zítra. Vycházím z času tvého zařízení a dostupného plánu.':'Ask me the time, today’s date or tomorrow’s workout. I use your device clock and the available plan.',
  'Přehled':'Overview','Můj plán':'My plan','VEYVO Coach':'VEYVO Coach','Výkonnost':'Performance','Propojení':'Connections',
  'Plán je aktuální':'Plan is up to date','Upraven podle posledních 3 běhů.':'Adjusted from the last 3 runs.','Tmavý režim':'Dark mode','Světlý režim':'Light mode','Jasné prostředí':'Bright appearance','Šetrnější večer':'Easier on the eyes','Nastavení':'Settings','Účet, aktualizace a data':'Account, updates and data',
  'Dobrý večer, Pepo.':'Good evening, Pepa.','Zapsat běh':'Log run','PŘIPRAVENOST 84':'READINESS 84','Dnes můžeš':'Today you can','běžet svižně.':'run fast.','Spánek i regenerace jsou v normě. Tvůj plán počítá s intervalovou jednotkou.':'Sleep and recovery look good. Your plan includes an interval session.','SPÁNEK':'SLEEP','ÚNAVA':'FATIGUE','Nízká':'Low','ZÁTĚŽ':'LOAD','Optimální':'Optimal','DNEŠNÍ MISE':'TODAY’S MISSION','Rychlost bez chaosu.':'Speed without chaos.','DNEŠNÍ TRÉNINK':'TODAY’S WORKOUT','Spustit':'Start',
  'PREDIKCE 5 KM':'5K PREDICTION','COACH INSIGHT':'COACH INSIGHT','Probrat s coachem →':'Ask the coach →','Můj plán':'My plan','Plán, který se hýbe s tebou.':'A plan that moves with you.','Upravit podle pocitu':'Adjust to how I feel','TÝDENNÍ ZÁTĚŽ':'WEEKLY LOAD','Objem':'Volume','Kvalitní tréninky':'Quality sessions','Regenerační dny':'Recovery days',
  'Na co dnes myslíš?':'What’s on your mind?','Ne plán z tabulky.':'Not a spreadsheet plan.','Rozhovor s trenérem.':'A conversation with a coach.','Spal jsem jen 5 hodin':'I slept only 5 hours','Bolí mě lýtka':'My calves hurt','Přesuň dlouhý běh':'Move the long run','Připraven':'Ready',
  'Tvoje výkonnost.':'Your performance.','Každý běh zanechá stopu.':'Every run leaves a mark.','TÝDENNÍ OBJEM':'WEEKLY VOLUME','KONZISTENCE':'CONSISTENCY','NEJLEPŠÍ 1 KM':'BEST 1 KM','VÝVOJ PREDIKCE':'PREDICTION TREND','Cesta k 19:59':'Road to 19:59',
  'Tvoje běhy. Automaticky.':'Your runs. Automatically.','Připojit přes Stravu':'Connect with Strava','Odpojit účet':'Disconnect account','SYNCHRONIZACE':'SYNC','Co se bude dít?':'What happens next?','Přihlásíš se u Stravy':'Sign in with Strava','Běhy se načtou':'Runs are imported','Plán zareaguje':'The plan adapts',
  'Obecné':'General','Jazyk aplikace':'App language','Změna se projeví okamžitě a zůstane uložená.':'The change is applied immediately and saved.','Jazyk':'Language','Čeština':'Czech','Aktualizace':'Updates','Zkontrolovat aktualizace':'Check for updates','VZHLED':'APPEARANCE','Světlý':'Light','Tmavý':'Dark',
  'ZÁZNAM TRÉNINKU':'WORKOUT LOG','Jak se běželo?':'How was your run?','Typ tréninku':'Workout type','Lehký běh':'Easy run','Dlouhý běh':'Long run','Vzdálenost':'Distance','kilometrů':'kilometres','Čas':'Time','Pocitová náročnost':'Perceived effort','Poznámka':'Note','Uložit a adaptovat plán':'Save and adapt plan'
};
const originalText = new WeakMap();
function applyLanguage() {
  const language = state.language || 'cs'; document.documentElement.lang = language;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let node;
  while(node=walker.nextNode()) { if(['SCRIPT','STYLE'].includes(node.parentElement?.tagName)||node.parentElement?.closest('[data-live-text]')) continue; if(!originalText.has(node)) originalText.set(node,node.nodeValue); const source=originalText.get(node); const key=source.trim(); if(!key) continue; const translated=language==='en'?(textTranslations[key]||key):key; node.nodeValue=source.replace(key,translated); }
  const placeholders={'Napiš, jak se dnes cítíš…':'Tell me how you feel today…','Jak ses cítil? Bolest, únava, počasí…':'How did you feel? Pain, fatigue, weather…'};
  $$('[placeholder]').forEach(el=>{if(!el.dataset.csPlaceholder)el.dataset.csPlaceholder=el.placeholder;el.placeholder=language==='en'?(placeholders[el.dataset.csPlaceholder]||el.dataset.csPlaceholder):el.dataset.csPlaceholder});
  $('#appLanguage').value=language;
  refreshTimeContext();
}
$('#appLanguage').addEventListener('change', event => { state.language=event.target.value; save(); applyLanguage(); renderAiPlanStatus(); toast(state.language==='en'?'Language changed to English':'Jazyk změněn na češtinu'); });
applyLanguage();



// Functional settings tabs
$$('[data-settings-view]').forEach(tab => tab.addEventListener('click', () => {
  $$('[data-settings-view]').forEach(item => item.classList.toggle('active', item === tab));
  $$('[data-settings-panel]').forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== tab.dataset.settingsView; });
}));
$('#settingsOpenStrava').addEventListener('click', () => { settingsDialog.close(); go('connections'); });

// Refresh from the device clock, including after sleep and calendar-day changes.
let lastCalendarDay = '';
function refreshTimeContext() {
  const now = new Date(), current = VeyvoTime.context(now, state.language);
  $('#localClock').textContent = current.time;
  $('#localClock').title = current.date + ' · ' + current.timeZone;
  if ($('#homePage').classList.contains('active')) {
    $('#pageEyebrow').textContent = current.date.toUpperCase();
    $('#pageTitle').textContent = current.greeting;
  }
  const todayPlan = VeyvoTime.describePlan(now, PLAN_START, state.weekPlans, baseWorkouts, state.language);
  $('#coachWelcome').textContent = current.greeting + ' ' + current.date + '. ' + todayPlan;
  $('#todayPlanText').textContent = state.language === 'en' ? 'Your plan for today.' : 'Tvůj plán na dnešek.';
  $('#todayWorkout').textContent = todayPlan;
  const position = plannedPosition(now);
  const workout = position && state.weekPlans[String(position.week)]
    ? getWeekPlan(position.week)[position.day] : null;
  $('#startWorkout').hidden = !workout || ['Regenerace','Volno'].includes(workout[1]);
}
function refreshCalendar() {
  const now = new Date();
  const day = [now.getFullYear(), now.getMonth(), now.getDate(), now.getTimezoneOffset()].join('-');
  if (day !== lastCalendarDay) {
    lastCalendarDay = day;
    updatePlanTiming(); renderPlan(); renderWeeklyReview(); checkSundayPlanning();
  }
  refreshTimeContext();
}
refreshCalendar();
setInterval(refreshCalendar, 10000);
window.addEventListener('focus', refreshCalendar);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCalendar(); });

initializeAi();

// Explicit migration to the shared web account; never export provider credentials.
document.getElementById('exportMobileRuns')?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify({runHistory:state.runHistory||[],profile:state.profile},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='veyvo-behy.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.getElementById('openMobileVeyvo')?.addEventListener('click',()=>window.veyvo.openMobile?.());
