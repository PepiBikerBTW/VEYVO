const {test}=require('node:test');
const assert=require('node:assert/strict');
const {guide}=require('../src/nutrition-context');
test('all requested distances have distinct preparation',()=>{const plans=[6,10,21.1,42.2].map(d=>guide(d,120,'meal'));assert.equal(new Set(plans.map(p=>p.prep)).size,4);});
test('fuelling follows duration, not distance',()=>{assert.match(guide(10,40,'meal').fuel,/nejsou potřeba/);assert.match(guide(6,100,'meal').fuel,/30–60/);assert.match(guide(42.2,240,'meal').fuel,/až 90/);});
test('duration boundaries',()=>{assert.match(guide(6,45,'snack').fuel,/malé množství/);assert.match(guide(10,75,'snack').fuel,/malé množství/);assert.match(guide(10,76,'snack').fuel,/30–60/);assert.match(guide(21.1,150,'snack').fuel,/30–60/);assert.match(guide(21.1,151,'snack').fuel,/až 90/);});
test('late start changes meal and flags long runs',()=>{assert.equal(guide(21.1,120,'soon').lateLongRun,true);assert.equal(guide(6,35,'soon').lateLongRun,false);assert.notEqual(guide(10,60,'meal').meal.title,guide(10,60,'snack').meal.title);});
test('invalid input never produces a plan',()=>{for(const n of [0,9,721,NaN,Infinity,'60',null])assert.throws(()=>guide(6,n,'meal'),RangeError);assert.throws(()=>guide(5,40,'meal'));assert.throws(()=>guide(6,40,'unknown'));});

const {timeline,fuelBudget}=require('../src/nutrition-context');
test('timeline works across midnight and rejects malformed time',()=>{assert.equal(timeline('02:30')[0].time,'22:30 (předchozí den) až 00:30');assert.equal(timeline('09:00')[0].time,'05:00 až 07:00');for(const input of ['24:00','09:60','','no'])assert.throws(()=>timeline(input),RangeError);});
test('fuel calculator adds whole-run grams and rounds supplies up',()=>{assert.deepEqual(fuelBudget(120,30,25),{grams:60,servings:3});assert.deepEqual(fuelBudget(240,60,30),{grams:240,servings:8});});
test('calculator rejects excessive targets and invalid servings',()=>{for(const args of [[60,30,25],[120,90,25],[180,100,25],[180,60,0],[NaN,30,25]])assert.throws(()=>fuelBudget(...args),RangeError);});
