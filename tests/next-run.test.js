const test=require('node:test');
const assert=require('node:assert/strict');
const {nextRunAfter5k,nextRunAfterRun}=require('../src/training-context.js');

test('5 km result and effort set the next easy run',()=>{
  const run={date:'2026-09-07',distance:5,movingSeconds:1800,effort:9};
  assert.deepEqual(nextRunAfter5k({...run,effort:5},[2,4]),{kind:'easy',date:'2026-09-16',distanceKm:3.5,paceFast:430,paceSlow:520});
  assert.equal(nextRunAfter5k({...run,effort:9},[1,4]).date,'2026-09-15');
  assert.equal(nextRunAfter5k({...run,effort:10},[1,4]).kind,'rest');
  assert.equal(nextRunAfter5k({...run,movingSeconds:1500},[1,4]).paceFast,360);
  assert.equal(nextRunAfter5k(run,[1,4],'2026-09-21').date,'2026-09-22');
  assert.equal(nextRunAfter5k({...run,distance:4},[1,4]),null);
});

test('a later run refreshes the next suggestion from result and effort',()=>{
  const baseline={date:'2026-09-07',type:'Test 5 km',distance:5,movingSeconds:1800,effort:9};
  const later={date:'2026-09-15',type:'Lehký běh',distance:3,movingSeconds:1260,effort:8};
  const next=nextRunAfterRun(later,[1,4],'2026-09-15',baseline);
  assert.equal(next.kind,'easy');
  assert.equal(next.date,'2026-09-18');
  assert.equal(next.distanceKm,2);
  assert.equal(next.paceFast,430);
  assert.equal(nextRunAfterRun({...later,effort:10},[1,4]).kind,'rest');
});

test('last Strava run after a two-week gap suggests an easy return',()=>{
  const run={date:'2026-09-15T17:44:51Z',type:'Běh',distance:6.17,movingSeconds:2570,effort:null};
  const next=nextRunAfterRun(run,[1,6],'2026-09-29');
  assert.equal(next.date,'2026-09-29');
  assert.equal(next.returnAfterBreak,true);
  assert.equal(next.durationMin,25);
  assert.equal(next.durationMax,30);
  assert.equal(next.paceFast,null);
  assert.equal(nextRunAfterRun(run,[1,6],'2026-09-30').date,'2026-10-04');
});

test('normalizeRuns keeps the calendar date of v2, legacy and Strava runs in every time zone',()=>{
  const {execFileSync}=require('node:child_process');
  const path=require('node:path');
  const script=`
    const T=require(${JSON.stringify(path.join(__dirname,'..','src','training-context.js'))});
    const now=new Date(2026,10,26,20,0);
    const runs=[
      {date:'2026-11-24',type:'run',distance:5,movingSeconds:1262},
      {date:'2026-11-21T23:40:00Z',type:'Dlouhý běh',distance:12,movingSeconds:4150},
      {date:'2026-11-17T00:00:00',type:'Intervaly',distance:6.5,time:'33:30'},
      {date:'2026-11-26',type:'easy',distance:3,movingSeconds:1100},
      {date:'2026-11-27',type:'run',distance:3,movingSeconds:1100},
      {date:'2026-08-28',type:'run',distance:3,movingSeconds:1100},
      {date:'2026-08-29',type:'run',distance:3,movingSeconds:1100},
      {date:'nope',distance:3,movingSeconds:1100}];
    const list=T.normalizeRuns(runs,now);
    process.stdout.write(JSON.stringify({dates:list.map(r=>r.date),week:T.summarize(list,now).distanceLast7Days}));`;
  for(const tz of ['Europe/Prague','America/Los_Angeles','Pacific/Kiritimati','UTC']){
    const out=JSON.parse(execFileSync(process.execPath,['-e',script],{env:{...process.env,TZ:tz},encoding:'utf8'}));
    // future (27.11.) and >= 90 days old (28.8.) runs are left out, exactly as before
    assert.deepEqual(out.dates,['2026-08-29','2026-11-17','2026-11-21','2026-11-24','2026-11-26'],tz);
    assert.equal(out.week,20,tz);
  }
});

test('nextRunAfterRun accepts v2 type codes: test5k uses the 5 km rule, run the general one',()=>{
  const effort={date:'2026-11-24',distance:5,movingSeconds:1262,effort:9};
  assert.deepEqual(nextRunAfterRun({...effort,type:'test5k'},[1,6],'2026-11-26'),nextRunAfterRun({...effort,type:'Test 5 km'},[1,6],'2026-11-26'));
  assert.equal(nextRunAfterRun({...effort,type:'test5k'},[1,6],'2026-11-26').date,'2026-12-01');
  assert.equal(nextRunAfterRun({...effort,type:'run'},[1,6],'2026-11-26').date,'2026-11-29');
});

test('normalProfile accepts every profile VeyvoStore accepts (1-7 days, sorted)',()=>{
  const {normalProfile}=require('../src/training-context.js');
  const Store=require('../src/core/store.js');
  for(const days of [[1,6],[6,1],[0],[0,1,2,3,4,5,6],[3,3,5]]){
    const result=Store.setProfile(Store.DEFAULT_STATE(),{days});
    assert.equal(result.ok,true,JSON.stringify(days));
    assert.deepEqual(normalProfile(result.profile).days,result.profile.days,JSON.stringify(days));
  }
  assert.throws(()=>normalProfile({days:[]}),/1 až 7/);
  assert.deepEqual(normalProfile({}).days,[1,6]);
});

