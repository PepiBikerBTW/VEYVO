const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {createAiClient}=require('../electron/ai');
const {createSettingsStore}=require('../electron/ai-settings');
let win,store,dir,failure=false,slow=false,planCalls=0,chatCalls=0,clock=new Date(2026,8,7,8);
const calls=[];
const ok=text=>({ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]})});
const ai=createAiClient({getSettings:()=>store.read(),now:()=>clock,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  if(body.input==='Reply with OK.')return ok('OK');
  if(failure)return {ok:false,status:429};
  if(body.text){
    planCalls++;const {rules}=JSON.parse(body.input);
    const first=rules.availableDays.find(day=>!rules.lockedDays.includes(day));
    if(slow)await new Promise(resolve=>setTimeout(resolve,250));
    return ok(JSON.stringify({explanation:'Plán vychází ze skutečného tempa a vzdáleností.',days:Array.from({length:7},(_,day)=>({day,type:day===first?'Lehký běh':'Volno',distanceKm:day===first?Math.min(3,rules.remainingKm,rules.maxRunKm):0,paceFast:day===first?350:null,paceSlow:day===first?390:null,description:day===first?'Klidný běh':'Odpočinek'}))}));
  }
  chatCalls++;return ok('AI odpověď k tempu 5:00/km.');
}});
function handlers(){
  ipcMain.handle('app-version',()=>app.getVersion());ipcMain.handle('strava-status',()=>({connected:false}));
  ipcMain.handle('ai-status',()=>store.status());
  ipcMain.handle('ai-save',async(event,input)=>{const settings=store.candidate(input);await ai.test(settings);return store.write(settings)});
  ipcMain.handle('ai-disconnect',()=>store.disconnect());
  ipcMain.handle('ai-chat',(event,input)=>ai.chat(input));
  ipcMain.handle('ai-plan',(event,input)=>ai.plan(input));
}
const execute=async code=>{try{return await win.webContents.executeJavaScript(code.includes('await ')?'(async()=>{'+code+'})()':code)}catch(error){console.error('Failed step:',code.slice(0,180));throw error}};
async function check(expression,message){if(!await execute(expression))throw Error(message)}
async function until(expression){for(let i=0;i<150;i++){if(await execute(expression))return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timed out: '+expression)}
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  try{
    dir=fs.mkdtempSync(path.join(os.tmpdir(),'veyvo-ui-'));
    store=createSettingsStore({file:path.join(dir,'openai.secure'),safeStorage});handlers();
    win=new BrowserWindow({show:false,width:1480,height:1000,webPreferences:{partition:'ai-test',offscreen:true,backgroundThrottling:false,preload:path.join(__dirname,'../electron/preload.js'),contextIsolation:true,nodeIntegration:false}});
    win.webContents.on('console-message',(...args)=>console.error(args.filter(value=>typeof value==='string').join(' ')));
    await win.loadFile(path.join(__dirname,'../src/index.html'));
    await execute(`window.testNow=new Date(2026,8,7,8);window.RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[testNow.getTime()]))}static now(){return testNow.getTime()}};refreshCalendar();`);
    await check("typeof initializeAi==='function' && $('#aiPlanStatus').textContent.includes('připoj')",'AI initialization');
    await execute("sendCoachMessage('Ahoj');openAiSettings();");
    await check("$('#messages').lastElementChild.textContent.includes('připoj OpenAI')",'No fake offline reply');
    await check("$('#aiAutomatic').checked && !$('#aiConsent').checked",'Automatic preference and explicit data consent');
    await execute("$('#aiKey').value='sk-'+'test'.repeat(8);$('#aiConsent').checked=true;$('#aiSave').click();");
    await until('aiStatus.configured && !aiSettingsBusy');
    await check("$('#aiKey').value==='' && !localStorage.getItem('veyvo-state').includes('sk-')",'Key not in renderer storage');
    await execute("importStravaActivities([{id:'100',name:'Morning run',startDateLocal:'2026-09-01T08:00:00',distanceKm:5,movingTime:1500,averageHeartrate:140,totalElevationGain:20}]);");
    await until("Boolean(state.aiPlans['1']) && !aiPlanBusy");
    await check("state.runHistory[0].week===0 && state.runHistory[0].movingSeconds===1500 && state.runHistory[0].effort===null",'Pre-plan Strava run retained with real duration');
    await check("state.weekPlans['1'][1][1]==='Lehký běh' && $('#planOrigin').textContent==='OPENAI'",'AI plan applied');
    await execute("openRunLog();$('#logDate').value='2026-09-04';$('#logDistance').value='6';$('#logTime').value='36:00';$('#effort').value='7';$('#saveLog').click();");
    await until("state.aiPlanInputs['1']===aiInputKey(1) && !aiPlanBusy");
    await check("state.runHistory.length===2 && state.runHistory[1].movingSeconds===2160",'Manual performance saved');
    await execute("importStravaActivities([{id:'101',startDateLocal:'2026-09-04T08:00:00',distanceKm:6,movingTime:2160}]);");
    await until("state.aiPlanInputs['1']===aiInputKey(1) && !aiPlanBusy");
    await check("state.runHistory.length===2 && state.runHistory[1].source==='strava' && state.runHistory[1].effort===7",'Manual/Strava duplicate merged without guessing effort');
    await execute("importStravaActivities([{id:'101',startDateLocal:'2026-09-04T08:00:00',distanceKm:6,movingTime:2160}]);");
    await check("state.runHistory.length===2",'Repeated Strava import is idempotent');
    const count=planCalls;await execute('await generateAiPlan(false)');if(planCalls!==count)throw Error('Repeated unchanged automatic request');
    await execute("$('#settingsDialog').close();go('coach');await sendCoachMessage('Jaké mám tempo?');await sendCoachMessage('A co dál?');");
    if(chatCalls!==2)throw Error('AI chat requests');
    const chat=calls.filter(call=>Array.isArray(call.input)).at(-1);
    if(chat.input.length!==4||!chat.input[0].content.includes('paceSecondsPerKm'))throw Error('Conversation/context missing');
    await check("state.chatHistory.length===4 && $('#messages').lastElementChild.textContent.includes('AI odpověď')",'Chat persisted');
    failure=true;
    await execute("window.previousPlan=JSON.stringify(state.weekPlans);await generateAiPlan(true);");
    await check("JSON.stringify(state.weekPlans)===previousPlan && $('#aiPlanStatus').textContent.includes('limit')",'API error preserves plan');
    failure=false;slow=true;
    await execute("window.pendingPlan=generateAiPlan(true);state.profile={...state.profile,targetSeconds:1300};await pendingPlan;");
    await check("JSON.stringify(state.weekPlans)===previousPlan && aiPlanError.includes('změnila')",'Stale generated plan rejected');
    slow=false;
    await execute("clearTimeout(aiTimer);aiStatus.automatic=false;openAiSettings();");
    await new Promise(resolve=>setTimeout(resolve,500));
    const screenshot=await win.webContents.capturePage();fs.mkdirSync(path.join(__dirname,'../release'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../release/ai-settings-test.png'),screenshot.toPNG());
    await execute("$('#settingsDialog').close();go('plan');");
    await check("!$('#settingsDialog').open && $('#planPage').classList.contains('active')",'Plan screen visible');await new Promise(resolve=>setTimeout(resolve,500));
    fs.writeFileSync(path.join(__dirname,'../release/ai-plan-test.png'),(await win.webContents.capturePage()).toPNG());
    await execute("await window.veyvo.disconnectAi();aiStatus=await window.veyvo.aiStatus();");
    await check('!aiStatus.configured','Disconnected');
    store.disconnect();fs.rmdirSync(dir);dir=null;
    console.log('UI passed: encrypted key, consent, pre-plan import, auto plan, deduplication, chat history, error preservation, stale result');
    app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
app.on('will-quit',()=>{if(dir){for(const name of ['openai.secure','openai.secure.tmp']){const file=path.join(dir,name);if(fs.existsSync(file))fs.unlinkSync(file)}fs.rmdirSync(dir);}});
setTimeout(()=>{console.error('AI UI test timeout');app.exit(1)},30000);
