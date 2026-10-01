const {app,BrowserWindow}=require('electron');
const path=require('node:path');
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1480,height:940,webPreferences:{partition:'nutrition-test',contextIsolation:true,nodeIntegration:false}});
 try{
  win.webContents.on('console-message', event=>console.log(event.message));
  await win.loadFile(path.join(__dirname,'../src/index.html'));
  for(const width of [1480,1120,940]){
   win.setSize(width,940);
   await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
   console.log(await win.webContents.executeJavaScript(`(()=>{
    const expect=(ok,message)=>{if(!ok){console.error(message);throw Error(message)}};
    document.querySelector('[data-page="nutrition"]').click();
    const duration=document.querySelector('#nutritionMinutes');duration.value='120';duration.dispatchEvent(new Event('input',{bubbles:true}));
    expect(!document.querySelector('#nutritionResult').hidden,'Plan visible');
    for(const distance of ['6','10','21.1','42.2']){
     document.querySelector('#nutritionDistance').value=distance;document.querySelector('#nutritionDistance').dispatchEvent(new Event('change',{bubbles:true}));
     expect(document.querySelector('#nutritionTitle').textContent===VeyvoNutrition.profiles[distance].name,'Distance changes content');
    }
    document.querySelector('#nutritionTiming').value='soon';document.querySelector('#nutritionTiming').dispatchEvent(new Event('change',{bubbles:true}));
    expect(!document.querySelector('#nutritionLate').hidden,'Late long run message');
    duration.value='';duration.dispatchEvent(new Event('input',{bubbles:true}));expect(document.querySelector('#nutritionResult').hidden,'Empty time hides stale advice');
    duration.value='240';duration.dispatchEvent(new Event('input',{bubbles:true}));
    expect(document.documentElement.scrollWidth<=innerWidth,'No horizontal overflow in nutrition');
    document.querySelector('[data-page="progress"]').click();
    state.runHistory=[{date:'2026-09-20',distance:6,movingSeconds:1800,type:'Běh'},{date:'2026-09-21',type:'Chybějící údaje'}];renderAll();
    expect(document.querySelectorAll('.performance-run').length===2,'Actual history rendered');
    expect(document.querySelector('.performance-run-number').textContent.includes('Nezapsáno'),'Missing distance is not invented');
    expect(document.documentElement.scrollWidth<=innerWidth,'No horizontal overflow in performance');
    const panels=[...document.querySelectorAll('.performance-columns .panel')].map(el=>el.getBoundingClientRect());
    expect(panels[0].right<=panels[1].left||panels[0].bottom<=panels[1].top,'Performance panels do not overlap');
    return 'Nutrition and performance UI passed at '+innerWidth;
   })()`));
  }
  app.exit(0);
 }catch(error){console.error(error);app.exit(1)}
});
setTimeout(()=>{console.error('UI timeout');app.exit(1)},20000);
