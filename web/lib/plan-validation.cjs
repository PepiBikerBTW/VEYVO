const Training=require('./training.cjs');
const TYPES = ['Volno','Regenerace','Lehký běh','Tempo','Intervaly','Dlouhý běh'];
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const PLAN_SCHEMA = object({
  explanation:{type:'string'},
  days:{type:'array',items:object({
    day:{type:'integer'},type:{type:'string',enum:TYPES},distanceKm:{type:'number'},
    paceFast:{type:['integer','null']},paceSlow:{type:['integer','null']},description:{type:'string'}}),minItems:7,maxItems:7}
});

function contextFor(raw, now=new Date()) {
  if(!raw||typeof raw!=='object'||JSON.stringify(raw).length>250000)throw Error('Kontext AI je příliš velký nebo neplatný.');
  const planStart=Training.parseDate(raw.planStart);
  if(!planStart || planStart.getDay()!==1)throw Error('Začátek plánu musí být platné pondělí.');
  const runs=Training.normalizeRuns(raw.runHistory,now);
  const profile=Training.normalProfile(raw.profile);
  const stats=Training.summarize(runs,now);
  const weekPlans={};
  for(const [key,rows] of Object.entries(raw.weekPlans||{})){
    if(!/^(10|[1-9])$/.test(key)||!Array.isArray(rows)||rows.length!==7)continue;
    weekPlans[key]=rows.map(row=>Array.isArray(row)?row.slice(0,4).map(value=>String(value).slice(0,600)):[]);
  }
  return {currentTime:{iso:now.toISOString(),local:now.toLocaleString(raw.language==='en'?'en-GB':'cs-CZ',{weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},
    language:raw.language==='en'?'en':'cs',planStart:Training.dateKey(planStart),profile,runs,stats,weekPlans};
}
function planningRules(context, targetWeek, now=new Date()) {
  if(!Number.isInteger(targetWeek)||targetWeek<1||targetWeek>10)throw Error('Neplatný týden plánu.');
  if(targetWeek!==Training.targetWeek(Training.parseDate(context.planStart),now))throw Error('Tento týden už není aktuální pro automatickou adaptaci.');
  if(!context.stats.runsLast28Days)throw Error('Pro plán nejdřív zapiš nebo importuj alespoň jeden běh z posledních 28 dnů s časem a vzdáleností.');
  const start=Training.parseDate(context.planStart);start.setDate(start.getDate()+(targetWeek-1)*7);
  const dates=Array.from({length:7},(_,day)=>{const date=new Date(start);date.setDate(date.getDate()+day);return Training.dateKey(date)});
  const today=Training.dateKey(now);
  const lockedDays=dates.map((date,i)=>date<today||context.runs.some(run=>run.date===date)?i:null).filter(day=>day!==null);
  const completed=context.runs.filter(run=>dates.includes(run.date));
  const completedKm=completed.reduce((sum,run)=>sum+run.distanceKm,0);
  const baseline=context.stats.distanceLast7Days || context.stats.distanceLast28Days/4;
  const highEffort=context.stats.averageEffortLast7Days>=8;
  // Product guardrails, not a guarantee that any training load is medically safe.
  const maxWeeklyKm=Math.round(baseline*(highEffort?1:1.08)*100)/100;
  const remainingKm=Math.max(0,Math.floor((maxWeeklyKm-completedKm)*100)/100);
  const recent=context.runs.filter(run=>Training.dayDifference(now,Training.parseDate(run.date))<7);
  const recentHard=recent.filter(run=>['Tempo','Intervaly'].includes(run.type)||run.effort>=8);
  return {targetWeek,dates,lockedDays,completedKm:Math.round(completedKm*100)/100,maxWeeklyKm,remainingKm,
    maxRunKm:Math.round(context.stats.longestRunKm*1.08*100)/100,
    maxHardSessions:context.stats.runsLast28Days<3||highEffort?0:Math.max(0,2-completed.filter(run=>['Tempo','Intervaly'].includes(run.type)||run.effort>=8).length),
    recentHardDates:recentHard.map(run=>run.date),availableDays:context.profile.days};
}
function validatePlan(plan,rules) {
  const fail=reason=>{throw Error(`AI vrátila nevyhovující plán (${reason}). Dosavadní plán zůstává uložený.`)};
  if(!plan||typeof plan.explanation!=='string'||!plan.explanation.trim()||plan.explanation.length>2500||!Array.isArray(plan.days)||plan.days.length!==7)fail('formát');
  let total=0,hard=[];
  for(let i=0;i<7;i++){
    const item=plan.days[i];
    if(!item||item.day!==i||!TYPES.includes(item.type)||!Number.isFinite(item.distanceKm)||item.distanceKm<0||typeof item.description!=='string'||item.description.length>700)fail('den nebo vzdálenost');
    const rest=['Volno','Regenerace'].includes(item.type);
    if(rest&&(item.distanceKm!==0||item.paceFast!==null||item.paceSlow!==null))fail('volný den');
    if(!rest&&(!rules.availableDays.includes(i)||rules.lockedDays.includes(i)))fail('nedostupný nebo dokončený den');
    if(!rest&&(item.distanceKm<=0||item.distanceKm>rules.maxRunKm+.01||!Number.isInteger(item.paceFast)||!Number.isInteger(item.paceSlow)||item.paceFast<120||item.paceSlow>1800||item.paceFast>item.paceSlow))fail('délka nebo tempo');
    if(['Tempo','Intervaly'].includes(item.type))hard.push(i);
    total+=Math.round(item.distanceKm*100)/100;
  }
  if(total>rules.remainingKm+.01)fail('týdenní objem');
  if(hard.length>rules.maxHardSessions||hard.some((day,i)=>i>0&&day-hard[i-1]<2))fail('rozestup intenzivních běhů');
  if(hard.some(day=>rules.recentHardDates.some(date=>Math.abs(Training.dayDifference(Training.parseDate(rules.dates[day]),Training.parseDate(date)))<2)))fail('regenerace po posledním výkonu');
  return {explanation:plan.explanation.trim(),days:plan.days.map(day=>({...day,description:day.description.trim(),distanceKm:Math.round(day.distanceKm*100)/100}))};
}
function rowsFromPlan(plan) {
  return plan.days.map((item,i)=>[
    ['PO','ÚT','ST','ČT','PÁ','SO','NE'][i],item.type,
    [item.description,item.distanceKm?`${item.distanceKm} km · ${Training.pace(item.paceFast)}–${Training.pace(item.paceSlow)}/km`:''].filter(Boolean).join(' · '),
    item.distanceKm?`${item.distanceKm} km`:'—'
  ]);
}

module.exports={PLAN_SCHEMA,validatePlan};
