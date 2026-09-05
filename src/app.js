const GITHUB_OWNER = 'PepiBikerBTW';
const GITHUB_REPO = 'VEYVO';
const defaultState = { theme: 'dark', loggedRuns: 0, week: 4, githubOwner: GITHUB_OWNER, githubRepo: GITHUB_REPO, autoCheckUpdates: true };
let state = JSON.parse(localStorage.getItem('veyvo-state') || 'null') || defaultState;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function save() { localStorage.setItem('veyvo-state', JSON.stringify(state)); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800); }
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('#themeIcon').textContent = state.theme === 'dark' ? '☾' : '☀';
  $('#themeText').textContent = state.theme === 'dark' ? 'Tmavý režim' : 'Světlý režim';
}

const pageMeta = {
  home: ['PÁTEK · 4. ZÁŘÍ','Dobrý večer, Pepo.'],
  plan: ['TVŮJ ADAPTIVNÍ PROGRAM','Deset týdnů k cíli.'],
  coach: ['KONTEXTOVÝ AI TRENÉR','Na co dnes myslíš?'],
  progress: ['DATA, KTERÁ MAJÍ SMĚR','Tvoje výkonnost.']
};
function go(page) {
  $$('.page').forEach(p=>p.classList.remove('active')); $$('.nav-item').forEach(n=>n.classList.remove('active'));
  $(`#${page}Page`).classList.add('active'); $(`.nav-item[data-page="${page}"]`).classList.add('active');
  [$('#pageEyebrow').textContent,$('#pageTitle').textContent]=pageMeta[page];
}
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)go(b.dataset.page)});
$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.goto)));
$('#themeToggle').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';save();applyTheme()});

const workouts = [
  ['PO','31','Regenerace','Volno nebo 20 min chůze','—'],
  ['ÚT','01','Lehký běh','7 km · 5:30–5:55/km','7,0 km'],
  ['ST','02','Tempo','3 × 1 km · 4:15–4:20/km','8,2 km'],
  ['ČT','03','Regenerace','Mobilita · 15 minut','—'],
  ['PÁ','04','Intervaly','6 × 400 m · 3:55–4:05/km','6,4 km'],
  ['SO','05','Volno','Volitelná lehká mobilita','—'],
  ['NE','06','Dlouhý běh','9,6 km · lehké tempo','9,6 km']
];
function renderPlan(){
  $('#weekStrip').innerHTML=Array.from({length:10},(_,i)=>`<button class="${i+1===state.week?'active':''}" data-week="${i+1}">TÝDEN<b>${i+1}</b></button>`).join('');
  $('#calendar').innerHTML=workouts.map((w,i)=>`<div class="day-row ${i===4?'today':''}"><div class="day-date"><span>${w[0]}</span><b>${w[1]}</b></div><div class="sport-icon">${[1,2,4,6].includes(i)?'↗':'◇'}</div><div class="day-workout"><b>${w[2]}</b><span>${w[3]}</span></div><div class="day-load"><span>${i===4?'DNES':''}</span><b>${w[4]}</b></div></div>`).join('');
  $$('#weekStrip button').forEach(b=>b.addEventListener('click',()=>{state.week=+b.dataset.week;save();renderPlan();toast(`Zobrazen týden ${state.week}`)}));
}

const dialog=$('#logDialog');
$('#quickLog').addEventListener('click',()=>dialog.showModal());
$('#startWorkout').addEventListener('click',()=>{dialog.showModal();toast('Trénink připraven k záznamu')});
$('#effort').addEventListener('input',e=>$('#effortOutput').value=`${e.target.value} / 10`);
$('#saveLog').addEventListener('click',e=>{e.preventDefault();state.loggedRuns++;save();dialog.close();const effort=+$('#effort').value;toast(effort>=8?'Běh uložen · další zátěž bude snížena':'Běh uložen · plán byl přepočítán')});
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
$('#resetDemo').addEventListener('click',()=>{state={...defaultState};save();applyTheme();renderPlan();go('home');toast('Ukázková data obnovena')});

