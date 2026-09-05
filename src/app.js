const GITHUB_OWNER = 'PepiBikerBTW';
const GITHUB_REPO = 'VEYVO';
const PLAN_START = new Date(2026, 8, 7);
const defaultState = { theme: 'dark', language: 'cs', loggedRuns: 0, week: 1, planStart: '2026-09-07' };
let state = JSON.parse(localStorage.getItem('veyvo-state') || 'null') || {...defaultState};
if (!state.planStart) { state = { ...state, week: 1, planStart: defaultState.planStart }; }
state.runHistory ||= [];
state.weekPlans ||= {};
state.weekReviews ||= {};
localStorage.setItem('veyvo-state', JSON.stringify(state));
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function save() { localStorage.setItem('veyvo-state', JSON.stringify(state)); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800); }
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('#themeIcon').textContent = state.theme === 'dark' ? '☾' : '☀';
  $('#themeText').textContent = state.theme === 'dark' ? 'Tmavý režim' : 'Světlý režim';
}
function localMidnight(date=new Date()){ return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
function dayDifference(a,b){ return Math.floor((localMidnight(a)-localMidnight(b))/86400000); }
function formatToday(){ return new Intl.DateTimeFormat(state.language==='en'?'en-GB':'cs-CZ',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toUpperCase(); }
function planPosition(){ const days=dayDifference(new Date(),PLAN_START); return {days,currentWeek:days<0?0:Math.min(10,Math.floor(days/7)+1)}; }

const pageMeta = {
  home: [formatToday(),'Dobrý večer, Pepo.'],
  plan: ['TVŮJ ADAPTIVNÍ PROGRAM','Deset týdnů k cíli.'],
  coach: ['KONTEXTOVÝ AI TRENÉR','Na co dnes myslíš?'],
  progress: ['DATA, KTERÁ MAJÍ SMĚR','Tvoje výkonnost.'],
  connections: ['ÚČTY A SYNCHRONIZACE','Propoj svůj běžecký svět.']
};
function go(page) {
  $$('.page').forEach(p=>p.classList.remove('active')); $$('.nav-item').forEach(n=>n.classList.remove('active'));
  $(`#${page}Page`).classList.add('active'); const nav=$(`.nav-item[data-page="${page}"]`); if(nav)nav.classList.add('active');
  if(page==='home') pageMeta.home[0]=formatToday();
  [$('#pageEyebrow').textContent,$('#pageTitle').textContent]=pageMeta[page];
  setTimeout(() => applyLanguage());
}
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)go(b.dataset.page)});
$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.goto)));
$('#themeToggle').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';save();applyTheme()});

