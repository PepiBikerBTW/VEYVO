const test=require('node:test');
const assert=require('node:assert/strict');
const {extractHistory}=require('../electron/shared-history');

function fixture(){
 const values=[];
 const ref=value=>{values.push(value);return values.length-1};
 const keys=Object.fromEntries(['author','content','role','parts','create_time'].map(name=>[name,ref(name)]));
 const message=(role,date,text,attachment=false)=>{
  const author=ref({[`_${keys.role}`]:ref(role)});
  const parts=ref(attachment?[ref(text),ref({image:true})]:[ref(text)]);
  const content=ref({[`_${keys.parts}`]:parts});
  ref({[`_${keys.author}`]:author,[`_${keys.content}`]:content,[`_${keys.create_time}`]:ref(Date.parse(date)/1000)});
 };
 message('assistant','2026-09-05T10:00:00Z','Zítra dej 6 km za 40:00.');
 message('user','2026-09-06T10:00:00Z','Tady je dnešní běh',true);
 message('assistant','2026-09-06T10:00:01Z','Dnešek: 6,28 km / 40:00 / průměrný tep 168 bpm.');
 message('user','2026-09-06T10:01:00Z','3');
 return `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(JSON.stringify(values))})</script>`;
}

test('shared chat imports a confirmed run and ignores planned workouts',()=>{
 const result=extractHistory(fixture());
 assert.equal(result.runs.length,1);
 assert.equal(result.runs[0].distance,6.28);
 assert.equal(result.runs[0].movingSeconds,2400);
 assert.equal(result.runs[0].effort,3);
 assert.equal(result.runs[0].averageHeartrate,168);
});
