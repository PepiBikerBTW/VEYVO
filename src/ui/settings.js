/*
 * ui/settings.js - Nastavení (dialog 'settings'), concept A "Track".
 *
 *   app.dialogs.open('settings', { section?, connect?, backupText?, backupName? })
 *     section: 'profile' | 'appearance' | 'connections' | 'data' | 'updates' | 'about'
 *              (aliases: strava, intervals, language, theme, backup, update, goal, days)
 *     connect: true opens the Strava connect form (onboarding "Připojit Stravu")
 *     backupText/backupName: a backup file read elsewhere (onboarding) -> import preview in Data
 *
 * Desktop: a large modal with a vertical tablist on the left (sliding orange lane like the sidebar)
 * and one section at a time. Phone (<= 760 px): a full-screen sheet with every section stacked and a
 * sticky jump bar (scroll spy). The dialog re-renders itself on 'state', 'language', 'strava',
 * 'updates' and 'backup' events; unsaved input lives in `view` and focus/caret survive re-renders.
 *
 * Sections
 *   Profil a cíl     name (<= 40), goal distance (5/10/21,1/42,2/custom), target time with a live
 *                    goal-pace / best / gap preview (VeyvoRuns.goalProgress on the draft), running
 *                    days (dayToggles). Saved with VeyvoStore.setProfile (undo toast); closing with
 *                    unsaved changes asks first. Fixes the 0.3 days-reset and hard-coded profile.
 *   Vzhled a jazyk   theme + language (app.setTheme / app.setLanguage: live and persisted).
 *   Propojení        Strava (desktop): status incl. lastError and "Vyžaduje nové přihlášení",
 *                    connect form (Client ID 275720, Client Secret, consent), sync now, disconnect,
 *                    re-allow deleted runs. Android/web: "Strava zatím jen ve Windows verzi"; a store
 *                    build (app.build.store, Google Play) shows no Strava at all.
 *                    intervals.icu: API key (VeyvoPlatform.secrets 'intervals-api-key', the same
 *                    name ui/workout-sheet.js uses), verified with GET /api/v1/athlete/0.
 *                    iPhone (platform kind 'ios'): Apple Zdraví instead of Strava. "Importovat běhy"
 *                    asks for read access (VeyvoPlatform.health), reads the last 90 days, then only
 *                    what is new (VeyvoStore.healthImportSince / importHealthRuns: deduplicated by the
 *                    Health workout id and the duplicate rules, the typed time wins, deleted runs stay
 *                    deleted). After the first import new runs come in on their own when the app
 *                    starts or returns to the foreground (importHealth, at most every 15 minutes).
 *   Data             counts, export (VeyvoStore.exportBackup + VeyvoPlatform.saveFile), import
 *                    (parseBackup -> preview -> merge / replace with confirm), automatic daily
 *                    backups (VeyvoPlatform.backup.list/read) with restore, and the danger zone
 *                    "Smazat všechna data" with a typed confirmation (replaces the 0.3 topbar
 *                    button; clears ignoredStravaIds + lastSync so Strava can import again).
 *                    Replace and wipe first write a safety snapshot into today's automatic backup.
 *   Aktualizace      desktop updater states with progress; Android GitHub release + APK link.
 *                    Not shown in a store build (Google Play installs updates): sectionsFor(app.build).
 *   O aplikaci       version, health notice ("not a medical device", consult a professional - both
 *                    stores require it), privacy + the privacy policy link (PRIVACY_URL, opened with
 *                    VeyvoPlatform.openExternal), licences (fonts OFL, workoutkit MIT, shell MIT), shortcuts.
 *
 * Texts: i18n namespace 'settings' (cs + en). CSS: styles/pages/settings.css (prefix set-).
 * Pure helpers for tests and ui/onboarding.js: VeyvoUI.settings.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI;
  const app = UI.app;
  const I18n = root.VeyvoI18n, Store = root.VeyvoStore, Runs = root.VeyvoRuns, Format = root.VeyvoFormat;
  const dom = UI.dom, h = dom.h, fmt = UI.fmt, icons = UI.icons, motion = UI.motion;
  const P = () => root.VeyvoPlatform;

  // ================================================================ texts (namespace 'settings')
  const MESSAGES = {
    cs: {
      title: 'Nastavení',
      navLabel: 'Sekce nastavení',
      section: {
        profile: 'Profil a cíl', appearance: 'Vzhled a jazyk', connections: 'Propojení',
        data: 'Data a zálohy', updates: 'Aktualizace', about: 'O aplikaci'
      },
      lead: {
        profile: 'Jméno, cíl a dny, kdy můžeš běhat. Podle nich VEYVO plánuje další běh a ukazuje, kolik ti do cíle chybí.',
        appearance: 'Motiv i jazyk se změní hned a zůstanou uložené.',
        connections: 'Obě služby jsou volitelné. Bez nich VEYVO funguje celé offline.',
        connectionsStore: 'Propojení s intervals.icu je volitelné. Bez něj VEYVO funguje celé offline.',
        connectionsIos: 'Apple Zdraví i intervals.icu jsou volitelné. Bez nich VEYVO funguje celé offline.',
        data: 'Všechno je uložené jen v tomto zařízení. Zálohu si stáhneš do souboru a obnovíš ji tady.',
        updates: 'Nové verze VEYVO a jejich instalace.',
        about: 'Verze, soukromí, zdravotní upozornění a licence.'
      },
      dot: { attention: 'vyžaduje pozornost', unsaved: 'neuložené změny', update: 'je dostupná aktualizace' },
      when: { today: 'dnes {time}', yesterday: 'včera {time}', date: '{date} {time}' },
      profile: {
        you: 'Ty',
        name: 'Jak ti říkat',
        namePlaceholder: 'Jméno nebo přezdívka',
        nameHint: 'Zobrazí se v postranním panelu. Může zůstat prázdné.',
        goal: 'Cíl',
        distance: 'Cílová vzdálenost',
        custom: 'Vlastní',
        customLabel: 'Vlastní vzdálenost',
        target: 'Cílový čas',
        targetPlaceholder: 'mm:ss',
        targetHint: 'Např. 20:00 nebo 1:45:00. Prázdné pole znamená cíl bez času.',
        pace: 'Cílové tempo',
        paceNone: 'bez cílového času',
        speed: '{speed} km/h',
        best: 'Nejlepší na {distance} km',
        bestNone: 'zatím žádný běh na {distance} km',
        gap: 'Do cíle',
        gapLeft: 'chybí do cíle',
        gapPace: 'o {s} s/km rychleji',
        reached: 'Splněno',
        reachedSub: 'cíl máš pokořený',
        days: 'Kdy můžeš běhat',
        daysHint: 'Další běh VEYVO naplánuje jen na vybrané dny.',
        daysCount: { one: '{n} den v týdnu', few: '{n} dny v týdnu', many: '{n} dne v týdnu', other: '{n} dní v týdnu' },
        unsaved: 'Neuložené změny',
        saved: 'Profil uložen',
        save: 'Uložit',
        discard: 'Zahodit',
        discardTitle: 'Zahodit neuložené změny?',
        discardBody: 'Změny jména, cíle a běžeckých dnů se neuloží.',
        error: {
          'target-format': 'Čas zadej jako mm:ss nebo h:mm:ss, např. 20:00.',
          'target-implausible': 'Tempo by vyšlo rychlejší než 2:00/km. Hodiny piš jako h:mm:ss, např. 1:45:00.'
        }
      },
      appearance: {
        theme: 'Motiv',
        themeSub: 'Platí pro celou aplikaci i lištu okna.',
        themeSubApp: 'Platí pro celou aplikaci.',
        dark: 'Tmavý',
        light: 'Světlý',
        language: 'Jazyk',
        languageSub: 'Přeloží celou aplikaci včetně dat a čísel.',
        sample: 'Takhle teď vypadají data a čísla'
      },
      strava: {
        title: 'Strava',
        sub: 'Načítání běhů',
        status: {
          connected: 'Připojeno', off: 'Nepřipojeno', error: 'Chyba synchronizace', reauth: 'Vyžaduje nové přihlášení',
          syncing: 'Synchronizuji…', waiting: 'Čeká na přihlášení', unsupported: 'Jen Windows'
        },
        lead: 'Načítá tvoje běhy ze Stravy za posledních 45 dní: datum a čas startu, vzdálenost, čas v pohybu, název, průměrný tep a převýšení.',
        rules: 'Když běh zapíšeš i ručně, platí tvůj čas a vzdálenost. Běh smazaný ve VEYVO se znovu nenačte.',
        account: 'Účet',
        lastSync: 'Poslední synchronizace',
        never: 'zatím nikdy',
        syncNow: 'Synchronizovat nyní',
        connect: 'Připojit Stravu',
        reconnect: 'Přihlásit znovu',
        disconnect: 'Odpojit',
        disconnectTitle: 'Odpojit Stravu?',
        disconnectBody: 'Běhy, které už jsou ve VEYVO, zůstanou. Nové se přestanou načítat a přihlašovací údaje se z tohoto počítače smažou.',
        reauthTitle: 'Strava odmítla uložené přihlášení.',
        reauthText: 'Připoj účet znovu, běhy zůstanou.',
        errorTitle: 'Poslední synchronizace selhala.',
        waitingTitle: 'Dokonči přihlášení v prohlížeči.',
        waitingText: 'Jakmile přístup povolíš, propojení se tady samo potvrdí.',
        retry: 'Zadat znovu',
        ignored: { one: '{n} smazaný běh ze Stravy se znovu nenačítá.', few: '{n} smazané běhy ze Stravy se znovu nenačítají.', many: '{n} smazaného běhu ze Stravy se znovu nenačítá.', other: '{n} smazaných běhů ze Stravy se znovu nenačítá.' },
        restoreIgnored: 'Povolit znovu načíst',
        unsupportedTitle: 'Strava zatím jen ve Windows verzi.',
        unsupportedText: 'Běhy ze Stravy načte VEYVO pro Windows. Do telefonu je přeneseš zálohou: v počítači ji exportuj a tady v sekci Data a zálohy obnov.',
        form: {
          title: 'Připojení Stravy',
          intro: 'VEYVO se ke Stravě připojuje přes Strava API aplikaci s Client ID {id}. Strava k přihlášení vyžaduje její Client Secret.',
          step1: 'Client Secret najdeš na strava.com/settings/api u účtu, který aplikaci {id} vytvořil. Bez něj se Strava připojit nedá.',
          step2: 'V nastavení aplikace musí být „Authorization Callback Domain“ nastavená na localhost.',
          step3: 'Po potvrzení se otevře prohlížeč. Přihlas se ke Stravě a povol přístup.',
          openApi: 'Otevřít strava.com/settings/api',
          secret: 'Strava Client Secret',
          secretHint: 'Aspoň 8 znaků bez mezer.',
          show: 'Zobrazit',
          hide: 'Skrýt',
          consent: 'Povoluji VEYVO načítat moje aktivity ze Stravy (oprávnění read a activity:read_all).',
          privacy: 'Client Secret a přihlašovací tokeny šifruje Windows a zůstávají jen v tomto počítači.',
          submit: 'Pokračovat na Stravu',
          secretInvalid: 'Client Secret má aspoň 8 znaků a žádné mezery.',
          consentMissing: 'Potvrď, že VEYVO smí načítat tvoje aktivity.'
        }
      },
      health: {
        title: 'Apple Zdraví',
        sub: 'Automatické načítání běhů',
        status: { off: 'Vypnuto', on: 'Zapnuto', importing: 'Načítám…', error: 'Chyba načítání' },
        lead: 'VEYVO načte z aplikace Zdraví tvoje běhy: datum a čas startu, vzdálenost, čas a průměrný i nejvyšší tep. Do Zdraví je zapisují Apple Watch i aplikace jiných hodinek.',
        lastImport: 'Poslední načtení',
        never: 'zatím nikdy',
        import: 'Importovat běhy',
        importAgain: 'Načíst nové běhy',
        stop: 'Vypnout automatické načítání',
        stopped: 'Automatické načítání z Apple Zdraví je vypnuté. Načtené běhy zůstávají.',
        auto: 'Nové běhy se načítají samy, když VEYVO otevřeš.',
        imported: { one: 'Z Apple Zdraví přibyl {n} běh.', few: 'Z Apple Zdraví přibyly {n} běhy.', many: 'Z Apple Zdraví přibylo {n} běhu.', other: 'Z Apple Zdraví přibylo {n} běhů.' },
        updated: { one: '{n} běh doplněn o údaje z Apple Zdraví.', few: '{n} běhy doplněny o údaje z Apple Zdraví.', many: '{n} běhu doplněno o údaje z Apple Zdraví.', other: '{n} běhů doplněno o údaje z Apple Zdraví.' },
        upToDate: 'Žádné nové běhy, všechno už je načtené.',
        none: 'V Apple Zdraví VEYVO žádné běhy nenašlo. Pokud tam nějaké máš, zkontroluj, že má VEYVO povolené čtení tréninků.',
        skipped: { one: '{n} běh bez vzdálenosti se nenačetl.', few: '{n} běhy bez vzdálenosti se nenačetly.', many: '{n} běhu bez vzdálenosti se nenačetlo.', other: '{n} běhů bez vzdálenosti se nenačetlo.' },
        errorTitle: 'Poslední načtení selhalo.',
        ignored: { one: '{n} smazaný běh z Apple Zdraví se znovu nenačítá.', few: '{n} smazané běhy z Apple Zdraví se znovu nenačítají.', many: '{n} smazaného běhu z Apple Zdraví se znovu nenačítá.', other: '{n} smazaných běhů z Apple Zdraví se znovu nenačítá.' },
        restoreIgnored: 'Povolit znovu načíst',
        reads: 'VEYVO ze Zdraví jen čte běžecké tréninky, vzdálenost a tep. Nic do něj nezapisuje a data neposílá mimo tento iPhone.',
        rules: 'První import načte posledních 90 dní, další už jen nové běhy. Když běh zapíšeš i ručně, platí tvůj čas a vzdálenost.',
        permission: 'Přístup VEYVO k datům změníš v aplikaci Zdraví v nastavení svého profilu, v seznamu aplikací.'
      },
      intervals: {
        title: 'intervals.icu',
        sub: 'Odesílání tréninků',
        status: { connected: 'Připojeno', off: 'Nepřipojeno', saved: 'Klíč uložen', error: 'Chyba', checking: 'Ověřuji…', loading: 'Načítám…' },
        lead: 'Pošle naplánované tréninky do kalendáře intervals.icu. Odtud se dostanou do hodinek, které máš s intervals.icu propojené.',
        key: 'API klíč',
        keyPlaceholder: 'Vlož API klíč',
        keyHint: 'Najdeš ho v intervals.icu v nabídce {path}.',
        pathSettings: 'Settings',
        pathDeveloper: 'Developer Settings',
        openSite: 'Otevřít intervals.icu',
        saveTest: 'Ověřit a uložit',
        saveAnyway: 'Uložit bez ověření',
        test: 'Otestovat připojení',
        change: 'Změnit klíč',
        remove: 'Odebrat klíč',
        removeTitle: 'Odebrat API klíč intervals.icu?',
        removeBody: 'Tréninky do intervals.icu nepůjde poslat, dokud klíč nezadáš znovu. V intervals.icu se nic nesmaže.',
        removed: 'Klíč intervals.icu odebrán.',
        savedToast: 'Klíč intervals.icu uložen.',
        savedKey: 'Uložený klíč končí na',
        ok: 'Připojení funguje.',
        okAccount: 'Připojení funguje. Účet: {name}',
        keyMissing: 'Vlož API klíč.',
        lastPush: 'Poslední odeslání tréninku: {when}',
        lastError: 'Poslední odeslání selhalo: {message}',
        storeEncrypted: 'Klíč šifruje Windows a zůstává jen v tomto počítači.',
        storePlain: 'Na Androidu se klíč ukládá do soukromého úložiště aplikace, ale není šifrovaný.',
        storePlainIos: 'V iPhonu se klíč ukládá do soukromého úložiště aplikace, ale není šifrovaný.',
        storeMemory: 'V této verzi se klíč drží jen do zavření aplikace.',
        storeNone: 'Tahle verze neumí klíč bezpečně uložit.'
      },
      data: {
        deviceTitle: 'V tomto zařízení',
        deviceSub: 'Běhy, regenerace, plán, profil i nastavení stránky Před během.',
        runsLabel: { one: 'běh', few: 'běhy', many: 'běhu', other: 'běhů' },
        recoveryLabel: { one: 'záznam regenerace', few: 'záznamy regenerace', many: 'záznamu regenerace', other: 'záznamů regenerace' },
        plannedLabel: { one: 'naplánovaný trénink', few: 'naplánované tréninky', many: 'naplánovaného tréninku', other: 'naplánovaných tréninků' },
        export: 'Exportovat zálohu',
        import: 'Obnovit ze souboru',
        fileName: 'veyvo-zaloha-{date}.json',
        fileHint: 'Záloha je jeden soubor JSON. Obnovíš ji tady nebo v jiném zařízení s VEYVO.',
        exported: 'Záloha uložena.',
        exportFailed: 'Zálohu se nepodařilo uložit: {message}',
        showInFolder: 'Zobrazit ve složce',
        reading: 'Čtu soubor…',
        readFailed: 'Soubor se nepodařilo přečíst: {message}',
        importFailedTitle: 'Tohle obnovit nejde.',
        otherFile: 'Vybrat jiný soubor',
        preview: {
          eyebrow: 'Obsah zálohy',
          exported: 'Exportováno {when}',
          unknownDate: 'Datum exportu neznámé',
          version: 'VEYVO {version}',
          runs: 'Běhy',
          newRuns: { one: 'z toho {n} nový', few: 'z toho {n} nové', many: 'z toho {n} nového', other: 'z toho {n} nových' },
          noNewRuns: 'žádné nové',
          recovery: 'Regenerace',
          planned: 'Plán',
          profile: 'Profil',
          nutrition: 'Obsahuje i nastavení stránky Před během.',
          warnings: { one: '{n} záznam se nepodařilo načíst a obnoví se bez něj.', few: '{n} záznamy se nepodařilo načíst a obnoví se bez nich.', many: '{n} záznamu se nepodařilo načíst a obnoví se bez nich.', other: '{n} záznamů se nepodařilo načíst a obnoví se bez nich.' },
          merge: 'Sloučit',
          mergeText: 'Přidá běhy a záznamy, které tu ještě nejsou. Tvoje data, profil i nastavení zůstanou.',
          replace: 'Nahradit',
          replaceText: 'Smaže současná data v tomto zařízení a použije jen obsah zálohy.',
          replaceTitle: 'Nahradit všechna data zálohou?',
          replaceBody: 'V zařízení teď máš {current}. Po nahrazení zůstane jen obsah zálohy: {incoming}.',
          replaceSafety: 'Současná data se předtím uloží do samostatné zálohy v Automatických zálohách.',
          replaced: 'Záloha obnovena. Data jsou nahrazená.',
          merged: 'Záloha sloučena. {detail}'
        },
        auto: {
          title: 'Automatické zálohy',
          sub: 'VEYVO ukládá zálohu jednou denně a drží jich posledních {n}. Před nahrazením nebo smazáním dat uloží ještě samostatnou kopii.',
          kind: { replace: 'před nahrazením zálohou', wipe: 'před smazáním dat' },
          lastFailed: 'Poslední automatickou zálohu se nepodařilo uložit: {message}',
          empty: 'Zatím tu žádná automatická záloha není. První vznikne po první změně dat.',
          failed: 'Seznam záloh se nepodařilo načíst: {message}',
          restore: 'Obnovit',
          restoreAria: 'Obnovit zálohu z {date}',
          size: '{n} kB',
          showAll: 'Zobrazit všechny ({n})',
          showLess: 'Zobrazit méně'
        },
        danger: {
          title: 'Smazat všechna data',
          sub: 'Nevratně v tomto zařízení',
          text: 'Smaže běhy, regeneraci, plán, profil i nastavení stránky Před během. Motiv, jazyk a propojení zůstanou.',
          strava: 'Připojená Strava pak znovu načte běhy za posledních 45 dní.',
          safety: 'Současná data se předtím uloží do samostatné zálohy v Automatických zálohách, takže je půjde obnovit.',
          exportFirst: 'Tahle verze nemá automatické zálohy. Nejdřív si zálohu exportuj.',
          start: 'Smazat všechna data…',
          typeLabel: 'Pro potvrzení napiš {word}',
          word: 'SMAZAT',
          button: 'Smazat všechna data',
          done: 'Všechna data jsou smazaná.',
          doneText: 'Profil začíná nanovo. Úvodní průvodce ti ho pomůže nastavit.',
          restart: 'Spustit úvodního průvodce',
          safetyFailedTitle: 'Zálohu se nepodařilo uložit',
          safetyFailed: 'Současná data se nepodařilo zálohovat ({message}). Pokračovat i tak?'
        }
      },
      updates: {
        installed: 'Nainstalovaná verze',
        check: 'Zkontrolovat aktualizace',
        restart: 'Restartovat a aktualizovat',
        download: 'Stáhnout verzi {version}',
        checked: 'Zkontrolováno {when}',
        progress: 'Staženo {percent} %',
        progressSize: 'Staženo {percent} % · {done} z {total} MB',
        source: 'Aktualizace se stahují z vydání VEYVO na GitHubu.',
        howDesktop: 'VEYVO hledá novou verzi pokaždé po spuštění. Stáhne ji na pozadí a nainstaluje se, až VEYVO zavřeš.',
        howAndroid: 'VEYVO se na nové vydání na GitHubu ptá jednou denně. Instalaci APK vždy potvrzuješ ty.',
        badge: {
          idle: 'Nezkontrolováno', checking: 'Kontrola', available: 'Nová verze', progress: 'Stahování', ready: 'Připraveno',
          current: 'Aktuální', error: 'Chyba', development: 'Vývoj', opened: 'Otevřeno', unsupported: 'Nedostupné', newer: 'Nová verze'
        },
        state: {
          idle: 'Zatím nezkontrolováno',
          idleText: 'Zjisti, jestli je k dispozici novější verze.',
          checking: 'Hledám novou verzi',
          checkingText: 'Obvykle to trvá jen chvíli.',
          available: 'Je dostupná verze {version}',
          availableText: 'Stahuje se na pozadí. Až bude připravená, stačí restart.',
          availableAndroid: 'Stáhne se z GitHubu jako soubor APK. Instalaci pak potvrdíš v Androidu.',
          progress: 'Stahuji aktualizaci',
          ready: 'Aktualizace je připravená',
          readyText: 'Restartuj VEYVO a nainstaluje se verze {version}.',
          current: 'Máš nejnovější verzi',
          currentText: 'VEYVO {version} je aktuální.',
          newer: 'Vyšla verze {version}',
          newerText: 'Soubor APK pro Android k ní ještě není. VEYVO to zkusí znovu při dalším spuštění.',
          openRelease: 'Otevřít vydání',
          error: 'Kontrola se nezdařila',
          errorText: 'Zkontroluj připojení k internetu a zkus to znovu.',
          development: 'Vývojová verze',
          developmentText: 'Aktualizace fungují až v nainstalované aplikaci.',
          opened: 'Stahování se otevřelo v prohlížeči',
          openedText: 'Po stažení otevři soubor APK a potvrď instalaci.',
          unsupported: 'Tady se aktualizace nekontrolují',
          unsupportedText: 'Nové verze hlídá aplikace pro Windows a Android.'
        }
      },
      about: {
        tagline: 'Běžecký deník',
        version: 'verze {version}',
        platform: { desktop: 'Windows', android: 'Android', ios: 'iPhone', web: 'Web' },
        privacyTitle: 'Tvoje data',
        privacySub: 'Bez účtu a bez cloudu',
        privacy: 'VEYVO nemá účet ani cloud. Běhy, regenerace, plán i profil zůstávají v tomto zařízení.',
        privacyOut: 'Ven odcházejí data jen přes volitelné propojení: Strava (načítání tvých běhů) a intervals.icu (odesílání tréninků). Kontrola aktualizací se GitHubu ptá jen na číslo nejnovější verze.',
        privacyOutStore: 'Ven odcházejí data jen přes volitelné propojení s intervals.icu, když do něj pošleš trénink.',
        privacyHealth: 'Běhy z Apple Zdraví VEYVO jen čte a ukládá v tomto iPhonu. Nikam je neposílá a do Zdraví nic nezapisuje.',
        privacyPolicy: 'Zásady ochrany osobních údajů',
        healthTitle: 'Zdravotní upozornění',
        healthSub: 'Obecné rady, ne lékařská péče',
        medical: 'VEYVO není zdravotnický prostředek a neslouží k diagnóze, léčbě, vyléčení ani prevenci žádného onemocnění. Rady k tréninku, regeneraci a jídlu jsou obecné.',
        medicalConsult: 'Před náročnějším tréninkem nebo při zdravotních potížích se poraď s lékařem.',
        licences: 'Licence',
        licencesSub: 'Software třetích stran v aplikaci',
        inter: 'písmo pro texty · © 2016 The Inter Project Authors',
        barlow: 'písmo pro čísla · © 2017 The Barlow Project Authors',
        workoutkit: 'export tréninků pro Apple Watch · © 2026 Bartosz Legięć',
        electron: 'aplikace pro Windows · © OpenJS Foundation a přispěvatelé',
        capacitor: 'aplikace pro Android · © Ionic',
        capacitorIos: 'aplikace pro iPhone · © Ionic',
        shortcuts: 'Klávesové zkratky',
        shortcutLog: 'Zapsat běh',
        shortcutClose: 'Zavřít okno nebo dialog',
        shortcutTabs: 'Přepínat sekce nastavení'
      }
    },
    en: {
      title: 'Settings',
      navLabel: 'Settings sections',
      section: {
        profile: 'Profile and goal', appearance: 'Appearance and language', connections: 'Connections',
        data: 'Data and backups', updates: 'Updates', about: 'About'
      },
      lead: {
        profile: 'Your name, goal and the days you can run. VEYVO plans your next run from them and shows how far you are from your goal.',
        appearance: 'Theme and language change right away and stay saved.',
        connections: 'Both services are optional. Without them VEYVO works fully offline.',
        connectionsStore: 'The intervals.icu link is optional. Without it VEYVO works fully offline.',
        connectionsIos: 'Apple Health and intervals.icu are both optional. Without them VEYVO works fully offline.',
        data: 'Everything is stored on this device only. Download a backup to a file and restore it here.',
        updates: 'New VEYVO versions and how to install them.',
        about: 'Version, privacy, health notice and licences.'
      },
      dot: { attention: 'needs attention', unsaved: 'unsaved changes', update: 'an update is available' },
      when: { today: 'today {time}', yesterday: 'yesterday {time}', date: '{date}, {time}' },
      profile: {
        you: 'You',
        name: 'What should we call you',
        namePlaceholder: 'Name or nickname',
        nameHint: 'Shown in the sidebar. You can leave it empty.',
        goal: 'Goal',
        distance: 'Goal distance',
        custom: 'Custom',
        customLabel: 'Custom distance',
        target: 'Target time',
        targetPlaceholder: 'mm:ss',
        targetHint: 'For example 20:00 or 1:45:00. Leave it empty for a goal without a time.',
        pace: 'Goal pace',
        paceNone: 'no target time',
        speed: '{speed} km/h',
        best: 'Best at {distance} km',
        bestNone: 'no {distance} km run yet',
        gap: 'To the goal',
        gapLeft: 'left to the goal',
        gapPace: '{s} s/km faster',
        reached: 'Reached',
        reachedSub: 'you have beaten your goal',
        days: 'When you can run',
        daysHint: 'VEYVO plans your next run on the chosen days only.',
        daysCount: { one: '{n} day a week', other: '{n} days a week' },
        unsaved: 'Unsaved changes',
        saved: 'Profile saved',
        save: 'Save',
        discard: 'Discard',
        discardTitle: 'Discard unsaved changes?',
        discardBody: 'Changes to your name, goal and running days will not be saved.',
        error: {
          'target-format': 'Enter the time as mm:ss or h:mm:ss, e.g. 20:00.',
          'target-implausible': 'That pace would be faster than 2:00/km. Write hours as h:mm:ss, e.g. 1:45:00.'
        }
      },
      appearance: {
        theme: 'Theme',
        themeSub: 'Applies to the whole app and the window bar.',
        themeSubApp: 'Applies to the whole app.',
        dark: 'Dark',
        light: 'Light',
        language: 'Language',
        languageSub: 'Translates the whole app, including dates and numbers.',
        sample: 'How dates and numbers look now'
      },
      strava: {
        title: 'Strava',
        sub: 'Importing runs',
        status: {
          connected: 'Connected', off: 'Not connected', error: 'Sync error', reauth: 'Needs a new sign-in',
          syncing: 'Syncing…', waiting: 'Waiting for sign-in', unsupported: 'Windows only'
        },
        lead: 'Imports your Strava runs from the last 45 days: start date and time, distance, moving time, name, average heart rate and elevation gain.',
        rules: 'If you also log a run by hand, your time and distance win. A run deleted in VEYVO is not imported again.',
        account: 'Account',
        lastSync: 'Last sync',
        never: 'never yet',
        syncNow: 'Sync now',
        connect: 'Connect Strava',
        reconnect: 'Sign in again',
        disconnect: 'Disconnect',
        disconnectTitle: 'Disconnect Strava?',
        disconnectBody: 'Runs already in VEYVO stay. New ones stop coming in and the sign-in data is removed from this computer.',
        reauthTitle: 'Strava rejected the saved sign-in.',
        reauthText: 'Connect your account again; your runs stay.',
        errorTitle: 'The last sync failed.',
        waitingTitle: 'Finish signing in in your browser.',
        waitingText: 'Once you allow access, the connection confirms itself here.',
        retry: 'Enter again',
        ignored: { one: '{n} deleted Strava run is not imported again.', other: '{n} deleted Strava runs are not imported again.' },
        restoreIgnored: 'Allow re-import',
        unsupportedTitle: 'Strava is only in the Windows version for now.',
        unsupportedText: 'VEYVO for Windows imports your Strava runs. To bring them to your phone, export a backup on the computer and restore it here under Data and backups.',
        form: {
          title: 'Connecting Strava',
          intro: 'VEYVO connects to Strava through a Strava API application with Client ID {id}. Strava needs its Client Secret to sign you in.',
          step1: 'You find the Client Secret at strava.com/settings/api in the account that created application {id}. Without it Strava cannot be connected.',
          step2: 'In that application, “Authorization Callback Domain” must be set to localhost.',
          step3: 'When you continue, your browser opens. Sign in to Strava and allow access.',
          openApi: 'Open strava.com/settings/api',
          secret: 'Strava Client Secret',
          secretHint: 'At least 8 characters, no spaces.',
          show: 'Show',
          hide: 'Hide',
          consent: 'I allow VEYVO to read my Strava activities (read and activity:read_all permissions).',
          privacy: 'Windows encrypts the Client Secret and the sign-in tokens, and they stay on this computer only.',
          submit: 'Continue to Strava',
          secretInvalid: 'The Client Secret has at least 8 characters and no spaces.',
          consentMissing: 'Confirm that VEYVO may read your activities.'
        }
      },
      health: {
        title: 'Apple Health',
        sub: 'Automatic run import',
        status: { off: 'Off', on: 'On', importing: 'Importing…', error: 'Import failed' },
        lead: 'VEYVO reads your runs from the Health app: date and start time, distance, time, and average and maximum heart rate. Apple Watch and the apps of other watches write them there.',
        lastImport: 'Last import',
        never: 'not yet',
        import: 'Import runs',
        importAgain: 'Import new runs',
        stop: 'Turn off automatic import',
        stopped: 'Automatic import from Apple Health is off. Imported runs stay.',
        auto: 'New runs are imported on their own when you open VEYVO.',
        imported: { one: '{n} run added from Apple Health.', other: '{n} runs added from Apple Health.' },
        updated: { one: '{n} run completed with Apple Health data.', other: '{n} runs completed with Apple Health data.' },
        upToDate: 'No new runs, everything is imported already.',
        none: 'VEYVO found no runs in Apple Health. If you have some there, check that VEYVO may read workouts.',
        skipped: { one: '{n} run without a distance was not imported.', other: '{n} runs without a distance were not imported.' },
        errorTitle: 'The last import failed.',
        ignored: { one: '{n} deleted Apple Health run is not imported again.', other: '{n} deleted Apple Health runs are not imported again.' },
        restoreIgnored: 'Allow importing again',
        reads: 'VEYVO only reads running workouts, distance and heart rate from Health. It writes nothing to Health and sends no data off this iPhone.',
        rules: 'The first import reads the last 90 days, later ones only new runs. When you also log a run by hand, your time and distance win.',
        permission: 'You can change what VEYVO may read in the Health app, in your profile settings, in the list of apps.'
      },
      intervals: {
        title: 'intervals.icu',
        sub: 'Sending workouts',
        status: { connected: 'Connected', off: 'Not connected', saved: 'Key saved', error: 'Error', checking: 'Checking…', loading: 'Loading…' },
        lead: 'Sends planned workouts to your intervals.icu calendar. From there they reach the watch you have linked to intervals.icu.',
        key: 'API key',
        keyPlaceholder: 'Paste your API key',
        keyHint: 'Find it in intervals.icu under {path}.',
        pathSettings: 'Settings',
        pathDeveloper: 'Developer Settings',
        openSite: 'Open intervals.icu',
        saveTest: 'Verify and save',
        saveAnyway: 'Save without checking',
        test: 'Test connection',
        change: 'Change key',
        remove: 'Remove key',
        removeTitle: 'Remove the intervals.icu API key?',
        removeBody: 'Workouts cannot be sent to intervals.icu until you enter the key again. Nothing is deleted in intervals.icu.',
        removed: 'intervals.icu key removed.',
        savedToast: 'intervals.icu key saved.',
        savedKey: 'Saved key ending in',
        ok: 'The connection works.',
        okAccount: 'The connection works. Account: {name}',
        keyMissing: 'Paste the API key.',
        lastPush: 'Last workout sent: {when}',
        lastError: 'The last send failed: {message}',
        storeEncrypted: 'Windows encrypts the key and it stays on this computer only.',
        storePlain: 'On Android the key is kept in the app’s private storage, but it is not encrypted.',
        storePlainIos: 'On iPhone the key is kept in the app’s private storage, but it is not encrypted.',
        storeMemory: 'In this version the key is kept only until the app closes.',
        storeNone: 'This version cannot store the key safely.'
      },
      data: {
        deviceTitle: 'On this device',
        deviceSub: 'Runs, recovery, plan, profile and your Before the run settings.',
        runsLabel: { one: 'run', other: 'runs' },
        recoveryLabel: { one: 'recovery entry', other: 'recovery entries' },
        plannedLabel: { one: 'planned workout', other: 'planned workouts' },
        export: 'Export backup',
        import: 'Restore from a file',
        fileName: 'veyvo-backup-{date}.json',
        fileHint: 'A backup is one JSON file. Restore it here or on another device with VEYVO.',
        exported: 'Backup saved.',
        exportFailed: 'The backup could not be saved: {message}',
        showInFolder: 'Show in folder',
        reading: 'Reading the file…',
        readFailed: 'The file could not be read: {message}',
        importFailedTitle: 'This cannot be restored.',
        otherFile: 'Choose another file',
        preview: {
          eyebrow: 'Backup contents',
          exported: 'Exported {when}',
          unknownDate: 'Export date unknown',
          version: 'VEYVO {version}',
          runs: 'Runs',
          newRuns: { one: '{n} of them new', other: '{n} of them new' },
          noNewRuns: 'none new',
          recovery: 'Recovery',
          planned: 'Plan',
          profile: 'Profile',
          nutrition: 'Also contains your Before the run settings.',
          warnings: { one: '{n} entry could not be read and is left out.', other: '{n} entries could not be read and are left out.' },
          merge: 'Merge',
          mergeText: 'Adds the runs and entries that are not here yet. Your data, profile and settings stay.',
          replace: 'Replace',
          replaceText: 'Deletes the current data on this device and uses only the backup.',
          replaceTitle: 'Replace all data with the backup?',
          replaceBody: 'This device now holds {current}. After replacing, only the backup remains: {incoming}.',
          replaceSafety: 'The current data is saved to a separate backup under Automatic backups first.',
          replaced: 'Backup restored. Your data is replaced.',
          merged: 'Backup merged. {detail}'
        },
        auto: {
          title: 'Automatic backups',
          sub: 'VEYVO saves a backup once a day and keeps the latest {n}. Before replacing or deleting your data it also saves a separate copy.',
          kind: { replace: 'before a replace', wipe: 'before deleting data' },
          lastFailed: 'The last automatic backup could not be saved: {message}',
          empty: 'No automatic backup yet. The first one is made after your first change.',
          failed: 'The backup list could not be loaded: {message}',
          restore: 'Restore',
          restoreAria: 'Restore the backup from {date}',
          size: '{n} kB',
          showAll: 'Show all ({n})',
          showLess: 'Show fewer'
        },
        danger: {
          title: 'Delete all data',
          sub: 'Cannot be undone on this device',
          text: 'Deletes runs, recovery, plan, profile and your Before the run settings. Theme, language and connections stay.',
          strava: 'A connected Strava then imports the runs from the last 45 days again.',
          safety: 'The current data is saved to a separate backup under Automatic backups first, so you can restore it.',
          exportFirst: 'This version has no automatic backups. Export a backup first.',
          start: 'Delete all data…',
          typeLabel: 'Type {word} to confirm',
          word: 'DELETE',
          button: 'Delete all data',
          done: 'All data is deleted.',
          doneText: 'Your profile starts from scratch. The welcome guide helps you set it up.',
          restart: 'Start the welcome guide',
          safetyFailedTitle: 'The backup could not be saved',
          safetyFailed: 'The current data could not be backed up ({message}). Continue anyway?'
        }
      },
      updates: {
        installed: 'Installed version',
        check: 'Check for updates',
        restart: 'Restart and update',
        download: 'Download version {version}',
        checked: 'Checked {when}',
        progress: '{percent} % downloaded',
        progressSize: '{percent} % downloaded · {done} of {total} MB',
        source: 'Updates download from the VEYVO releases on GitHub.',
        howDesktop: 'VEYVO looks for a new version every time it starts. It downloads in the background and installs when you close VEYVO.',
        howAndroid: 'VEYVO asks GitHub for a new release once a day. You always confirm the APK installation yourself.',
        badge: {
          idle: 'Not checked', checking: 'Checking', available: 'New version', progress: 'Downloading', ready: 'Ready',
          current: 'Up to date', error: 'Error', development: 'Development', opened: 'Opened', unsupported: 'Unavailable', newer: 'New version'
        },
        state: {
          idle: 'Not checked yet',
          idleText: 'Find out whether a newer version is available.',
          checking: 'Looking for a new version',
          checkingText: 'This usually takes a moment.',
          available: 'Version {version} is available',
          availableText: 'It downloads in the background. When it is ready, a restart is all it takes.',
          availableAndroid: 'It downloads from GitHub as an APK file. You then confirm the installation in Android.',
          progress: 'Downloading the update',
          ready: 'The update is ready',
          readyText: 'Restart VEYVO to install version {version}.',
          current: 'You have the latest version',
          currentText: 'VEYVO {version} is up to date.',
          newer: 'Version {version} is out',
          newerText: 'Its Android APK file is not there yet. VEYVO tries again the next time it starts.',
          openRelease: 'Open the release',
          error: 'The check failed',
          errorText: 'Check your internet connection and try again.',
          development: 'Development build',
          developmentText: 'Updates only work in the installed app.',
          opened: 'The download opened in your browser',
          openedText: 'When it finishes, open the APK file and confirm the installation.',
          unsupported: 'Updates are not checked here',
          unsupportedText: 'The Windows and Android apps look for new versions.'
        }
      },
      about: {
        tagline: 'Running journal',
        version: 'version {version}',
        platform: { desktop: 'Windows', android: 'Android', ios: 'iPhone', web: 'Web' },
        privacyTitle: 'Your data',
        privacySub: 'No account, no cloud',
        privacy: 'VEYVO has no account and no cloud. Your runs, recovery, plan and profile stay on this device.',
        privacyOut: 'Data leaves the device only through the optional links: Strava (importing your runs) and intervals.icu (sending workouts). The update check only asks GitHub for the latest version number.',
        privacyOutStore: 'Data leaves the device only through the optional intervals.icu link, when you send a workout there.',
        privacyHealth: 'VEYVO only reads runs from Apple Health and keeps them on this iPhone. It sends them nowhere and writes nothing to Health.',
        privacyPolicy: 'Privacy policy',
        healthTitle: 'Health notice',
        healthSub: 'General guidance, not medical care',
        medical: 'VEYVO is not a medical device and does not diagnose, treat, cure or prevent any medical condition. Its training, recovery and nutrition tips are general guidance.',
        medicalConsult: 'Talk to a doctor or another healthcare professional before harder training or if you have health concerns.',
        licences: 'Licences',
        licencesSub: 'Third-party software in the app',
        inter: 'text typeface · © 2016 The Inter Project Authors',
        barlow: 'number typeface · © 2017 The Barlow Project Authors',
        workoutkit: 'Apple Watch workout export · © 2026 Bartosz Legięć',
        electron: 'Windows app · © OpenJS Foundation and contributors',
        capacitor: 'Android app · © Ionic',
        capacitorIos: 'iPhone app · © Ionic',
        shortcuts: 'Keyboard shortcuts',
        shortcutLog: 'Log a run',
        shortcutClose: 'Close a window or dialog',
        shortcutTabs: 'Switch settings sections'
      }
    }
  };
  I18n.register('settings', MESSAGES);
  const t = (key, params) => app.t('settings.' + key, params);

  // ================================================================ constants
  const SECTIONS = Object.freeze(['profile', 'appearance', 'connections', 'data', 'updates', 'about']);
  // A store build (Google Play) has no Aktualizace: Google Play installs updates, the version is in O aplikaci.
  const STORE_SECTIONS = Object.freeze(SECTIONS.filter(s => s !== 'updates'));
  const SECTION_ICON = Object.freeze({ profile: 'user', appearance: 'sun', connections: 'link', data: 'database', updates: 'download', about: 'info' });
  const SECTION_ALIASES = Object.freeze({
    strava: 'connections', intervals: 'connections', connection: 'connections', language: 'appearance', theme: 'appearance',
    backup: 'data', backups: 'data', update: 'updates', goal: 'profile', days: 'profile'
  });
  const GOAL_PRESETS = Object.freeze([5, 10, 21.1, 42.2]);
  const STRAVA_CLIENT_ID = '275720';
  const STRAVA_API_URL = 'https://www.strava.com/settings/api';
  const INTERVALS_SITE = 'https://intervals.icu/settings';
  const INTERVALS_SECRET = 'intervals-api-key';            // same name as ui/workout-sheet.js
  const INTERVALS_ATHLETE_URL = 'https://intervals.icu/api/v1/athlete/0';
  // Public privacy policy (GitHub Pages, cs + en), opened in the system browser via VeyvoPlatform.openExternal.
  const PRIVACY_URL = 'https://pepibikerbtw.github.io/VEYVO/privacy/';
  const BACKUP_ROWS = 5;
  const NAME_MAX = (Store.LIMITS && Store.LIMITS.maxProfileName) || 40;
  const MIN_PACE = 120;                                   // s/km: faster than 2:00/km is a typo
  const STORE_FIELD = Object.freeze({ 'name-invalid': 'name', 'name-too-long': 'name', 'goal-distance-invalid': 'distance', 'target-invalid': 'target', 'days-invalid': 'days' });

  // ================================================================ pure helpers (VeyvoUI.settings)
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const pad2 = n => String(n).padStart(2, '0');

  /** The sections a build shows ({ store } from app.build): a store build has no 'updates'. */
  function sectionsFor(build) { return build && build.store ? STORE_SECTIONS : SECTIONS; }

  /**
   * The Propojení groups of a build and platform kind: a store build has no Strava at all (not even
   * a "Windows only" note); the iPhone app has Apple Zdraví instead (and never names other platforms).
   */
  function connectionsFor(build, kind) {
    if (kind === 'ios') return ['health', 'intervals'];
    return build && build.store ? ['intervals'] : ['strava', 'intervals'];
  }

  /** Apple Zdraví card state: 'importing' | 'error' | 'on' | 'off' from state.health and the busy flag. */
  function healthKey(health, busy) {
    if (busy) return 'importing';
    const st = health || {};
    if (st.lastError) return 'error';
    return st.enabled ? 'on' : 'off';
  }

  /** Toast text for a finished import: { key, n } of 'health.imported' | 'health.updated' | 'health.upToDate' | 'health.none', or null (automatic import, nothing new). */
  function healthToast(result, rows, manual) {
    if (result.added > 0) return { key: 'health.imported', n: result.added };
    if (!manual) return null;
    if (result.updated > 0) return { key: 'health.updated', n: result.updated };
    return { key: rows > 0 ? 'health.upToDate' : 'health.none', n: rows };
  }

  /** 'strava' -> 'connections'; unknown -> 'profile'; a section the build does not show ('updates' in a store build) -> 'about'. */
  function sectionOf(name, sections) {
    const list = Array.isArray(sections) ? sections : SECTIONS;
    const s = String(name || '');
    const found = SECTIONS.indexOf(s) >= 0 ? s : (SECTION_ALIASES[s] || 'profile');
    return list.indexOf(found) >= 0 ? found : 'about';
  }

  /**
   * Target time input -> { empty } | { seconds } | { invalid }. Accepts 'mm:ss', 'h:mm:ss', dots or
   * commas as separators (Android number pads have no colon: '20.00', '1.45.00') and bare minutes ('20').
   */
  function parseTarget(text) {
    const raw = String(text === null || text === undefined ? '' : text).trim();
    if (!raw) return { empty: true, seconds: null };
    let s = raw.replace(/\s+/g, '');
    if (/^\d{1,3}$/.test(s)) return { seconds: Number(s) * 60 };
    s = s.replace(/[.,]/g, ':');
    const seconds = Format.parseDuration(s);
    return seconds === null ? { invalid: true, seconds: null } : { seconds };
  }

  /** '7,5', '7.5 km', ' 12 ' -> number; anything else (or <= 0) -> null. */
  function parseKm(text) {
    const s = String(text === null || text === undefined ? '' : text).trim().toLowerCase().replace(/\s*km$/, '').replace(/\s+/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return n > 0 ? n : null;
  }

  /** 5 -> '5', 21.1 -> '21.1', 7 -> 'custom' */
  function presetOf(km) {
    const n = Number(km);
    const hit = GOAL_PRESETS.find(p => Math.abs(p - n) < 1e-9);
    return hit === undefined ? 'custom' : String(hit);
  }

  /** Editable copy of a v2 profile (strings as the inputs show them). */
  function draftFromProfile(profile) {
    const p = profile || {};
    const km = isNum(Number(p.goalDistanceKm)) && Number(p.goalDistanceKm) > 0 ? Number(p.goalDistanceKm) : 5;
    const preset = presetOf(km);
    return {
      name: typeof p.name === 'string' ? p.name : '',
      preset,
      customKm: preset === 'custom' ? Format.number(km, { maxDecimals: 3, grouping: false }) : '',
      target: isNum(p.targetSeconds) && p.targetSeconds > 0 ? Format.duration(p.targetSeconds) : '',
      days: Array.isArray(p.days) ? p.days.slice().sort((a, b) => a - b) : []
    };
  }

  function draftKm(d) { return d.preset === 'custom' ? parseKm(d.customKm) : Number(d.preset); }

  /** Canonical value of a draft, so '5:00' vs '05:00' or a leftover custom km are not "changes". */
  function draftKey(d) {
    if (!d) return '';
    const target = parseTarget(d.target);
    return JSON.stringify([String(d.name || '').trim(), draftKm(d), target.empty ? null : (target.invalid ? 'x' + d.target : target.seconds), (d.days || []).slice().sort().join(',')]);
  }

  /**
   * profilePatch(draft) -> { ok: true, patch } for VeyvoStore.setProfile, or { ok: false, errors:
   * { field: code } } with store codes (store.error.*) or the local 'target-format' / 'target-implausible'.
   */
  function profilePatch(d) {
    const errors = {};
    const km = draftKm(d);
    if (!(km >= 1 && km <= 100)) errors.distance = 'goal-distance-invalid';
    const target = parseTarget(d.target);
    if (target.invalid) errors.target = 'target-format';
    else if (!target.empty && (target.seconds < 60 || target.seconds > 172800)) errors.target = 'target-invalid';
    else if (!target.empty && km > 0 && target.seconds / km < MIN_PACE) errors.target = 'target-implausible';
    const name = String(d.name || '').trim();
    if (Array.from(name).length > NAME_MAX) errors.name = 'name-too-long';
    if (!Array.isArray(d.days) || !d.days.length) errors.days = 'days-invalid';
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, patch: { name, goalDistanceKm: km, targetSeconds: target.empty ? null : target.seconds, days: d.days.slice().sort((a, b) => a - b) } };
  }

  /** Goal pace in s/km (target / distance) or null. */
  function goalPace(km, seconds) { return km > 0 && seconds > 0 ? seconds / km : null; }

  /** Live goal preview of a draft against the runner's runs (VeyvoRuns.goalProgress). */
  function goalPreview(d, runs) {
    const km = draftKm(d);
    if (!(km >= 1 && km <= 100)) return { km: null };
    const target = parseTarget(d.target);
    const seconds = !target.empty && !target.invalid && target.seconds >= 60 ? target.seconds : null;
    const g = Runs.goalProgress({ goalDistanceKm: km, targetSeconds: seconds }, runs || []);
    const pace = goalPace(km, seconds);
    return {
      km, target: seconds, pace: pace !== null && pace >= MIN_PACE ? pace : null,
      best: g.best, bestDate: g.bestDate, bestPace: g.bestPace, gap: g.gapSeconds, pacePerKmGap: g.pacePerKmGap, reached: g.reached
    };
  }

  /** Strava errors that mean the stored sign-in no longer works (401, refused refresh token). */
  function isReauthError(message) {
    return /\b401\b|unauthori[sz]ed|authorization error|invalid[_ ]grant|invalid refresh|refresh token|bad request|není připojená|not connected/i.test(String(message || ''));
  }

  /** 'veyvo-zaloha-2026-11-27.json' (cs) / 'veyvo-backup-2026-11-27.json' (en). */
  function backupFileName(dateKey, locale) { return I18n.t('settings.data.fileName', { date: String(dateKey) }, locale); }

  function confirmWord(locale) { return I18n.t('settings.data.danger.word', null, locale); }
  /** Typed confirmation for "Smazat všechna data": the word of the current language, any case. */
  function confirmMatches(text, locale) {
    return String(text || '').trim().toLocaleUpperCase() === confirmWord(locale).toLocaleUpperCase();
  }

  /** Last 4 characters of a stored key (shown as '•••• abcd'). */
  function maskKey(key) { const k = String(key || ''); return k.length > 4 ? k.slice(-4) : ''; }

  /** intervals.icu athlete JSON -> display name or null. */
  function athleteName(json) {
    if (!json || typeof json !== 'object') return null;
    if (typeof json.name === 'string' && json.name.trim()) return json.name.trim();
    const parts = [json.firstname, json.lastname].filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
    return parts.length ? parts.join(' ') : null;
  }

  /**
   * "Smazat všechna data": a fresh v2 state that keeps only device preferences (theme, language,
   * ui) and the connection flags. ignoredStravaIds and strava.lastSync are cleared, so a connected
   * Strava can import the runs again (0.3 bug: deleted runs never came back); ignoredHealthIds and
   * health.lastImport likewise for Apple Health.
   */
  function wipeState(prev) {
    const p = prev || {};
    const fresh = Store.DEFAULT_STATE();
    if (p.theme === 'light' || p.theme === 'dark') fresh.theme = p.theme;
    if (p.language === 'cs' || p.language === 'en') fresh.language = p.language;
    fresh.strava = { connected: !!(p.strava && p.strava.connected), lastSync: null, lastError: null };
    fresh.intervals = { enabled: !!(p.intervals && p.intervals.enabled), lastPush: null, lastError: null };
    // Apple Health stays switched on, but the next import reads the last 90 days again
    fresh.health = { enabled: !!(p.health && p.health.enabled), lastImport: null, lastError: null };
    if (p.ui && typeof p.ui === 'object') fresh.ui = JSON.parse(JSON.stringify(p.ui));
    return fresh;
  }

  /** What a parsed backup holds, and how many of its runs a merge would add (a real dry run). */
  function importSummary(current, parsed) {
    const s = parsed.state;
    const merge = Store.applyBackup(current, parsed, { mode: 'merge' });
    const runs = s.runHistory || [];
    return {
      runs: runs.length,
      firstDate: runs.length ? runs[0].date : null,
      lastDate: runs.length ? runs[runs.length - 1].date : null,
      recovery: (s.recoveryLogs || []).length,
      planned: (s.plannedWorkouts || []).length,
      profile: s.profile || null,
      nutrition: !!parsed.nutrition,
      exportedAt: parsed.exportedAt || null,
      appVersion: parsed.appVersion || null,
      warnings: (parsed.warnings || []).filter(w => /dropped|invalid/.test(String(w && w.code))).length,
      newRuns: merge.ok && merge.stats ? merge.stats.added : 0,
      updatedRuns: merge.ok && merge.stats ? merge.stats.updated : 0
    };
  }

  const UPDATE_KEYS = ['checking', 'available', 'progress', 'ready', 'current', 'error', 'development', 'opened', 'newer'];
  /** Updater status (desktop electron-updater or Android GitHub check) -> a view key + numbers. */
  function updateView(status, supported) {
    if (!supported) return { key: 'unsupported' };
    if (!status || !status.type) return { key: 'idle' };
    const key = UPDATE_KEYS.indexOf(status.type) >= 0 ? status.type : 'error';
    const percent = Math.max(0, Math.min(100, Math.round(Number(status.percent) || 0)));
    const num = v => (isNum(Number(v)) && Number(v) > 0 ? Number(v) : null);
    return { key, version: status.version || null, percent, transferred: num(status.transferred), total: num(status.total), message: status.message || null, pageUrl: status.pageUrl || null, checkedAt: status.checkedAt || null };
  }

  // ================================================================ session view state
  function freshView() {
    return {
      handle: null, shell: null, main: null, section: 'profile', enter: true, phone: false,
      draft: null, errors: {}, offs: [], laneY: null, savedAt: 0, savedTimer: null, confirming: false, forceClose: false,
      pv: null, lastPace: null, jumpActive: null, spyRaf: 0, mq: null, onMq: null,
      strava: { open: false, secret: '', consent: false, show: false, error: null, busy: false, waiting: false },
      prevStravaKey: null,
      intervals: { loaded: false, loading: false, hasKey: false, tail: '', input: '', show: false, editing: false, busy: false, result: null, offerSave: false, loadError: null },
      backups: { list: null, loading: false, error: null, expanded: false },
      importing: null, reading: false,
      wipe: { open: false, text: '', busy: false, done: false },
      exporting: false,
      version: null, versionLoading: false, updateAt: null, lastPercent: 0,
      appear: new Set(), barShown: false
    };
  }
  let view = freshView();
  // VeyvoUI.app stores Strava errors through errorText(), which turns the main process's
  // "... (401)" into the generic network text; a manual sync returns the raw error, so the
  // "needs a new sign-in" state is remembered here until a sync succeeds or Strava reconnects.
  let stravaAuthFailed = false;

  // ================================================================ Apple Zdraví import (iPhone)
  // Lives outside the dialog: after the first import the app imports new runs on its own when it starts
  // and whenever it comes back to the foreground (at most every HEALTH_AUTO_MS).
  const HEALTH_AUTO_MS = 15 * 60 * 1000;
  const healthRun = { busy: false, last: null, startedAt: 0 };

  function healthSupported() {
    const p = P();
    return !!(p && p.kind === 'ios' && p.health && p.health.supported);
  }
  function renderIfOpen() { if (view.handle && view.handle.isOpen()) render(); }

  /**
   * importHealth({ manual }) -> Promise<{ ok, added?, updated?, invalid?, rows?, error? }>. Asks for read
   * access (the system sheet appears only the first time), reads running workouts from
   * VeyvoStore.healthImportSince and stores them with VeyvoStore.importHealthRuns. A manual import
   * always says what happened; an automatic one only speaks up when runs were added. Never throws.
   */
  async function importHealth(options) {
    const o = options || {};
    if (!healthSupported()) return { ok: false, unsupported: true };
    if (healthRun.busy) return { ok: false, busy: true };
    const H = P().health;
    healthRun.busy = true;
    healthRun.startedAt = Date.now();
    renderIfOpen();
    try {
      if (!(await H.isAvailable())) throw Object.assign(new Error('Apple Health is not available'), { code: 'health_unavailable' });
      await H.requestAuthorization();
      const rows = await H.importRuns({ since: Store.healthImportSince(app.state(), Date.now()) });
      const at = new Date().toISOString();
      const probe = Store.importHealthRuns(app.state(), rows, { at });
      let result = probe;
      const r = app.update(s => { result = Store.importHealthRuns(s, rows, { at }); return result; },
        { reason: 'health-import', render: probe.added > 0 || probe.updated > 0 ? true : 'shell' });
      if (!r.ok) throw Object.assign(new Error((r.errors || []).join(', ') || 'not saved'), { code: (r.errors && r.errors[0]) || 'failed' });
      healthRun.last = { ok: true, added: result.added, updated: result.updated, invalid: result.invalid, rows: rows.length };
      const toast = healthToast(result, rows.length, !!o.manual);
      if (toast) app.toast(t(toast.key, { n: toast.n }), { kind: toast.key === 'health.none' ? 'info' : 'success' });
      return Object.assign({ ok: true }, healthRun.last);
    } catch (err) {
      const message = err && err.code && I18n.has('store.error.' + err.code) ? app.t('store.error.' + err.code) : app.errorText(err);
      healthRun.last = { ok: false, error: message };
      app.update(s => { s.health = Object.assign({}, s.health, { lastError: String(message).slice(0, 500) }); }, { reason: 'health-error', render: 'shell' });
      if (o.manual) app.toast(message, { kind: 'error' });
      return { ok: false, error: message };
    } finally {
      healthRun.busy = false;
      renderIfOpen();
    }
  }

  function autoImportHealth() {
    if (!healthSupported() || healthRun.busy || !app.isReady()) return;
    const st = app.state();
    if (!st || !st.health || !st.health.enabled) return;
    if (healthRun.startedAt && Date.now() - healthRun.startedAt < HEALTH_AUTO_MS) return;
    importHealth({ manual: false });
  }

  app.on('ready', () => {
    if (!healthSupported()) return;
    setTimeout(autoImportHealth, 1500);
    const doc = root.document;
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => { if (!doc.hidden) autoImportHealth(); });
  });

  // ================================================================ small builders
  const icon = (name, size) => icons.get(name, size ? { size } : undefined);
  /** 'set-appear' once for a block that just opened (blocks are rebuilt on every render). */
  const appear = key => (view.appear.has(key) ? 'set-appear' : null);

  function chip(kind, label, iconName, extra) {
    return h('span', { class: ['chip', kind ? 'chip-' + kind : null, 'set-chip', extra] }, iconName ? icon(iconName) : null, h('span', label));
  }

  /** A settings card: header (icon tile, title, subtitle, end slot) + body. */
  function group(o) {
    const id = 'set-g-' + o.id;
    return h('section', { class: ['set-group', o.cls], 'aria-labelledby': id, dataset: { group: o.id } },
      h('div.set-group-head',
        o.icon ? h('span.set-ico', { class: o.iconCls || null }, icon(o.icon)) : null,
        h('div.set-group-titles', h('h4.set-group-title', { id }, o.title), o.sub ? h('p.set-group-sub', o.sub) : null),
        o.end ? h('div.set-group-end', o.end) : null),
      o.body && o.body.length !== 0 ? h('div', { class: ['set-group-body', o.bodyCls] }, o.body) : null);
  }

  /** Label/description on the left, control on the right (stacked on a phone). */
  function row(o) {
    return h('div', { class: ['set-row', o.cls] },
      o.icon ? h('span.set-row-ico', icon(o.icon)) : null,
      h('div.set-row-text', h('p.set-row-title', { id: o.titleId || null }, o.title), o.sub ? h('p.set-row-sub', o.sub) : null),
      o.control ? h('div.set-row-ctl', o.control) : null);
  }

  function note(iconName, text, cls) { return h('p', { class: ['set-note', cls] }, iconName ? icon(iconName, 14) : null, h('span', text)); }

  function callout(kind, title, text, extra) {
    return h('div', { class: ['callout', 'callout-' + kind, 'set-callout'], role: kind === 'danger' ? 'alert' : null },
      icon(kind === 'danger' || kind === 'warn' ? 'warning' : kind === 'good' ? 'check-circle' : 'info'),
      h('div.set-callout-main', title ? h('b', title + ' ') : null, text ? h('span', text) : null, extra || null));
  }

  function button(cls, label, o) {
    const opts = o || {};
    return h('button', {
      type: opts.type || 'button', class: ['btn', cls, opts.busy ? 'is-busy' : null], disabled: !!opts.disabled || !!opts.busy,
      dataset: { key: opts.key || undefined }, 'aria-label': opts.aria || null, onClick: opts.onClick || null
    }, opts.icon ? icon(opts.icon) : null, h('span', label), opts.iconEnd ? icon(opts.iconEnd, 15) : null);
  }

  function whenText(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    const key = Format.toDateKey(d);
    const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const today = app.today();
    if (key === today) return t('when.today', { time });
    if (key === Format.addDays(today, -1)) return t('when.yesterday', { time });
    return t('when.date', { date: fmt.date(key, 'short'), time });
  }

  function errText(code) {
    if (I18n.has('settings.profile.error.' + code)) return t('profile.error.' + code);
    return app.t('store.error.' + code);
  }

  // ================================================================ focus + scroll keeping
  function captureFocus(scope) {
    const a = root.document.activeElement;
    if (!a || !scope || !scope.contains(a)) return null;
    const key = a.getAttribute('data-key');
    if (!key) return null;
    let sel = null;
    try { if (typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch (e) { sel = null; }
    return { key, sel };
  }
  function restoreFocus(scope, f) {
    if (!f || !scope) return;
    let el = null;
    try { el = scope.querySelector('[data-key="' + CSS.escape(f.key) + '"]'); } catch (e) { el = null; }
    if (!el || typeof el.focus !== 'function' || el.disabled) return;
    el.focus({ preventScroll: true });
    if (f.sel && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(f.sel[0], f.sel[1]); } catch (e) { /* not a text field */ } }
  }
  function focusKey(key) {
    const hd = view.handle;
    if (!hd) return;
    const el = hd.el.querySelector('[data-key="' + CSS.escape(key) + '"]');
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: false });
  }

  // ================================================================ render
  function isDirty() { return !!view.draft && draftKey(view.draft) !== draftKey(draftFromProfile(app.state().profile)); }

  function render(opts) {
    const o = opts || {};
    const hd = view.handle;
    if (!hd || !hd.isOpen() || !view.shell) return;
    const phone = app.isPhone();
    const layoutChanged = phone !== view.phone;
    view.phone = phone;
    if (!view.draft) view.draft = draftFromProfile(app.state().profile);
    const oldScroller = phone ? hd.body : view.main;
    const keepScroll = !o.resetScroll && !layoutChanged && oldScroller ? oldScroller.scrollTop : 0;
    const focus = captureFocus(hd.el);
    hd.el.classList.toggle('set-is-phone', phone);
    view.pv = null;
    dom.mount(view.shell, phone ? buildPhone() : buildDesktop());
    view.shell.dataset.layout = phone ? 'phone' : 'desktop';
    view.main = phone ? null : view.shell.querySelector('.set-main');
    // fill the live parts first: the scroll position is restored on the final layout
    liveProfile(false);
    afterRender();
    countIn();
    const scroller = phone ? hd.body : view.main;
    if (scroller) scroller.scrollTop = keepScroll;
    restoreFocus(hd.el, focus);
    if (!phone) placeLane();
    else paintJump();
    view.enter = false;
    view.appear.clear();
  }

  /** Progress fills slide from the previous value (the element is new on every render). */
  function afterRender() {
    const fill = view.shell && view.shell.querySelector('.set-prog-fill');
    if (fill) {
      const to = Number(fill.dataset.to) / 100;
      const from = view.lastPercent / 100;
      fill.style.transform = 'scaleX(' + from + ')';
      void fill.offsetWidth;
      fill.style.transform = 'scaleX(' + to + ')';
      view.lastPercent = Number(fill.dataset.to);
    }
  }

  /** Numbers on the Data board count up when the section is entered. */
  function countIn() {
    if (!view.enter || !view.shell) return;
    view.shell.querySelectorAll('.set-count-n[data-n]').forEach((el, i) => motion.countUp(el, Number(el.dataset.n), { from: 0, delay: 80 + i * 60, format: v => fmt.number(Math.round(v)) }));
  }

  function identity() {
    const p = app.state().profile;
    return h('div.set-me',
      h('span.avatar.set-avatar', { 'aria-hidden': 'true' }),
      h('div.set-me-text', h('span.set-me-name.truncate'), h('span.set-me-goal.truncate', fmt.goal(p))));
  }
  /** The identity block follows the draft live (name and goal as you type). */
  function paintIdentity() {
    if (!view.shell) return;
    const d = view.draft;
    const name = (d && d.name.trim()) || app.state().profile.name || '';
    const shown = (d ? d.name.trim() : name) || app.t('ui.profile.anonymous');
    view.shell.querySelectorAll('.set-me').forEach(me => {
      const av = me.querySelector('.set-avatar');
      const initial = (d ? d.name.trim() : name).charAt(0).toLocaleUpperCase(app.language());
      av.replaceChildren(initial || icon('user', 16));
      me.querySelector('.set-me-name').textContent = shown;
      const built = d ? profilePatch(d) : null;
      if (built && built.ok) me.querySelector('.set-me-goal').textContent = fmt.goal(built.patch);
    });
  }

  function dotFor(section) {
    if (section === 'profile' && isDirty()) return 'unsaved';
    if (section === 'connections' && app.strava.supported) {
      const k = stravaKey(app.strava.status());
      if (k === 'error' || k === 'reauth') return 'attention';
    }
    if (section === 'connections' && healthSupported() && healthKey(app.state().health, healthRun.busy) === 'error') return 'attention';
    if (section === 'updates') {
      const u = updateView(app.updates.status(), app.updates.supported);
      if (u.key === 'ready' || u.key === 'available') return 'update';
    }
    return null;
  }
  function dotNode(section) {
    const d = dotFor(section);
    return d ? h('span.set-dot', { class: 'is-' + d }, h('span.sr-only', ', ' + t('dot.' + d))) : null;
  }

  /** The sections this build shows (no Aktualizace in a store build). */
  function shownSections() { return sectionsFor(app.build); }

  function sectionHead(s, id) {
    // a store build has no Strava, so Propojení is about intervals.icu only (plus Apple Zdraví on iPhone)
    const lead = s !== 'connections' ? 'lead.' + s
      : P().kind === 'ios' ? 'lead.connectionsIos' : app.build.store ? 'lead.connectionsStore' : 'lead.connections';
    return h('header.set-head', h('h3.set-title', { id: id || null }, t('section.' + s)), h('p.set-lead', t(lead)));
  }
  function sectionBody(s) {
    if (s === 'profile') return profileSection();
    if (s === 'appearance') return appearanceSection();
    if (s === 'connections') return connectionsSection();
    if (s === 'data') return dataSection();
    if (s === 'updates') return updatesSection();
    return aboutSection();
  }

  function buildDesktop() {
    const sec = view.section;
    const tabs = shownSections().map(s => h('button.set-tab', {
      type: 'button', role: 'tab', id: 'set-tab-' + s, 'aria-selected': s === sec ? 'true' : 'false', 'aria-controls': 'set-panel',
      tabindex: s === sec ? '0' : '-1', title: t('section.' + s), dataset: { key: 'set-tab:' + s, section: s }, onClick: () => select(s)
    }, icon(SECTION_ICON[s]), h('span.set-tab-label', t('section.' + s)), dotNode(s)));
    const lane = h('span.set-lane', { 'aria-hidden': 'true', style: { '--lane-y': (view.laneY === null ? 0 : view.laneY) + 'px', opacity: view.laneY === null ? 0 : 1 } });
    const list = h('div.set-tabs', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': t('navLabel'), onKeydown: tabKeys }, lane, tabs);
    const nav = h('div.set-nav', identity(), list, h('p.set-nav-foot', h('span.num', 'VEYVO ' + (view.version || ''))));
    const panel = h('section.set-panel#set-panel', { role: 'tabpanel', 'aria-labelledby': 'set-tab-' + sec, dataset: { section: sec } },
      sectionHead(sec), sectionBody(sec));
    return [nav, h('div.set-main', panel)];
  }

  function buildPhone() {
    const jump = h('nav.set-jump', { 'aria-label': t('navLabel') }, shownSections().map(s => h('button.set-jump-item', {
      type: 'button', dataset: { key: 'set-jump:' + s, section: s }, 'aria-current': s === view.jumpActive ? 'true' : null,
      onClick: () => scrollToSection(s, true)
    }, icon(SECTION_ICON[s], 15), h('span', t('section.' + s)), dotNode(s))));
    const secs = shownSections().map(s => h('section.set-sec', { id: 'set-sec-' + s, dataset: { section: s }, 'aria-labelledby': 'set-sec-t-' + s },
      sectionHead(s, 'set-sec-t-' + s), sectionBody(s)));
    return [identity(), jump, h('div.set-secs', secs)];
  }

  function placeLane() {
    const lane = view.shell.querySelector('.set-lane');
    const active = view.shell.querySelector('.set-tab[aria-selected="true"]');
    if (!lane || !active) return;
    const y = active.offsetTop + (active.offsetHeight - 20) / 2;
    if (view.laneY === null) {
      lane.style.transition = 'none';
      lane.style.setProperty('--lane-y', y + 'px');
      lane.style.opacity = '1';
      void lane.offsetWidth;
      lane.style.transition = '';
    } else if (y !== view.laneY) {
      (root.requestAnimationFrame || setTimeout)(() => lane.style.setProperty('--lane-y', y + 'px'));
    }
    view.laneY = y;
  }

  function tabKeys(e) {
    const list = shownSections();
    const i = list.indexOf(view.section);
    let n = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    if (n === null) return;
    e.preventDefault();
    select(list[n]);
    focusKey('set-tab:' + list[n]);
  }

  function select(s) {
    const next = sectionOf(s, shownSections());
    if (view.phone) { scrollToSection(next, true); return; }
    if (next === view.section) return;
    view.section = next;
    view.enter = true;
    render({ resetScroll: true });
  }

  // ---------------------------------------------------------------- phone: jump bar + scroll spy
  function scrollToSection(s, smooth) {
    const hd = view.handle;
    if (!hd) return;
    const sec = hd.el.querySelector('#set-sec-' + s);
    if (!sec) return;
    view.jumpActive = s;
    paintJump();
    const jump = hd.el.querySelector('.set-jump');
    const offset = (jump ? jump.offsetHeight : 0) + 4;
    const top = s === shownSections()[0] ? 0 : sec.offsetTop - offset;
    const behavior = smooth && !motion.prefersReduced() ? 'smooth' : 'auto';
    hd.body.scrollTo({ top: Math.max(0, top), behavior });
  }
  function paintJump() {
    const hd = view.handle;
    if (!hd) return;
    const active = view.jumpActive || 'profile';
    hd.el.querySelectorAll('.set-jump-item').forEach(b => {
      const on = b.dataset.section === active;
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      if (on && b.parentNode && typeof b.parentNode.scrollTo === 'function') {
        const bar = b.parentNode;
        const left = b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2;
        bar.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
      }
    });
  }
  function onBodyScroll() {
    if (!view.phone || view.spyRaf) return;
    view.spyRaf = (root.requestAnimationFrame || setTimeout)(() => {
      view.spyRaf = 0;
      const hd = view.handle;
      if (!hd) return;
      const jump = hd.el.querySelector('.set-jump');
      const limit = hd.body.scrollTop + (jump ? jump.offsetHeight : 0) + 24;
      const list = shownSections();
      let active = list[0];
      hd.el.querySelectorAll('.set-sec').forEach(sec => { if (sec.offsetTop <= limit) active = sec.dataset.section; });
      if (hd.body.scrollTop + hd.body.clientHeight >= hd.body.scrollHeight - 4) active = list[list.length - 1];
      if (active !== view.jumpActive) { view.jumpActive = active; paintJump(); }
    });
  }

  // ================================================================ Profil a cíl
  function profileSection() {
    const d = view.draft, e = view.errors;
    const pv = view.pv = {};

    const fieldError = (code, id) => (code ? h('p.field-error', { id: id || null, role: 'alert' }, icon('warning'), h('span', errText(code))) : null);
    const block = (o, ...children) => h('div', { class: ['set-block', o.cls] },
      h('div.set-block-head', o.label, o.meta || null), children);

    // 1) name: the block title is the input's label
    const counter = h('span.set-block-meta.set-counter.num', { 'aria-hidden': 'true' });
    pv.counter = counter;
    const nameInput = h('input.input.set-name#set-name-input', {
      type: 'text', value: d.name, maxlength: NAME_MAX, autocomplete: 'nickname', spellcheck: 'false',
      placeholder: t('profile.namePlaceholder'), dataset: { key: 'set-name' },
      'aria-describedby': e.name ? 'set-name-err set-name-hint' : 'set-name-hint', 'aria-invalid': e.name ? 'true' : null,
      onInput: ev => { d.name = ev.target.value; if (e.name) { delete e.name; render(); } else liveProfile(true); }
    });
    const nameBlock = block({ label: h('label.eyebrow.set-eyebrow', { for: 'set-name-input' }, t('profile.name')), meta: counter },
      nameInput, fieldError(e.name, 'set-name-err'), h('p.field-hint#set-name-hint', t('profile.nameHint')));

    // 2) goal: distance, target time and the live preview strip
    const goalMeta = h('span.set-block-meta.set-goal-meta');
    pv.goalMeta = goalMeta;
    const distance = app.components.create('segmented', {
      label: t('profile.distance'), key: 'set-dist', value: d.preset,
      options: GOAL_PRESETS.map(km => ({ value: String(km), label: fmt.kmUnit(km, { trim: true }) })).concat([{ value: 'custom', label: t('profile.custom') }]),
      onChange: v => {
        d.preset = v;
        delete e.distance;
        if (v === 'custom' && !d.customKm) d.customKm = '';
        render();
        if (v === 'custom') focusKey('set-km');
      }
    });
    const kmInput = d.preset === 'custom' ? h('div.affix.set-km',
      h('input.input.input-num', {
        type: 'text', inputmode: 'decimal', value: d.customKm, autocomplete: 'off', 'aria-label': t('profile.customLabel'),
        'aria-invalid': e.distance ? 'true' : null, placeholder: Format.number(7.5, { minDecimals: 1, maxDecimals: 1 }), dataset: { key: 'set-km' },
        onInput: ev => { d.customKm = ev.target.value; if (e.distance) { delete e.distance; render(); } else liveProfile(true); }
      }),
      h('span.affix-suffix', app.t('common.unit.km'))) : null;
    const distField = h('div.field.set-dist',
      h('span.field-label', t('profile.distance')),
      h('div.set-dist-row', distance, kmInput),
      fieldError(e.distance));

    const targetInput = h('input.input.input-num.input-lg.set-target#set-target-input', {
      type: 'text', inputmode: 'decimal', value: d.target, autocomplete: 'off', spellcheck: 'false',
      placeholder: t('profile.targetPlaceholder'), dataset: { key: 'set-target' },
      'aria-describedby': e.target ? 'set-target-err set-target-hint' : 'set-target-hint', 'aria-invalid': e.target ? 'true' : null,
      onInput: ev => { d.target = ev.target.value; if (e.target) { delete e.target; render(); } else liveProfile(true); }
    });
    const targetField = h('div.field.set-target-field',
      h('label.field-label', { for: 'set-target-input' }, t('profile.target')),
      h('div.set-target-row', targetInput, h('p.field-hint.set-target-hint#set-target-hint', t('profile.targetHint'))),
      fieldError(e.target, 'set-target-err'));

    // live preview strip: goal pace | best at the distance | gap (all from the draft + real runs)
    const cell = (k, label) => {
      const value = h('span.set-gp-v.num');
      const sub = h('span.set-gp-s');
      const l = h('span.set-gp-l', label);
      pv[k] = { value, sub, label: l };
      return h('div.set-gp', { dataset: { cell: k } }, l, value, sub);
    };
    const preview = h('div.set-goalprev', { 'aria-live': 'polite' }, cell('pace', t('profile.pace')), cell('best', ''), cell('gap', t('profile.gap')));
    pv.preview = preview;
    const goalBlock = block({ label: h('span.eyebrow.set-eyebrow', t('profile.goal')), meta: goalMeta }, distField, targetField, preview);

    // 3) running days
    const days = app.components.create('dayToggles', {
      label: t('profile.days'), key: 'set-days', value: d.days,
      onChange: list => { d.days = list; if (e.days) { delete e.days; render(); } else liveProfile(true); }
    });
    const daysSum = h('span.set-block-meta.set-days-sum');
    pv.daysSum = daysSum;
    const daysBlock = block({ label: h('span.eyebrow.set-eyebrow', t('profile.days')), meta: daysSum },
      days, fieldError(e.days), h('p.field-hint', t('profile.daysHint')));

    const saveText = h('span.set-savebar-text');
    const bar = h('div.set-savebar', { hidden: true },
      h('span.set-savebar-msg', { 'aria-live': 'polite' }, saveText),
      h('div.set-savebar-actions',
        button('btn-ghost', t('profile.discard'), { key: 'set-discard', onClick: discardProfile }),
        button('btn-primary', t('profile.save'), { key: 'set-save', type: 'submit', icon: 'check' })));
    pv.bar = bar;
    pv.saveText = saveText;

    return h('form.set-groups', {
      class: view.enter ? 'stagger' : null, novalidate: true, 'aria-label': t('section.profile'),
      onSubmit: ev => { ev.preventDefault(); saveProfile(); }
    },
      h('section.set-group.set-form-card', nameBlock, goalBlock, daysBlock),
      bar);
  }

  /** Updates the live parts of the profile form without rebuilding the inputs. */
  function liveProfile(fromInput) {
    const pv = view.pv;
    paintIdentity();
    if (!pv || !view.draft) return;
    const d = view.draft;
    pv.counter.textContent = Array.from(d.name).length + '/' + NAME_MAX;
    const g = goalPreview(d, app.derived().runs);
    const kmText = g.km ? Format.km(g.km, { trim: true, decimals: 3 }) : null;
    // pace
    if (g.pace !== null && g.pace !== undefined) {
      const from = view.lastPace;
      pv.pace.value.replaceChildren(h('span.set-gp-num', Format.pace(g.pace)), h('span.unit', fmt.NB + app.t('common.unit.perKm')));
      pv.pace.sub.textContent = t('profile.speed', { speed: fmt.number(3600 / g.pace, { decimals: 1 }) });
      if (fromInput && isNum(from) && Math.abs(from - g.pace) >= 0.5) motion.countUp(pv.pace.value.firstChild, g.pace, { from, duration: 260, format: v => Format.pace(v) });
      view.lastPace = g.pace;
    } else {
      pv.pace.value.replaceChildren(h('span.set-gp-num.is-empty', Format.EMPTY));
      pv.pace.sub.textContent = t('profile.paceNone');
      view.lastPace = null;
    }
    // best at the distance
    pv.best.label.textContent = kmText ? t('profile.best', { distance: kmText }) : t('profile.best', { distance: Format.EMPTY });
    if (g.best) {
      pv.best.value.replaceChildren(h('span.set-gp-num', Format.duration(g.best)));
      pv.best.sub.textContent = fmt.typo(fmt.paceUnit(g.bestPace) + ' · ' + fmt.date(g.bestDate, 'dayMonth'));
    } else {
      pv.best.value.replaceChildren(h('span.set-gp-num.is-empty', Format.EMPTY));
      pv.best.sub.textContent = kmText ? t('profile.bestNone', { distance: kmText }) : '';
    }
    // gap
    const gapCell = pv.gap.value.parentNode;
    gapCell.classList.remove('is-reached', 'is-gap');
    if (g.best && g.target && g.reached) {
      gapCell.classList.add('is-reached');
      pv.gap.value.replaceChildren(h('span.set-gp-num', t('profile.reached')));
      pv.gap.sub.textContent = t('profile.reachedSub');
    } else if (g.best && g.target && isNum(g.gap)) {
      gapCell.classList.add('is-gap');
      const gap = Math.round(g.gap);
      const text = gap < 100 ? fmt.seconds(-gap) : Format.duration(-gap);
      pv.gap.value.replaceChildren(h('span.set-gp-num', text));
      pv.gap.sub.textContent = isNum(g.pacePerKmGap) && g.pacePerKmGap >= 0.5 ? t('profile.gapPace', { s: Math.round(g.pacePerKmGap) }) : t('profile.gapLeft');
    } else {
      pv.gap.value.replaceChildren(h('span.set-gp-num.is-empty', Format.EMPTY));
      pv.gap.sub.textContent = '';
    }
    // days
    const n = d.days.length;
    pv.daysSum.replaceChildren.apply(pv.daysSum, [h('b', t('profile.daysCount', { n }))].concat(n ? [h('span', ' · ' + d.days.map(i => I18n.t('common.weekdayShort.' + i)).join(', '))] : []));
    const built = profilePatch(d);
    pv.goalMeta.textContent = built.ok ? fmt.goal(built.patch) : '';
    // save bar
    const dirty = isDirty();
    const recentlySaved = !dirty && view.savedAt && Date.now() - view.savedAt < 1800;
    const show = dirty || !!recentlySaved;
    pv.bar.hidden = !show;
    if (!show) pv.bar.classList.remove('set-appear-up');
    else if (!view.barShown) pv.bar.classList.add('set-appear-up');
    view.barShown = show;
    pv.bar.classList.toggle('is-saved', !!recentlySaved);
    pv.saveText.replaceChildren(icon(recentlySaved ? 'check-circle' : 'edit', 15), h('span', recentlySaved ? t('profile.saved') : t('profile.unsaved')));
    pv.bar.querySelectorAll('button').forEach(b => { b.hidden = !!recentlySaved; });
    // tab dot follows the dirty state
    if (view.shell) {
      view.shell.querySelectorAll('[data-section="profile"].set-tab, [data-section="profile"].set-jump-item').forEach(tab => {
        const old = tab.querySelector('.set-dot');
        if (old) old.remove();
        const dot = dotNode('profile');
        if (dot) tab.append(dot);
      });
    }
  }

  function saveProfile() {
    const built = profilePatch(view.draft);
    if (!built.ok) {
      view.errors = built.errors;
      render();
      const first = ['name', 'distance', 'target', 'days'].find(f => view.errors[f]);
      focusKey({ name: 'set-name', distance: view.draft.preset === 'custom' ? 'set-km' : 'set-dist:' + view.draft.preset, target: 'set-target', days: 'set-days:0' }[first]);
      return;
    }
    const r = app.update(s => Store.setProfile(s, built.patch), { reason: 'profile', toast: app.t('store.notice.profileSaved'), undo: true });
    if (!r.ok) {
      const errors = {};
      (r.errors || []).forEach(code => { errors[STORE_FIELD[code] || 'name'] = code; });
      view.errors = errors;
      render();
      return;
    }
    view.draft = draftFromProfile(app.state().profile);
    view.errors = {};
    view.savedAt = Date.now();
    clearTimeout(view.savedTimer);
    view.savedTimer = setTimeout(() => liveProfile(false), 1850);
    render();
    const hd = view.handle;
    if (hd) { const me = hd.el.querySelector('.set-me'); if (me) motion.flash(me); }
  }

  function discardProfile() {
    view.draft = draftFromProfile(app.state().profile);
    view.errors = {};
    render();
    focusKey(view.phone ? 'set-name' : 'set-tab:profile');
  }

  // ================================================================ Vzhled a jazyk
  function appearanceSection() {
    const theme = app.components.create('segmented', {
      label: t('appearance.theme'), size: 'lg', key: 'set-theme', value: app.theme(),
      options: [{ value: 'dark', label: t('appearance.dark'), icon: 'moon' }, { value: 'light', label: t('appearance.light'), icon: 'sun' }],
      onChange: v => app.setTheme(v)
    });
    const lang = app.components.create('segmented', {
      label: t('appearance.language'), size: 'lg', key: 'set-lang', value: app.language(),
      options: [{ value: 'cs', label: I18n.t('common.language.cs') }, { value: 'en', label: I18n.t('common.language.en') }],
      onChange: v => app.setLanguage(v)
    });
    const d = app.derived();
    const parts = [h('span', fmt.date(d.today, 'long', { capitalize: true }))];
    if (d.latestRun && d.latestRun.distance > 0) {
      parts.push(dom.val(fmt.km(d.latestRun.distance), app.t('common.unit.km')));
      if (d.latestRun.movingSeconds > 0) parts.push(dom.val(Format.pace(d.latestRun.movingSeconds / d.latestRun.distance), app.t('common.unit.perKm')));
    }
    parts.push(h('span', fmt.count('common.count.runs', d.runs.length)));
    const sample = h('p.set-sample', parts.reduce((all, p, i) => all.concat(i ? [h('span.set-sep', { 'aria-hidden': 'true' }, '·'), p] : [p]), []));
    return h('div.set-groups', { class: view.enter ? 'stagger' : null },
      h('section.set-group.set-rows', { 'aria-label': t('section.appearance') },
        row({ icon: app.theme() === 'light' ? 'sun' : 'moon', title: t('appearance.theme'), sub: t(P().kind === 'desktop' ? 'appearance.themeSub' : 'appearance.themeSubApp'), control: theme }),
        row({ icon: 'language', title: t('appearance.language'), sub: t('appearance.languageSub'), control: lang }),
        h('div.set-row.set-row-sample', h('span.set-row-ico', icon('info')), h('div.set-row-text', h('p.set-row-sub', t('appearance.sample')), sample))));
  }

  // ================================================================ Propojení
  function stravaKey(st) {
    if (!app.strava.supported) return 'unsupported';
    if (st.busy) return 'syncing';
    if (!st.connected) return view.strava.waiting ? 'waiting' : 'off';
    if (st.lastError) return stravaAuthFailed || isReauthError(st.lastError) ? 'reauth' : 'error';
    return 'connected';
  }
  const STRAVA_CHIP = {
    connected: ['good', 'check'], off: [null, null], error: ['danger', 'warning'], reauth: ['warn', 'warning'],
    syncing: ['accent', 'refresh'], waiting: ['cool', 'clock'], unsupported: [null, null]
  };

  function connectionsSection() {
    ensureIntervalsKey();
    const groups = { strava: stravaGroup, health: healthGroup, intervals: intervalsGroup };
    return h('div.set-groups', { class: view.enter ? 'stagger' : null }, connectionsFor(app.build, P().kind).map(name => groups[name]()));
  }

  function stravaGroup() {
    const st = app.strava.status();
    const key = stravaKey(st);
    const changed = view.prevStravaKey !== null && view.prevStravaKey !== key;
    view.prevStravaKey = key;
    const c = STRAVA_CHIP[key];
    const statusChip = chip(c[0], t('strava.status.' + key), c[1], [changed ? 'set-pop' : null, key === 'syncing' ? 'is-spin' : null]);
    const head = { id: 'strava', icon: 'link', title: t('strava.title'), sub: t('strava.sub'), end: statusChip, cls: 'set-strava is-' + key };
    if (key === 'unsupported') {
      return group(Object.assign(head, { body: [callout('info', t('strava.unsupportedTitle'), t('strava.unsupportedText'))] }));
    }
    const f = view.strava;
    const body = [h('p.set-text', t('strava.lead'))];
    if (st.connected || key === 'reauth' || key === 'error') {
      const athlete = st.athlete ? [st.athlete.firstname, st.athlete.lastname].filter(Boolean).join(' ') : '';
      body.push(h('dl.set-facts',
        athlete ? h('div', h('dt', t('strava.account')), h('dd', athlete)) : null,
        h('div', h('dt', t('strava.lastSync')), h('dd', st.lastSync ? whenText(st.lastSync) : t('strava.never')))));
    }
    if (key === 'reauth') body.push(callout('warn', t('strava.reauthTitle'), t('strava.reauthText')));
    else if (key === 'error') body.push(callout('danger', t('strava.errorTitle'), st.lastError));
    if (key === 'waiting' && !f.open) {
      body.push(h('div', { class: ['callout', 'callout-info', 'set-callout', 'set-waiting', appear('waiting')] }, h('span.set-spinner', { 'aria-hidden': 'true' }, icon('refresh', 16)),
        h('div.set-callout-main', h('b', t('strava.waitingTitle') + ' '), h('span', t('strava.waitingText')))));
    }
    if (f.open) body.push(stravaForm());
    const actions = [];
    if (!f.open) {
      if (key === 'connected' || key === 'error' || key === 'syncing') {
        actions.push(button('btn-secondary', t('strava.syncNow'), { key: 'set-strava-sync', icon: 'refresh', busy: st.busy, onClick: syncStrava }));
      }
      if (key === 'reauth') actions.push(button('btn-primary', t('strava.reconnect'), { key: 'set-strava-reconnect', icon: 'link', onClick: () => openStravaForm() }));
      if (key === 'off') actions.push(button('btn-primary', t('strava.connect'), { key: 'set-strava-connect', icon: 'link', onClick: () => openStravaForm() }));
      if (key === 'waiting') actions.push(button('btn-secondary', t('strava.retry'), { key: 'set-strava-retry', onClick: () => openStravaForm() }));
      if (st.connected) actions.push(button('btn-ghost', t('strava.disconnect'), { key: 'set-strava-disconnect', onClick: disconnectStrava }));
    }
    if (actions.length) body.push(h('div.btn-row.set-actions', actions));
    const ignored = (app.state().ignoredStravaIds || []).length;
    if (ignored && !f.open) {
      body.push(h('div.set-inline', icon('trash', 15), h('span', t('strava.ignored', { n: ignored })),
        button('btn-sm btn-outline', t('strava.restoreIgnored'), { key: 'set-strava-restore', onClick: restoreIgnored })));
    }
    body.push(note('info', t('strava.rules'), 'set-note-faint'));
    return group(Object.assign(head, { body }));
  }

  function stravaForm() {
    const f = view.strava;
    const secret = h('input.input.set-secret', {
      type: f.show ? 'text' : 'password', value: f.secret, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
      'aria-invalid': f.error && !f.consentError ? 'true' : null, dataset: { key: 'set-strava-secret' },
      onInput: ev => { f.secret = ev.target.value; if (f.error) { f.error = null; render(); } }
    });
    const reveal = h('button.btn.btn-sm.btn-ghost.set-reveal', {
      type: 'button', 'aria-pressed': f.show ? 'true' : 'false', dataset: { key: 'set-strava-show' },
      onClick: () => { f.show = !f.show; render(); }
    }, f.show ? t('strava.form.hide') : t('strava.form.show'));
    const consent = h('input.check', {
      type: 'checkbox', checked: f.consent, dataset: { key: 'set-strava-consent' },
      onChange: ev => { f.consent = ev.target.checked; if (f.error) { f.error = null; render(); } }
    });
    const steps = ['step1', 'step2', 'step3'].map((k, i) => h('li', h('span.set-step-n.num', String(i + 1)), h('span', t('strava.form.' + k, { id: STRAVA_CLIENT_ID }))));
    return h('div', { class: ['set-subform', appear('strava-form')], role: 'group', 'aria-labelledby': 'set-strava-form-t' },
      h('p.set-subform-title', { id: 'set-strava-form-t' }, t('strava.form.title')),
      h('p.set-text', t('strava.form.intro', { id: STRAVA_CLIENT_ID })),
      h('ol.set-steps', steps),
      h('button.btn-link.set-ext', { type: 'button', dataset: { key: 'set-strava-api' }, onClick: () => openExternal(STRAVA_API_URL) }, h('span', t('strava.form.openApi')), icon('external', 14)),
      app.components.create('field', {
        label: t('strava.form.secret'), control: h('div.set-secret-wrap', secret, reveal), hint: t('strava.form.secretHint'),
        error: f.error && !f.consentError ? f.error : null
      }),
      h('label.check-row.set-consent', consent, h('span', t('strava.form.consent'))),
      f.error && f.consentError ? h('p.field-error', { role: 'alert' }, icon('warning'), h('span', f.error)) : null,
      note('lock', t('strava.form.privacy')),
      h('div.btn-row.set-actions',
        button('btn-primary', t('strava.form.submit'), { key: 'set-strava-submit', iconEnd: 'external', busy: f.busy, onClick: connectStrava }),
        button('btn-ghost', app.t('common.button.cancel'), { key: 'set-strava-cancel', onClick: () => { f.open = false; f.secret = ''; f.error = null; render(); focusKey('set-strava-connect'); } })));
  }

  async function syncStrava() {
    const r = await app.strava.sync({ manual: true });
    if (r && r.ok) stravaAuthFailed = false;
    else if (r && r.error) stravaAuthFailed = isReauthError(r.error && r.error.message);
    render();
  }

  function openStravaForm() {
    const f = view.strava;
    f.open = true; f.error = null; f.waiting = false;
    view.appear.add('strava-form');
    render();
    focusKey('set-strava-secret');
  }

  async function connectStrava() {
    const f = view.strava;
    const secret = f.secret.trim();
    f.consentError = false;
    if (!/^\S{8,}$/.test(secret)) { f.error = t('strava.form.secretInvalid'); render(); focusKey('set-strava-secret'); return; }
    if (!f.consent) { f.error = t('strava.form.consentMissing'); f.consentError = true; render(); focusKey('set-strava-consent'); return; }
    f.busy = true; f.error = null;
    render();
    try {
      await app.strava.connect(secret);
      f.secret = ''; f.consent = false; f.open = false; f.waiting = true; f.show = false;
      view.appear.add('waiting');
    } catch (err) {
      f.error = app.t('ui.strava.connectFailed', { message: app.errorText(err) });
    } finally {
      f.busy = false;
      render();
    }
  }

  async function disconnectStrava() {
    const ok = await app.confirm({ title: t('strava.disconnectTitle'), body: t('strava.disconnectBody'), confirmLabel: t('strava.disconnect'), danger: true });
    if (!ok) return;
    try { await app.strava.disconnect(); } catch (err) { app.toast(app.errorText(err), { kind: 'error' }); }
  }

  function restoreIgnored() {
    const n = (app.state().ignoredStravaIds || []).length;
    const r = app.update(s => Store.restoreIgnoredStrava(s), { reason: 'strava-restore', toast: app.t('store.notice.stravaRestored', { n }), undo: true });
    if (r.ok && app.strava.status().connected) app.strava.sync({ manual: false });
  }

  function openExternal(url) {
    P().openExternal(url).catch(err => app.toast(app.errorText(err), { kind: 'error' }));
  }

  // ---------------------------------------------------------------- Apple Zdraví (iPhone)
  const HEALTH_CHIP = { off: [null, null], on: ['good', 'check'], importing: ['accent', 'refresh'], error: ['danger', 'warning'] };

  function healthGroup() {
    const st = app.state().health || {};
    const key = healthKey(st, healthRun.busy);
    const c = HEALTH_CHIP[key];
    const statusChip = chip(c[0], t('health.status.' + key), c[1], key === 'importing' ? 'is-spin' : null);
    const body = [h('p.set-text', t('health.lead'))];
    body.push(h('dl.set-facts', h('div', h('dt', t('health.lastImport')), h('dd', st.lastImport ? whenText(st.lastImport) : t('health.never')))));
    if (key === 'error') body.push(callout('danger', t('health.errorTitle'), st.lastError));
    const last = healthRun.last;
    if (last && last.ok && last.invalid > 0) body.push(note('info', t('health.skipped', { n: last.invalid })));
    const actions = [button(st.enabled ? 'btn-secondary' : 'btn-primary', t(st.enabled ? 'health.importAgain' : 'health.import'), {
      key: 'set-health-import', icon: st.enabled ? 'refresh' : 'heart', busy: healthRun.busy, onClick: () => importHealth({ manual: true })
    })];
    if (st.enabled && !healthRun.busy) actions.push(button('btn-ghost', t('health.stop'), { key: 'set-health-stop', onClick: stopHealth }));
    body.push(h('div.btn-row.set-actions', actions));
    if (st.enabled) body.push(note('refresh', t('health.auto'), 'set-note-faint'));
    const ignored = (app.state().ignoredHealthIds || []).length;
    if (ignored) {
      body.push(h('div.set-inline', icon('trash', 15), h('span', t('health.ignored', { n: ignored })),
        button('btn-sm btn-outline', t('health.restoreIgnored'), { key: 'set-health-restore', disabled: healthRun.busy, onClick: restoreHealthIgnored })));
    }
    body.push(h('div.set-foot-notes', note('lock', t('health.reads'), 'set-note-faint'), note('info', t('health.rules'), 'set-note-faint'),
      note('info', t('health.permission'), 'set-note-faint')));
    return group({ id: 'applehealth', icon: 'heart', title: t('health.title'), sub: t('health.sub'), end: statusChip, cls: 'set-health is-' + key, body });
  }

  function stopHealth() {
    app.update(s => { s.health = Object.assign({}, s.health, { enabled: false }); }, { reason: 'health-stop', render: 'shell', toast: t('health.stopped') });
  }

  function restoreHealthIgnored() {
    const n = (app.state().ignoredHealthIds || []).length;
    const r = app.update(s => Store.restoreIgnoredHealth(s), { reason: 'health-restore', render: 'shell', toast: app.t('store.notice.healthRestored', { n }), undo: true });
    if (r.ok && app.state().health && app.state().health.enabled) importHealth({ manual: false });
  }

  // ---------------------------------------------------------------- intervals.icu
  function ensureIntervalsKey() {
    const iv = view.intervals;
    if (iv.loaded || iv.loading) return;
    const S = P().secrets;
    if (!S || !S.supported) { iv.loaded = true; return; }
    iv.loading = true;
    Promise.resolve().then(() => S.get(INTERVALS_SECRET))
      .then(v => { iv.hasKey = !!v; iv.tail = maskKey(v); }, err => { iv.loadError = app.errorText(err); })
      .then(() => { iv.loading = false; iv.loaded = true; render(); });
  }

  function intervalsKey() {
    const iv = view.intervals;
    if (!iv.loaded) return 'loading';
    if (iv.busy) return 'checking';
    if (iv.result) return iv.result.ok ? 'connected' : 'error';
    return iv.hasKey ? 'saved' : 'off';
  }
  const INTERVALS_CHIP = { loading: [null, null], checking: ['accent', 'refresh'], connected: ['good', 'check'], error: ['danger', 'warning'], saved: ['cool', 'lock'], off: [null, null] };

  function storeNote() {
    const S = P().secrets;
    if (!S || !S.supported) return t('intervals.storeNone');
    if (S.encrypted) return t('intervals.storeEncrypted');
    const kind = P().kind;
    return kind === 'android' ? t('intervals.storePlain') : kind === 'ios' ? t('intervals.storePlainIos') : t('intervals.storeMemory');
  }

  function intervalsGroup() {
    const iv = view.intervals;
    const key = intervalsKey();
    const c = INTERVALS_CHIP[key];
    const statusChip = chip(c[0], t('intervals.status.' + key), c[1], key === 'checking' ? 'is-spin' : null);
    const st = app.state().intervals || {};
    const body = [h('p.set-text', t('intervals.lead'))];
    const showForm = iv.loaded && (!iv.hasKey || iv.editing);
    if (iv.loaded && iv.hasKey && !iv.editing) {
      body.push(h('div.set-keyline', icon('lock', 15), h('span', t('intervals.savedKey')), h('span.set-key.num', '•••• ' + (iv.tail || ''))));
      if (st.lastPush) body.push(h('p.set-text.set-text-faint', t('intervals.lastPush', { when: whenText(st.lastPush) })));
    }
    if (iv.result && iv.result.ok) body.push(callout('good', null, iv.result.name ? t('intervals.okAccount', { name: iv.result.name }) : t('intervals.ok')));
    else if (iv.result) body.push(callout('danger', null, iv.result.text));
    else if (iv.hasKey && st.lastError && !showForm) body.push(callout('warn', null, t('intervals.lastError', { message: st.lastError })));
    if (iv.loadError) body.push(callout('danger', null, iv.loadError));
    if (showForm) {
      const input = h('input.input.set-secret', {
        type: iv.show ? 'text' : 'password', value: iv.input, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
        placeholder: t('intervals.keyPlaceholder'), dataset: { key: 'set-iv-key' },
        onInput: ev => { iv.input = ev.target.value; if (iv.result && !iv.result.ok) { iv.result = null; iv.offerSave = false; render(); } },
        onKeydown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); verifyAndSave(false); } }
      });
      const reveal = h('button.btn.btn-sm.btn-ghost.set-reveal', {
        type: 'button', 'aria-pressed': iv.show ? 'true' : 'false', dataset: { key: 'set-iv-show' },
        onClick: () => { iv.show = !iv.show; render(); }
      }, iv.show ? t('strava.form.hide') : t('strava.form.show'));
      const path = h('span.set-path', h('b', t('intervals.pathSettings')), icon('chevron-right', 13), h('b', t('intervals.pathDeveloper')));
      const hintText = t('intervals.keyHint', { path: '\u0000' }).split('\u0000');
      const keyField = app.components.create('field', {
        label: t('intervals.key'), control: h('div.set-secret-wrap', input, reveal),
        hint: h('span', hintText[0], path, hintText[1] || '')
      });
      if (appear('iv-form')) keyField.classList.add('set-appear');
      body.push(keyField);
    }
    const actions = [];
    if (showForm) {
      actions.push(button('btn-primary', t('intervals.saveTest'), { key: 'set-iv-save', icon: 'check', busy: iv.busy, onClick: () => verifyAndSave(false) }));
      if (iv.offerSave && !iv.busy) actions.push(button('btn-secondary', t('intervals.saveAnyway'), { key: 'set-iv-anyway', onClick: () => verifyAndSave(true) }));
      if (iv.editing) actions.push(button('btn-ghost', app.t('common.button.cancel'), { key: 'set-iv-cancel', onClick: () => { iv.editing = false; iv.input = ''; iv.result = null; iv.offerSave = false; render(); } }));
    } else if (iv.loaded && iv.hasKey) {
      actions.push(button('btn-secondary', t('intervals.test'), { key: 'set-iv-test', icon: 'refresh', busy: iv.busy, onClick: testSavedKey }));
      actions.push(button('btn-ghost', t('intervals.change'), { key: 'set-iv-change', onClick: () => { iv.editing = true; iv.result = null; view.appear.add('iv-form'); render(); focusKey('set-iv-key'); } }));
      actions.push(button('btn-ghost', t('intervals.remove'), { key: 'set-iv-remove', onClick: removeKey }));
    }
    if (actions.length) body.push(h('div.btn-row.set-actions', actions));
    body.push(h('div.set-foot-notes', note('lock', storeNote(), 'set-note-faint'),
      h('button.btn-link.set-ext', { type: 'button', dataset: { key: 'set-iv-site' }, onClick: () => openExternal(INTERVALS_SITE) }, h('span', t('intervals.openSite')), icon('external', 14))));
    return group({ id: 'intervals', icon: 'calendar-plus', title: t('intervals.title'), sub: t('intervals.sub'), end: statusChip, cls: 'set-intervals is-' + key, body });
  }

  function base64(text) {
    try { return root.btoa(unescape(encodeURIComponent(text))); } catch (e) { return root.btoa(text); }
  }

  /** GET /api/v1/athlete/0 with Basic auth 'API_KEY:<key>' -> { ok, name } | { ok: false, text, network }. */
  async function probeIntervals(key) {
    let res;
    try {
      res = await P().http({ url: INTERVALS_ATHLETE_URL, method: 'GET', headers: { Authorization: 'Basic ' + base64('API_KEY:' + key), Accept: 'application/json' } });
    } catch (err) {
      return { ok: false, network: true, text: app.errorText(err) };
    }
    const I = root.VeyvoIntervals;
    const e = I && typeof I.parseError === 'function' ? I.parseError(res) : (res && res.ok ? null : { code: 'http_error', status: res ? res.status : 0, message: '' });
    if (!e) return { ok: true, name: athleteName(res.json) };
    const k = 'intervals.error.' + e.code;
    const text = I18n.has(k) ? app.t(k, { message: e.message || '', status: e.status || '' }) : app.t('platform.error.failed');
    return { ok: false, network: e.code !== 'unauthorized' && e.code !== 'forbidden', text };
  }

  async function verifyAndSave(skipCheck) {
    const iv = view.intervals;
    const key = iv.input.trim();
    if (!key) { iv.result = { ok: false, text: t('intervals.keyMissing') }; render(); focusKey('set-iv-key'); return; }
    iv.busy = true; iv.result = null; iv.offerSave = false;
    render();
    let r = skipCheck ? { ok: true, unchecked: true } : await probeIntervals(key);
    if (r.ok) {
      try { await P().secrets.set(INTERVALS_SECRET, key); } catch (err) { r = { ok: false, network: false, text: app.errorText(err) }; }
    }
    iv.busy = false;
    if (r.ok) {
      Object.assign(iv, { hasKey: true, tail: maskKey(key), input: '', editing: false, show: false, result: r.unchecked ? null : r });
      app.update(s => { s.intervals = Object.assign({}, s.intervals, { enabled: true, lastError: null }); }, { reason: 'intervals-key', render: false, toast: t('intervals.savedToast') });
    } else {
      iv.result = r;
      iv.offerSave = !!r.network;
    }
    render();
    focusKey(r.ok ? 'set-iv-test' : 'set-iv-key');
  }

  async function testSavedKey() {
    const iv = view.intervals;
    iv.busy = true; iv.result = null;
    render();
    let key = null;
    try { key = await P().secrets.get(INTERVALS_SECRET); } catch (err) { iv.result = { ok: false, text: app.errorText(err) }; }
    if (key) iv.result = await probeIntervals(key);
    else if (!iv.result) { iv.hasKey = false; iv.result = null; }
    iv.busy = false;
    if (iv.result && iv.result.ok && app.state().intervals.lastError) {
      app.update(s => { s.intervals = Object.assign({}, s.intervals, { lastError: null }); }, { reason: 'intervals-test', render: false });
    }
    render();
  }

  async function removeKey() {
    const ok = await app.confirm({ title: t('intervals.removeTitle'), body: t('intervals.removeBody'), confirmLabel: t('intervals.remove'), danger: true });
    if (!ok) return;
    const iv = view.intervals;
    try {
      await P().secrets.remove(INTERVALS_SECRET);
      Object.assign(iv, { hasKey: false, tail: '', result: null, editing: false, input: '' });
      app.update(s => { s.intervals = Object.assign({}, s.intervals, { enabled: false }); }, { reason: 'intervals-key', render: false, toast: t('intervals.removed'), toastKind: 'info' });
    } catch (err) {
      app.toast(app.errorText(err), { kind: 'error' });
    }
    render();
  }

  // ================================================================ Data a zálohy
  function dataSection() {
    const s = app.state();
    const counts = [[s.runHistory.length, 'data.runsLabel'], [s.recoveryLogs.length, 'data.recoveryLabel'], [(s.plannedWorkouts || []).length, 'data.plannedLabel']];
    const board = h('div.set-counts', counts.map(([n, k]) => h('div.set-count', h('span.set-count-n.num', { dataset: { n: String(n) } }, fmt.number(n)), h('span.set-count-l', t(k, { n })))));
    const fileInput = h('input.set-file', {
      type: 'file', accept: '.json,application/json', tabindex: '-1', 'aria-hidden': 'true',
      onChange: ev => { const file = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (file) readFile(file); }
    });
    const actions = h('div.btn-row.set-actions',
      button('btn-primary', t('data.export'), { key: 'set-export', icon: 'download', busy: view.exporting, onClick: exportBackup }),
      button('btn-secondary', t('data.import'), { key: 'set-import', icon: 'upload', busy: view.reading, onClick: () => fileInput.click() }),
      fileInput);
    return h('div.set-groups', { class: view.enter ? 'stagger' : null },
      group({ id: 'device', icon: 'database', title: t('data.deviceTitle'), sub: t('data.deviceSub'), body: [board, actions, note('file', t('data.fileHint'), 'set-note-faint'), importPanel()] }),
      autoGroup(),
      dangerGroup());
  }

  async function exportBackup() {
    if (view.exporting) return;
    view.exporting = true;
    render();
    try {
      const version = await P().version().catch(() => null);
      const json = Store.exportBackup(app.state(), app.storage.get(Store.NUTRITION_KEY), { appVersion: version, exportedAt: new Date(), legacy: app.storage.get(Store.LEGACY_BACKUP_KEY) });
      const r = await P().saveFile({ name: backupFileName(app.today(), app.language()), mime: 'application/json', data: json });
      if (r && r.saved && !r.shared) {
        const canShow = r.path && P().supports && P().supports.showInFolder;
        app.toast(t('data.exported'), { kind: 'success', action: canShow ? { label: t('data.showInFolder'), run: () => P().showInFolder(r.path) } : null });
      } else if (r && r.saved) app.toast(t('data.exported'), { kind: 'success' });
    } catch (err) {
      app.toast(t('data.exportFailed', { message: app.errorText(err) }), { kind: 'error' });
    } finally {
      view.exporting = false;
      render();
    }
  }

  async function readFile(file) {
    view.reading = true;
    render();
    let text = null;
    try {
      if (file.size > Store.LIMITS.maxBackupChars) throw new Error(app.t('store.error.too-large'));
      text = await file.text();
    } catch (err) {
      view.importing = { error: t('data.readFailed', { message: app.errorText(err) }), name: file.name };
    }
    view.reading = false;
    if (text !== null) startImport(text, { name: file.name });
    else render();
  }

  /** Parse a backup and show its preview (nothing changes until Sloučit / Nahradit). */
  function startImport(text, meta) {
    const m = meta || {};
    const parsed = Store.parseBackup(text);
    if (!parsed.ok) view.importing = { error: app.t('store.error.' + parsed.error), name: m.name || null };
    else view.importing = { parsed, name: m.name || null, auto: !!m.auto, summary: importSummary(app.state(), parsed) };
    view.appear.add('import');
    if (view.phone) { render(); scrollToSection('data', true); } else if (view.section !== 'data') select('data'); else render();
    focusKey(view.importing.error ? 'set-import-other' : 'set-merge');
  }

  function importPanel() {
    const im = view.importing;
    if (!im) return null;
    const close = button('btn-ghost', app.t('common.button.cancel'), { key: 'set-import-cancel', onClick: () => { view.importing = null; render(); focusKey('set-import'); } });
    if (im.error) {
      return h('div', { class: ['set-import', 'is-error', appear('import')] },
        callout('danger', t('data.importFailedTitle'), im.error, im.name ? h('span.set-err-detail', im.name) : null),
        h('div.btn-row.set-actions', button('btn-secondary', t('data.otherFile'), { key: 'set-import-other', icon: 'upload', onClick: () => { const input = view.shell.querySelector('.set-file'); if (input) input.click(); } }), close));
    }
    const s = im.summary;
    let when = t('data.preview.unknownDate');
    if (s.exportedAt) {
      const d = new Date(s.exportedAt);
      if (Number.isFinite(d.getTime())) when = t('data.preview.exported', { when: fmt.date(Format.toDateKey(d), 'dayMonthYear') + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) });
    }
    const meta = [when, s.appVersion ? t('data.preview.version', { version: s.appVersion }) : null, im.name].filter(Boolean);
    const stat = (label, n, sub, cls) => h('div', { class: ['set-istat', cls] }, h('span.set-istat-l', label), h('span.set-istat-n.num', fmt.number(n)), sub ? h('span.set-istat-s', sub) : null);
    const profile = s.profile ? h('div.set-istat.set-istat-profile', h('span.set-istat-l', t('data.preview.profile')),
      h('span.set-istat-p', s.profile.name || app.t('ui.profile.anonymous')), h('span.set-istat-s', fmt.goal(s.profile))) : null;
    const range = s.firstDate && s.lastDate ? fmt.typo(fmt.date(s.firstDate, 'dayMonth') + ' – ' + fmt.date(s.lastDate, 'dayMonthYear')) : null;
    return h('div', { class: ['set-import', appear('import')], role: 'region', 'aria-labelledby': 'set-import-t' },
      h('div.set-import-head', h('p.eyebrow#set-import-t', t('data.preview.eyebrow')), h('p.set-import-meta', meta.join(' · '))),
      h('div.set-istats',
        stat(t('data.preview.runs'), s.runs, s.newRuns ? t('data.preview.newRuns', { n: s.newRuns }) : t('data.preview.noNewRuns'), s.newRuns ? 'has-new' : null),
        stat(t('data.preview.recovery'), s.recovery),
        stat(t('data.preview.planned'), s.planned),
        profile),
      range ? h('p.set-text.set-text-faint', range) : null,
      s.nutrition ? note('check', t('data.preview.nutrition'), 'set-note-faint') : null,
      s.warnings ? note('warning', t('data.preview.warnings', { n: s.warnings }), 'set-note-warn') : null,
      h('div.set-choices',
        h('button.set-choice', { type: 'button', dataset: { key: 'set-merge' }, onClick: applyMerge },
          h('span.set-choice-ico', icon('plus')), h('span.set-choice-main', h('span.set-choice-t', t('data.preview.merge')), h('span.set-choice-d', t('data.preview.mergeText')))),
        h('button.set-choice.is-danger', { type: 'button', dataset: { key: 'set-replace' }, onClick: applyReplace },
          h('span.set-choice-ico', icon('refresh')), h('span.set-choice-main', h('span.set-choice-t', t('data.preview.replace')), h('span.set-choice-d', t('data.preview.replaceText'))))),
      h('div.btn-row.set-actions', close));
  }

  function nutritionRemove() { try { root.localStorage.removeItem(Store.NUTRITION_KEY); } catch (e) { /* storage blocked */ } }
  function nutritionWrite(value) {
    if (value === null || value === undefined) nutritionRemove();
    else app.storage.set(Store.NUTRITION_KEY, typeof value === 'string' ? value : JSON.stringify(value));
  }

  /**
   * Stores nutrition first and then the state: app.update re-renders the open page (Před během reads
   * its key on render), so the page never keeps the old nutrition and writes it back on the next tap.
   * nutrition undefined leaves the key alone; a failed update puts the old nutrition back.
   */
  function updateWithNutrition(nextState, nutrition, opts) {
    const before = app.storage.get(Store.NUTRITION_KEY);
    if (nutrition !== undefined) nutritionWrite(nutrition);
    const r = app.update(() => nextState, opts);
    if (!r.ok && nutrition !== undefined) nutritionWrite(before);
    return r;
  }

  /** Puts back a whole earlier state (+ nutrition) after replace / wipe, incl. theme and language. */
  function undoTo(prevState, prevNutrition) {
    const copy = JSON.parse(JSON.stringify(prevState));
    const r = updateWithNutrition(copy, prevNutrition === undefined ? null : prevNutrition, { reason: 'undo', toast: app.t('ui.toast.undone') });
    if (!r.ok) return;
    if (copy.language !== app.language()) app.setLanguage(copy.language);
    if (copy.theme !== app.theme()) app.setTheme(copy.theme);
    view.wipe.done = false;
    view.draft = draftFromProfile(app.state().profile);
    render();
  }

  /**
   * Saves the current data as a separate safety copy ('…-before-replace.json' / '…-before-wipe.json',
   * desktop/Android) before a destructive step. It never overwrites the daily backup or an earlier
   * copy, so restoring today's backup twice (or after a wipe) cannot destroy the only copy on disk.
   * Nothing to save (no runs, no recovery, no nutrition) is not a failure.
   */
  async function safetySnapshot(state, nutrition, kind) {
    const B = P().backup;
    if (!B || !B.supported) return { supported: false, ok: false };
    const empty = !(state.runHistory || []).length && !(state.recoveryLogs || []).length && !nutrition;
    if (empty) return { supported: true, ok: true, skipped: true };
    try {
      const version = await P().version().catch(() => null);
      await B.snapshot(Store.exportBackup(state, nutrition, { appVersion: version, exportedAt: new Date(), legacy: app.storage.get(Store.LEGACY_BACKUP_KEY) }), { kind });
      view.backups.list = null;
      return { supported: true, ok: true };
    } catch (err) {
      return { supported: true, ok: false, error: err };
    }
  }

  /** A restored backup that carries pre-0.4 data (chatHistory, …) keeps it for the next exports. */
  function keepLegacy(parsed) {
    if (parsed && parsed.legacy && !app.storage.get(Store.LEGACY_BACKUP_KEY)) app.storage.set(Store.LEGACY_BACKUP_KEY, JSON.stringify(parsed.legacy));
  }

  function applyMerge() {
    const im = view.importing;
    if (!im || !im.parsed) return;
    const res = Store.applyBackup(app.state(), im.parsed, { mode: 'merge' });
    if (!res.ok) { app.toast(app.t('store.error.' + (res.error || 'backup-invalid')), { kind: 'error' }); return; }
    const nutritionBefore = app.storage.get(Store.NUTRITION_KEY);
    const st = res.stats || { added: 0, updated: 0, unchanged: 0 };
    const detail = [st.added ? app.t('store.notice.runsAdded', { n: st.added }) : null, st.updated ? app.t('store.notice.runsUpdated', { n: st.updated }) : null,
      !st.added && !st.updated && st.unchanged ? app.t('store.notice.runsUnchanged', { n: st.unchanged }) : null].filter(Boolean).join(' ');
    const r = updateWithNutrition(res.state, res.nutrition && !nutritionBefore ? res.nutrition : undefined, { reason: 'backup-merge', toast: t('data.preview.merged', { detail }), undo: true });
    if (!r.ok) { render(); return; }
    view.importing = null;
    keepLegacy(im.parsed);
    render();
    focusKey('set-import');
  }

  async function applyReplace() {
    const im = view.importing;
    if (!im || !im.parsed) return;
    const cur = app.state();
    const backupSupported = !!(P().backup && P().backup.supported);
    const body = h('div.set-confirm-body',
      h('p', t('data.preview.replaceBody', { current: fmt.count('common.count.runs', cur.runHistory.length), incoming: fmt.count('common.count.runs', im.summary.runs) })),
      backupSupported ? h('p.set-text-faint', t('data.preview.replaceSafety')) : null);
    const ok = await app.confirm({ title: t('data.preview.replaceTitle'), body, confirmLabel: t('data.preview.replace'), danger: true });
    if (!ok) return;
    const prev = app.state();
    const prevNutrition = app.storage.get(Store.NUTRITION_KEY);
    const safety = await safetySnapshot(prev, prevNutrition, 'replace');
    if (safety.supported && !safety.ok) {
      // The confirm promised a backup of the current data: say it failed and ask again (as wipeAll).
      const go = await app.confirm({ title: t('data.danger.safetyFailedTitle'), body: t('data.danger.safetyFailed', { message: app.errorText(safety.error) }), confirmLabel: t('data.preview.replace'), danger: true });
      if (!go) return;
    }
    const res = Store.applyBackup(app.state(), im.parsed, { mode: 'replace' });
    if (!res.ok) { app.toast(app.t('store.error.' + (res.error || 'backup-invalid')), { kind: 'error' }); return; }
    const r = updateWithNutrition(res.state, res.nutrition || null, { reason: 'backup-replace' });
    if (!r.ok) { render(); return; }
    view.importing = null;
    keepLegacy(im.parsed);
    if (res.state.language !== app.language()) app.setLanguage(res.state.language);
    if (res.state.theme !== app.theme()) app.setTheme(res.state.theme);
    if (app.strava.supported) app.strava.refresh().catch(() => null);
    view.draft = draftFromProfile(app.state().profile);
    view.errors = {};
    app.toast(t('data.preview.replaced'), { kind: 'success', action: { label: app.t('ui.toast.undo'), run: () => undoTo(prev, prevNutrition) } });
    render();
  }

  // ---------------------------------------------------------------- automatic backups
  function ensureBackups() {
    const b = view.backups;
    const B = P().backup;
    if (!B || !B.supported || b.list !== null || b.loading) return;
    b.loading = true;
    Promise.resolve().then(() => B.list())
      .then(list => { b.list = Array.isArray(list) ? list : []; b.error = null; }, err => { b.list = []; b.error = app.errorText(err); })
      .then(() => { b.loading = false; render(); });
  }

  function autoGroup() {
    const B = P().backup;
    if (!B || !B.supported) return null;
    ensureBackups();
    const b = view.backups;
    const keep = (P().util && P().util.BACKUP_KEEP) || 14;
    const body = [];
    // A failed daily backup stays visible here (the start-up toast can be missed, retries are silent).
    const last = typeof app.backupStatus === 'function' ? app.backupStatus() : null;
    if (last && !last.ok) body.push(callout('danger', null, t('data.auto.lastFailed', { message: app.errorText(last.error) })));
    if (b.loading && b.list === null) body.push(app.components.create('skeleton', { lines: 3, title: false }));
    else if (b.error) body.push(callout('danger', null, t('data.auto.failed', { message: b.error })));
    else if (!b.list || !b.list.length) body.push(h('p.set-text.set-text-faint', t('data.auto.empty')));
    else {
      const today = app.today();
      const rows = (b.expanded ? b.list : b.list.slice(0, BACKUP_ROWS)).map(x => {
        const info = (P().util && P().util.backupInfo && P().util.backupInfo(x.name)) || {};
        const date = x.date || info.date || (/(\d{4}-\d{2}-\d{2})/.exec(x.name) || [])[1] || null;
        const kind = x.kind || info.kind || 'daily';
        const time = x.time || info.time || null;
        const safetyCopy = kind !== 'daily' && I18n.has('settings.data.auto.kind.' + kind);
        const label = date ? fmt.date(date, 'long', { capitalize: true }) + (safetyCopy && time ? ' ' + time.slice(0, 2) + ':' + time.slice(2, 4) : '') : x.name;
        const sub = [safetyCopy ? t('data.auto.kind.' + kind) : null, date ? fmt.relDay(date, today) : null, isNum(x.size) && x.size > 0 ? t('data.auto.size', { n: Math.max(1, Math.round(x.size / 1024)) }) : null].filter(Boolean).join(' · ');
        return h('li.set-bk',
          h('span.set-bk-ico', icon('file', 16)),
          h('div.set-bk-main', h('span.set-bk-date', label), sub ? h('span.set-bk-sub', sub) : null),
          button('btn-sm btn-outline', t('data.auto.restore'), { key: 'set-bk:' + x.name, aria: t('data.auto.restoreAria', { date: label }), onClick: () => restoreAuto(x) }));
      });
      body.push(h('ul.set-bk-list', rows));
      if (b.list.length > BACKUP_ROWS) {
        body.push(h('button.btn-link.set-more', { type: 'button', dataset: { key: 'set-bk-more' }, onClick: () => { b.expanded = !b.expanded; render(); } },
          h('span', b.expanded ? t('data.auto.showLess') : t('data.auto.showAll', { n: b.list.length })), icon(b.expanded ? 'chevron-up' : 'chevron-down', 14)));
      }
    }
    return group({ id: 'auto', icon: 'clock', title: t('data.auto.title'), sub: t('data.auto.sub', { n: keep }), body });
  }

  async function restoreAuto(x) {
    try {
      const text = await P().backup.read(x.name);
      startImport(text, { name: x.name, auto: true });
    } catch (err) {
      view.importing = { error: t('data.readFailed', { message: app.errorText(err) }), name: x.name };
      render();
    }
  }

  // ---------------------------------------------------------------- danger zone
  function dangerGroup() {
    const w = view.wipe;
    const body = [];
    if (w.done) {
      body.push(callout('good', t('data.danger.done'), t('data.danger.doneText')));
      body.push(h('div.btn-row.set-actions', button('btn-secondary', t('data.danger.restart'), { key: 'set-wipe-restart', icon: 'arrow-right', onClick: restartOnboarding })));
      return group({ id: 'danger', icon: 'trash', iconCls: 'is-danger', title: t('data.danger.title'), sub: t('data.danger.sub'), cls: 'set-danger', body });
    }
    const backup = !!(P().backup && P().backup.supported);
    const st = app.strava.status();
    body.push(h('p.set-text', t('data.danger.text')));
    if (app.strava.supported && st.connected) body.push(note('link', t('data.danger.strava'), 'set-note-faint'));
    body.push(note(backup ? 'check' : 'warning', backup ? t('data.danger.safety') : t('data.danger.exportFirst'), backup ? 'set-note-faint' : 'set-note-warn'));
    if (!w.open) {
      body.push(h('div.btn-row.set-actions', button('btn-danger', t('data.danger.start'), { key: 'set-wipe-start', icon: 'trash', onClick: () => { w.open = true; w.text = ''; view.appear.add('wipe'); render(); focusKey('set-wipe-input'); } })));
    } else {
      const word = confirmWord(app.language());
      const go = button('btn-danger-solid', t('data.danger.button'), { key: 'set-wipe-go', icon: 'trash', busy: w.busy, disabled: !confirmMatches(w.text, app.language()), onClick: wipeAll });
      const input = h('input.input.set-wipe-input', {
        type: 'text', value: w.text, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters', placeholder: word,
        dataset: { key: 'set-wipe-input' },
        onInput: ev => { w.text = ev.target.value; go.disabled = !confirmMatches(w.text, app.language()); },
        onKeydown: ev => { if (ev.key === 'Enter' && confirmMatches(w.text, app.language())) { ev.preventDefault(); wipeAll(); } }
      });
      const label = t('data.danger.typeLabel', { word: '\u0000' }).split('\u0000');
      body.push(h('div', { class: ['set-wipe', appear('wipe')] },
        app.components.create('field', { label: [label[0], h('b.set-word', word), label[1] || ''], control: input }),
        h('div.btn-row.set-actions', go, button('btn-ghost', app.t('common.button.cancel'), { key: 'set-wipe-cancel', onClick: () => { w.open = false; w.text = ''; render(); focusKey('set-wipe-start'); } }))));
    }
    return group({ id: 'danger', icon: 'trash', iconCls: 'is-danger', title: t('data.danger.title'), sub: t('data.danger.sub'), cls: 'set-danger', body });
  }

  async function wipeAll() {
    const w = view.wipe;
    if (w.busy || !confirmMatches(w.text, app.language())) return;
    w.busy = true;
    render();
    const prev = app.state();
    const prevNutrition = app.storage.get(Store.NUTRITION_KEY);
    const safety = await safetySnapshot(prev, prevNutrition, 'wipe');
    if (safety.supported && !safety.ok) {
      const go = await app.confirm({ title: t('data.danger.safetyFailedTitle'), body: t('data.danger.safetyFailed', { message: app.errorText(safety.error) }), confirmLabel: t('data.danger.button'), danger: true });
      if (!go) { w.busy = false; render(); return; }
    }
    const r = updateWithNutrition(wipeState(prev), null, { reason: 'reset' });
    if (!r.ok) { w.busy = false; render(); return; }
    view.importing = null;
    view.draft = draftFromProfile(app.state().profile);
    view.errors = {};
    Object.assign(w, { open: false, text: '', busy: false, done: true });
    app.toast(t('data.danger.done'), { kind: 'success', action: { label: app.t('ui.toast.undo'), run: () => undoTo(prev, prevNutrition) } });
    render();
    focusKey('set-wipe-restart');
  }

  function restartOnboarding() {
    const hd = view.handle;
    if (hd) hd.close();
    setTimeout(() => app.dialogs.open('onboarding', {}), 230);
  }

  // ================================================================ Aktualizace
  function ensureVersion() {
    if (view.version !== null || view.versionLoading) return;
    view.versionLoading = true;
    Promise.resolve().then(() => P().version()).then(v => { view.version = v || ''; }, () => { view.version = ''; })
      .then(() => { view.versionLoading = false; render(); });
  }

  const UPDATE_ICON = {
    idle: 'refresh', checking: 'refresh', available: 'download', progress: 'download', ready: 'check-circle', current: 'check-circle',
    error: 'warning', development: 'info', opened: 'external', unsupported: 'info', newer: 'info'
  };
  const UPDATE_CHIP = { idle: null, checking: 'accent', available: 'accent', progress: 'accent', ready: 'good', current: 'good', error: 'danger', development: 'cool', opened: 'cool', unsupported: null, newer: 'cool' };

  function updatesSection() {
    ensureVersion();
    const android = P().kind === 'android';
    const supported = app.updates.supported;
    const u = updateView(app.updates.status(), supported);
    const k = u.key;
    const version = u.version || view.version || '';
    let title = t('updates.state.' + k, { version });
    let text = null;
    if (k === 'available') text = android ? t('updates.state.availableAndroid') : t('updates.state.availableText');
    else if (k === 'progress') text = u.total ? t('updates.progressSize', { percent: u.percent, done: fmt.number((u.transferred || 0) / 1048576, { decimals: 1 }), total: fmt.number(u.total / 1048576, { decimals: 1 }) }) : t('updates.progress', { percent: u.percent });
    else if (k === 'ready') text = t('updates.state.readyText', { version });
    else if (k === 'current') text = t('updates.state.currentText', { version });
    else if (k === 'error') text = t('updates.state.errorText');
    else if (k !== 'progress') text = I18n.has('settings.updates.state.' + k + 'Text') ? t('updates.state.' + k + 'Text') : null;
    const busy = k === 'checking' || k === 'progress' || (k === 'available' && !android);
    const statusIco = h('span', { class: ['set-ustate-ico', 'is-' + k, k === 'checking' ? 'is-spin' : null] }, icon(UPDATE_ICON[k]));
    const status = h('div.set-ustate', { role: 'status' }, statusIco,
      h('div.set-ustate-main', h('p.set-ustate-t', title), text ? h('p.set-ustate-d', text) : null,
        k === 'error' && u.message ? h('p.set-err-detail', u.message) : null,
        k === 'progress' ? h('div.bar.set-prog', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(u.percent) },
          h('span.bar-fill.set-prog-fill', { dataset: { to: String(u.percent) } })) : null));
    const actions = [];
    if (supported) {
      if (k === 'ready') actions.push(button('btn-primary', t('updates.restart'), { key: 'set-up-install', icon: 'refresh', onClick: installUpdate }));
      else if (android && k === 'available') actions.push(button('btn-primary', t('updates.download', { version }), { key: 'set-up-install', icon: 'download', onClick: installUpdate }));
      else if (k === 'newer' && u.pageUrl) actions.push(button('btn-secondary', t('updates.state.openRelease'), { key: 'set-up-release', icon: 'external', onClick: () => Promise.resolve().then(() => P().openExternal(u.pageUrl)).catch(err => app.toast(app.errorText(err), { kind: 'error' })) }));
      actions.push(button(k === 'ready' || (android && k === 'available') ? 'btn-secondary' : 'btn-primary', t('updates.check'), { key: 'set-up-check', icon: 'refresh', disabled: busy, onClick: checkUpdates }));
    }
    const verBlock = h('div.set-ver',
      h('div.set-ver-main', h('span.set-ver-l', t('updates.installed')), h('span.set-ver-n.num', view.version === null ? Format.EMPTY : (view.version || Format.EMPTY))),
      chip(UPDATE_CHIP[k], t('updates.badge.' + k), null, 'set-ver-chip'));
    const body = [verBlock, status];
    if (actions.length) body.push(h('div.btn-row.set-actions', actions));
    const foot = [];
    const checkedAt = u.checkedAt || (view.updateAt ? view.updateAt.toISOString() : null);
    if (checkedAt) foot.push(h('span', t('updates.checked', { when: whenText(checkedAt) })));
    if (supported && android) foot.push(h('span', t('updates.source')));
    if (foot.length) body.push(h('p.set-text.set-text-faint.set-ufoot', foot.reduce((all, n, i) => all.concat(i ? [h('span.set-sep', { 'aria-hidden': 'true' }, '·'), n] : [n]), [])));
    return h('div.set-groups', { class: view.enter ? 'stagger' : null },
      h('section.set-group.set-updates', { 'aria-label': t('section.updates') }, h('div.set-group-body', body)),
      supported ? note('info', android ? t('updates.howAndroid') : t('updates.howDesktop'), 'set-note-faint set-under') : null);
  }

  function checkUpdates() {
    Promise.resolve().then(() => app.updates.check()).catch(err => app.toast(app.errorText(err), { kind: 'error' }));
  }
  function installUpdate() {
    Promise.resolve().then(() => app.updates.install()).catch(err => app.toast(app.errorText(err), { kind: 'error' }));
  }

  // ================================================================ O aplikaci
  function aboutSection() {
    ensureVersion();
    const kind = P().kind;
    const brand = h('div.set-brand',
      h('img.set-brand-mark', { src: '../assets/veyvo-icon.png', alt: '', width: 48, height: 48 }),
      h('div.set-brand-text',
        h('p.set-brand-name', I18n.t('common.appName')),
        h('p.set-brand-sub', fmt.typo([t('about.tagline'), view.version ? t('about.version', { version: view.version }) : null, t('about.platform.' + kind)].filter(Boolean).join(' · ')))));
    const lic = (name, text, licence) => h('li.set-lic', h('div.set-lic-main', h('span.set-lic-name', name), h('span.set-lic-text', text)), h('span.chip.set-lic-chip', licence));
    const licences = [
      lic('Inter', t('about.inter'), 'SIL OFL 1.1'),
      lic('Barlow Condensed', t('about.barlow'), 'SIL OFL 1.1'),
      lic('@bibixx/workoutkit 0.2.0', t('about.workoutkit'), 'MIT'),
      kind === 'desktop' ? lic('Electron', t('about.electron'), 'MIT') : null,
      kind === 'android' ? lic('Capacitor', t('about.capacitor'), 'MIT') : null,
      kind === 'ios' ? lic('Capacitor', t('about.capacitorIos'), 'MIT') : null
    ];
    const policy = h('button.btn-link.set-ext', { type: 'button', dataset: { key: 'set-privacy-policy' }, onClick: () => openExternal(PRIVACY_URL) },
      h('span', t('about.privacyPolicy')), icon('external', 14));
    const groups = [
      brand,
      group({ id: 'health', icon: 'heart', title: t('about.healthTitle'), sub: t('about.healthSub'), body: [h('p.set-text', t('about.medical')), h('p.set-text', t('about.medicalConsult'))] }),
      group({ id: 'privacy', icon: 'lock', title: t('about.privacyTitle'), sub: t('about.privacySub'), body: [
        h('p.set-text', t('about.privacy')), h('p.set-text', t(app.build.store ? 'about.privacyOutStore' : 'about.privacyOut')),
        kind === 'ios' ? h('p.set-text', t('about.privacyHealth')) : null, policy] }),
      group({ id: 'licences', icon: 'file', title: t('about.licences'), sub: t('about.licencesSub'), body: [h('ul.set-lic-list', licences)] })
    ];
    if (!view.phone && kind !== 'android' && kind !== 'ios') {
      const sc = (keys, text) => h('li.set-sc', h('span.set-sc-keys', keys.map(k => h('kbd.kbd', k))), h('span', text));
      groups.push(group({ id: 'shortcuts', icon: 'menu', title: t('about.shortcuts'), body: [h('ul.set-sc-list',
        sc(['N'], t('about.shortcutLog')),
        sc(['Esc'], t('about.shortcutClose')),
        sc([icon('arrow-up', 12), icon('arrow-down', 12)], t('about.shortcutTabs')))] }));
    }
    return h('div.set-groups', { class: view.enter ? 'stagger' : null }, groups);
  }

  // ================================================================ dialog
  function onState(ev) {
    if (view.draft && ev && ev.prev && ev.next && draftKey(view.draft) === draftKey(draftFromProfile(ev.prev.profile))) {
      view.draft = draftFromProfile(ev.next.profile);
    }
    // an undo (or any other change of the profile) ends the "Profil uložen" confirmation
    if (ev && ev.reason !== 'profile' && ev.prev && ev.next && JSON.stringify(ev.prev.profile) !== JSON.stringify(ev.next.profile)) view.savedAt = 0;
    render();
  }
  function onLanguage() {
    const hd = view.handle;
    if (!hd) return;
    hd.setTitle(t('title'));
    const close = hd.head.querySelector('.dlg-close');
    if (close) { close.setAttribute('aria-label', app.t('ui.dialog.close')); close.title = app.t('ui.dialog.close'); }
    render();
  }

  function applyParams(p) {
    if (p.connect && app.strava.supported) { view.section = 'connections'; view.strava.open = true; }
  }

  function open(params) {
    const p = params || {};
    if (view.handle && view.handle.isOpen()) {
      applyParams(p);
      if (p.section) select(p.section);
      if (p.backupText) startImport(String(p.backupText), { name: p.backupName });
      return view.handle;
    }
    view = freshView();
    view.section = sectionOf(p.section, shownSections());
    view.phone = app.isPhone();
    view.jumpActive = view.section;
    view.draft = draftFromProfile(app.state().profile);
    applyParams(p);
    view.shell = h('div.set-shell');
    const hd = app.dialogs.create({
      title: t('title'), kind: 'modal', size: 'lg', className: 'set-dlg dlg-full',
      body: view.shell,
      beforeClose() {
        if (view.forceClose || !isDirty()) return true;
        if (!view.confirming) {
          view.confirming = true;
          app.confirm({ title: t('profile.discardTitle'), body: t('profile.discardBody'), confirmLabel: t('profile.discard'), danger: true }).then(ok => {
            view.confirming = false;
            if (ok) { view.forceClose = true; hd.close(); }
          });
        }
        return false;
      },
      onClose() {
        view.offs.forEach(off => { try { off(); } catch (e) { /* already gone */ } });
        if (view.mq && view.onMq) { try { view.mq.removeEventListener('change', view.onMq); } catch (e) { /* old engines */ } }
        clearTimeout(view.savedTimer);
        view = freshView();
      }
    });
    view.handle = hd;
    view.offs = [
      app.on('state', onState),
      app.on('language', onLanguage),
      app.on('strava', st => { if (st && st.connected) view.strava.waiting = false; if (st && (!st.connected || !st.lastError)) stravaAuthFailed = false; render(); }),
      app.on('updates', st => { if (st && st.type && st.type !== 'checking' && st.type !== 'progress') view.updateAt = new Date(); render(); }),
      app.on('backup', () => { view.backups.list = null; render(); })
    ];
    if (root.matchMedia) {
      view.mq = root.matchMedia('(max-width: 760px)');
      view.onMq = () => render({ resetScroll: true });
      if (view.mq.addEventListener) view.mq.addEventListener('change', view.onMq);
    }
    hd.body.addEventListener('scroll', onBodyScroll, { passive: true });
    render({ resetScroll: true });
    if (view.phone) { if (p.section || p.connect) scrollToSection(view.section, false); }
    else focusKey('set-tab:' + view.section);
    if (view.strava.open) focusKey('set-strava-secret');
    if (p.backupText) startImport(String(p.backupText), { name: p.backupName });
    ensureVersion();
    return hd;
  }

  app.dialogs.register('settings', { open });

  UI.settings = {
    SECTIONS, STORE_SECTIONS, GOAL_PRESETS, INTERVALS_SECRET, STRAVA_CLIENT_ID, PRIVACY_URL, MESSAGES, HEALTH_AUTO_MS,
    sectionsFor, connectionsFor, healthKey, healthToast, importHealth, sectionOf, parseTarget, parseKm, presetOf, draftFromProfile, draftKey, profilePatch, goalPace, goalPreview,
    isReauthError, backupFileName, confirmWord, confirmMatches, maskKey, athleteName, wipeState, importSummary, updateView
  };
})(globalThis);