const baseWorkouts = [
  ['PO','Regenerace','Volno nebo 20 min chůze','—'],
  ['ÚT','Lehký běh','7 km · 5:30–5:55/km','7,0 km'],
  ['ST','Tempo','3 × 1 km · 4:15–4:20/km','8,2 km'],
  ['ČT','Regenerace','Mobilita · 15 minut','—'],
  ['PÁ','Intervaly','6 × 400 m · 3:55–4:05/km','6,4 km'],
  ['SO','Volno','Volitelná lehká mobilita','—'],
  ['NE','Dlouhý běh','9,6 km · lehké tempo','9,6 km']
];
function getWeekPlan(week){ return state.weekPlans[String(week)] || baseWorkouts; }
function formatKm(value){ return `${Math.round(value*10)/10}`.replace('.',','); }
function runsForWeek(week){ return state.runHistory.filter(run=>run.week===week); }
function generateNextWeekPlan(currentWeek){
  if(currentWeek<1||currentWeek>=10||state.weekPlans[String(currentWeek+1)])return false;
  const runs=runsForWeek(currentWeek), avgEffort=runs.length?runs.reduce((sum,run)=>sum+run.effort,0)/runs.length:7;
  const completion=Math.min(1,runs.length/4); let factor=1, decision='udržení zátěže';
  if(avgEffort>=8||runs.some(run=>/bolest|pain|zran/i.test(run.note||''))){factor=.9;decision='odlehčení kvůli vysoké náročnosti nebo bolesti'}
  else if(avgEffort<=6&&completion>=.75){factor=1.05;decision='bezpečné zvýšení zátěže o 5 %'}
  else if(completion<.75){factor=.92;decision='snížení zátěže kvůli neúplnému týdnu'}
  const easy=7*factor,long=9.6*factor,intervals=factor<1?5:(factor>1?7:6),tempo=factor<1?2:3;
  state.weekPlans[String(currentWeek+1)]=[
    ['PO','Regenerace','Volno nebo 20 min chůze','—'],
    ['ÚT','Lehký běh',`${formatKm(easy)} km · 5:30–5:55/km`,`${formatKm(easy)} km`],
    ['ST','Tempo',`${tempo} × 1 km · 4:15–4:20/km`,`${formatKm(5.2+tempo)} km`],
    ['ČT','Regenerace','Mobilita · 15 minut','—'],
    ['PÁ','Intervaly',`${intervals} × 400 m · 3:55–4:05/km`,`${formatKm(4+intervals*.4)} km`],
    ['SO','Volno','Volitelná lehká mobilita','—'],
    ['NE','Dlouhý běh',`${formatKm(long)} km · lehké tempo`,`${formatKm(long)} km`]
  ];
  state.weekReviews[String(currentWeek)]={createdAt:new Date().toISOString(),nextWeek:currentWeek+1,avgEffort:Math.round(avgEffort*10)/10,completion:Math.round(completion*100),decision};
  save(); return true;
}
function renderWeeklyReview(){
  const {currentWeek}=planPosition();
  const latestKey=Object.keys(state.weekReviews).map(Number).filter(week=>week<=Math.max(currentWeek,1)).sort((a,b)=>b-a)[0];
  const latest=latestKey?state.weekReviews[String(latestKey)]:null;
  if(latest){$('#weeklyReviewTitle').textContent=`Plán pro ${latest.nextWeek}. týden je připravený`;$('#weeklyReviewText').textContent=`Rozhodnutí: ${latest.decision}. Splnění ${latest.completion} %, průměrná náročnost ${latest.avgEffort}/10.`;$('#weeklyReviewState').textContent='HOTOVO';return}
  if(currentWeek===0){$('#weeklyReviewTitle').textContent='První týden začne 7. 9. 2026';$('#weeklyReviewText').textContent='První AI vyhodnocení proběhne v neděli 13. 9. po posledním běhu.';$('#weeklyReviewState').textContent='ČEKÁ';return}
  $('#weeklyReviewTitle').textContent='Další plán vznikne po posledním nedělním běhu';$('#weeklyReviewText').textContent='VEYVO vyhodnotí splnění, náročnost, objem a poznámky za celý týden.';$('#weeklyReviewState').textContent='ČEKÁ';
}
function checkSundayPlanning(){
  const now=new Date(), {days,currentWeek}=planPosition(); if(days<0)return;
  const isSundayEvening=now.getDay()===0&&now.getHours()>=18;
  if(now.getDay()===0&&!isSundayEvening)return;
  const reviewWeek=now.getDay()===0?currentWeek:currentWeek-1;
  if(reviewWeek<1||reviewWeek>=10)return;
  const hasFinalRun=runsForWeek(reviewWeek).some(run=>run.type==='Dlouhý běh'&&new Date(run.date).getDay()===0);
  if(hasFinalRun&&generateNextWeekPlan(reviewWeek)){renderPlan();renderWeeklyReview();toast(`AI připravila plán pro ${reviewWeek+1}. týden`)}
}
function renderPlan(){
  const selectedStart=new Date(PLAN_START); selectedStart.setDate(selectedStart.getDate()+(state.week-1)*7);
  const today=localMidnight();
  $('#weekStrip').innerHTML=Array.from({length:10},(_,i)=>`<button class="${i+1===state.week?'active':''} ${state.weekPlans[String(i+1)]?'generated':''}" data-week="${i+1}">TÝDEN<b>${i+1}</b></button>`).join('');
  $('#calendar').innerHTML=getWeekPlan(state.week).map((w,i)=>{const date=new Date(selectedStart);date.setDate(date.getDate()+i);const isToday=date.getTime()===today.getTime();return `<div class="day-row ${isToday?'today':''}"><div class="day-date"><span>${w[0]}</span><b>${String(date.getDate()).padStart(2,'0')}</b></div><div class="sport-icon">${[1,2,4,6].includes(i)?'↗':'◇'}</div><div class="day-workout"><b>${w[1]}</b><span>${w[2]}</span></div><div class="day-load"><span>${isToday?'DNES':''}</span><b>${w[3]}</b></div></div>`}).join('');
  $$('#weekStrip button').forEach(b=>b.addEventListener('click',()=>{state.week=+b.dataset.week;save();renderPlan();toast(`Zobrazen týden ${state.week}`);setTimeout(()=>applyLanguage())}));
}
function updatePlanTiming(){
  const {days,currentWeek}=planPosition();
  $('#pageEyebrow').textContent=formatToday();
  if(currentWeek===0){const remaining=Math.abs(days);$('#planPhaseLabel').textContent=`Začíná za ${remaining} ${remaining===1?'den':'dny'}`;$('#planStatusTitle').textContent='Plán začne 7. 9. 2026';$('#planStatusText').textContent='První týden zatím ještě nezačal.';}
  else{$('#planPhaseLabel').textContent=`Týden ${currentWeek}/10`;$('#planStatusTitle').textContent=`Probíhá ${currentWeek}. týden`;$('#planStatusText').textContent='Plán odpovídá aktuálnímu datu.';if(state.week<1||state.week>10)state.week=currentWeek;}
}
const dialog=$('#logDialog');
$('#quickLog').addEventListener('click',()=>dialog.showModal());
$('#startWorkout').addEventListener('click',()=>{dialog.showModal();toast('Trénink připraven k záznamu')});
$('#effort').addEventListener('input',e=>$('#effortOutput').value=`${e.target.value} / 10`);
$('#saveLog').addEventListener('click',e=>{
  e.preventDefault(); const {currentWeek}=planPosition(), effort=+$('#effort').value;
  state.loggedRuns++; state.runHistory.push({id:Date.now(),date:new Date().toISOString(),week:currentWeek,type:$('#logType').value,distance:+$('#logDistance').value||0,time:$('#logTime').value,effort,note:$('#logNote').value.trim()});
  save(); dialog.close(); checkSundayPlanning(); renderWeeklyReview();
  toast(effort>=8?'Běh uložen · AI zohlední vyšší náročnost':'Běh uložen pro nedělní AI vyhodnocení');
});
$('#adaptPlan').addEventListener('click',()=>{go('coach');setTimeout(()=>sendCoachMessage('Chci upravit plán podle toho, jak se dnes cítím.'),200)});

