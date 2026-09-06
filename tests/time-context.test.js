const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.TZ = 'Europe/Prague';
const time = require('../src/time-context');
const planStart = new Date(2026,8,7);
const baseWorkouts = ['Rest','Easy','Tempo','Recovery','Intervals','Rest','Long'].map(name=>['',name,'details']);
const options = {planStart,baseWorkouts,weekPlans:{},language:'cs',now:new Date(2026,8,6,23,59)};
test('clock and calendar questions bypass sleep replies',()=>{
  assert.match(time.answer('Kolik je hodin?',options),/23:59.*Europe\/Prague/);
  assert.match(time.answer('Co je dnes za den?',options),/neděle.*2026/);
  assert.match(time.answer('Jaké je dnes datum?',options),/6/);
  assert.equal(time.answer('Spal jsem jen 5 hodin',options),null);
  assert.equal(time.answer('I slept only 5 hours',options),null);
});
test('relative dates use calendar days and actual plan availability',()=>{
  assert.match(time.answer('Co mám dnes za trénink?',options),/začátku/);
  assert.match(time.answer('Co mám zítra za trénink?',options),/pondělí.*1\. týden: Rest/);
  assert.match(time.answer('Co mám dnes za trénink?',{...options,now:new Date(2026,8,8)}),/Easy/);
  assert.match(time.answer('Jaký trénink mám dnes?',{...options,now:new Date(2026,8,14)}),/není připravený/);
  assert.match(time.describePlan(new Date(2026,10,16),planStart,{},baseWorkouts),/skončil/);
});
test('fresh clock, greeting, language and year rollover',()=>{
  assert.match(time.context(new Date(2026,8,7,8)).greeting,/ráno/);
  assert.match(time.context(new Date(2026,8,7,15)).greeting,/odpoledne/);
  assert.match(time.context(new Date(2026,8,7,21)).greeting,/večer/);
  assert.match(time.answer('What day is tomorrow?',{...options,language:'en',now:new Date(2026,11,31,23,59)}),/Friday.*2027/);
  assert.match(time.answer('What time is it?',{...options,language:'en',now:new Date(2026,8,7,0,1)}),/00:01/);
});
test('calendar arithmetic survives both daylight-saving transitions',()=>{
  assert.equal(time.dayDifference(new Date(2026,2,30),new Date(2026,2,29)),1);
  assert.equal(time.dayDifference(new Date(2026,9,26),new Date(2026,9,25)),1);
  assert.match(time.describePlan(new Date(2026,9,26),planStart,{'8':baseWorkouts},baseWorkouts),/8\. týden: Rest/);
});
