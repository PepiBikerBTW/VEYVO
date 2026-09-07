let cloudSyncEnabled=false,cloudApplying=false,cloudPending=null,cloudTimer,cloudEpoch=0;
function cloudSnapshot(){return {accountId:state.cloudAccountId,runs:state.runHistory.map((r,i)=>({id:String(r.id??('legacy-'+i)),date:String(r.date).slice(0,10),distance:r.distance,movingSeconds:r.movingSeconds||VeyvoTraining.durationSeconds(r.time),effort:r.effort??null,type:r.type||'Běh',note:r.note||'',averageHeartrate:r.averageHeartrate??null,elevationGain:r.elevationGain??null})),profile:state.profile,chat:state.chatHistory,baseline:state.cloudBaseline||null};}
function cloudMessage(text){$('#cloudStatus').textContent=text;}
window.scheduleCloudSync=()=>{if(cloudApplying||!cloudSyncEnabled)return;clearTimeout(cloudTimer);cloudTimer=setTimeout(()=>syncCloud().catch(()=>{}),700);};
function applyCloud(data,sent){
 const current=cloudSnapshot(),runs=VeyvoSync.rebaseRuns(data.runs,sent.runs,current.runs);
 cloudApplying=true;
 try{
 if(!state.cloudLocalBackup)state.cloudLocalBackup={runHistory:state.runHistory,profile:state.profile,chatHistory:state.chatHistory,weekPlans:state.weekPlans,aiPlans:state.aiPlans};
 state.cloudAccountId=data.accountId;state.cloudBaseline={runs:data.runs,profile:data.profile};
 const currentMonday=new Date(data.currentDate+'T12:00:00');currentMonday.setDate(currentMonday.getDate()-((currentMonday.getDay()+6)%7));currentMonday.setHours(0,0,0,0);
 if(PLAN_START.getTime()!==currentMonday.getTime()){PLAN_START=currentMonday;state.planStart=VeyvoTraining.dateKey(currentMonday);state.week=1;state.weekPlans={};state.aiPlans={};state.aiPlanInputs={};}

 state.runHistory=runs.map(r=>{const previous=state.runHistory.find(old=>String(old.id)===r.id),position=plannedPosition(r.date+'T12:00:00');return {...previous,...r,source:previous?.source||'cloud',time:formatDuration(r.movingSeconds),effortRecorded:r.effort!==null,week:position?.week||0,plannedDay:position?.day??null};});state.loggedRuns=state.runHistory.length;
 if(JSON.stringify(current.profile)===JSON.stringify(sent.profile))state.profile=data.profile;
 state.chatHistory=data.chat;

 for(const plan of Object.values(data.plans)){
  const position=plannedPosition(plan.week+'T12:00:00');if(!position)continue;const week=position.week;
  const rows=plan.days.map((d,i)=>[['PO','ÚT','ST','ČT','PÁ','SO','NE'][i],d.type,[d.description,d.distanceKm?`${d.distanceKm} km · ${VeyvoTraining.pace(d.paceFast)}–${VeyvoTraining.pace(d.paceSlow)}/km`:''].filter(Boolean).join(' · '),d.distanceKm?`${d.distanceKm} km`:'—']);
  state.weekPlans[String(week)]=rows;state.aiPlans[String(week)]={...plan,source:'nvidia',targetWeek:week,rows,rules:{lockedDays:[],completedKm:data.runs.filter(r=>plan.dates.includes(r.date)).reduce((sum,r)=>sum+r.distance,0)}};
 }
 aiStatus={configured:data.configured,automatic:data.automatic,model:data.model,cloud:true};
 save();renderPlan();renderChatHistory();renderAiSettings();renderAiPlanStatus();
 cloudMessage('Synchronizováno ✓ · '+new Date().toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}));
 }finally{cloudApplying=false;}
 if(JSON.stringify(cloudSnapshot().runs)!==JSON.stringify(data.runs)||JSON.stringify(state.profile)!==JSON.stringify(data.profile))window.scheduleCloudSync();
}
async function syncCloud(){
 if(!cloudSyncEnabled||cloudApplying)return;
 if(cloudPending)return cloudPending;
 if(aiChatBusy||aiPlanBusy)return;
 const epoch=cloudEpoch,sent=structuredClone(cloudSnapshot());cloudMessage('Synchronizuji…');
 cloudPending=window.veyvo.cloudSync(sent).then(data=>{if(epoch===cloudEpoch&&cloudSyncEnabled)applyCloud(data,sent);}).catch(error=>{cloudMessage(aiSaveError(error)+' Lokální data zůstávají uložená.');throw error;}).finally(()=>{cloudPending=null;});
 return cloudPending;
}
window.flushCloudSync=async()=>{if(!cloudSyncEnabled)return;clearTimeout(cloudTimer);await syncCloud();};
$('#cloudConnect').addEventListener('click',async()=>{try{await window.veyvo.cloudConnect();aiGeneration++;clearTimeout(aiTimer);cloudSyncEnabled=true;cloudMessage('Dokonči přihlášení v otevřeném okně. Pak se data spojí automaticky.');}catch(e){cloudMessage(aiSaveError(e));}});
$('#cloudRefresh').addEventListener('click',()=>syncCloud().catch(()=>{}));
$('#cloudDisconnect').addEventListener('click',async()=>{try{cloudEpoch++;aiGeneration++;clearTimeout(aiTimer);cloudSyncEnabled=false;await window.veyvo.cloudDisconnect();clearTimeout(cloudTimer);cloudMessage('Odpojeno. Lokální běhy zůstávají uložené.');aiStatus=await window.veyvo.aiStatus();renderAiSettings();renderAiPlanStatus();}catch(e){cloudMessage(aiSaveError(e));}});
async function checkCloud(){if(!window.veyvo?.cloudStatus)return;try{const status=await window.veyvo.cloudStatus();cloudSyncEnabled=status.enabled;if(status.enabled)await syncCloud();}catch(e){cloudMessage(aiSaveError(e));}}
void checkCloud();
setInterval(()=>{if(cloudSyncEnabled&&!document.hidden)void syncCloud().catch(()=>{});},15000);
window.addEventListener('focus',()=>{if(cloudSyncEnabled)void syncCloud().catch(()=>{});});
window.addEventListener('online',()=>{if(cloudSyncEnabled)void syncCloud().catch(()=>{});});
