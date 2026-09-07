// AI requests stay in Electron's main process; the renderer never receives a saved API key.
let aiStatus={configured:false,automatic:false,model:'nvidia/nemotron-3.5-lightning-30b-a3b',cloud:true,needsLogin:true};
let aiPlanBusy=false,aiChatBusy=false,aiSettingsBusy=false,aiGeneration=0,aiTimer;
let aiPlanError='';
let aiSaveState='idle';
function setAiSaveState(kind,message='') {
  aiSaveState=kind;
  const en=state.language==='en';
  $('#aiSave').textContent=({idle:en?'Save and verify connection':'Uložit a ověřit připojení',saving:en?'Verifying…':'Ověřuji připojení…',saved:en?'Saved ✓':'Uloženo ✓',error:en?'Try again':'Zkusit znovu'})[kind];
  $('#aiSave').dataset.saveState=kind;
  $('#aiSave').setAttribute('aria-busy',String(kind==='saving'));
  const result=$('#aiSettingsResult');
  result.textContent=message;result.dataset.state=kind;result.hidden=!message;
  result.setAttribute('role',kind==='error'?'alert':'status');
}
function aiSaveError(error) {
  return (error?.message||'Připojení se nezdařilo.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
}
function aiContext(){
  return {language:state.language,planStart:state.planStart,profile:state.profile,
    runHistory:state.runHistory.slice(-200),weekPlans:state.weekPlans};
}
function aiWeek(){return aiStatus.cloud?1:VeyvoTraining.targetWeek(PLAN_START);}
function aiInputKey(week){return JSON.stringify([week,aiContext().profile,aiContext().runHistory,state.planStart,state.language,aiStatus.model]);}
function openAiSettings(){
  $$('[data-settings-view]').forEach(tab=>tab.classList.toggle('active',tab.dataset.settingsView==='ai'));
  $$('[data-settings-panel]').forEach(panel=>{panel.hidden=panel.dataset.settingsPanel!=='ai'});
  renderAiSettings();$('#settingsDialog').showModal();
}
function renderAiSettings(){
  const needsLogin=aiStatus.needsLogin===true;
  if(!needsLogin&&$('#aiSave').dataset.needsLogin==='true')setAiSaveState('idle');
  $('#aiSave').dataset.needsLogin=String(needsLogin);
  $('#aiKey').closest('label').hidden=needsLogin;$('#aiConsent').closest('label').hidden=needsLogin;$('#aiAutomatic').closest('label').hidden=needsLogin;
  if(needsLogin){$('#aiSave').textContent='Přihlásit a propojit NVIDIA';$('#aiSettingsResult').textContent='Pro Nemotron se přihlas stejným účtem jako na webu. NVIDIA klíč potom zadáš jednou pro telefon i Windows.';$('#aiSettingsResult').hidden=false;}
  if(!aiSettingsBusy && aiSaveState==='idle' && aiStatus.configured && !$('#aiKey').value)setAiSaveState('saved','Klíč je uložený. AI coach je připravený.');
  $('#aiModel').value=aiStatus.model;$('#aiModel').readOnly=!!aiStatus.cloud;
  $('.ai-settings h3').textContent=aiStatus.cloud?'NVIDIA · společný účet':'OpenAI';
  $('.ai-settings > .ai-help').textContent=aiStatus.cloud?'NVIDIA API klíč je společný s webem a na serveru uložený šifrovaně. Testovací API má limity podle podmínek NVIDIA.':'Použij vlastní OpenAI API klíč. API má samostatné účtování. Klíč chrání šifrování Windows a zůstává v tomto počítači.';
  $('#aiConsent').nextElementSibling.textContent='Souhlasím s odesíláním zpráv, cíle, plánu a běžecké historie včetně poznámek do '+(aiStatus.cloud?'NVIDIA':'OpenAI')+' pro odpovědi a tvorbu plánu.';
  $('#aiAutomatic').nextElementSibling.textContent='Automaticky aktualizovat plán po běhu a při změně týdne. Funguje při otevřené aplikaci a používá API podle podmínek poskytovatele.';
  $('#aiAutomatic').checked=aiStatus.configured?aiStatus.automatic:true;
  $('#aiConsent').checked=aiStatus.configured;
  $('#aiConnectionState').textContent=aiStatus.configured?`Připojeno ✓ · ${aiStatus.model}`:(needsLogin?'Nemotron · čeká na přihlášení':aiStatus.cloud?'NVIDIA není připojená':'OpenAI není připojené');
  $('#aiDisconnect').hidden=!aiStatus.configured;
  $('#aiKey').placeholder=aiStatus.configured?'Klíč je uložený · prázdné pole ho zachová':(aiStatus.cloud?'nvapi-…':'sk-…');
  $('#goalDistance').value=state.profile.goalDistanceKm;
  $('#goalTime').value=state.profile.targetSeconds?VeyvoTraining.pace(state.profile.targetSeconds):'';
  $$('[data-running-day]').forEach(input=>input.checked=state.profile.days.includes(+input.dataset.runningDay));
}
function renderAiPlanStatus(){
  const target=aiWeek();
  const meta=state.aiPlans?.[String(target)]||state.aiPlans?.[String(state.week)];
  $('#generateAiPlan').disabled=aiPlanBusy;
  $('#aiPlanStatus').textContent=aiPlanBusy?'AI vyhodnocuje výkony a připravuje plán…':aiPlanError || (aiStatus.configured
    ? (aiStatus.automatic?'Automatická adaptace je zapnutá.':'Automatická adaptace je vypnutá; plán vytvoříš tlačítkem.')
    : 'Pro AI plán připoj zvoleného AI trenéra v nastavení.');
  $('#weeklyReviewTitle').textContent=aiPlanBusy?'AI připravuje tréninky':meta?`AI plán pro ${meta.targetWeek}. týden`:'Plán podle tvých skutečných výkonů';
  $('#weeklyReviewText').textContent=meta?meta.explanation:'Zapiš nebo importuj běhy s časem a vzdáleností. AI podle nich zvolí délky, tempa a regeneraci.';
  $('#weeklyReviewState').textContent=aiPlanBusy?'PRACUJE':meta?(aiStatus.cloud?'NVIDIA':'OPENAI'):'ČEKÁ';
  $('#coachConnection').textContent=aiChatBusy?'AI přemýšlí…':aiStatus.configured?`${aiStatus.cloud?'NVIDIA':'OpenAI'} · ${aiStatus.model}`:'Připoj AI trenéra v nastavení';
}
function scheduleAiPlanning(){
  clearTimeout(aiTimer);
  if(aiStatus.configured&&aiStatus.automatic)aiTimer=setTimeout(()=>generateAiPlan(false),1800);
}
async function generateAiPlan(manual=true){
  if(aiPlanBusy)return;
  if(aiStatus.cloud){try{await window.flushCloudSync?.();}catch(error){aiPlanError=aiSaveError(error);renderAiPlanStatus();return;}}
  if(!aiStatus.configured){if(manual)openAiSettings();return;}
  if(!manual&&!aiStatus.automatic)return;
  const week=aiWeek();
  if(!week){aiPlanError='Desetitýdenní program skončil. Automatické plánování je dokončené.';renderAiPlanStatus();return;}
  const key=aiInputKey(week);
  if(!manual&&(state.aiPlanInputs?.[week]===key || (state.aiLastAttempt?.key===key&&Date.now()-state.aiLastAttempt.time<30*60*1000)))return;
  const valid=VeyvoTraining.normalizeRuns(state.runHistory);
  if(!VeyvoTraining.summarize(valid).runsLast28Days){aiPlanError='Nejdřív zapiš nebo importuj běh z posledních 28 dnů s časem a vzdáleností.';renderAiPlanStatus();return;}
  const generation=aiGeneration,requestDay=VeyvoTraining.dateKey();
  aiPlanBusy=true;aiPlanError='';state.aiLastAttempt={key,time:Date.now()};save();renderAiPlanStatus();
  try{
    const result=await window.veyvo.generatePlan({context:aiContext(),targetWeek:week,automatic:!manual});
    if(generation!==aiGeneration||key!==aiInputKey(week)||week!==aiWeek()||requestDay!==VeyvoTraining.dateKey()){
      if(generation===aiGeneration){state.aiLastAttempt=null;save();}
      aiPlanError='Během generování se změnila data. Připravím plán z aktuálních výkonů.';
      scheduleAiPlanning();return;
    }
    const previous=getWeekPlan(week).map(row=>[...row]);
    const rows=result.rows.map((row,day)=>result.rules.lockedDays.includes(day)?previous[day]:row);
    // Keep a previous version so a generated change remains inspectable.
    state.aiPlanHistory ||= [];
    if(state.aiPlans[week])state.aiPlanHistory.push(state.aiPlans[week]);
    state.aiPlanHistory=state.aiPlanHistory.slice(-10);
    state.weekPlans[String(week)]=rows;
    state.aiPlans[String(week)]={...result,rows};
    state.aiPlanInputs[String(week)]=key;
    state.week=week;save();renderPlan();refreshTimeContext();
    toast(`AI připravila plán pro ${week}. týden`);
  }catch(error){if(generation===aiGeneration)aiPlanError=error.message||'AI plán se nepodařilo vytvořit. Dosavadní plán zůstává uložený.';}
  finally{aiPlanBusy=false;renderAiPlanStatus();}
}
function addChatMessage(role,text){
  const box=document.createElement('div');box.className=`message ${role==='user'?'user':'coach'}`;
  if(role!=='user') {const badge=document.createElement('span');const img=document.createElement('img');img.src='../assets/veyvo-icon.png';img.alt='VEYVO';badge.append(img);box.append(badge);}
  const body=document.createElement('p');body.textContent=text;box.append(body);$('#messages').append(box);$('#messages').scrollTop=$('#messages').scrollHeight;
  return body;
}
function renderChatHistory(){
  $$('#messages .message').slice(1).forEach(node=>node.remove());
  for(const message of state.chatHistory||[])addChatMessage(message.role,message.content);
}
async function sendCoachMessage(text){
  text=text.trim();if(!text||aiChatBusy)return;
  if(aiStatus.cloud){try{await window.flushCloudSync?.();}catch(error){toast(aiSaveError(error));return;}}
  if(text.length>6000){toast('Zpráva může mít nejvýše 6000 znaků.');return;}
  if(!aiStatus.configured){addChatMessage('assistant','Pro skutečný rozhovor s AI připoj OpenAI v Nastavení → AI trenér.');return;}
  const generation=aiGeneration;
  addChatMessage('user',text);
  const messages=[...(state.chatHistory||[]).slice(-18),{role:'user',content:text}];
  const pending=addChatMessage('assistant','AI přemýšlí…');
  aiChatBusy=true;$('#chatForm button').disabled=true;$('#chatInput').disabled=true;renderAiPlanStatus();
  try{
    const result=await window.veyvo.chat({context:aiContext(),messages});
    if(generation!==aiGeneration){pending.textContent='Požadavek byl zrušen změnou AI připojení.';return;}
    pending.textContent=result.text;
    state.chatHistory=[...messages,{role:'assistant',content:result.text.slice(0,6000)}].slice(-20);save();
  }catch(error){if(generation===aiGeneration)pending.textContent=error.message||'AI není dostupné. Zkus zprávu odeslat znovu.';}
  finally{aiChatBusy=false;$('#chatForm button').disabled=false;$('#chatInput').disabled=false;renderAiPlanStatus();$('#messages').scrollTop=$('#messages').scrollHeight;}
}
function resetAiSession(){
  aiGeneration++;aiPlanError='';clearTimeout(aiTimer);renderChatHistory();renderAiSettings();renderAiPlanStatus();
}
async function initializeAi(){
  renderAiSettings();renderChatHistory();renderAiPlanStatus();
  $('#openAiSettings').addEventListener('click',openAiSettings);
  $('#generateAiPlan').addEventListener('click',()=>generateAiPlan(true));
  for(const selector of ['#aiKey','#aiModel','#aiAutomatic','#aiConsent']) {
    $(selector).addEventListener('input',()=>{if(!aiSettingsBusy)setAiSaveState('idle');});
  }
  $('#aiSave').addEventListener('click',async()=>{
    if(aiSettingsBusy)return;
    if(aiStatus.needsLogin){$('#cloudConnect').click();setAiSaveState('idle','Dokonči přihlášení v otevřeném okně. Po propojení se zde zobrazí NVIDIA klíč.');renderAiSettings();return;}
    aiSettingsBusy=true;
    const controls=['#aiSave','#aiKey','#aiModel','#aiAutomatic','#aiConsent','#aiDisconnect'];
    controls.forEach(selector=>$(selector).disabled=true);
    setAiSaveState('saving','Ověřuji klíč a připojení k AI. Může to trvat až minutu…');
    $('#aiSettingsResult').scrollIntoView({block:'nearest'});
    try{
      aiStatus=await window.veyvo.saveAi({apiKey:$('#aiKey').value,model:$('#aiModel').value,automatic:$('#aiAutomatic').checked,consent:$('#aiConsent').checked});
      aiGeneration++;state.aiLastAttempt=null;save();$('#aiKey').value='';
      setAiSaveState('saved','Uloženo ✓ Připojení k AI je ověřené. Můžeš otevřít VEYVO Coach.');
      renderAiSettings();renderAiPlanStatus();scheduleAiPlanning();toast('Uloženo ✓ AI je připojená');
    }catch(error){
      setAiSaveState('error','Neuloženo: '+aiSaveError(error));
      $('#aiSettingsResult').scrollIntoView({block:'nearest'});
    }finally{aiSettingsBusy=false;controls.forEach(selector=>$(selector).disabled=false);}
  });
  $('#aiDisconnect').addEventListener('click',async()=>{
    try{aiStatus=await window.veyvo.disconnectAi();aiGeneration++;clearTimeout(aiTimer);$('#aiKey').value='';setAiSaveState('idle','OpenAI odpojeno, API klíč odstraněn.');renderAiSettings();renderAiPlanStatus();}
    catch(error){setAiSaveState('error',aiSaveError(error));}
  });
  $('#saveRunnerProfile').addEventListener('click',()=>{
    try{
      const target=$('#goalTime').value.trim(),targetSeconds=target?VeyvoTraining.durationSeconds(target):null;
      if(target&&!targetSeconds)throw Error('Cílový čas zadej jako mm:ss nebo h:mm:ss.');
      state.profile=VeyvoTraining.normalProfile({goalDistanceKm:+$('#goalDistance').value,targetSeconds,days:$$('[data-running-day]:checked').map(input=>+input.dataset.runningDay)});
      save();renderPlan();$('#runnerProfileResult').textContent='Běžecký profil uložen ✓';scheduleAiPlanning();
    }catch(error){$('#runnerProfileResult').textContent=aiSaveError(error);}
  });
  $('#clearChat').addEventListener('click',async()=>{if(aiChatBusy)return;try{if(aiStatus.cloud)await window.veyvo.cloudClearChat();state.chatHistory=[];save();renderChatHistory();}catch(e){toast(aiSaveError(e));}});
  try{if(window.veyvo?.aiStatus)aiStatus=await window.veyvo.aiStatus();}
  catch(error){setAiSaveState('error',aiSaveError(error));}
  renderAiSettings();renderAiPlanStatus();scheduleAiPlanning();
}