const replies = [
  { keys:['spal','spánek','hodin'], text:'Kvůli horšímu spánku bych dnes snížil intenzitu. Místo 6 opakování dej 4 × 400 m v kontrolovaném tempu a pokud se při rozklusu necítíš dobře, změň trénink na 30 minut lehce.' },
  { keys:['lýtk','bolí','bolest'], text:'Bolest není signál k přitvrzení. Dnešní běh vynech a zvol lehkou chůzi bez bolesti. Pokud je bolest ostrá, zhoršuje se nebo přetrvává, obrať se na zdravotníka. Plán zatím označím k odlehčení.' },
  { keys:['přesuň','dlouhý','neděle'], text:'Jasně. Dlouhý běh přesunu o den a pohlídám, aby vedle něj nebyl další náročný trénink. Týdenní objem zůstane stejný.' },
  { keys:['unaven','únava','těžké'], text:'Rozumím. Doporučuji dnes jen 25–35 minut velmi lehce. Kvalitní jednotku posuneme a zachováme minimálně 48 hodin do další vysoké intenzity.' }
];
function sendCoachMessage(text){
  if(!text.trim())return; const m=$('#messages');m.insertAdjacentHTML('beforeend',`<div class="message user"><p>${escapeHtml(text)}</p></div>`);m.scrollTop=m.scrollHeight;
  const lower=text.toLowerCase();const answer=replies.find(r=>r.keys.some(k=>lower.includes(k)))?.text||'Podívám se na tvůj aktuální plán, poslední zátěž a regeneraci. Doporučení upravím tak, aby tě posouvalo k cíli bez zbytečného rizika. Jak náročně se cítíš na škále 1–10?';
  setTimeout(()=>{m.insertAdjacentHTML('beforeend',`<div class="message coach"><span><img src="../assets/veyvo-icon.png" alt="VEYVO"></span><p>${answer}</p></div>`);m.scrollTop=m.scrollHeight},450);
}
function escapeHtml(v){const d=document.createElement('div');d.textContent=v;return d.innerHTML}
$('#chatForm').addEventListener('submit',e=>{e.preventDefault();sendCoachMessage($('#chatInput').value);$('#chatInput').value=''});
$$('.suggestions button').forEach(b=>b.addEventListener('click',()=>sendCoachMessage(b.textContent)));
$('#resetDemo').addEventListener('click',()=>{state={...defaultState};save();applyTheme();updatePlanTiming();renderPlan();renderWeeklyReview();checkSundayPlanning();go('home');toast('Ukázková data obnovena')});

