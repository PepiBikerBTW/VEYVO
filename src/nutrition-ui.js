(()=>{
 const form=document.querySelector('#nutritionForm');
 function render(){
  const input=document.querySelector('#nutritionMinutes'),result=document.querySelector('#nutritionResult'),error=document.querySelector('#nutritionError');
  if(!input.value||!input.checkValidity()){result.hidden=true;error.textContent='Zadej očekávanou délku běhu 10–720 minut.';return;}
  const plan=VeyvoNutrition.guide(document.querySelector('#nutritionDistance').value,Number(input.value),document.querySelector('#nutritionTiming').value);
  error.textContent='';result.hidden=false;
  for(const [id,text] of Object.entries({nutritionTitle:plan.name,nutritionPrep:plan.prep,nutritionMealTitle:plan.meal.title,nutritionMealText:plan.meal.text,nutritionFuel:plan.fuel}))document.getElementById(id).textContent=text;
  document.querySelector('#nutritionFoods').replaceChildren(...plan.meal.foods.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  document.querySelector('#nutritionLate').hidden=!plan.lateLongRun;
 }
 form.addEventListener('input',render);form.addEventListener('change',render);form.addEventListener('submit',event=>event.preventDefault());
})();
