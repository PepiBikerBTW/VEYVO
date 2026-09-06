const {app,BrowserWindow}=require('electron');
const path=require('node:path');
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1120,height:720,webPreferences:{partition:'time-test',contextIsolation:true,nodeIntegration:false}});
  try{
    await win.loadFile(path.join(__dirname,'../src/index.html'));
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const expect=(value,message)=>{if(!value)throw Error(message)};
      expect(/^\\d{2}:\\d{2}$/.test($('#localClock').textContent),'Clock rendered');
      const RealDate=Date;
      let now=new RealDate(2026,8,6,23,59);
      window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now.getTime()]))}static now(){return now.getTime()}};
      state.language='cs'; refreshCalendar();
      expect($('#todayWorkout').textContent.includes('začátku'),'Before plan');
      now=new RealDate(2026,8,7,0,1);refreshCalendar();
      expect($('#pageEyebrow').textContent.includes('PONDĚLÍ'),'Midnight header');
      expect($('#todayWorkout').textContent.includes('Regenerace'),'Monday workout');
      expect($('.day-row.today .day-date b').textContent==='07','Calendar today');
      go('coach');await new Promise(r=>setTimeout(r,20));
      now=new RealDate(2026,8,8,8,15);refreshCalendar();
      expect($('#pageTitle').textContent==='Na co dnes myslíš?','Keep coach heading');
      sendCoachMessage('Kolik je hodin?');await new Promise(r=>setTimeout(r,500));
      expect($('#messages').lastElementChild.textContent.includes('08:15'),'Clock answer');
      sendCoachMessage('Spal jsem jen 5 hodin');await new Promise(r=>setTimeout(r,500));
      expect($('#messages').lastElementChild.textContent.includes('spánku'),'Sleep answer');
      state.language='en';applyLanguage();go('home');await new Promise(r=>setTimeout(r,20));
      expect($('#pageTitle').textContent==='Good morning, Pepa.','English greeting');
      expect($('#pageEyebrow').textContent.includes('TUESDAY'),'English date');
      expect(!$('#startWorkout').hidden,'Running day action');
      return 'UI passed: clock, midnight, calendar, coach, language, workout';
    })()`);
    console.log(result);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
setTimeout(()=>{console.error('UI test timeout');app.exit(1)},20000);
