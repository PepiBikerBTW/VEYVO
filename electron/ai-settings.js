const fs=require('node:fs');
const {DEFAULT_MODEL}=require('./ai');
function createSettingsStore({file,safeStorage}) {
  function read(){
    if(!fs.existsSync(file))return null;
    if(!safeStorage.isEncryptionAvailable())throw Error('Systémové šifrování není dostupné.');
    try{return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}
    catch{throw Error('Uložené AI připojení nelze přečíst. Odpoj ho a zadej klíč znovu.');}
  }
  function status(){const settings=read();return {configured:Boolean(settings?.apiKey&&settings.consent),model:settings?.model||DEFAULT_MODEL,automatic:settings?.automatic===true};}
  function candidate(input){
    if(!input||input.consent!==true)throw Error('Potvrď odesílání tréninkových dat do OpenAI.');
    const apiKey=typeof input.apiKey==='string'&&input.apiKey.trim()?input.apiKey.trim():read()?.apiKey;
    const model=String(input.model||DEFAULT_MODEL).trim();
    if(typeof apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,500}$/.test(apiKey))throw Error('Zadej platný OpenAI API klíč.');
    if(!/^[A-Za-z0-9._:-]{1,100}$/.test(model))throw Error('Zadej platný název modelu.');
    if(!safeStorage.isEncryptionAvailable())throw Error('Systémové šifrování není dostupné. Klíč nelze bezpečně uložit.');
    return {apiKey,model,consent:true,automatic:input.automatic===true};
  }
  function write(settings){
    if(!safeStorage.isEncryptionAvailable())throw Error('Systémové šifrování není dostupné.');
    fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(settings)));
    fs.renameSync(file+'.tmp',file);
    return status();
  }
  function disconnect(){
    for(const target of [file,file+'.tmp'])if(fs.existsSync(target))fs.unlinkSync(target);
    return {configured:false,model:DEFAULT_MODEL,automatic:false};
  }
  return {read,status,candidate,write,disconnect};
}
module.exports={createSettingsStore};
