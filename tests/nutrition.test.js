const {test}=require('node:test');
const assert=require('node:assert/strict');
const {guide}=require('../src/nutrition-context');
test('all requested distances have distinct preparation',()=>{const plans=[6,10,21.1,42.2].map(d=>guide(d,120,'meal'));assert.equal(new Set(plans.map(p=>p.prep)).size,4);});
test('fuelling follows duration, not distance',()=>{assert.match(guide(10,40,'meal').fuel,/nejsou potřeba/);assert.match(guide(6,100,'meal').fuel,/30–60/);assert.match(guide(42.2,240,'meal').fuel,/až 90/);});
test('duration boundaries',()=>{assert.match(guide(6,45,'snack').fuel,/malé množství/);assert.match(guide(10,75,'snack').fuel,/malé množství/);assert.match(guide(10,76,'snack').fuel,/30–60/);assert.match(guide(21.1,150,'snack').fuel,/30–60/);assert.match(guide(21.1,151,'snack').fuel,/až 90/);});
test('late start changes meal and flags long runs',()=>{assert.equal(guide(21.1,120,'soon').lateLongRun,true);assert.equal(guide(6,35,'soon').lateLongRun,false);assert.notEqual(guide(10,60,'meal').meal.title,guide(10,60,'snack').meal.title);});
test('invalid input never produces a plan',()=>{for(const n of [0,9,721,NaN,Infinity,'60',null])assert.throws(()=>guide(6,n,'meal'),RangeError);assert.throws(()=>guide(5,40,'meal'));assert.throws(()=>guide(6,40,'unknown'));});
