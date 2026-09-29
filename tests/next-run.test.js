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
  const next=nextRunAfterRun(run,[1,2,4,6],'2026-09-29');
  assert.equal(next.date,'2026-09-30');
  assert.equal(next.returnAfterBreak,true);
  assert.equal(next.durationMin,25);
  assert.equal(next.durationMax,30);
  assert.equal(next.paceFast,null);
});
