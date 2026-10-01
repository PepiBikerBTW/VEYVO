(()=>{
 const $=id=>document.getElementById(id),key='veyvo-pre-run-v1';
 const fields=['nutritionDistance','nutritionMinutes','nutritionTiming','nutritionStart','nutritionRate','nutritionServing','nutritionNotes'];
 const checks=[['meal','Jídlo před během mám naplánované a vyzkoušené.'],['drink','Vím, kde doplním pití nebo si ho vezmu s sebou.'],['fuel','Pro dlouhý běh mám připravené vyzkoušené občerstvení.'],['route','Mám trasu, počasí a možnost návratu zkontrolované.'],['gear','Mám vhodné boty, oblečení, telefon a klíče.']];
 let saved={};
 try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{$('nutritionSaved').textContent='Uloženou přípravu se nepodařilo načíst. Zadej ji znovu.';}
 for(const id of fields){if(typeof saved[id]==='string')$(id).value=saved[id];}
 if(!$('nutritionDistance').value)$('nutritionDistance').value='6';
 if(!$('nutritionTiming').value)$('nutritionTiming').value='meal';
 for(const [id,text] of checks){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='checkbox';input.dataset.check=id;input.checked=saved.checks?.[id]===true;span.textContent=text;label.append(input,span);$('nutritionChecklist').append(label);}
 function persist(){
  const data=Object.fromEntries(fields.map(id=>[id,$(id).value]));data.checks=Object.fromEntries([...$('nutritionChecklist').querySelectorAll('input')].map(input=>[input.dataset.check,input.checked]));
  try{localStorage.setItem(key,JSON.stringify(data));$('nutritionSaved').textContent='Uloženo v tomto počítači.';}catch{$('nutritionSaved').textContent='Uložení se nezdařilo. Po zavření se změny nemusí zachovat.';}
 }
 function render(){
  const input=$('nutritionMinutes'),result=$('nutritionResult'),error=$('nutritionError'),minutes=Number(input.value);
  const valid=!!input.value&&input.checkValidity();
  if(!valid){result.hidden=true;error.textContent='Zadej očekávanou délku běhu 10–720 minut.';}
  else{
   const plan=VeyvoNutrition.guide($('nutritionDistance').value,minutes,$('nutritionTiming').value);
   error.textContent='';result.hidden=false;
   for(const [id,text] of Object.entries({nutritionTitle:plan.name,nutritionPrep:plan.prep,nutritionMealTitle:plan.meal.title,nutritionMealText:plan.meal.text,nutritionFuel:plan.fuel}))$(id).textContent=text;
   $('nutritionFoods').replaceChildren(...plan.meal.foods.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
   $('nutritionLate').hidden=!plan.lateLongRun;
  }
  $('nutritionTimeline').replaceChildren();
  if($('nutritionStart').value){
   for(const item of VeyvoNutrition.timeline($('nutritionStart').value)){const li=document.createElement('li'),time=document.createElement('strong'),title=document.createElement('h4'),detail=document.createElement('p');time.textContent=item.time;title.textContent=item.title;detail.textContent=item.detail;li.append(time,title,detail);$('nutritionTimeline').append(li);}
  }else{const li=document.createElement('li');li.textContent='Zadej plánovaný čas startu pro konkrétní časy jídel.';$('nutritionTimeline').append(li);}
  $('nutritionRate').max=valid&&minutes<=150?'60':'90';
  const budget=$('nutritionBudget');
  if(!valid||minutes<=75)budget.textContent='Výpočet občerstvení je určen pro běh delší než 75 minut.';
  else if(!$('nutritionRate').value||!$('nutritionServing').value)budget.textContent='Doplň svůj vyzkoušený cíl a sacharidy v jedné porci podle obalu.';
  else if(!$('nutritionRate').checkValidity()||!$('nutritionServing').checkValidity())budget.textContent='Zadej cíl 30–'+$('nutritionRate').max+' g/h a obsah jedné porce 1–100 g.';
  else{const value=VeyvoNutrition.fuelBudget(minutes,Number($('nutritionRate').value),Number($('nutritionServing').value));budget.textContent='Pro tvůj zadaný cíl: '+value.grams+' g sacharidů celkem, tedy '+value.servings+' porcí po '+$('nutritionServing').value+' g (zaokrouhleno nahoru). Rozděl je během běhu; nejde o dávku před startem.';}
  const checked=$('nutritionChecklist').querySelectorAll('input:checked').length;$('nutritionChecklistStatus').textContent=checked+' z '+checks.length+' položek připraveno.';
 }
 $('nutritionPage').addEventListener('input',event=>{if(event.target.matches('input,select,textarea')){render();persist();}});
 $('nutritionPage').addEventListener('change',event=>{if(event.target.matches('input,select,textarea')){render();persist();}});
 $('nutritionForm').addEventListener('submit',event=>event.preventDefault());
 $('nutritionResetChecklist').addEventListener('click',()=>{$('nutritionChecklist').querySelectorAll('input').forEach(input=>input.checked=false);render();persist();});
 render();
})();
