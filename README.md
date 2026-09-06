# VEYVO

**Your adaptive running coach.** Desktopová Windows aplikace pro personalizované a bezpečně adaptované běžecké plány.

## Vývoj

```powershell
npm install
npm start
```

## Windows build

```powershell
npm run build
```

Instalátor i portable `.exe` se vytvoří ve složce `release`.

## Rozsah prototypu

- přehled připravenosti a dnešního tréninku
- desetidenní/týdenní adaptivní plán
- lokální bezpečnostní pravidla a záznam náročnosti
- kontextový VEYVO Coach
- statistiky, predikce 5 km a cesta k cíli
- světlý a tmavý režim
- lokální uchování nastavení

Cloudové účty, skutečné AI API a integrace sportovních služeb jsou připravené jako další produkční fáze; demo odpovědi coache zatím běží lokálně.

## Časový kontext

VEYVO používá místní datum, čas a časové pásmo zařízení. Hodiny, pozdrav a dnešní plán se obnovují průběžně i po návratu do okna. Lokální coach rozpoznává dotazy na čas, datum a trénink dnes, zítra nebo včera. Časové odpovědi fungují bez internetu; obecná konverzace zatím používá demo odpovědi.

Ověření: `npm test` a `npm run test:ui`.
