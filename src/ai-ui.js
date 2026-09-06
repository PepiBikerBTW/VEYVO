// AI requests stay in Electron's main process; the renderer never receives a saved API key.
let aiStatus={configured:false,automatic:false,model:'gpt-5.4-mini'};
let aiPlanBusy=false,aiChatBusy=false,aiSettingsBusy=false,aiGeneration=0,aiTimer;
let aiPlanError='';
function aiContext(){
  return {language:state.language,planStart:state.planStart,profile:state.profile,
    runHistory:state.runHistory.slice(-200),weekPlans:state.weekPlans};
}
function aiWeek(){return VeyvoTraining.targetWeek(PLAN_START);}
function aiInputKey(week){return JSON.stringify([week,aiContext().profile,aiContext().runHistory,state.planStart,state.language,aiStatus.model]);}
function openAiSettings(){
  $$('[data-settings-view]').forEach(tab=>tab.classList.toggle('active',tab.dataset.settingsView==='ai'));
  $$('[data-settings-panel]').forEach(panel=>{panel.hidden=panel.dataset.settingsPanel!=='ai'});
  renderAiSettings();$('#settingsDialog').showModal();
}
function renderAiSettings(){
  $('#aiModel').value=aiStatus.model;
  $('#aiAutomatic').checked=aiStatus.configured?aiStatus.automatic:true;
  $('#aiConsent').checked=aiStatus.configured;
  $('#aiConnectionState').textContent=aiStatus.configured?`OpenAI · ${aiStatus.model}`:'OpenAI není připojené';
  $('#aiDisconnect').hidden=!aiStatus.configured;
  $('#aiKey').placeholder=aiStatus.configured?'Klíč je uložený · prázdné pole ho zachová':'sk-…';
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
    : 'Pro skutečný AI plán připoj OpenAI v nastavení.');
  $('#weeklyReviewTitle').textContent=aiPlanBusy?'AI připravuje tréninky':meta?`AI plán pro ${meta.targetWeek}. týden`:'Plán podle tvých skutečných výkonů';
  $('#weeklyReviewText').textContent=meta?meta.explanation:'Zapiš nebo importuj běhy s časem a vzdáleností. AI podle nich zvolí délky, tempa a regeneraci.';
  $('#weeklyReviewState').textContent=aiPlanBusy?'PRACUJE':meta?'OPENAI':'ČEKÁ';
  $('#coachConnection').textContent=aiChatBusy?'AI přemýšlí…':aiStatus.configured?`OpenAI · ${aiStatus.model}`:'Připoj OpenAI v nastavení';
}
function scheduleAiPlanning(){
  clearTimeout(aiTimer);
  if(aiStatus.configured&&aiStatus.automatic)aiTimer=setTimeout(()=>generateAiPlan(false),1800);
}
async function generateAiPlan(manual=true){
  if(aiPlanBusy)return;
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
    toast(`OpenAI připravilo plán pro ${week}. týden`);
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
  $('#aiSave').addEventListener('click',async()=>{
    if(aiSettingsBusy)return;aiSettingsBusy=true;$('#aiSave').disabled=true;
    $('#aiSettingsResult').textContent='Ověřuji připojení k OpenAI…';
    try{
      aiStatus=await window.veyvo.saveAi({apiKey:$('#aiKey').value,model:$('#aiModel').value,automatic:$('#aiAutomatic').checked,consent:$('#aiConsent').checked});
      aiGeneration++;state.aiLastAttempt=null;save();$('#aiSettingsResult').textContent='Připojení ověřeno. AI coach je připravený.';renderAiSettings();renderAiPlanStatus();scheduleAiPlanning();
    }catch(error){$('#aiSettingsResult').textContent=error.message||'Připojení se nezdařilo.';}
    finally{$('#aiKey').value='';aiSettingsBusy=false;$('#aiSave').disabled=false;}
  });
  $('#aiDisconnect').addEventListener('click',async()=>{
    try{aiStatus=await window.veyvo.disconnectAi();aiGeneration++;clearTimeout(aiTimer);$('#aiKey').value='';$('#aiSettingsResult').textContent='OpenAI odpojeno, API klíč odstraněn.';renderAiSettings();renderAiPlanStatus();}
    catch(error){$('#aiSettingsResult').textContent=error.message;}
  });
  $('#saveRunnerProfile').addEventListener('click',()=>{
    try{
      const target=$('#goalTime').value.trim(),targetSeconds=target?VeyvoTraining.durationSeconds(target):null;
      if(target&&!targetSeconds)throw Error('Cílový čas zadej jako mm:ss nebo h:mm:ss.');
      state.profile=VeyvoTraining.normalProfile({goalDistanceKm:+$('#goalDistance').value,targetSeconds,days:$$('[data-running-day]:checked').map(input=>+input.dataset.runningDay)});
      save();renderPlan();$('#aiSettingsResult').textContent='Běžecký profil uložen.';scheduleAiPlanning();
    }catch(error){$('#aiSettingsResult').textContent=error.message;}
  });
  $('#clearChat').addEventListener('click',()=>{if(aiChatBusy)return;state.chatHistory=[];save();renderChatHistory();});
  try{if(window.veyvo?.aiStatus)aiStatus=await window.veyvo.aiStatus();}
  catch(error){$('#aiSettingsResult').textContent=error.message;}
  renderAiSettings();renderAiPlanStatus();scheduleAiPlanning();
}
