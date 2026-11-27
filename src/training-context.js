(function(root) {
  const DAY = 86400000;
  function dateKey(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  }
  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year,month,day] = value.split('-').map(Number);
    const date = new Date(year,month-1,day);
    return dateKey(date) === value ? date : null;
  }
  function dayDifference(a,b) {
    return Math.round((Date.UTC(a.getFullYear(),a.getMonth(),a.getDate())-Date.UTC(b.getFullYear(),b.getMonth(),b.getDate()))/DAY);
  }
  function durationSeconds(value) {
    if (typeof value !== 'string' || !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value.trim())) return null;
    const parts=value.trim().split(':').map(Number);
    if(parts.slice(1).some(n=>n>59))return null;
    const seconds=parts.reduce((total,n)=>total*60+n,0);
    return seconds>0 && seconds<=172800 ? seconds : null;
  }
  function pace(seconds) {
    if(!Number.isFinite(seconds)||seconds<=0)return '—';
    const rounded=Math.round(seconds);
    return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}`;
  }
  // One 5 km window everywhere: the same 4.95-5.2 km as VeyvoRuns.isFiveKAttempt (GPS often reads 5.1 km).
  const FIVE_K_MIN_KM=4.95,FIVE_K_MAX_KM=5.2;
  const isFiveKDistance=distance=>Number.isFinite(distance)&&distance>=FIVE_K_MIN_KM&&distance<=FIVE_K_MAX_KM;
  // A maximal effort (10/10) means rest - for the first days only, then a normal (tired) next run.
  const MAX_EFFORT_REST_DAYS=3;
  const REST={kind:'rest',date:null,distanceKm:0,paceFast:null,paceSlow:null};
  function daysSince(date,today){
    const now=today?parseDate(today):null;
    return now?dayDifference(now,date):0;
  }
  function firstAvailable(date,startOffset,availableDays){
    const daySet=new Set(availableDays);
    for(let offset=startOffset;offset<=startOffset+7;offset++){
      const candidate=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()+offset));
      if(daySet.has((candidate.getUTCDay()+6)%7))return candidate.toISOString().slice(0,10);
    }
    return null;
  }
  function returnAfterBreakRun(date){
    return {kind:'easy',date,distanceKm:3.5,paceFast:null,paceSlow:null,returnAfterBreak:true,durationMin:25,durationMax:30};
  }
  function nextRunAfter5k(run, availableDays=[1,6], today='') {
    const date=parseDate(String(run?.date||'').slice(0,10));
    const distance=Number(run?.distance),seconds=Number(run?.movingSeconds ?? durationSeconds(run?.time));
    if(!date||!isFiveKDistance(distance)||!Number.isFinite(seconds)||seconds<600||seconds>7200)return null;
    const effort=Number(run.effort),since=daysSince(date,today);
    if(effort>=10&&since<MAX_EFFORT_REST_DAYS)return {...REST};
    const tired=effort>=8,good=effort>=1&&effort<=5;
    const minDays=tired?3:2;
    if(since>=10)return returnAfterBreakRun(firstAvailable(date,Math.max(minDays,since),availableDays));
    const nextWeekOffset=7-((date.getDay()+6)%7);
    const startOffset=Math.max(minDays,nextWeekOffset,today&&parseDate(today)?since+1:0);
    const nextDate=firstAvailable(date,startOffset,availableDays);
    const racePace=seconds/distance;
    return {kind:'easy',date:nextDate,distanceKm:tired?2.5:good?3.5:3,
      paceFast:Math.round(racePace*1.2/5)*5,paceSlow:Math.round(racePace*1.45/5)*5};
  }
  function nextRunAfterRun(run, availableDays=[1,6], today='', baseline=null) {
    if(run?.type==='test5k'||run?.type==='Test 5 km'){
      // A 5 km test outside the 5 km window (e.g. logged with warm-up and cool-down) is planned like any other run.
      const afterTest=nextRunAfter5k(run,availableDays,today);
      if(afterTest)return afterTest;
    }
    const date=parseDate(String(run?.date||'').slice(0,10));
    const distance=Number(run?.distance),seconds=Number(run?.movingSeconds ?? durationSeconds(run?.time));
    if(!date||!Number.isFinite(distance)||distance<=0||distance>300||!Number.isFinite(seconds)||seconds<=0||seconds>172800)return null;
    const effort=Number(run.effort);
    const daysSinceRun=daysSince(date,today);
    if(effort>=10&&daysSinceRun<MAX_EFFORT_REST_DAYS)return {...REST};
    const tired=effort>=8,minDays=tired?3:2;
    const returnAfterBreak=daysSinceRun>=10;
    const startOffset=Math.max(minDays,daysSinceRun+(returnAfterBreak?0:1));
    const nextDate=firstAvailable(date,startOffset,availableDays);
    const baseDistance=Number(baseline?.distance),baseSeconds=Number(baseline?.movingSeconds);
    const reference=baseline&&isFiveKDistance(baseDistance)?baseSeconds/baseDistance:seconds/distance;
    if(!Number.isFinite(reference)||reference<=0)return null;
    if(returnAfterBreak)return returnAfterBreakRun(nextDate);
    return {kind:'easy',date:nextDate,distanceKm:Math.round(Math.min(5,Math.max(2,distance*(tired?.6:.8)))*2)/2,
      paceFast:Math.round(reference*1.2/5)*5,paceSlow:Math.round(reference*1.45/5)*5};
  }
  function normalProfile(profile = {}) {
    // 1-7 available days, the same rule as VeyvoStore.setProfile (availability, not a run every day).
    const days=Array.isArray(profile.days)?[...new Set(profile.days)].filter(day=>Number.isInteger(day)&&day>=0&&day<=6).sort((a,b)=>a-b):[1,6];
    if(days.length<1 || days.length>7)throw Error('Vyber 1 až 7 běžeckých dnů.');
    const goalDistanceKm=Number(profile.goalDistanceKm ?? 5);
    if(!Number.isFinite(goalDistanceKm)||goalDistanceKm<1||goalDistanceKm>100)throw Error('Cílová vzdálenost musí být 1–100 km.');
    const targetSeconds=profile.targetSeconds==null?null:Number(profile.targetSeconds);
    if(targetSeconds!==null&&(!Number.isFinite(targetSeconds)||targetSeconds<60||targetSeconds>172800))throw Error('Zadej platný cílový čas.');
    return {goalDistanceKm,targetSeconds,days};
  }
  function normalizeRuns(history = [], now = new Date()) {
    if(!Array.isArray(history))throw Error('Historie běhů není platná.');
    const todayKey=dateKey(now);
    return history.filter(run=>run&&typeof run==='object').map(run=>{
      // Calendar date by slicing 'YYYY-MM-DD…' (v2 keys, legacy 'T00:00:00', Strava local time with a
      // fake 'Z'); new Date() would read those as UTC and move the run a day in many time zones.
      const key=String(run.date??'').slice(0,10), date=parseDate(key), distanceKm=Number(run.distance);
      const duration=run.movingSeconds ?? durationSeconds(run.time);
      if(!date||key>todayKey||dayDifference(now,date)>=90||!Number.isFinite(distanceKm)||distanceKm<=0||distanceKm>300||!Number.isFinite(duration)||duration<=0||duration>172800)return null;
      return {date:key,distanceKm, movingSeconds:duration,paceSecondsPerKm:Math.round(duration/distanceKm),
        effort:Number.isFinite(run.effort)&&run.effort>=1&&run.effort<=10?run.effort:null,
        averageHeartrate:Number.isFinite(run.averageHeartrate)&&run.averageHeartrate>0?run.averageHeartrate:null,
        elevationGain:Number.isFinite(run.elevationGain)&&run.elevationGain>=0?run.elevationGain:null,
        type:typeof run.type==='string'?run.type.slice(0,80):'Běh',
        note:typeof run.note==='string'?run.note.slice(0,1000):''};
    }).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)).slice(-100);
  }
  function summarize(runs, now=new Date()) {
    const recent=runs.filter(run=>dayDifference(now,parseDate(run.date))<28);
    const week=runs.filter(run=>dayDifference(now,parseDate(run.date))<7);
    const total=list=>Math.round(list.reduce((sum,run)=>sum+run.distanceKm,0)*100)/100;
    const effort=week.filter(run=>run.effort!==null);
    const distance=total(recent);
    return {runsLast28Days:recent.length,distanceLast28Days:distance,distanceLast7Days:total(week),
      averagePaceSecondsPerKm:distance?Math.round(recent.reduce((sum,run)=>sum+run.movingSeconds,0)/distance):null,
      averageEffortLast7Days:effort.length?Math.round(effort.reduce((sum,run)=>sum+run.effort,0)/effort.length*10)/10:null,
      longestRunKm:recent.length?Math.max(...recent.map(run=>run.distanceKm)):0,
      weeks:Array.from({length:4},(_,i)=>({daysAgo:[i*7,i*7+6],distanceKm:total(runs.filter(run=>{const days=dayDifference(now,parseDate(run.date));return days>=i*7&&days<(i+1)*7}))}))};
  }
  function targetWeek(planStart, now=new Date()) {
    const days=dayDifference(now,planStart);
    if(days>=70)return null;
    if(days<0)return 1;
    const week=Math.floor(days/7)+1;
    return now.getDay()===0&&now.getHours()>=18 ? (week<10?week+1:null) : week;
  }
  const api={FIVE_K_MIN_KM,FIVE_K_MAX_KM,MAX_EFFORT_REST_DAYS,dateKey,parseDate,dayDifference,durationSeconds,pace,nextRunAfter5k,nextRunAfterRun,normalProfile,normalizeRuns,summarize,targetWeek};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VeyvoTraining=api;
})(globalThis);
