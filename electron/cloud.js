const {BrowserWindow,session,app}=require('electron');
const fs=require('fs'),path=require('path');
const ORIGIN='https://veyvo-coach-pepa.j-kozisek.chatgpt.site';
function createCloud(){
 let loginWindow=null;
 const file=()=>path.join(app.getPath('userData'),'cloud-linked.json');
 const enabled=()=>{try{return JSON.parse(fs.readFileSync(file(),'utf8')).enabled===true;}catch{return false;}};
 const ses=()=>session.fromPartition('persist:veyvo-cloud');
 async function request(body){let r;try{r=await ses().fetch(ORIGIN+'/api/state',{method:body?'POST':'GET',credentials:'include',redirect:'error',headers:body?{'Content-Type':'application/json','Origin':ORIGIN}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(65000)});}catch{throw Error('Cloud není dostupný. Zkontroluj internet nebo se znovu přihlas v Nastavení → Synchronizace.');}
 if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Přihlas se ke společnému účtu v Nastavení → Synchronizace.');
 const data=await r.json();if(!r.ok)throw Error(data.error||'Synchronizace selhala.');return data;
 }
 async function connect(){if(loginWindow&&!loginWindow.isDestroyed()){loginWindow.focus();return;}
 loginWindow=new BrowserWindow({width:1040,height:820,title:'Přihlášení ke společnému účtu VEYVO',webPreferences:{partition:'persist:veyvo-cloud',contextIsolation:true,nodeIntegration:false,sandbox:true}});
 loginWindow.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://')){loginWindow.loadURL(url); }return {action:'deny'};});
 loginWindow.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('https://'))event.preventDefault();});
 loginWindow.on('closed',()=>{loginWindow=null;});
 fs.writeFileSync(file(),JSON.stringify({enabled:true}));await loginWindow.loadURL(ORIGIN+'/signin-with-chatgpt?return_to=/');
 }
 return {enabled,request,connect,async disconnect(){fs.writeFileSync(file(),JSON.stringify({enabled:false}));if(loginWindow&&!loginWindow.isDestroyed())loginWindow.close();await ses().clearStorageData();return {enabled:false};},async status(){if(!enabled())return {enabled:false};try{const data=await request();return {enabled:true,connected:true,data};}catch(error){return {enabled:true,connected:false,error:error.message};}}};
}
module.exports={createCloud};