applyTheme();updatePlanTiming();renderPlan();renderWeeklyReview();checkSundayPlanning();
window.veyvo?.version().then(v=>console.info(`VEYVO ${v}`));
setInterval(checkSundayPlanning, 15*60*1000);

const stravaDialog = $('#stravaDialog');
function renderStravaState() {
  const connected = Boolean(state.stravaConnected);
  $('#stravaStatus').textContent = connected ? 'PŘIPRAVENO' : 'NEPŘIPOJENO';
  $('#stravaStatus').classList.toggle('connected', connected);
  $('#connectStrava').hidden = connected;
  $('#disconnectStrava').hidden = !connected;
}
$('#connectStrava').addEventListener('click', () => stravaDialog.showModal());
$('#authorizeStrava').addEventListener('click', async (event) => {
  event.preventDefault();
  const clientId = $('#stravaClientId').value.trim();
  if (!clientId || !/^\d+$/.test(clientId)) return toast('Zadej platné číselné Strava Client ID');
  if (!$('#stravaConsent').checked) return toast('Nejdřív potvrď oprávnění k aktivitám');
  const redirect = encodeURIComponent('http://localhost/strava/callback');
  const url = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${redirect}&approval_prompt=auto&scope=read,activity:read_all`;
  await window.veyvo?.openExternal(url);
  state.stravaClientId = clientId;
  state.stravaConnected = true;
  save(); renderStravaState(); stravaDialog.close();
  toast('Autorizace otevřena ve webovém prohlížeči');
});
$('#disconnectStrava').addEventListener('click', () => {
  state.stravaConnected = false; delete state.stravaClientId; save(); renderStravaState();
  toast('Strava byla od VEYVO odpojena');
});
renderStravaState();

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
  while(node=walker.nextNode()) { if(['SCRIPT','STYLE'].includes(node.parentElement?.tagName)) continue; if(!originalText.has(node)) originalText.set(node,node.nodeValue); const source=originalText.get(node); const key=source.trim(); if(!key) continue; const translated=language==='en'?(textTranslations[key]||key):key; node.nodeValue=source.replace(key,translated); }
  const placeholders={'Napiš, jak se dnes cítíš…':'Tell me how you feel today…','Jak ses cítil? Bolest, únava, počasí…':'How did you feel? Pain, fatigue, weather…'};
  $$('[placeholder]').forEach(el=>{if(!el.dataset.csPlaceholder)el.dataset.csPlaceholder=el.placeholder;el.placeholder=language==='en'?(placeholders[el.dataset.csPlaceholder]||el.dataset.csPlaceholder):el.dataset.csPlaceholder});
  $('#appLanguage').value=language;
}
$('#appLanguage').addEventListener('change', event => { state.language=event.target.value; save(); applyLanguage(); toast(state.language==='en'?'Language changed to English':'Jazyk změněn na češtinu'); });
applyLanguage();



// Functional settings tabs
$$('[data-settings-view]').forEach(tab => tab.addEventListener('click', () => {
  $$('[data-settings-view]').forEach(item => item.classList.toggle('active', item === tab));
  $$('[data-settings-panel]').forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== tab.dataset.settingsView; });
}));
$('#settingsOpenStrava').addEventListener('click', () => { settingsDialog.close(); go('connections'); });