test('a 5 km test at a GPS distance (5.08 km) still plans the next run; the 5 km window matches VeyvoRuns',()=>{
  const T=require('../src/training-context.js');
  const Runs=require('../src/core/runs-model.js');
  const test5k={date:'2026-11-24',type:'test5k',distance:5.08,movingSeconds:1262,effort:9};
  for(const distance of [5.06,5.08,5.1,5.2]){
    const next=nextRunAfterRun({...test5k,distance},[1,6],'2026-11-26');
    assert.equal(next&&next.kind,'easy',String(distance));
    assert.equal(next.date,'2026-12-01',String(distance)+': the 5 km rule (next week)');
  }
  // race pace is per km of the distance actually run
  assert.deepEqual(nextRunAfter5k({...test5k,distance:5.0},[1,6],'2026-11-26'),{kind:'easy',date:'2026-12-01',distanceKm:2.5,paceFast:305,paceSlow:365});
  const gps=nextRunAfter5k(test5k,[1,6],'2026-11-26');
  assert.equal(gps.paceFast,Math.round(1262/5.08*1.2/5)*5);
  assert.equal(gps.paceSlow,Math.round(1262/5.08*1.45/5)*5);
  // the same window as VeyvoRuns.isFiveKAttempt
  assert.equal(T.FIVE_K_MIN_KM,4.95);
  assert.equal(T.FIVE_K_MAX_KM,5.2);
  for(const distance of [4.94,4.95,5.05,5.2,5.21]){
    const accepted=nextRunAfter5k({...test5k,distance},[1,6],'2026-11-26')!==null;
    assert.equal(accepted,Runs.isFiveKAttempt({...test5k,id:'x',source:'manual',distance}),String(distance));
  }
});

test('a 5 km test logged as the whole session (8 km) is planned like any other run, never null',()=>{
  const session={date:'2026-11-24',type:'test5k',distance:8,movingSeconds:2700,effort:8};
  const next=nextRunAfterRun(session,[1,6],'2026-11-26');
  assert.equal(next.kind,'easy');
  assert.equal(next.date,'2026-11-29');
  assert.deepEqual(next,nextRunAfterRun({...session,type:'run'},[1,6],'2026-11-26'));
  // with a 5 km baseline the paces come from the baseline (5.08 km GPS reading included)
  const baseline={date:'2026-11-10',type:'run',distance:5.08,movingSeconds:1270,effort:9};
  const paced=nextRunAfterRun(session,[1,6],'2026-11-26',baseline);
  assert.equal(paced.paceFast,Math.round(1270/5.08*1.2/5)*5);
});

test('an easy run with a 5.08 km baseline gets the paces of that 5 km, not its own pace',()=>{
  const easy={date:'2026-11-26',type:'easy',distance:6,movingSeconds:2160,effort:4};
  const own=nextRunAfterRun(easy,[1,6],'2026-11-27');
  assert.deepEqual([own.paceFast,own.paceSlow],[430,520]);
  const five=nextRunAfterRun(easy,[1,6],'2026-11-27',{distance:5.0,movingSeconds:1262});
  const gps=nextRunAfterRun(easy,[1,6],'2026-11-27',{distance:5.08,movingSeconds:1282});
  assert.deepEqual([five.paceFast,five.paceSlow],[305,365]);
  assert.deepEqual([gps.paceFast,gps.paceSlow],[305,365]);
});

test('a maximal effort (10/10) means rest for a few days only, then a run, then a return after a break',()=>{
  const run={date:'2026-11-10',type:'run',distance:6,movingSeconds:2100,effort:10};
  // +1 day: rest
  assert.equal(nextRunAfterRun(run,[1,6],'2026-11-11').kind,'rest');
  assert.equal(nextRunAfterRun(run,[1,6],'2026-11-12').kind,'rest');
  // +4 days: an easy run like after a hard (8-9) effort, from tomorrow on
  const four=nextRunAfterRun(run,[1,6],'2026-11-14');
  assert.equal(four.kind,'easy');
  assert.equal(four.date,'2026-11-15');
  assert.deepEqual(four,nextRunAfterRun({...run,effort:9},[1,6],'2026-11-14'));
  // +15 days: the 25-30 min return after a break
  const back=nextRunAfterRun(run,[1,6],'2026-11-25');
  assert.equal(back.kind,'easy');
  assert.equal(back.returnAfterBreak,true);
  assert.equal(back.date,'2026-11-29');
  assert.equal(nextRunAfterRun(run,[1,6],'2026-12-20').returnAfterBreak,true);
  // the same for an all-out 5 km test
  const test5k={date:'2026-11-10',type:'test5k',distance:5,movingSeconds:1262,effort:10};
  assert.equal(nextRunAfterRun(test5k,[1,6],'2026-11-11').kind,'rest');
  const testFour=nextRunAfterRun(test5k,[1,6],'2026-11-14');
  assert.equal(testFour.kind,'easy');
  assert.equal(testFour.date,'2026-11-17','the 5 km rule: the following week');
  assert.equal(testFour.distanceKm,2.5,'tired: the short easy run');
  const testBack=nextRunAfterRun(test5k,[1,6],'2026-11-25');
  assert.equal(testBack.returnAfterBreak,true);
  assert.equal(testBack.date,'2026-11-29');
});
