(function(root){
  const DAY=86400000;
  function dateKey(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
  function weekStart(date){const day=new Date(date.getFullYear(),date.getMonth(),date.getDate());day.setDate(day.getDate()-(day.getDay()+6)%7);return day}
  function weekDays(date,offset=0){const monday=weekStart(date);monday.setDate(monday.getDate()+offset*7);return Array.from({length:7},(_,index)=>{const day=new Date(monday);day.setDate(monday.getDate()+index);return dateKey(day)})}
  function entriesForDay(date,{runs=[],milestones=[],availableDays=[],nextRun=null,plannedDescription=null,today=dateKey(new Date())}={}){
    const day=new Date(date+'T12:00:00');
    const completed=runs.filter(run=>String(run.date).slice(0,10)===date).map(run=>({kind:'run',title:run.type||'Běh',detail:`${run.distance} km · ${run.time||''}`.trim()}));
    const notes=milestones.filter(item=>item.date===date).map(item=>({kind:'milestone',title:item.label,detail:'Dřívější záznam'}));
    if(completed.length||notes.length)return [...completed,...notes];
    if(nextRun?.kind==='easy'&&nextRun.date===date)return [{kind:'planned',title:'Lehký běh',detail:plannedDescription||`${nextRun.distanceKm} km lehce · po doběhu zapiš výsledek`}];
    if(date<today)return [{kind:'unlogged',title:'Bez záznamu',detail:'Pokud jsi běžel, můžeš běh doplnit'}];
    if(!availableDays.includes((day.getDay()+6)%7))return [{kind:'rest',title:'Volno',detail:'Tento den nemůžeš běhat'}];
    return [{kind:'pending',title:'Další plán po výsledku běhu',detail:'Trénink se upřesní podle času a pocitu'}];
  }
  const api={dateKey,weekStart,weekDays,entriesForDay};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VeyvoCalendar=api;
})(globalThis);
