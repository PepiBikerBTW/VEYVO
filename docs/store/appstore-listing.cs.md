# App Store: metadata (čeština)

Vložit do App Store Connect: *Aplikace › VEYVO › App Store › (lokalizace Čeština)*. Texty v blocích `text` se vkládají přesně tak, jak jsou; délky hlídá `node docs/store/count-chars.cjs` (a `npm test`). Anglická lokalizace je v [appstore-listing.en.md](appstore-listing.en.md), odpovědi k soukromí, věkovému hodnocení a poznámka pro App Review v [declarations.md](declarations.md).

Pravidla, která texty dodržují: žádná zmínka o Androidu, Windows, Google Play ani GitHubu (pokyn 2.3.10); názvy hodinek a služeb jen popisně, nikdy v názvu, podtitulu ani klíčových slovech (2.3.7, 4.1); žádná lékařská tvrzení (1.4.1); integrace se Zdravím je v popisu jmenovaná (2.5.1).

> **Před odesláním ke schválení zkontroluj v sestavení pro iPhone:** popis uvádí načítání běhů z aplikace Zdraví (Apple Health, jen čtení), odesílání do intervals.icu a přidání tréninku do Apple Watch. Pokud některá z těchto funkcí v nahraném sestavení není, odstavec s ní smaž, jinak hrozí zamítnutí podle pokynu 2.3.1 (nepřesná metadata).

## Název (max. 30 znaků)
<!-- field: name | max: 30 -->
```text
VEYVO: běžecký deník a plán
```

## Podtitul (max. 30 znaků)
<!-- field: subtitle | max: 30 -->
```text
Plán, cíl a trénink do hodinek
```

## Propagační text (max. 170 znaků)
Dá se měnit kdykoli bez nové verze.
<!-- field: promo | max: 170 -->
```text
Zapiš běh a VEYVO spočítá tempo, ukáže, kolik ti chybí do cíle, a navrhne další trénink. Bez účtu a bez reklam, data zůstávají v iPhonu.
```

## Popis (max. 4000 znaků)
<!-- field: description | max: 4000 -->
```text
VEYVO je běžecký deník a plán tréninku. Zapíšeš běh a VEYVO z tvých vlastních běhů spočítá tempo, ukáže, kolik ti chybí do cíle, a navrhne další trénink na dny, kdy můžeš běhat. Trénink pak přidáš do hodinek. Nepotřebuješ účet: všechno zůstává v iPhonu.

Přehled
• Dnešní doporučení: běh, nebo volno, a kdy je další trénink
• Další běh se vzdáleností a rozsahem tempa
• Cíl na 5 km, 10 km, půlmaraton, maraton nebo vlastní vzdálenost: tvůj nejlepší čas, cílový čas a kolik ti zbývá
• Regenerace třemi klepnutími: spánek, únava a bolest svalů. Při velké únavě nebo bolesti svalů VEYVO doporučí odpočinek.

Běhy z aplikace Zdraví
Když to povolíš, VEYVO načte tvoje běhy z aplikace Zdraví (Apple Health). Přístup je jen pro čtení, do Zdraví VEYVO nic nezapisuje a načtená data zůstávají v iPhonu. Běhy můžeš zapisovat i ručně.

Můj plán
• Týden podle dnů, které si vybereš
• Knihovna tréninků: lehký běh, dlouhý běh, 6 × 400 m, 5 × 1 km, 3 × 2 km v prahovém tempu a test na 5 km
• Tempa vycházejí z tvého nejlepšího běhu na 5 km a z cílového času

Výkonnost
• Graf tempa každého běhu s čárou cíle
• Objem po týdnech, osobní rekordy a milníky
• Deník běhů s poznámkami odvozenými z tvých dat, třeba nový rekord nebo nejdelší běh
• Po zápisu hned uvidíš tempo a případný osobní rekord

Do hodinek
Strukturovaný trénink s úseky a cílovým tempem pošleš tam, kde ho potřebuješ:
• Apple Watch: trénink přidáš do aplikace Cvičení (iOS 17 a watchOS 10 nebo novější)
• hodinky Garmin, COROS, Suunto, Huawei a Amazfit přes tvůj účet intervals.icu
• Zwift a TrainingPeaks jako soubor .zwo
• jako text pro ostatní hodinky a aplikace

Před během
Časový plán jídla a pití před během, výpočet občerstvení pro běhy delší než 75 minut a kontrolní seznam před odchodem. Obecné rady pro zdravé dospělé s odkazy na zdroje (NSW Institute of Sport, Australian Institute of Sport, Cleveland Clinic).

Tvoje data
• Bez účtu, bez reklam, bez analytiky a sledování
• Data zůstávají v iPhonu a aplikace funguje offline
• Záloha do souboru, kterou obnovíš i v jiném zařízení
• Propojení s intervals.icu je volitelné a používá tvůj vlastní API klíč
• Česky i anglicky, tmavý i světlý motiv

VEYVO je zdarma.

VEYVO není zdravotnický prostředek a nediagnostikuje, neléčí, nevyléčí ani nepředchází žádnému onemocnění. Rady k tréninku, regeneraci a jídlu jsou obecné. Před zahájením tréninkového nebo výživového plánu se poraď s lékařem.

Garmin, COROS, Suunto, Huawei, Amazfit, Zwift, TrainingPeaks a intervals.icu jsou ochranné známky svých vlastníků. VEYVO s nimi není spojené a není jejich oficiální aplikací.
```

