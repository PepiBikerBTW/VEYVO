import assert from 'node:assert/strict';import http from 'node:http';
async function fetch(url,options){return new Promise((resolve,reject)=>{const request=http.request(url,options,response=>{let text='';response.setEncoding('utf8');response.on('data',c=>text+=c);response.on('end',()=>resolve({status:response.statusCode,json:async()=>JSON.parse(text)}));});request.on('error',reject);request.end(options.body);});}
const base='http://127.0.0.1:3001/api/state',id='test-'+crypto.randomUUID();
async function req(user=id,body,origin){const r=await fetch(base,{method:body?'POST':'GET',headers:{Connection:'close',...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':'test@example.test'}:{}),...(body?{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(JSON.stringify(body)))}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
assert.equal((await req(null)).status,401);
const first=await req();assert.equal(first.status,200);assert.equal(first.data.configured,false);assert.equal('secret' in first.data,false);
const body={action:'run',revision:first.data.revision,run:{date:'2026-09-01',distance:5,movingSeconds:1800}};

const saved=await req(id,body);assert.equal(saved.status,200);assert.equal(saved.data.runs.length,1);
assert.equal((await req(id,body)).status,409);
assert.equal((await req(id+'-other')).data.runs.length,0);
const again=await req();assert.equal(again.data.runs.length,1);
const invalid=await req(id,{action:'run',revision:again.data.revision,run:{date:'2099-01-01',distance:5,movingSeconds:100}});assert.equal(invalid.status,400);assert.equal((await req()).data.runs.length,1);
const imported=await req(id,{action:'import',revision:again.data.revision,data:{runs:again.data.runs}});assert.equal(imported.data.runs.length,1);
assert.equal((await req(id,{action:'chat',revision:imported.data.revision,message:'Ahoj'})).status,400);
console.log('API passed: authentication, owner isolation, persistence, stale revision, CSRF, validation, import deduplication, missing key');

const snapshot={accountId:id,runs:imported.data.runs,profile:imported.data.profile,baseline:{runs:structuredClone(imported.data.runs),profile:imported.data.profile}};
const noop=await req(id,{action:'desktopSync',revision:imported.data.revision,snapshot});assert.equal(noop.status,200);assert.equal(noop.data.revision,imported.data.revision);
const withRun=structuredClone(snapshot);withRun.runs.push({...withRun.runs[0],id:'desktop-second',date:'2026-09-02'});
const synced=await req(id,{action:'desktopSync',revision:noop.data.revision,snapshot:withRun});assert.equal(synced.status,200);assert.equal(synced.data.runs.length,2);
assert.equal((await req()).data.runs.length,2);
console.log('Desktop API passed: authenticated merge, persistence, no-op revision stability');
assert.equal((await req(id,body,'https://evil.example')).status,403);