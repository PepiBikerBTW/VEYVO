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
const api={guide,profiles};if(typeof module==='object'&&module.exports)module.exports=api;else root.VeyvoNutrition=api;
})(globalThis);