applyTheme();renderPlan();
window.veyvo?.version().then(v=>console.info(`VEYVO ${v}`));

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
  $('#githubOwner').value = state.githubOwner || GITHUB_OWNER;
  $('#githubRepo').value = state.githubRepo || GITHUB_REPO;
  $('#autoCheckUpdates').checked = state.autoCheckUpdates !== false;
  const configured = Boolean((state.githubOwner || GITHUB_OWNER) && (state.githubRepo || GITHUB_REPO));
  $('#githubStatus').textContent = configured ? 'PROPOJENO' : 'NEKONFIGUROVÁNO';
  $('#githubStatus').classList.toggle('connected', configured);
}
function setTheme(theme) { state.theme = theme; save(); applyTheme(); renderProfilePreferences(); }
$('#profileMenuButton').addEventListener('click', event => {
  event.stopPropagation(); const opening = profileMenu.hidden; profileMenu.hidden = !opening;
  $('#profileMenuButton').setAttribute('aria-expanded', String(opening)); renderProfilePreferences();
});
document.addEventListener('click', event => { if (!profileMenu.hidden && !profileMenu.contains(event.target)) profileMenu.hidden = true; });
$('#menuLight').addEventListener('click', () => { setTheme('light'); profileMenu.hidden = true; });
$('#menuDark').addEventListener('click', () => { setTheme('dark'); profileMenu.hidden = true; });
$('#openSettings').addEventListener('click', () => { profileMenu.hidden = true; renderProfilePreferences(); settingsDialog.showModal(); });
$$('[data-set-theme]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.setTheme)));
$('#saveGithub').addEventListener('click', () => {
  const owner = $('#githubOwner').value.trim(), repo = $('#githubRepo').value.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return toast('Zadej platného vlastníka a název repozitáře');
  state.githubOwner = owner; state.githubRepo = repo; state.autoCheckUpdates = $('#autoCheckUpdates').checked; save(); renderProfilePreferences();
  toast('GitHub Releases byly propojeny'); checkForUpdates(true);
});
$('#checkUpdates').addEventListener('click', () => checkForUpdates(true));
function compareVersions(a, b) {
  const pa=String(a).split('.').map(Number), pb=String(b).split('.').map(Number);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){const d=(pa[i]||0)-(pb[i]||0);if(d)return d} return 0;
}
async function checkForUpdates(showResult = false) {
  const owner = state.githubOwner || $('#githubOwner').value.trim(), repo = state.githubRepo || $('#githubRepo').value.trim();
  if (!owner || !repo) { if(showResult) toast('Nejdřív nastav GitHub repozitář'); return; }
  const box=$('#updateResult'); if(showResult){box.hidden=false;box.innerHTML='<strong>Kontroluji GitHub…</strong>Hledám nejnovější veřejné vydání.'}
  const result=await window.veyvo?.checkGithubRelease(owner,repo);
  if(!result || result.error){if(showResult){box.hidden=false;box.innerHTML=`<strong>Aktualizaci nelze ověřit</strong>${escapeHtml(result?.error||'Neznámá chyba')}`}return}
  const newer=compareVersions(result.latestVersion,result.currentVersion)>0;
  box.hidden=false;
  box.innerHTML=newer?`<strong>Je dostupná verze ${escapeHtml(result.latestVersion)}</strong>Máš VEYVO ${escapeHtml(result.currentVersion)}.<br><button type="button" class="strava-button" id="downloadUpdate">Otevřít GitHub Release</button>`:`<strong>VEYVO je aktuální</strong>Používáš nejnovější verzi ${escapeHtml(result.currentVersion)}.`;
  if(newer)$('#downloadUpdate').addEventListener('click',()=>window.veyvo.openGithubRelease(result.url));
}
renderProfilePreferences();
setTimeout(() => { if (state.autoCheckUpdates !== false && state.githubOwner && state.githubRepo) checkForUpdates(false); }, 1200);


