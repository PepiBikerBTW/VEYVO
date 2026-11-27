# Google Play: záznam v obchodě (čeština, cs-CZ)

Vložit do Play Console: *Rozšíření publika › Záznam v obchodě › Výchozí záznam v obchodě* (nebo překlad cs-CZ, pokud je výchozí angličtina). Texty v blocích `text` se vkládají přesně tak, jak jsou; délky hlídá `node docs/store/count-chars.cjs` (a `npm test`).

Platí pro **první vydání na Google Play** (kanál `play`): bez Stravy, bez aktualizací z GitHubu, bez Health Connect. Až přibude Health Connect (načítání běhů), uprav popis, Bezpečnost údajů a Prohlášení o zdravotních aplikacích (viz [declarations.md](declarations.md)).

## Název aplikace (max. 30 znaků)
<!-- field: name | max: 30 -->
```text
VEYVO: běžecký deník a plán
```

## Krátký popis (max. 80 znaků)
<!-- field: short | max: 80 -->
```text
Běžecký deník a plán tréninku bez účtu. Trénink pak pošleš do hodinek.
```

## Úplný popis (max. 4000 znaků)
<!-- field: full | max: 4000 -->
```text
VEYVO je běžecký deník a plán tréninku. Zapíšeš běh a VEYVO z tvých vlastních běhů spočítá tempo, ukáže, kolik ti chybí do cíle, a navrhne další trénink na dny, kdy můžeš běhat. Trénink pak pošleš do hodinek. Nepotřebuješ účet: všechno zůstává v telefonu.

Přehled
• Dnešní doporučení: běh, nebo volno, a kdy je další trénink
• Další běh se vzdáleností a rozsahem tempa
• Cíl na 5 km, 10 km, půlmaraton, maraton nebo vlastní vzdálenost: tvůj nejlepší čas, cílový čas a kolik ti zbývá
• Regenerace třemi klepnutími: spánek, únava a bolest svalů. Při velké únavě nebo bolesti svalů VEYVO doporučí odpočinek.

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
• hodinky Garmin, COROS, Suunto, Huawei a Amazfit přes tvůj účet intervals.icu
• Apple Watch jako soubor .workout, který otevřeš na iPhonu
• Zwift a TrainingPeaks jako soubor .zwo
• soubor .fit pro hodinky Garmin připojené kabelem k počítači
• jako text pro Polar, Samsung, Pixel Watch a další

Před během
Časový plán jídla a pití před během, výpočet občerstvení pro běhy delší než 75 minut a kontrolní seznam před odchodem. Obecné rady pro zdravé dospělé s odkazy na zdroje (NSW Institute of Sport, Australian Institute of Sport, Cleveland Clinic).

Tvoje data
• Bez účtu, bez reklam, bez analytiky a sledování
• Data zůstávají v telefonu a aplikace funguje offline
• Automatická denní záloha v telefonu a záloha do souboru, kterou obnovíš i v jiném zařízení
• Propojení s intervals.icu je volitelné a používá tvůj vlastní API klíč
• Česky i anglicky, tmavý i světlý motiv

VEYVO je zdarma.

VEYVO není zdravotnický prostředek a nediagnostikuje, neléčí, nevyléčí ani nepředchází žádnému onemocnění. Rady k tréninku, regeneraci a jídlu jsou obecné. Před zahájením tréninkového nebo výživového plánu se poraď s lékařem.

Garmin, Apple Watch, COROS, Suunto, Huawei, Amazfit, Polar, Samsung, Pixel Watch, Zwift, TrainingPeaks a intervals.icu jsou ochranné známky svých vlastníků. VEYVO s nimi není spojené a není jejich oficiální aplikací.
```

## Poznámky k vydání, první vydání (max. 500 znaků)
Play Console: *Vydání › (stopa) › Vytvořit vydání › Poznámky k vydání*, jazyk `<cs-CZ>`.
<!-- field: release-notes | max: 500 -->
```text
První vydání na Google Play. Deník běhů, plán tréninku podle dnů, kdy můžeš běhat, výkonnost z tvých běhů, trénink do hodinek přes intervals.icu nebo jako soubor a rady před během. Česky i anglicky, bez účtu a bez reklam.
```

## Kategorie a kontakty
| Pole v Play Console | Hodnota |
|---|---|
| Typ aplikace | Aplikace |
| Kategorie | Zdraví a fitness (Health & Fitness) |
| Štítky (max. 5, vybírá se ze seznamu) | Běh, Fitness tracker, Trénink (nebo nejbližší nabízené) |
| E-mail (veřejný kontakt) | pepik.kozisek@seznam.cz |
| Web | https://pepibikerbtw.github.io/VEYVO/ |
| Telefon | nevyplňovat (není povinný; u ne-obchodníka se nezobrazuje) |
| Zásady ochrany osobních údajů | https://pepibikerbtw.github.io/VEYVO/privacy/ |
| Cena | Zdarma. Aplikaci zveřejněnou zdarma už Google nedovolí změnit na placenou; placené doplňky později půjdou jen jako nákupy v aplikaci (Google Play Billing), viz [owner-checklist.md](owner-checklist.md). |

## Grafika (`docs/store/graphics/`)
| Pole | Soubor | Rozměr |
|---|---|---|
| Ikona aplikace | `play-icon-512.png` | 512 × 512, PNG 32 bit, bez průhlednosti |
| Hlavní obrázek (feature graphic) | `play-feature-cs.png` | 1024 × 500, PNG 24 bit |
| Snímky obrazovky telefonu (pořadí 1–6) | `play-phone-cs-1-overview.png` … `play-phone-cs-6-result.png` | 1080 × 2400, PNG 24 bit |

Snímky jsou ze skutečné aplikace (sestavení `play`) s ukázkovými daty: devět běhů autora z 27. 10.–24. 11. 2026, dnešek 27. 11. 2026. Znovu je vytvoří `tests/visual/store-graphics.cjs` (postup je v hlavičce skriptu). Video na YouTube je volitelné, zatím žádné.
