(function(root){
'use strict';
const profiles={
 '6':{name:'6 km',prep:'Před kratším během navazuj na běžná jídla během dne. Svačinu zvol podle hladu a času od posledního jídla.'},
 '10':{name:'10 km',prep:'Připrav si známé sacharidové jídlo. Pro občerstvení na trase rozhoduje očekávaný čas, zvlášť při závodním tempu.'},
 '21.1':{name:'Půlmaraton · 21,1 km',prep:'Vyzkoušej snídani i občerstvení při dlouhém tréninku. Připrav si gely nebo nápoj a ověř občerstvovací stanice.'},
 '42.2':{name:'Maraton · 42,2 km',prep:'Příprava začíná v předchozích dnech. Zařazuj známé sacharidové potraviny; nespoléhej na jednu velkou večeři. Večer například rýži nebo bílé těstoviny s menší porcí libové bílkoviny.'}
};
const meals={
 meal:{title:'Hlavní jídlo · 2–4 hodiny před startem',text:'Dej jídlu čas na trávení. Množství přizpůsob hladu, délce běhu a tomu, co máš vyzkoušené.',foods:['Rýže s menší porcí tofu nebo kuřete.','Bílé těstoviny s lehkou rajčatovou omáčkou.','Bílý toast s džemem a banán, pokud běžíš ráno.']},
 snack:{title:'Menší svačina · 1–2 hodiny před startem',text:'Vyber jednu známou, lehce stravitelnou variantu s malým množstvím tuku a vlákniny.',foods:['Banán.','Bílý toast nebo rohlík s džemem či medem.']},
 soon:{title:'Do startu zbývá méně než hodina',text:'Velké jídlo už nedoháněj. Tekutiny upíjej postupně; při dlouhém nebo intenzivním běhu může pomoci vyzkoušený sportovní nápoj.',foods:['Voda po malých doušcích.','Vyzkoušený sacharidový nápoj pro dlouhý nebo intenzivní běh.']}
};
function guide(distance,minutes,timing){
 const profile=profiles[String(distance)],meal=meals[timing];
 if(!profile||!meal||typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<10||minutes>720)throw new RangeError('Zadej očekávanou délku běhu 10–720 minut.');
 const fuel=minutes<45?'Během výkonu kratšího než 45 minut sacharidy obvykle nejsou potřeba.':minutes<=75?'Při intenzivním běhu 45–75 minut může pomoci malé množství sacharidů. Nejde o povinnost pro každý lehký běh.':minutes<=150?'Pro vytrvalostní běh této délky se běžně používá 30–60 g sacharidů za hodinu. Započítej gely i nápoje a plán nejprve vyzkoušej v tréninku.':'U běhů nad 2,5–3 hodiny lze po nácviku využít až 90 g sacharidů za hodinu ze směsi glukózy a fruktózy. Není to automatický cíl pro začátečníka; množství zvyšuj podle tolerance.';
 return {...profile,meal,fuel,longRun:minutes>75,lateLongRun:minutes>75&&timing==='soon'};
}
function timeline(start){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start))throw new RangeError('Zadej čas startu.');
 const [h,m]=start.split(':').map(Number),base=h*60+m;
 const time=offset=>{const raw=base-offset,value=((raw%1440)+1440)%1440;return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0')+(raw<0?' (předchozí den)':'');};
 return [
  {time:time(240)+' až '+time(120),title:'Hlavní jídlo',detail:'Vyber jednu variantu jídla níže. Porci přizpůsob vlastní zkušenosti; není potřeba sníst všechny příklady.'},
  {time:time(120)+' až '+time(60),title:'Volitelná svačina',detail:'Podle hladu a předchozího jídla si dej banán nebo bílé pečivo s džemem. Svačina není další povinné jídlo.'},
  {time:time(60)+' až '+time(0),title:'Poslední hodina',detail:'Připrav pití, vyzkoušené občerstvení a vybavení. Nedoháněj přípravu velkým jídlem.'},
  {time:time(0),title:'Start',detail:'Použij občerstvení, které máš vyzkoušené při tréninku.'}
 ];
}
function fuelBudget(minutes,rate,perServing){
 if(![minutes,rate,perServing].every(Number.isFinite)||minutes<=75||minutes>720||rate<30||rate>90||(minutes<=150&&rate>60)||perServing<1||perServing>100)throw new RangeError('Zkontroluj délku běhu, cíl sacharidů a údaj na obalu.');
 const grams=Math.round(minutes/60*rate);
 return {grams,servings:Math.ceil(grams/perServing)};
}
const api={guide,profiles,timeline,fuelBudget};if(typeof module==='object'&&module.exports)module.exports=api;else root.VeyvoNutrition=api;
})(globalThis);