## Klíčová slova (max. 100 bajtů, čárky bez mezer)
Neopakují slova z názvu a podtitulu (ta App Store indexuje sám) a neobsahují cizí ochranné známky.
<!-- field: keywords | max: 100 | unit: bytes -->
```text
běh,běhání,tempo,5 km,10 km,maraton,intervaly,běžec,rekord,regenerace,kondice,závod
```

## Co je nového (první verze)
U první verze aplikace App Store Connect toto pole nezobrazuje; text je pro další verzi nebo pro TestFlight (*Co testovat*).
<!-- field: whats-new | max: 4000 -->
```text
První vydání pro iPhone. Deník běhů, plán tréninku podle dnů, kdy můžeš běhat, výkonnost z tvých běhů, trénink do Apple Watch a dalších hodinek, načítání běhů z aplikace Zdraví a rady před během. Česky i anglicky, bez účtu a bez reklam.
```

## Ostatní pole
| Pole v App Store Connect | Hodnota |
|---|---|
| Primární jazyk | English (U.S.) z [appstore-listing.en.md](appstore-listing.en.md), čeština jako další lokalizace. V zemích bez české ani anglické lokalizace se pak ukáže angličtina. |
| Kategorie | Zdraví a fitness (Health & Fitness); sekundární volitelně Sport |
| URL podpory | https://pepibikerbtw.github.io/VEYVO/support/ |
| Marketingová URL | https://pepibikerbtw.github.io/VEYVO/ |
| URL zásad ochrany osobních údajů | https://pepibikerbtw.github.io/VEYVO/privacy/ |
| Copyright | 2026 Josef Kožíšek |
| Cena | Zdarma (0 Kč), všechny země nebo aspoň EU |
| Bundle ID / SKU | `com.veyvo.coach` / `veyvo-ios` |
| Věkové hodnocení | podle [declarations.md](declarations.md), očekávaný výsledek 9+ |

## Snímky obrazovky (`docs/store/graphics/`, PNG bez alfa kanálu)
| Velikost displeje | Soubory (pořadí 1–6) | Rozměr |
|---|---|---|
| iPhone 6,9″ (povinná sada) | `ios-6.9-cs-1-overview.png` … `ios-6.9-cs-6-result.png` | 1320 × 2868 |
| iPhone 6,3″ (doplňková sada) | `ios-6.3-cs-1-overview.png` … `ios-6.3-cs-6-result.png` | 1206 × 2622 |

Snímky jsou ze skutečné aplikace (sestavení `appstore`) s ukázkovými daty: devět běhů autora z 27. 10.–24. 11. 2026, dnešek 27. 11. 2026. Až bude mít sestavení pro iPhone vlastní platformní adaptér (sdílení souborů, intervals.icu, Zdraví), vytvoř je znovu: `tests/visual/store-graphics.cjs --only ios69,ios63` (postup v hlavičce skriptu), aby okno Do hodinek ukazovalo stejné volby jako aplikace na iPhonu.
