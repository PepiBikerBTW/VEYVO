const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');

let installRequests=0;
ipcMain.handle('app-version',()=> '0.3.6');
ipcMain.handle('strava-status',()=>({connected:false}));
ipcMain.handle('updater-install',()=>{installRequests++;return true});
ipcMain.handle('updater-check',()=>true);
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1120,height:720,webPreferences:{partition:'update-ui-test',preload:path.join(__dirname,'../electron/preload.js'),contextIsolation:true,nodeIntegration:false}});
 try{
  await win.loadFile(path.join(__dirname,'../src/index.html'));
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#installedVersion').textContent"),'v0.3.6');
  win.webContents.send('updater-status',{type:'progress',percent:42});
  await new Promise(resolve=>setTimeout(resolve,50));
  const progress=await win.webContents.executeJavaScript("({title:document.querySelector('#updateStatusTitle').textContent,width:document.querySelector('#updateProgressBar').style.width,disabled:document.querySelector('#checkUpdates').disabled})");
  assert.deepEqual(progress,{title:'Stahuji aktualizaci',width:'42%',disabled:true});
  win.webContents.send('updater-status',{type:'ready',version:'0.3.7'});
  await new Promise(resolve=>setTimeout(resolve,50));
  const ready=await win.webContents.executeJavaScript("({text:document.querySelector('#checkUpdates').textContent,disabled:document.querySelector('#checkUpdates').disabled})");
  assert.match(ready.text,/Restartovat a aktualizovat/);
  assert.equal(ready.disabled,false);
  await win.webContents.executeJavaScript("document.querySelector('#checkUpdates').click()");
  assert.equal(installRequests,1);
  console.log('Update UI passed: version, download progress, restart action');app.exit(0);
 }catch(error){console.error(error);app.exit(1)}
});
setTimeout(()=>{console.error('Update UI timeout');app.exit(1)},20000);
