# VEYVO

**Your adaptive running coach.** Desktopová Windows aplikace s OpenAI coachem a automatickou adaptací běžeckých plánů podle skutečných výkonů.

## Spuštění a sestavení

```powershell
npm install
npm start
npm test
npm run test:ui
npm run build
```

Instalátor a portable aplikace vznikají ve složce `release`. Tag `v*` na GitHubu spustí testy, Windows build a publikování aktualizace.

## Zapnutí skutečné AI

1. Otevři **Nastavení → AI trenér** nebo tlačítko **Nastavit AI a běžecký profil** v plánu.
2. Zadej vlastní OpenAI API klíč, ponech `gpt-5.4-mini` nebo zvol model svého API účtu podporující Responses API a Structured Outputs.
3. Potvrď odesílání zpráv, cíle, plánu a běžecké historie včetně poznámek do OpenAI. Volba automatické adaptace je samostatná.
4. Klikni na **Uložit a ověřit připojení**. Nový klíč/model se ověří krátkým API požadavkem. OpenAI API používá vlastní kredit a účtování.
5. Ulož cíl a dostupné běžecké dny. Importuj běhy ze Stravy nebo zapiš běh s datem, vzdáleností a časem `mm:ss` / `h:mm:ss`.

API klíč je šifrovaný pomocí Electron `safeStorage` v uživatelském adresáři aplikace. Uložený klíč se nevrací do rozhraní a není v `localStorage`, repozitáři ani instalátoru. **Odpojit a smazat klíč** připojení odstraní. Síťové požadavky používají pouze pevnou OpenAI HTTPS adresu z hlavního procesu Electronu.

Integrace používá [OpenAI Responses API se strukturovanými výstupy](https://developers.openai.com/api/docs/guides/structured-outputs) a jako výchozí model [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini). Požadavky nastavují `store: false`; to neznamená, že data vůbec nejsou zpracována poskytovatelem.

## AI coach a automatický plán

Coach používá skutečné AI odpovědi a posledních 20 zpráv konverzace. Dostává místní čas, datum, časové pásmo, cíl, dostupné dny, uložené plány a až 100 platných běhů za posledních 90 dnů. Chybějící tep a subjektivní náročnost zůstávají neznámé. Při chybě připojení aplikace zobrazí chybu, nikoli demo odpověď. Chat sám plán nemění; změny ukládá generátor plánu.

Se zapnutou automatickou adaptací se po novém ručním záznamu, importu ze Stravy nebo změně profilu aktualizují budoucí tréninky aktuálního týdne. Od neděle 18:00 se připravuje další týden; pokud byla aplikace zavřená, vytvoří se po příštím spuštění. Automatika funguje při otevřené aplikaci a vyžaduje internet. Stejná úspěšně zpracovaná data se znovu neposílají; po chybě je automatické opakování omezeno na nejdříve 30 minut. Ruční tlačítko může požadavek zopakovat.

AI vyhodnocuje vzdálenosti, skutečné časy a tempa, objem za poslední čtyři týdny, náročnost, tep a poznámky, pokud jsou dostupné. Pro první plán potřebuje alespoň jeden platný běh za posledních 28 dnů. S malým množstvím dat dostává pokyn k opatrnému plánu bez intenzivních tréninků.

Aplikace před uložením ověřuje strukturu sedmi dnů, dostupné dny, délku běhů, tempo, zbývající objem a rozestupy intenzivních tréninků. Používá produktový limit růstu objemu 8 % proti pozorované zátěži; nejde o záruku zdravotní bezpečnosti. Minulé a dokončené dny se nepřepisují. Odpověď vytvořená ze zastaralých dat se neuloží a selhání zachová předchozí plán. Ukládá se vysvětlení změn, model a čas vytvoření.

Dosavadní deset týdnů dlouhý program stále začíná 7. 9. 2026. Jeho starší lokálně vytvořené plány se zachovají, ale nové AI označení dostávají až plány z OpenAI. Ostatní ukázkové ukazatele připravenosti a predikce v prototypu nejsou vstupem AI.

## Testování

`npm test` ověřuje výpočty výkonů a kalendáře, datový kontrakt OpenAI, chybové odpovědi, validaci plánů a ukládání nastavení. `npm run test:ui` spustí izolovaná skrytá Electron okna a ověří čas, šifrování, připojení, importy, konverzaci, adaptaci i zachování dat při chybě. API odpovědi jsou v testech simulované; testy nepotřebují skutečný klíč ani nečerpají kredit.

## 0.3.0 — VEYVO na iPhonu

Soukromý web: https://veyvo-coach-pepa.j-kozisek.chatgpt.site

Na iPhonu otevři v Safari a zvol Sdílet → Přidat na plochu. Stejný ChatGPT účet na webu v telefonu a počítači sdílí běhy, profil, chat a plány. V Nastavení webu vlož vlastní NVIDIA API klíč; model Nemotron je přednastavený. Testovací endpoint NVIDIA má poskytovatelem řízené limity a podmínky.

Windows Nastavení → Obecné nabízí otevření webu a export historie do JSON. Soubor importuj v Nastavení webu. Windows aplikace dál uchovává původní lokální data; pro další průběžnou synchronizaci používej web na obou zařízeních. Přímé propojení Stravy ve webu zatím není; již importované aktivity lze přenést exportem.

Webová implementace a její testy jsou ve `web/`. Ověřeno sestavení, typy, doménové testy, skutečné lokální D1 ukládání a oddělení uživatelů. NVIDIA testována s mock odpověďmi, bez živého klíče. WebMCP rozhraní je volitelné a nebylo ověřeno v podporovaném prohlížeči.
