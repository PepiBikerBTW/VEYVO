const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.TZ='Europe/Prague';
const T=require('../src/training-context');
const {contextFor,planningRules,validatePlan,createAiClient,responseText}=require('../electron/ai');
const {createSettingsStore}=require('../electron/ai-settings');
const now=new Date(2026,8,7,8);
const raw={planStart:'2026-09-07',language:'cs',profile:{goalDistanceKm:5,targetSeconds:1200,days:[1,2,4,6]},weekPlans:{},runHistory:[
  {date:'2026-09-01T08:00:00',distance:5,time:'30:00',effort:5,type:'Lehký běh'},
  {date:'2026-09-03T08:00:00',distance:5,time:'27:30',effort:6,type:'Lehký běh'},
  {date:'2026-09-06T08:00:00',distance:6,time:'36:00',effort:null,type:'Běh'}
]};
const rules=()=>planningRules(contextFor(raw,now),1,now);
function plan(){return {explanation:'Tempa vycházejí z běhů 5 km za 30:00 a 27:30.',days:Array.from({length:7},(_,day)=>({day,type:day===1?'Lehký běh':'Volno',distanceKm:day===1?5:0,paceFast:day===1?360:null,paceSlow:day===1?400:null,description:day===1?'Lehce':'Odpočinek'}))};}
const ok=text=>({ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]})});
const settings={apiKey:'sk-'+'test'.repeat(8),consent:true,model:'gpt-5.4-mini',automatic:true};
test('duration handles mm:ss and h:mm:ss; invalid times rejected',()=>{
  assert.equal(T.durationSeconds('1:02:03'),3723);assert.equal(T.durationSeconds('62:03'),3723);
  for(const bad of ['1:99','abc','0:00','-1:30','1:99:01'])assert.equal(T.durationSeconds(bad),null);
  assert.equal(T.pace(359.8),'6:00');
});
test('context derives actual weighted pace and preserves unknown effort',()=>{
  const context=contextFor(raw,now);assert.equal(context.runs[0].paceSecondsPerKm,360);
  assert.equal(context.stats.averagePaceSecondsPerKm,351);assert.equal(context.stats.distanceLast7Days,16);
  assert.equal(context.runs.at(-1).effort,null);assert.equal(context.currentTime.timeZone,'Europe/Prague');
  const faster=structuredClone(raw);faster.runHistory[0].time='25:00';
  assert.notEqual(contextFor(faster,now).stats.averagePaceSecondsPerKm,context.stats.averagePaceSecondsPerKm);
});
test('future, invalid and old runs do not become training evidence',()=>{
  const history=[...raw.runHistory,{date:'2026-09-08',distance:40,time:'120:00'},{date:'bad',distance:5,time:'20:00'},{date:'2020-01-01',distance:10,time:'50:00'}];
  assert.equal(T.normalizeRuns(history,now).length,3);
});
test('automatic target advances Sunday evening, handles missed Sunday and plan end',()=>{
  const start=T.parseDate(raw.planStart);
  assert.equal(T.targetWeek(start,new Date(2026,8,6)),1);
  assert.equal(T.targetWeek(start,new Date(2026,8,13,17)),1);
  assert.equal(T.targetWeek(start,new Date(2026,8,13,18)),2);
  assert.equal(T.targetWeek(start,new Date(2026,8,14,8)),2);
  assert.equal(T.targetWeek(start,new Date(2026,10,16)),null);
});
test('valid personalized plan is accepted; unavailable and oversized plans rejected',()=>{
  assert.equal(validatePlan(plan(),rules()).days[1].distanceKm,5);
  const badDay=plan();badDay.days[0]={...badDay.days[1],day:0};
  assert.throws(()=>validatePlan(badDay,rules()),/nedostupný/);
  const tooLong=plan();tooLong.days[1].distanceKm=15;assert.throws(()=>validatePlan(tooLong,rules()),/délka/);
  const excessive=plan();for(const day of [2,4,6])excessive.days[day]={...excessive.days[1],day};
  assert.throws(()=>validatePlan(excessive,rules()),/objem/);
});
test('unknown history cannot create a plan; high effort forbids intensity',()=>{
  assert.throws(()=>planningRules(contextFor({...raw,runHistory:[]},now),1,now),/alespoň jeden běh/);
  const tired=structuredClone(raw);tired.runHistory.forEach(run=>run.effort=9);
  const tiredRules=planningRules(contextFor(tired,now),1,now);
  const hard=plan();hard.days[1].type='Tempo';
  assert.throws(()=>validatePlan(hard,tiredRules),/intenzivních/);
});
test('completed days stay locked and count against remaining weekly budget',()=>{
  const later=new Date(2026,8,8,20),data=structuredClone(raw);
  data.runHistory.push({date:'2026-09-08T08:00:00',distance:5,time:'25:00',effort:8,type:'Tempo'});
  const constraints=planningRules(contextFor(data,later),1,later);
  assert.deepEqual(constraints.lockedDays,[0,1]);assert.equal(constraints.completedKm,5);
  assert.throws(()=>validatePlan(plan(),constraints),/dokončený/);
  const adjacent=plan();adjacent.days[1]={...adjacent.days[0],day:1};adjacent.days[2]={day:2,type:'Tempo',distanceKm:4,paceFast:300,paceSlow:320,description:'Tempo'};
  assert.throws(()=>validatePlan(adjacent,constraints),/regenerace/);
});
test('responses API sends correct context, strict schema and no response storage',async()=>{
  let sent;
  const client=createAiClient({getSettings:()=>settings,now:()=>now,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.body);
    assert.equal(options.headers.Authorization,'Bearer '+settings.apiKey);return ok(JSON.stringify(plan()));
  }});
  const result=await client.plan({context:raw,targetWeek:1});
  assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);
  assert.equal(JSON.parse(sent.input).context.runs[0].paceSecondsPerKm,360);
  assert.equal(result.source,'openai');assert.match(result.rows[1][2],/6:00–6:40/);
  assert(!JSON.stringify(result).includes(settings.apiKey));
});
test('chat includes real history and current time, and never instructs fake plan changes',async()=>{
  let sent;const client=createAiClient({getSettings:()=>settings,now:()=>now,fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return ok('Odpověď AI');}});
  const messages=[{role:'user',content:'Jak běhat?'},{role:'assistant',content:'Minule jsme řešili tempo.'},{role:'user',content:'A dnes?'}];
  assert.equal((await client.chat({context:raw,messages})).text,'Odpověď AI');
  assert.deepEqual(sent.input.slice(1),messages);assert.match(sent.input[0].content,/paceSecondsPerKm/);
  assert.match(sent.instructions,/cannot edit or save a plan/);assert.match(sent.instructions,/currentTime/);
});
test('missing key, HTTP failure, refusal, truncation and malformed plan fail explicitly',async()=>{
  const call=client=>client.chat({context:raw,messages:[{role:'user',content:'Ahoj'}]});
  await assert.rejects(call(createAiClient({getSettings:()=>null,now:()=>now,fetchImpl:()=>{throw Error('must not fetch')}})),/připoj OpenAI/);
  for(const status of [401,403,404,429,500]){
    const client=createAiClient({getSettings:()=>settings,now:()=>now,fetchImpl:async()=>({ok:false,status,json:async()=>({error:{message:settings.apiKey}})})});
    await assert.rejects(call(client),error=>!error.message.includes(settings.apiKey));
  }
  assert.throws(()=>responseText({status:'incomplete',output:[]}),/dokončena/);
  assert.throws(()=>responseText({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}),/nemohla/);
  const client=createAiClient({getSettings:()=>settings,now:()=>now,fetchImpl:async()=>ok('not json')});
  await assert.rejects(client.plan({context:raw,targetWeek:1}),/nečitelný/);
});
test('one active chat at a time prevents duplicate API use',async()=>{
  let release;const delayed=new Promise(resolve=>release=resolve);
  const client=createAiClient({getSettings:()=>settings,now:()=>now,fetchImpl:()=>delayed});
  const payload={context:raw,messages:[{role:'user',content:'Ahoj'}]},first=client.chat(payload);
  await assert.rejects(client.chat(payload),/ještě probíhá/);release(ok('Ahoj'));await first;
});
test('settings require consent and encryption; public status never reveals key',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'veyvo-ai-test-')),file=path.join(dir,'openai.secure');
  try{
    const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
    const store=createSettingsStore({file,safeStorage:encryption});
    assert.throws(()=>store.candidate({...settings,consent:false}),/Potvrď/);
    store.write(store.candidate(settings));assert.equal(store.status().configured,true);
    assert(!JSON.stringify(store.status()).includes(settings.apiKey));assert(!fs.readFileSync(file).toString().includes(settings.apiKey));
    assert.equal(store.candidate({...settings,apiKey:''}).apiKey,settings.apiKey);
    assert.equal(store.disconnect().configured,false);assert(!fs.existsSync(file));
    const unavailable=createSettingsStore({file,safeStorage:{isEncryptionAvailable:()=>false}});
    assert.throws(()=>unavailable.candidate(settings),/šifrování/);
  } finally {for(const name of ['openai.secure','openai.secure.tmp']){const file=path.join(dir,name);if(fs.existsSync(file))fs.unlinkSync(file)}fs.rmdirSync(dir);}
});
