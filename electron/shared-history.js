const SHARE_URL = /^https:\/\/chatgpt\.com\/share\/([0-9a-f]{8}-[0-9a-f-]{27,})\/?$/i;

function readMessages(html) {
  const chunks = [...html.matchAll(/streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g)];
  if (!chunks.length) throw new Error('Sdílený chat se nepodařilo přečíst.');
  let values;
  for (const chunk of chunks) {
    try {
      const candidate = JSON.parse(JSON.parse(chunk[1]));
      if (Array.isArray(candidate) && candidate.includes('author') && candidate.includes('content')) { values = candidate; break; }
    } catch { /* Other stream frames are not the conversation payload. */ }
  }
  if (!Array.isArray(values)) throw new Error('Neznámý formát sdíleného chatu.');
  const key = name => values.indexOf(name);
  const authorKey = `_${key('author')}`, contentKey = `_${key('content')}`;
  const roleKey = `_${key('role')}`, partsKey = `_${key('parts')}`, timeKey = `_${key('create_time')}`;
  if ([authorKey,contentKey,roleKey,partsKey,timeKey].some(item=>item==='_-1')) throw new Error('Neznámý formát zpráv.');
  const seen = new Set(), messages = [];
  for (const item of values) {
    if (!item || Array.isArray(item) || typeof item !== 'object' || !(authorKey in item) || !(contentKey in item)) continue;
    const author = values[item[authorKey]], content = values[item[contentKey]];
    const role = author && values[author[roleKey]], parts = content && values[content[partsKey]];
    const stamp = values[item[timeKey]];
    if (!['user','assistant'].includes(role) || !Array.isArray(parts) || !Number.isFinite(stamp)) continue;
    const text = parts.map(index => values[index]).filter(part => typeof part === 'string').join(' ').trim();
    if (!text) continue;
    const date = new Date(stamp * 1000).toISOString().slice(0,10);
    const id = role + ':' + stamp + ':' + text;
    if (seen.has(id)) continue;
    seen.add(id);
    messages.push({role,date,time:stamp,text,hasAttachment:parts.length > 1});
  }
  return messages.sort((a,b)=>a.time-b.time);
}

function extractHistory(html) {
  const messages = readMessages(html);
  const runs = [], milestones = [];
  const addRun = (date, distance, duration, heartRate, effort) => {
    const km = Number(distance.replace(',','.'));
    const [minutes, seconds] = duration.split(':').map(Number);
    const movingSeconds = minutes * 60 + seconds;
    if (!(km > 0 && km < 100 && movingSeconds > 0)) return;
    const id = `chatgpt-${date}-${km}-${movingSeconds}`;
    if (!runs.some(run=>run.id===id)) runs.push({id,source:'chatgpt',date:date+'T12:00:00',type:'Běh',distance:km,time:duration,movingSeconds,averageHeartrate:heartRate || null,effort:effort || null,effortRecorded:!!effort,note:'Import ze sdíleného tréninkového chatu'});
  };
  const addMilestone = (date, label) => {
    const id = `chatgpt-${date}-${label}`;
    if (!milestones.some(entry=>entry.id===id)) milestones.push({id,date,label});
  };
  for (let i=0;i<messages.length;i++) {
    const message=messages[i];
    if (message.role !== 'user') continue;
    const benchmark=message.text.match(/\b(?:1\s*)?km\s+zab[eě]hnu\s+za\s+(\d{1,2}:\d{2})/i);
    if(benchmark)addMilestone(message.date,`Rychlý 1 km: ${benchmark[1]} (datum výkonu není uvedeno)`);
    if(/bol[ií]\s+koleno.*c[ií]t[ií]m\s+t[rř][ií]slo/i.test(message.text))addMilestone(message.date,'Při běhu jsi hlásil bolest kolene a tah v třísle');
    if(message.text.trim()==='Vubec jsem nic necitil')addMilestone(message.date,'Po návratovém běhu jsi nehlásil bolest kolene ani třísla');
    if(/po zrenink a behem uplne vpohode/i.test(message.text))addMilestone(message.date,'Po intervalech a během nich ses cítil dobře');
    if (!message.hasAttachment || !/dne[sš]n[ií] b[eě]h|today.s run|tady je dne[sš]n[ií] b[eě]h|tneska to byl chill/i.test(message.text)) continue;
    const reply = messages.slice(i+1).find(item=>item.role==='assistant' && item.time-message.time < 180 && item.time>=message.time);
    if (!reply) continue;
    const text=reply.text;
    let match=text.match(/(?:Dne[sš]ek|Dnes):\s*\*{0,2}(\d+[,.]\d+)\s*km\s*\/\s*(\d{1,3}:\d{2})/i);
    if (match) {
      const effort=messages.slice(i+1).find(item=>item.role==='user' && item.date===message.date && item.time-message.time<600 && /^(?:[1-9]|10)$/.test(item.text.trim()))?.text.trim();
      addRun(message.date,match[1],match[2],Number(text.match(/pr[uů]m[eě]rn[yý]\s*tep\s*(\d{2,3})/i)?.[1])||null,Number(effort)||null);
    }
    match=text.match(/Dal jsi\s*\*{0,2}(\d{1,3}:\d{2})\s*\/\s*(\d+[,.]\d+)\s*km/i);
    if (match) addRun(message.date,match[2],match[1],Number(text.match(/(\d{2,3})\s*bpm/i)?.[1])||null,null);
    match=text.match(/(?:cca|asi)\s*\*{0,2}(\d{1,3}:\d{2})\*{0,2}/i);
    if (match && !runs.some(run=>run.date.startsWith(message.date))) addMilestone(message.date,`Lehký běh ${match[1]}; vzdálenost v chatu není ověřená`);
    match=text.match(/(?:Tvoje|Tv[eé])\s+(\d+)\s*[×x]\s*400\s*m/i);
    if (match) addMilestone(message.date,`${match[1]}×400 m intervaly; celková vzdálenost v chatu není ověřená`);
    match=text.match(/hlavn[ií]\s*400m\s*[uú]seky[^:]*:\s*\*{0,2}([\d:\s→-]+)/i);
    if (match) addMilestone(message.date,`400 m intervaly (${match[1].trim()}); celková vzdálenost v chatu není ověřená`);
  }
  runs.sort((a,b)=>a.date.localeCompare(b.date));
  milestones.sort((a,b)=>a.date.localeCompare(b.date));
  return {runs,milestones,preferences:{goalDistanceKm:5,targetSeconds:1200,days:[0,1,3,5,6]},messageCount:messages.length};
}

async function fetchSharedHistory(url) {
  if (typeof url !== 'string' || !SHARE_URL.test(url.trim())) throw new Error('Vlož platný odkaz chatgpt.com/share.');
  const response = await fetch(url.trim(), {signal:AbortSignal.timeout(15000),headers:{'User-Agent':'VEYVO/0.3'}});
  if (!response.ok) throw new Error(`Sdílený chat není dostupný (${response.status}).`);
  const html = await response.text();
  if (html.length > 10_000_000) throw new Error('Sdílený chat je příliš velký.');
  return extractHistory(html);
}

module.exports={readMessages,extractHistory,fetchSharedHistory};
