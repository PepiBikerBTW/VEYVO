import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { db } from '@/lib/db';
import { mergeDesktop, defaultData, localTime, runInput, profileInput, nvidia, planMessages, parsePlan, chatMessages, monday } from '@/lib/domain.mjs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function account(userId:string){const database=db();await database.prepare('INSERT OR IGNORE INTO accounts(user_id,data) VALUES(?,?)').bind(userId,JSON.stringify(defaultData())).run();return await database.prepare('SELECT * FROM accounts WHERE user_id=?').bind(userId).first<any>();}
const view=(row:any)=>({accountId:row.user_id,currentDate:localTime(JSON.parse(row.data).timeZone).date,...JSON.parse(row.data),revision:row.revision,configured:!!row.secret});
async function crypt(value:string,userId:string,decrypt=false){
 const secret=(env as unknown as {KEY_ENCRYPTION_SECRET?:string}).KEY_ENCRYPTION_SECRET;
 if(!secret)throw Error('Server zatím nemá nastavené šifrování API klíče.');
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);
 const aad=new TextEncoder().encode(userId);
 if(decrypt){const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:aad},key,bytes.slice(12)));}
 const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(value)));return btoa(String.fromCharCode(...iv,...encrypted));
}
export async function GET(){const user=await getChatGPTUser();if(!user)return json({error:'Přihlas se znovu.'},401);try{return json(view(await account(user.userId)));}catch{return json({error:'Data se nepodařilo načíst. Zkus obnovit stránku.'},503);}}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return json({error:'Přihlas se znovu.'},401);
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Neplatný původ požadavku.'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Neplatný požadavek.'},400);
 let token:string|null=null;
 try{
 const text=await request.text();if(text.length>800000)return json({error:'Soubor je příliš velký.'},413);
 const body=JSON.parse(text),row=await account(user.userId),data=JSON.parse(row.data),now=new Date(),today=localTime(data.timeZone,now).date;
 if(body.revision!==row.revision)return json({error:'Data byla změněna na jiném zařízení. Obnovili jsme je; akci zopakuj.'},409);
 let secret=row.secret;
 const action=body.action;
 if(action==='desktopSync'){const merged=mergeDesktop(data,body.snapshot);if(JSON.stringify(merged)===row.data)return json(view(row));Object.assign(data,merged);
 }else if(action==='run'){
 const run=runInput(body.run,today);if(data.runs.some((r:any)=>r.id===run.id))return json(view(row));
 if(data.runs.length>=2000)throw Error('Historie už má 2000 běhů.');data.runs.push(run);
 }else if(action==='deleteRun'){if(typeof body.id!=='string')throw Error('Neplatný běh.');data.runs=data.runs.filter((r:any)=>r.id!==body.id);
 }else if(action==='profile'){data.profile=profileInput(body.profile);localTime(body.timeZone);data.timeZone=body.timeZone;data.automatic=body.automatic===true;
 }else if(action==='import'){
 const source=body.data?.state||body.data;if(!source||!Array.isArray(source.runHistory??source.runs))throw Error('Vyber export běhů z VEYVO.');
 const incoming=source.runHistory??source.runs;if(incoming.length>2000)throw Error('Lze importovat nejvýše 2000 běhů.');
 const runs=incoming.map((r:any)=>runInput(r,today));
 for(const run of runs)if(!data.runs.some((r:any)=>r.id===run.id||(r.date===run.date&&Math.abs(r.distance-run.distance)<0.15&&Math.abs(r.movingSeconds-run.movingSeconds)<60)))data.runs.push(run);
 if(data.runs.length>2000)throw Error('Historie by překročila 2000 běhů.');if(source.profile)data.profile=profileInput(source.profile);
 }else if(action==='clearChat'){data.chat=[];
 }else if(action==='disconnect'){secret=null;data.consent=false;data.automatic=false;
 }else if(['connect','chat','plan','autoPlan'].includes(action)){
 if(action==='connect'&&(typeof body.key!=='string'||!/^nvapi-[A-Za-z0-9_-]{20,250}$/.test(body.key.trim())||body.consent!==true))throw Error('Vlož celý NVIDIA API klíč a potvrď souhlas.');
 if(action!=='connect'&&(!secret||!data.consent))throw Error('Nejdřív připoj NVIDIA v Nastavení.');
 if(action==='chat'&&(typeof body.message!=='string'||!body.message.trim()||body.message.length>6000))throw Error('Zpráva musí mít 1–6000 znaků.');
 const fingerprint=JSON.stringify({week:monday(today),date:today,profile:data.profile,runs:data.runs});
 if(action==='autoPlan'&&(!data.automatic||data.lastAttempt?.fingerprint===fingerprint&&(data.lastAttempt.ok||Date.now()-data.lastAttempt.at<1800000)))return json(view(row));
 token=crypto.randomUUID();const lock=await db().prepare('UPDATE accounts SET lease=?,lease_until=? WHERE user_id=? AND revision=? AND lease_until<?').bind(token,Date.now()+70000,user.userId,row.revision,Date.now()).run();
 if(!lock.meta.changes)return json({error:'Jiný AI požadavek právě probíhá. Zkus to za chvíli.'},409);
 const key=action==='connect'?body.key.trim():await crypt(secret,user.userId,true);
 if(action==='connect'){await nvidia(key,[{role:'user',content:'Reply OK.'}]);secret=await crypt(key,user.userId);data.consent=true;
 }else if(action==='chat'){const answer=await nvidia(key,chatMessages(data,body.message,now));data.chat=[...data.chat,{role:'user',content:body.message.trim()},{role:'assistant',content:answer}].slice(-40);
 }else{
 try{const answer=await nvidia(key,planMessages(data,now),true),plan=parsePlan(answer,data,now);if(localTime(data.timeZone).date!==today)throw Error('Začal nový den. Vytvoř plán znovu.');data.plans[plan.week]=plan;data.plans=Object.fromEntries(Object.entries(data.plans).sort(([a],[b])=>b.localeCompare(a)).slice(0,12));data.lastAttempt={fingerprint,at:Date.now(),ok:true};}
 catch(error){data.lastAttempt={fingerprint,at:Date.now(),ok:false};await db().prepare('UPDATE accounts SET data=?,revision=revision+1 WHERE user_id=? AND revision=? AND lease=?').bind(JSON.stringify(data),user.userId,row.revision,token).run();throw error;}
 }
 }else throw Error('Neznámá akce.');
 const saved=await db().prepare('UPDATE accounts SET data=?,secret=?,revision=revision+1 WHERE user_id=? AND revision=?').bind(JSON.stringify(data),secret,user.userId,row.revision).run();
 if(!saved.meta.changes)return json({error:'Mezitím se změnila data. Obnovili jsme je; akci zopakuj.'},409);
 return json(view(await account(user.userId)));
 }catch(error){const message=error instanceof Error?error.message:'';const safe=message&&!/SQLITE|D1_|decrypt|encrypt|JSON|Unexpected|fetch|binding/i.test(message)?message:'Akci se nepodařilo dokončit. Zkus to znovu.';return json({error:safe},400);
 }finally{if(token)await db().prepare('UPDATE accounts SET lease=NULL,lease_until=0 WHERE user_id=? AND lease=?').bind(user.userId,token).run();}
}
