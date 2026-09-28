const {app,BrowserWindow}=require('electron');
const path=require('node:path');
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1120,height:720,webPreferences:{partition:'journal-test',contextIsolation:true,nodeIntegration:false}});
  try{
    await win.loadFile(path.join(__dirname,'../src/index.html'));
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const expect=(value,message)=>{if(!value)throw Error(message)};
      const drag=document.querySelector('.window-drag-region'),bounds=drag.getBoundingClientRect();
      expect(getComputedStyle(drag).getPropertyValue('-webkit-app-region')==='drag'&&bounds.top===0&&bounds.height===42,'Top strip is draggable');
      expect(document.elementFromPoint(10,10)===drag&&document.elementFromPoint(innerWidth-10,10)!==drag,'Window controls remain clear');
      expect(/^\\d{2}:\\d{2}$/.test(document.querySelector('#localClock').textContent),'Clock rendered');
      expect(!document.querySelector('#baselineIntro').hidden,'First-run prompt visible');
      document.querySelector('#startBaseline').click();
      expect(document.querySelector('#logDistance').readOnly&&document.querySelector('#logDistance').value==='5','5 km baseline selected');
      document.querySelector('#logTime').value='30:00';
      document.querySelector('#effort').value='6';
      document.querySelector('#saveLog').click();
      expect(state.runHistory.length===1&&state.runHistory[0].type==='Test 5 km','Baseline saved');
      expect(!document.querySelector('#nextRunIntro').hidden,'Next run shown');
      expect(document.querySelector('#progressCount').textContent==='1','Progress updated');
      expect(!document.querySelector('#exportRuns').hidden,'Local export available');
      return 'UI passed: drag strip, clock, 5 km onboarding, next run, progress, export';
    })()`);
    console.log(result);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
setTimeout(()=>{console.error('UI test timeout');app.exit(1)},20000);
