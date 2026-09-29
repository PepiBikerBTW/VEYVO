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
      expect(!document.querySelector('#historyIntro').hidden,'Continue-journey prompt visible');
      expect(!document.querySelector('#baselineIntro'),'Old 5 km onboarding removed');
      expect(document.querySelectorAll('.calendar-day').length===7,'Weekly calendar rendered');
      document.querySelector('#quickLog').click();
      expect(!document.querySelector('#logDistance').readOnly&&document.querySelector('#logDistance').value==='','Open run log without forced 5 km');
      document.querySelector('#logDistance').value='3.31';
      document.querySelector('#logTime').value='25:37';
      document.querySelector('#effort').value='6';
      document.querySelector('#saveLog').click();
      expect(state.runHistory.length===1&&state.runHistory[0].type==='Běh','Run saved');
      expect(!document.querySelector('#nextRunIntro').hidden,'Next run shown');
      expect(document.querySelector('#planPage').classList.contains('active'),'Plan page opens after first run');
      expect(document.querySelector('.calendar-day.run'),'Completed run appears in calendar');
      expect(document.querySelector('#progressCount').textContent==='1','Progress updated');
      expect(!document.querySelector('#exportRuns'),'Data export card removed');
      expect(!document.querySelector('#sharedChatUrl'),'Chat import card removed');
      expect(!document.querySelector('#goalDistance'),'Goal settings card removed');
      const oldDate=new Date();oldDate.setDate(oldDate.getDate()-14);
      state.runHistory=[{date:VeyvoTraining.dateKey(oldDate)+'T12:00:00',type:'Běh',distance:6.17,movingSeconds:2570,effort:null}];
      renderAll();
      expect(document.querySelector('#nextRunTitle').textContent.includes('25–30 min lehký návrat'),'Return run shown after a two-week gap');
      expect(document.querySelector('#nextRunText').textContent.includes('náročnost 2–3/10'),'Easy effort shown for return run');
      state.stravaConnected=true;renderStravaState();
      expect(document.querySelector('#settingsOpenStrava').textContent==='Připojeno','Connected Strava button label');
      state.stravaConnected=false;renderStravaState();
      expect(document.querySelector('#settingsOpenStrava').textContent==='Nastavit propojení Stravy','Disconnected Strava button label');
      return 'UI passed: drag strip, clock, calendar, run log, progress, simple settings';
    })()`);
    console.log(result);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
setTimeout(()=>{console.error('UI test timeout');app.exit(1)},20000);
