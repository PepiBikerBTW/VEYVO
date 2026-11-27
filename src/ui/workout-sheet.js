/*
 * ui/workout-sheet.js - "Do hodinek": one structured workout and every way to get it onto a watch.
 *
 * Dialog names (docs/ui-architecture.md section 6): 'workout' and its alias 'workoutExport'.
 *   params { workout }                        a ready Workout (home, plan, run dialog)
 *          { workout?, date?, templateId? }   date / templateId refine it, or build it from the
 *                                             planned session or the library when workout is missing
 *          {}                                 derived.nextWorkout
 * Side sheet on desktop, bottom sheet on phones (the runtime decides).
 *
 * Top: the workout name (editable, <= 40 characters; the Garmin 15-character name is previewed with
 * VeyvoFit.garminName), date, estimated distance and time (VeyvoWorkouts.estimate: pace targets at
 * the middle of their range, other steps at the runner's easy pace), FIT step count, an intensity
 * profile, the step list and every VeyvoWorkouts.validate error in words.
 * Then "Kam ho poslat?": a brand grid with text labels (no logos). Each brand opens a short flow:
 *   Garmin          .fit (VeyvoFit) via VeyvoPlatform.saveFile; desktop also finds mass-storage
 *                   watches (garmin.findDrives) and copies straight to GARMIN\NewFiles; MTP steps
 *   Apple Watch     .workout (VeyvoApple, unofficial format), iPhone steps, WatchFit .fit fallback
 *   COROS, Suunto, Huawei, Amazfit, Garmin bez kabelu
 *                   intervals.icu push (VeyvoIntervals + VeyvoPlatform.http), API key in
 *                   VeyvoPlatform.secrets 'intervals-api-key' with inline setup; third-party notice
 *   Zwift, TrainingPeaks   .zwo (VeyvoZwo, reference pace from the runner's own 5 km)
 *   Polar, Samsung, Pixel, other   copy as text (VeyvoWorkouts.toText), print (desktop) or share
 * Each successful export is appended to state.exportLog (VeyvoStore.logExport); intervals pushes
 * also store state.intervals.lastPush / lastError. The chosen brand is remembered in
 * state.ui.lastExportBrand. Android: saveFile opens the share sheet, so the buttons say "Sdílet".
 *
 * Texts: i18n namespace 'workout' (cs + en). CSS: styles/pages/workout-sheet.css (prefix ws-).
 * Pure helpers for tests: VeyvoUI.workoutSheet.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI;
  const app = UI.app;
  const I18n = root.VeyvoI18n;
  const Store = root.VeyvoStore;
  const Workouts = root.VeyvoWorkouts;
  const Format = root.VeyvoFormat;
  const dom = UI.dom, h = dom.h, fmt = UI.fmt, icons = UI.icons, motion = UI.motion;
  const doc = root.document;
  const NB = '\u00a0';
  const EN_DASH = '\u2013';
  const SECRET = 'intervals-api-key';
  const LS_BRAND = 'veyvo-last-export-brand';
  const INTERVALS_SETTINGS = 'https://intervals.icu/settings';
  const NAME_MAX = Workouts.LIMITS.nameMax;
  const GARMIN_CHARS = 15;

  // Exporters and the platform are read when used, so a late patch (tests, screenshots) is seen.
  const Platform = () => root.VeyvoPlatform;
  const Fit = () => root.VeyvoFit;
  const Apple = () => root.VeyvoApple;
  const Zwo = () => root.VeyvoZwo;
  const Intervals = () => root.VeyvoIntervals;

  // ================================================================ brands
  /** id, flow ('fit' | 'apple' | 'intervals' | 'zwo' | 'text'), tile icon. 'other' spans the grid. */
  const BRANDS = Object.freeze([
    { id: 'garmin', flow: 'fit', icon: 'watch' },
    { id: 'garminCloud', flow: 'intervals', icon: 'refresh' },
    { id: 'apple', flow: 'apple', icon: 'watch' },
    { id: 'coros', flow: 'intervals', icon: 'refresh' },
    { id: 'suunto', flow: 'intervals', icon: 'refresh' },
    { id: 'polar', flow: 'text', icon: 'list' },
    { id: 'huawei', flow: 'intervals', icon: 'refresh' },
    { id: 'amazfit', flow: 'intervals', icon: 'refresh' },
    { id: 'samsung', flow: 'text', icon: 'list' },
    { id: 'pixel', flow: 'text', icon: 'list' },
    { id: 'zwift', flow: 'zwo', icon: 'file' },
    { id: 'trainingpeaks', flow: 'zwo', icon: 'file' },
    { id: 'other', flow: 'text', icon: 'list', wide: true }
  ].map(Object.freeze));
  const BRAND_IDS = BRANDS.map(b => b.id);
  function brandOf(id) { return BRANDS.find(b => b.id === id) || null; }

  /** The export log format code for an action. */
  const FORMAT = Object.freeze({ fit: 'fit', garminCopy: 'garmin', apple: 'apple', zwo: 'zwo', intervals: 'intervals', text: 'text', print: 'print', txt: 'text-share' });

  // ================================================================ texts (namespace 'workout')
  const MESSAGES = {
    cs: {
      eyebrow: { dated: 'Do hodinek · {date}', undated: 'Do hodinek' },
      titleFallback: 'Trénink do hodinek',
      empty: {
        title: 'Zatím není co poslat',
        text: 'Až zapíšeš běh, VEYVO naplánuje další trénink. Hotové tréninky najdeš také v knihovně v Můj plán.',
        plan: 'Otevřít Můj plán'
      },
      name: {
        label: 'Název v hodinkách',
        counter: '{n}/{max}',
        counterLabel: '{n} z {max} znaků',
        garminFull: 'Hodinky Garmin ukážou celý název.',
        garminCut: 'Většina hodinek Garmin ukáže jen prvních 15 znaků:',
        reset: 'Vrátit původní název'
      },
      fig: { distance: 'Vzdálenost', time: 'Čas', steps: 'Kroky', stepsMax: 'v hodinkách, nejvýš {max}', approx: 'přibližně' },
      est: {
        paced: 'Odhad: úseky s cílovým tempem počítá středem rozmezí, ostatní tvým lehkým tempem {pace} /km.',
        pacedOnly: 'Odhad: úseky s cílovým tempem počítá středem rozmezí.',
        open: {
          one: 'Nezahrnuje {n} krok do stisku Lap.', few: 'Nezahrnuje {n} kroky do stisku Lap.',
          many: 'Nezahrnuje {n} kroku do stisku Lap.', other: 'Nezahrnuje {n} kroků do stisku Lap.'
        },
        unpaced: 'Kroky bez tempa odhad nezahrnuje.'
      },
      steps: {
        title: 'Průběh',
        untilLap: 'do stisku Lap',
        byFeel: 'podle pocitu',
        hr: '{low}–{high} tep/min',
        repeat: '{n}× opakuj'
      },
      errors: {
        title: 'Takhle trénink do hodinek poslat nejde',
        step: 'Krok {n}',
        repeat: 'Opakování {n}',
        repeatStep: 'Opakování {n}, krok {m}',
        code: {
          workout_invalid: 'Trénink se nepodařilo načíst.',
          id_invalid: 'Trénink nemá platné označení.',
          name_required: 'Zadej název tréninku.',
          name_too_long: 'Název může mít nejvýš {max} znaků.',
          sport_invalid: 'VEYVO posílá jen běžecké tréninky.',
          date_invalid: 'Datum tréninku není platné.',
          description_invalid: 'Popis tréninku není platný.',
          source_invalid: 'Původ tréninku není známý.',
          steps_empty: 'Trénink nemá žádné kroky.',
          step_invalid: 'Krok není platný.',
          intensity_invalid: 'Krok má neznámou intenzitu.',
          duration_invalid: 'Krok nemá platnou délku.',
          duration_time_range: 'Délka kroku musí být od 10 s do 6 h.',
          duration_distance_range: 'Vzdálenost kroku musí být od 50 m do 100 km.',
          target_invalid: 'Cíl kroku není platný.',
          pace_range: 'Tempo musí být mezi 2:30 a 12:00 /km.',
          pace_order: 'V rozmezí tempa musí být rychlejší tempo první.',
          hr_range: 'Tep musí být mezi 60 a 220 tep/min.',
          hr_order: 'Spodní hranice tepu musí být nižší než horní.',
          label_invalid: 'Popisek kroku není platný.',
          label_too_long: 'Popisek kroku může mít nejvýš {max} znaků.',
          repeat_count_range: 'Opakování musí být 1× až 99×.',
          repeat_empty: 'Opakování nemá žádné kroky.',
          repeat_nested: 'Opakování nejde vnořit do jiného opakování.',
          too_many_steps: 'Trénink má {count} kroků, hodinky Garmin zvládnou nejvýš {max}.'
        }
      },
      last: {
        label: 'Naposledy odesláno:',
        at: '{day} v {time}',
        format: {
          fit: 'soubor .fit', garmin: 'přímo do hodinek Garmin', apple: 'soubor .workout', zwo: 'soubor .zwo',
          intervals: 'intervals.icu', text: 'zkopírováno jako text', print: 'tisk', 'text-share': 'sdílení textu'
        }
      },
      dest: { title: 'Kam ho poslat?', sub: 'Vyber hodinky nebo aplikaci', label: 'Hodinky nebo aplikace' },
      brand: {
        garmin: 'Garmin', garminCloud: 'Garmin bez kabelu', apple: 'Apple Watch', coros: 'COROS', suunto: 'Suunto',
        polar: 'Polar', huawei: 'Huawei', amazfit: 'Amazfit', samsung: 'Samsung', pixel: 'Pixel Watch',
        zwift: 'Zwift', trainingpeaks: 'TrainingPeaks', other: 'Jiné hodinky nebo aplikace'
      },
      method: {
        fit: 'Soubor .fit přes USB', intervals: 'Přes intervals.icu', apple: 'Soubor .workout', zwo: 'Soubor .zwo',
        text: 'Text a tisk', textShare: 'Text a sdílení'
      },
      action: {
        download: 'Stáhnout {ext}', share: 'Sdílet {ext}…', openFolder: 'Otevřít složku',
        copy: 'Kopírovat jako text', copied: 'Zkopírováno', print: 'Tisk', shareText: 'Sdílet jako text…'
      },
      status: {
        saving: 'Ukládám…',
        sharing: 'Otevírám sdílení…',
        saved: 'Uloženo jako {name}',
        downloaded: 'Staženo jako {name}',
        shared: 'Soubor {name} je předaný ke sdílení.',
        copied: 'Trénink je ve schránce jako text.',
        copyFailed: 'Text se nepodařilo zkopírovat. Označ ho v náhledu a zkopíruj ručně.',
        printed: 'Otevřel se tisk tréninku.',
        printFailed: 'Tisk se nepodařilo otevřít.',
        folderFailed: 'Složku se nepodařilo otevřít.'
      },
      export: {
        invalid: 'Trénink má chyby, oprav je nahoře.',
        appleFailed: 'Soubor pro Apple Watch se nepodařilo vytvořit.',
        failed: 'Soubor se nepodařilo vytvořit.'
      },
      howto: 'Postup',
      good: 'Dobré vědět',
      garmin: {
        lead: 'Trénink se uloží jako soubor .fit a do hodinek ho nahraješ kabelem USB.',
        drive: {
          scanning: 'Hledám hodinky připojené kabelem…',
          found: 'Hodinky připojené jako disk',
          none: 'Žádné hodinky připojené jako disk. Novější modely se v počítači ukážou jako přenosné zařízení, pro ně platí postup níže.',
          rescan: 'Hledat znovu',
          copy: 'Nahrát přímo do hodinek',
          copying: 'Nahrávám do hodinek…',
          copied: 'Nahráno do {path}. Hodinky odpoj, trénink pak najdeš v nabídce',
          error: 'Hodinky se nepodařilo vyhledat: {message}'
        },
        s1: 'Připoj hodinky kabelem USB k počítači.',
        s2: 'Otevři Tento počítač a v něm hodinky.',
        s3: 'Otevři složku',
        s4: 'Přetáhni do ní soubor',
        s5: 'Hodinky odpoj, trénink si samy přesunou mezi tréninky.',
        s6: 'Na hodinkách vyber běh, podrž Menu a otevři',
        s4Pending: 'Přetáhni do ní soubor, který si stáhneš tlačítkem výše.',
        path: { storage: 'Internal Storage', garmin: 'GARMIN', newFiles: 'NewFiles', training: 'Trénink', workouts: 'Tréninky' },
        n0: 'Hodinky bez hudby se ukážou jako disk (třeba E:) a složka GARMIN je přímo na něm.',
        n1: 'Hodinky pojmou nejvýš 25 uložených tréninků.',
        n2: 'Trénink zůstane jen v hodinkách, v Garmin Connect se neobjeví.',
        n3: 'Když se trénink neukáže, hodinky restartuj.',
        android: 'Z telefonu se soubor do hodinek Garmin nahrát nedá. Pošli si ho do počítače, nebo použij Garmin bez kabelu.',
        androidSwitch: 'Přepnout na Garmin bez kabelu'
      },
      apple: {
        lead: 'Trénink se uloží jako soubor .workout, který iPhone přidá do aplikace Cvičení.',
        where: 'Kde poběžíš',
        outdoor: 'Venku',
        indoor: 'Na pásu',
        s1: 'Pošli soubor do iPhonu, třeba přes iCloud Drive, e-mail nebo messenger.',
        s2: 'Na iPhonu na soubor klepni.',
        s3: 'Zvol',
        s4: 'Na hodinkách otevři Cvičení, vyber běh a trénink najdeš mezi vlastními tréninky.',
        add: 'Přidat do Apple Watch',
        req: 'Potřebuješ iPhone s iOS 17 nebo novějším a Apple Watch s watchOS 10 nebo novějším.',
        fallback: 'Soubor nejde otevřít? Aplikace WatchFit na iPhonu načte i soubor .fit.',
        unofficial: 'Neoficiální formát: Apple ho nezveřejnil, VEYVO ho zapisuje podle zpětně zjištěné struktury.'
      },
      intervals: {
        lead: 'VEYVO pošle trénink do tvého kalendáře v intervals.icu a ten ho předá do hodinek.',
        thirdParty: 'Služba třetí strany.',
        leaves: 'Trénink se odešle na intervals.icu, data tedy opustí toto zařízení.',
        unavailable: 'Odesílání do intervals.icu funguje v aplikaci VEYVO pro Windows a Android. Tady si trénink můžeš zkopírovat jako text.',
        setup: {
          title: 'Propojení s intervals.icu',
          s1: 'Přihlas se na intervals.icu a otevři',
          s2: 'Zkopíruj API key a vlož ho sem.',
          open: 'Otevřít intervals.icu',
          openFailed: 'Odkaz se nepodařilo otevřít.'
        },
        path: { settings: 'Settings', developer: 'Developer Settings' },
        key: {
          label: 'API klíč',
          placeholder: 'Vlož API klíč',
          save: 'Uložit klíč',
          saved: 'API klíč je uložený',
          change: 'Změnit',
          remove: 'Odebrat',
          cancel: 'Zrušit',
          required: 'Vlož API klíč z intervals.icu.',
          loading: 'Načítám uložený klíč…',
          encrypted: 'Klíč se ukládá šifrovaně v tomto počítači.',
          plain: 'Na Androidu se klíč ukládá do úložiště aplikace bez šifrování.',
          memory: 'Tady se klíč drží jen do zavření aplikace.',
          removeTitle: 'Odebrat API klíč?',
          removeBody: 'VEYVO pak do intervals.icu nic nepošle, dokud klíč znovu nevložíš.',
          removed: 'API klíč je odebraný.'
        },
        date: { label: 'Datum v kalendáři', past: 'Vyber dnešek nebo pozdější den.', invalid: 'Zadej platné datum.' },
        send: 'Poslat přes intervals.icu',
        sending: 'Odesílám do intervals.icu…',
        sent: 'Odesláno. Trénink je v kalendáři intervals.icu na {date}.',
        after: 'Do hodinek dorazí po synchronizaci, pokud máš v intervals.icu propojený účet {account}.',
        once: {
          title: 'Jednorázové nastavení v intervals.icu',
          connect: 'V Settings propoj účet {account} a zapni Upload planned workouts.',
          threshold: 'Nastav prahové tempo pro běh (Run threshold pace), jinak se cílová tempa do hodinek nedostanou.'
        },
        account: { garminCloud: 'Garmin Connect', coros: 'COROS', suunto: 'Suunto', huawei: 'Huawei Health', amazfit: 'Zepp' },
        note: {
          garminCloud: 'Garmin dostává naplánované tréninky zhruba na týden dopředu.',
          coros: 'V aplikaci COROS napoprvé přidej do kalendáře plán Intervals.icu Training Plan.',
          suunto: 'V hodinkách trénink najdeš mezi SuuntoPlus Guides, vyber ho před startem běhu.',
          huawei: 'Huawei Health dostane vždy nejbližší naplánovaný běh.',
          amazfit: 'Účet intervals.icu propojíš v aplikaci Zepp v propojení účtů. Plány zvládají hodinky se Zepp OS 5.'
        },
        fixKey: 'Změnit klíč'
      },
      zwo: {
        lead: 'Trénink se uloží jako soubor .zwo.',
        noPace: 'Pro soubor .zwo potřebuje VEYVO tvé tempo na 5 km. Zapiš test na 5 km nebo nastav cílový čas v profilu.',
        failed: 'Tento trénink do souboru .zwo převést nejde.',
        zwift: {
          s1: 'Ulož soubor do složky',
          s2: 'Ve Zwiftu ho najdeš mezi vlastními běžeckými tréninky (Custom Workouts).',
          s3: 'Ve Zwiftu nastav v Edit Paces tempo na 5 km {pace} /km, tempa v souboru jsou podle něj.'
        },
        zpath: { docs: 'Dokumenty', zwift: 'Zwift', workouts: 'Workouts', id: 'číslo tvého účtu' },
        tp: {
          s1: 'V TrainingPeaks otevři knihovnu tréninků a zvol',
          s2: 'Přetáhni trénink v kalendáři na den, kdy poběžíš.',
          s3: 'TrainingPeaks ho pošle do propojených hodinek, třeba Garmin, COROS, Suunto, Polar nebo Apple Watch.',
          premium: 'Plánování na další dny vyžaduje placené TrainingPeaks Premium.',
          pace: 'Tempa jsou v souboru zapsaná jako podíl tvého tempa na 5 km ({pace} /km). Po importu je zkontroluj.'
        },
        tpath: { library: 'Workout Library', import: 'Import Workout' }
      },
      text: {
        lead: 'Trénink si zkopíruj jako text, nebo ho vytiskni a vezmi s sebou.',
        leadShare: 'Trénink si zkopíruj jako text, nebo ho pošli do jiné aplikace.',
        preview: 'Náhled textu',
        polar: 'Polar přijímá naplánované tréninky jen z TrainingPeaks (placené Premium). Stáhni si soubor .zwo a naimportuj ho tam.',
        samsung: 'Hodinky Samsung strukturovaný trénink z jiné aplikace převzít neumí.',
        pixel: 'Hodinky Pixel Watch strukturovaný trénink z jiné aplikace převzít neumí.',
        other: 'Mnoho aplikací a hodinek otevře soubor .fit, zkus ho nejdřív.'
      },
      print: {
        brand: 'VEYVO',
        printed: 'Vytištěno {date}',
        step: 'Krok',
        amount: 'Délka',
        target: 'Cíl',
        done: 'Hotovo',
        estimate: 'Odhad: {distance} · {time}'
      }
    },
    en: {
      eyebrow: { dated: 'To your watch · {date}', undated: 'To your watch' },
      titleFallback: 'Workout for your watch',
      empty: {
        title: 'Nothing to send yet',
        text: 'Once you log a run, VEYVO plans your next workout. Ready-made sessions are also in the library under My plan.',
        plan: 'Open My plan'
      },
      name: {
        label: 'Name on the watch',
        counter: '{n}/{max}',
        counterLabel: '{n} of {max} characters',
        garminFull: 'Garmin watches show the whole name.',
        garminCut: 'Most Garmin watches show only the first 15 characters:',
        reset: 'Restore the original name'
      },
      fig: { distance: 'Distance', time: 'Time', steps: 'Steps', stepsMax: 'on the watch, max {max}', approx: 'about' },
      est: {
        paced: 'Estimate: steps with a target pace count at the middle of the range, the rest at your easy pace of {pace} /km.',
        pacedOnly: 'Estimate: steps with a target pace count at the middle of the range.',
        open: { one: 'Leaves out {n} step that ends when you press Lap.', other: 'Leaves out {n} steps that end when you press Lap.' },
        unpaced: 'Steps without a pace are left out of the estimate.'
      },
      steps: {
        title: 'Steps',
        untilLap: 'until you press Lap',
        byFeel: 'by feel',
        hr: '{low}–{high} bpm',
        repeat: 'Repeat {n}×'
      },
      errors: {
        title: 'This workout cannot go to a watch yet',
        step: 'Step {n}',
        repeat: 'Repeat {n}',
        repeatStep: 'Repeat {n}, step {m}',
        code: {
          workout_invalid: 'The workout could not be read.',
          id_invalid: 'The workout has no valid ID.',
          name_required: 'Enter a workout name.',
          name_too_long: 'The name can have at most {max} characters.',
          sport_invalid: 'VEYVO only sends running workouts.',
          date_invalid: 'The workout date is not valid.',
          description_invalid: 'The workout description is not valid.',
          source_invalid: 'The workout source is unknown.',
          steps_empty: 'The workout has no steps.',
          step_invalid: 'The step is not valid.',
          intensity_invalid: 'The step has an unknown intensity.',
          duration_invalid: 'The step has no valid length.',
          duration_time_range: 'A step must last from 10 s to 6 h.',
          duration_distance_range: 'A step must cover from 50 m to 100 km.',
          target_invalid: 'The step target is not valid.',
          pace_range: 'Pace must be between 2:30 and 12:00 /km.',
          pace_order: 'In a pace range the faster pace comes first.',
          hr_range: 'Heart rate must be between 60 and 220 bpm.',
          hr_order: 'The lower heart rate must be below the upper one.',
          label_invalid: 'The step label is not valid.',
          label_too_long: 'A step label can have at most {max} characters.',
          repeat_count_range: 'A repeat must run 1× to 99×.',
          repeat_empty: 'The repeat has no steps.',
          repeat_nested: 'A repeat cannot sit inside another repeat.',
          too_many_steps: 'The workout has {count} steps; Garmin watches take at most {max}.'
        }
      },
      last: {
        label: 'Last sent:',
        at: '{day} at {time}',
        format: {
          fit: '.fit file', garmin: 'straight to the Garmin watch', apple: '.workout file', zwo: '.zwo file',
          intervals: 'intervals.icu', text: 'copied as text', print: 'printed', 'text-share': 'shared as text'
        }
      },
      dest: { title: 'Where should it go?', sub: 'Pick your watch or app', label: 'Watch or app' },
      brand: {
        garmin: 'Garmin', garminCloud: 'Garmin, no cable', apple: 'Apple Watch', coros: 'COROS', suunto: 'Suunto',
        polar: 'Polar', huawei: 'Huawei', amazfit: 'Amazfit', samsung: 'Samsung', pixel: 'Pixel Watch',
        zwift: 'Zwift', trainingpeaks: 'TrainingPeaks', other: 'Other watches and apps'
      },
      method: {
        fit: '.fit file over USB', intervals: 'Via intervals.icu', apple: '.workout file', zwo: '.zwo file',
        text: 'Text and print', textShare: 'Text and sharing'
      },
      action: {
        download: 'Download {ext}', share: 'Share {ext}…', openFolder: 'Show in folder',
        copy: 'Copy as text', copied: 'Copied', print: 'Print', shareText: 'Share as text…'
      },
      status: {
        saving: 'Saving…',
        sharing: 'Opening the share sheet…',
        saved: 'Saved as {name}',
        downloaded: 'Downloaded as {name}',
        shared: '{name} was handed to the share sheet.',
        copied: 'The workout is on your clipboard as text.',
        copyFailed: 'The text could not be copied. Select it in the preview and copy it yourself.',
        printed: 'The print dialog opened.',
        printFailed: 'Printing could not be started.',
        folderFailed: 'The folder could not be opened.'
      },
      export: {
        invalid: 'The workout has errors; fix them above.',
        appleFailed: 'The Apple Watch file could not be created.',
        failed: 'The file could not be created.'
      },
      howto: 'How to',
      good: 'Good to know',
      garmin: {
        lead: 'The workout is saved as a .fit file that you copy to the watch over a USB cable.',
        drive: {
          scanning: 'Looking for a watch connected by cable…',
          found: 'Watch connected as a drive',
          none: 'No watch connected as a drive. Newer models show up as a portable device instead; the steps below cover them.',
          rescan: 'Search again',
          copy: 'Copy straight to the watch',
          copying: 'Copying to the watch…',
          copied: 'Copied to {path}. Unplug the watch; the workout is then in',
          error: 'Could not look for the watch: {message}'
        },
        s1: 'Connect the watch to the computer with the USB cable.',
        s2: 'Open This PC and then the watch.',
        s3: 'Open the folder',
        s4: 'Drag in the file',
        s5: 'Unplug the watch; it moves the file to its workouts itself.',
        s6: 'On the watch, pick Run, hold Menu and open',
        s4Pending: 'Drag in the file you download with the button above.',
        path: { storage: 'Internal Storage', garmin: 'GARMIN', newFiles: 'NewFiles', training: 'Training', workouts: 'Workouts' },
        n0: 'Watches without music show up as a drive (such as E:) with the GARMIN folder right on it.',
        n1: 'The watch holds at most 25 saved workouts.',
        n2: 'The workout stays on the watch only; it does not appear in Garmin Connect.',
        n3: 'If the workout does not show up, restart the watch.',
        android: 'A phone cannot copy the file to a Garmin watch. Send it to a computer, or use Garmin, no cable.',
        androidSwitch: 'Switch to Garmin, no cable'
      },
      apple: {
        lead: 'The workout is saved as a .workout file that your iPhone adds to the Workout app.',
        where: 'Where will you run',
        outdoor: 'Outdoors',
        indoor: 'Treadmill',
        s1: 'Send the file to your iPhone, for example through iCloud Drive, e-mail or a messenger.',
        s2: 'Tap the file on the iPhone.',
        s3: 'Choose',
        s4: 'On the watch, open Workout, pick a run and find the workout among your custom workouts.',
        add: 'Add to Apple Watch',
        req: 'You need an iPhone with iOS 17 or later and an Apple Watch with watchOS 10 or later.',
        fallback: 'Cannot open the file? The WatchFit app on the iPhone also reads the .fit file.',
        unofficial: 'Unofficial format: Apple has not published it; VEYVO writes it from a reverse-engineered structure.'
      },
      intervals: {
        lead: 'VEYVO puts the workout on your intervals.icu calendar, which passes it on to the watch.',
        thirdParty: 'Third-party service.',
        leaves: 'The workout is sent to intervals.icu, so the data leaves this device.',
        unavailable: 'Sending to intervals.icu works in the VEYVO app for Windows and Android. Here you can copy the workout as text.',
        setup: {
          title: 'Connect intervals.icu',
          s1: 'Sign in to intervals.icu and open',
          s2: 'Copy the API key and paste it here.',
          open: 'Open intervals.icu',
          openFailed: 'The link could not be opened.'
        },
        path: { settings: 'Settings', developer: 'Developer Settings' },
        key: {
          label: 'API key',
          placeholder: 'Paste the API key',
          save: 'Save key',
          saved: 'The API key is saved',
          change: 'Change',
          remove: 'Remove',
          cancel: 'Cancel',
          required: 'Paste your intervals.icu API key.',
          loading: 'Loading the saved key…',
          encrypted: 'The key is stored encrypted on this computer.',
          plain: 'On Android the key is stored in the app storage without encryption.',
          memory: 'Here the key is kept only until the app closes.',
          removeTitle: 'Remove the API key?',
          removeBody: 'VEYVO will not send anything to intervals.icu until you paste a key again.',
          removed: 'The API key was removed.'
        },
        date: { label: 'Calendar date', past: 'Pick today or a later day.', invalid: 'Enter a valid date.' },
        send: 'Send via intervals.icu',
        sending: 'Sending to intervals.icu…',
        sent: 'Sent. The workout is on your intervals.icu calendar for {date}.',
        after: 'It reaches the watch after a sync, as long as your {account} account is connected in intervals.icu.',
        once: {
          title: 'One-time setup in intervals.icu',
          connect: 'In Settings, connect your {account} account and turn on Upload planned workouts.',
          threshold: 'Set a Run threshold pace, otherwise pace targets do not reach the watch.'
        },
        account: { garminCloud: 'Garmin Connect', coros: 'COROS', suunto: 'Suunto', huawei: 'Huawei Health', amazfit: 'Zepp' },
        note: {
          garminCloud: 'Garmin receives planned workouts about a week ahead.',
          coros: 'In the COROS app, add the Intervals.icu Training Plan to your calendar the first time.',
          suunto: 'On the watch the workout is among SuuntoPlus Guides; pick it before you start the run.',
          huawei: 'Huawei Health always receives the next planned run.',
          amazfit: 'Link intervals.icu in the Zepp app under account linking. Plans work on Zepp OS 5 watches.'
        },
        fixKey: 'Change key'
      },
      zwo: {
        lead: 'The workout is saved as a .zwo file.',
        noPace: 'A .zwo file needs your 5 km pace. Log a 5 km test or set a goal time in your profile.',
        failed: 'This workout cannot be converted to a .zwo file.',
        zwift: {
          s1: 'Save the file to the folder',
          s2: 'In Zwift it is among your custom running workouts (Custom Workouts).',
          s3: 'In Zwift, set your 5 km pace to {pace} /km under Edit Paces; the paces in the file are based on it.'
        },
        zpath: { docs: 'Documents', zwift: 'Zwift', workouts: 'Workouts', id: 'your account number' },
        tp: {
          s1: 'In TrainingPeaks, open the workout library and choose',
          s2: 'Drag the workout onto the calendar day you will run it.',
          s3: 'TrainingPeaks sends it to connected watches such as Garmin, COROS, Suunto, Polar or Apple Watch.',
          premium: 'Planning future days needs a paid TrainingPeaks Premium account.',
          pace: 'Paces are stored as a share of your 5 km pace ({pace} /km). Check them after the import.'
        },
        tpath: { library: 'Workout Library', import: 'Import Workout' }
      },
      text: {
        lead: 'Copy the workout as text, or print it and take it with you.',
        leadShare: 'Copy the workout as text, or send it to another app.',
        preview: 'Text preview',
        polar: 'Polar only takes planned workouts from TrainingPeaks (paid Premium). Download the .zwo file and import it there.',
        samsung: 'Samsung watches cannot take a structured workout from another app.',
        pixel: 'Pixel Watch cannot take a structured workout from another app.',
        other: 'Many apps and watches open a .fit file, so try that first.'
      },
      print: {
        brand: 'VEYVO',
        printed: 'Printed {date}',
        step: 'Step',
        amount: 'Length',
        target: 'Target',
        done: 'Done',
        estimate: 'Estimate: {distance} · {time}'
      }
    }
  };
  I18n.register('workout', MESSAGES);

  const t = (key, params) => app.t('workout.' + key, params);

  // ================================================================ pure helpers (exported for tests)
  function isKey(value) { return typeof value === 'string' && Workouts.isDateKey(value); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function charCount(text) { return Array.from(String(text || '')).length; }

  /** 'lib-easy' + '2026-11-29' -> 'lib-easy-2026-11-29'; a trailing date is replaced, never doubled. */
  function idForDate(id, date) {
    const base = String(id || 'workout').replace(/-\d{4}-\d{2}-\d{2}$/, '') || 'workout';
    return base.slice(0, 89) + '-' + date;
  }

  /**
   * resolveWorkout(params, derived) -> { workout, templateId, date, source } | null
   * source: 'param' (a passed workout), 'planned' (scheduled library session), 'library', 'next'.
   * A date that differs from the workout's own date re-dates the copy and its id (idForDate), the
   * same way VeyvoUI.app dates planned library sessions.
   */
  function resolveWorkout(params, d) {
    const p = params || {};
    const date = isKey(p.date) ? p.date : null;
    const templateId = typeof p.templateId === 'string' && p.templateId ? p.templateId : null;
    let workout = null, source = null;
    if (p.workout && typeof p.workout === 'object') { workout = clone(p.workout); source = 'param'; }
    else if (templateId) {
      const planned = date && d ? (d.planned || []).find(x => x.date === date && x.templateId === templateId && x.workout) : null;
      const tpl = d ? (d.library || []).find(x => x.id === templateId) : null;
      if (planned) { workout = clone(planned.workout); source = 'planned'; }
      else if (tpl) { workout = clone(tpl.workout); source = 'library'; }
    } else if (d && d.nextWorkout) { workout = clone(d.nextWorkout); source = 'next'; }
    if (!workout || typeof workout !== 'object') return null;
    const when = date || (isKey(workout.date) ? workout.date : null);
    if (when && workout.date !== when) { workout.date = when; workout.id = idForDate(workout.id, when); }
    return { workout, templateId, date: when, source };
  }

  /** Series group of a workout: template ids map like the plan page; otherwise from the shape. */
  const TEMPLATE_GROUP = { easy: 'easy', long: 'easy', intervals400: 'quality', intervals1k: 'quality', threshold: 'quality', test5k: 'fast' };
  function groupOf(workout, templateId) {
    if (templateId && TEMPLATE_GROUP[templateId]) return TEMPLATE_GROUP[templateId];
    const steps = workout && Array.isArray(workout.steps) ? workout.steps : [];
    if (steps.some(s => s && s.kind === 'repeat')) return 'quality';
    if (steps.some(s => s && s.intensity === 'active' && typeof s.label === 'string' && s.label.trim() && (!s.target || s.target.type !== 'pace'))) return 'fast';
    return 'easy';
  }

  function midPace(target) {
    return target && target.type === 'pace' && target.fastSecPerKm > 0 && target.slowSecPerKm > 0 ? (target.fastSecPerKm + target.slowSecPerKm) / 2 : null;
  }
  /** Middle of the derived easy range (s/km) or null; the same value VeyvoWorkouts.estimate gets. */
  function easyPaceOf(paces) {
    return paces && paces.easy ? (paces.easy.fastSecPerKm + paces.easy.slowSecPerKm) / 2 : null;
  }

  /**
   * profileBlocks(workout, { easyPace, refPace }) -> [{ intensity, seconds, level, inRepeat }]
   * A drawing of the prescription, repeats expanded: width ~ planned seconds (distance at the step's
   * pace, else the easy pace, else 6:00 /km; lap-button steps 5 min), height ~ intensity (faster
   * than the reference pace = taller). Decorative only (aria-hidden); the step list has the numbers.
   */
  function profileBlocks(workout, options) {
    const o = options || {};
    const easy = o.easyPace > 0 ? o.easyPace : 360;
    const ref = o.refPace > 0 ? o.refPace : null;
    const out = [];
    const add = (s, inRepeat) => {
      if (!s || s.kind !== 'step' || !s.duration) return;
      const pace = midPace(s.target) || easy;
      let seconds;
      if (s.duration.type === 'time') seconds = s.duration.seconds;
      else if (s.duration.type === 'distance') seconds = s.duration.meters / 1000 * pace;
      else seconds = 300;
      const labelled = typeof s.label === 'string' && !!s.label.trim();
      let level;
      if (s.intensity === 'warmup' || s.intensity === 'cooldown') level = 0.36;
      else if (s.intensity === 'recovery') level = 0.24;
      else if (s.intensity === 'rest') level = 0.14;
      else if (s.target && s.target.type === 'pace' && ref) level = Math.max(0.46, Math.min(1, Math.pow(ref / pace, 2)));
      else level = labelled ? 1 : 0.62;
      out.push({ intensity: s.intensity, seconds: Math.max(1, Number(seconds) || 1), level: Math.round(level * 100) / 100, inRepeat });
    };
    (workout && Array.isArray(workout.steps) ? workout.steps : []).forEach(item => {
      if (item && item.kind === 'repeat') {
        const count = Math.max(1, Math.min(99, Number(item.count) || 1));
        for (let i = 0; i < count; i++) (item.steps || []).forEach(s => add(s, true));
      } else add(item, false);
    });
    return out;
  }

  /**
   * errorEntries(validation) -> [{ code, key, params, where: null | { key, params } }]
   * Location from the error path: 'steps.2' -> 'Krok 3'; 'steps.1.steps.0' -> 'Opakování 2, krok 1'.
   */
  function errorEntries(result) {
    const list = result && Array.isArray(result.errors) ? result.errors : [];
    const seen = new Set();
    const out = [];
    list.forEach(e => {
      const m = /^steps\.(\d+)(?:\.steps\.(\d+))?/.exec(e.path || '');
      let where = null;
      if (m && m[2] !== undefined) where = { key: 'errors.repeatStep', params: { n: Number(m[1]) + 1, m: Number(m[2]) + 1 } };
      else if (m && /count$|steps$/.test(e.path) && e.code.indexOf('repeat') === 0) where = { key: 'errors.repeat', params: { n: Number(m[1]) + 1 } };
      else if (m) where = { key: 'errors.step', params: { n: Number(m[1]) + 1 } };
      const sig = e.code + '|' + (where ? JSON.stringify(where) : '');
      if (seen.has(sig)) return;
      seen.add(sig);
      const params = {};
      ['min', 'max', 'count'].forEach(k => { if (e[k] !== undefined) params[k] = e[k]; });
      const key = I18n.has('workout.errors.code.' + e.code) ? 'errors.code.' + e.code : 'errors.code.workout_invalid';
      out.push({ code: e.code, key, params, where });
    });
    return out;
  }

  /** Plain text for the clipboard / share / print: name, date line, the step lines, description. */
  function textFor(workout, locale, dateLabel) {
    const lines = [String(workout.name || '').trim()];
    if (dateLabel) lines.push(dateLabel);
    lines.push('');
    Workouts.toLines(workout, locale).forEach(line => lines.push(line));
    if (typeof workout.description === 'string' && workout.description.trim()) { lines.push(''); lines.push(workout.description.trim()); }
    return lines.join('\n');
  }

  /** 'E:\\' -> 'E:\\GARMIN\\NewFiles' (also for '/media/GARMIN/'). */
  function newFilesPath(rootPath) {
    const r = String(rootPath || '');
    const sep = r.indexOf('/') >= 0 && r.indexOf('\\') < 0 ? '/' : '\\';
    return r.replace(/[\\/]+$/, '') + sep + 'GARMIN' + sep + 'NewFiles';
  }

  /** Brand remembered in state.ui.lastExportBrand (or the local fallback), if still known. */
  function lastBrand(state, storageGet) {
    const fromState = state && state.ui && typeof state.ui.lastExportBrand === 'string' ? state.ui.lastExportBrand : null;
    let id = fromState;
    if (!id && typeof storageGet === 'function') { try { id = storageGet(LS_BRAND); } catch (e) { id = null; } }
    return BRAND_IDS.indexOf(id) >= 0 ? id : null;
  }

  // ================================================================ small view helpers
  function paceRange(fast, slow) { return fmt.pace(fast) + EN_DASH + fmt.pace(slow) + NB + '/km'; }
  /** Czech typography plus no line break inside number ranges ('3:50–3:57', '15–20'). */
  function prose(text) { return fmt.typo(String(text || '')).replace(/(\d)\u2013(?=\d)/g, '$1\u2060\u2013\u2060'); }
  function stepAmount(step, locale) {
    const d = step.duration;
    if (d.type === 'time') return fmt.typo(Workouts.format.time(d.seconds));
    if (d.type === 'distance') return fmt.typo(Workouts.format.distance(d.meters, locale));
    return t('steps.untilLap');
  }
  function stepTarget(step) {
    const tg = step.target;
    if (tg && tg.type === 'pace') return { text: paceRange(tg.fastSecPerKm, tg.slowSecPerKm), strong: true };
    if (tg && tg.type === 'hr') return { text: t('steps.hr', { low: Math.round(tg.lowBpm), high: Math.round(tg.highBpm) }), strong: true };
    if (step.intensity === 'active' && typeof step.label === 'string' && step.label.trim()) return { text: '', strong: false };
    return { text: t('steps.byFeel'), strong: false };
  }
  /** '1 h 6 min' -> <span.num>1</span><span.unit> h</span>… (numbers in Barlow, units small). */
  function numUnits(text, cls) {
    const parts = String(text).split(/[\s\u00a0]+/).filter(Boolean);
    return h('span', { class: ['ws-nu', cls] }, parts.map(p => /^[\d.,:\u2212-]+$/.test(p) ? h('span.num', p) : h('span.unit', NB + p)));
  }
  /** A path such as Internal Storage > GARMIN > NewFiles, separated by SVG chevrons. */
  function pathNode(segments) {
    const nodes = [];
    segments.forEach((seg, i) => {
      if (i) {
        nodes.push(icons.get('chevron-right', { className: 'ws-path-sep', size: 12 }));
        nodes.push(h('span.sr-only', ', '));
      }
      nodes.push(h('span.ws-path-seg', seg));
    });
    return h('span.ws-path', nodes);
  }
  function codeChip(text) { return h('code.ws-code', text); }
  /**
   * Icons the shared set (VeyvoUI.icons) does not have, drawn on the same 24 grid with the same
   * stroke rules (svg.ic in base.css): 'printer'. Unknown names fall back to the shared set.
   */
  const LOCAL_ICONS = {
    printer: ['M7 8V3.5h10V8', 'M7 17.5H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-2', 'M7 14h10v6.5H7z', 'M17 11h.01']
  };
  function icon(name, options) {
    if (!LOCAL_ICONS[name]) return icons.get(name, options);
    const o = options || {};
    const el = dom.svg('svg', { viewBox: '0 0 24 24', class: 'ic' + (o.className ? ' ' + o.className : ''), focusable: 'false', 'aria-hidden': 'true' },
      LOCAL_ICONS[name].map(d => dom.svg('path', { d })));
    if (o.size) el.style.setProperty('--ic', o.size + 'px');
    return el;
  }
  function localTime(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    return { day: Format.toDateKey(d), time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') };
  }
  function extOf(kind) { return kind === 'apple' ? '.workout' : kind === 'zwo' ? '.zwo' : kind === 'txt' ? '.txt' : '.fit'; }

  // ================================================================ the sheet
  function openSheet(params) {
    const platform = Platform();
    const kind = platform ? platform.kind : 'web';
    const isAndroid = kind === 'android';
    const resolved = resolveWorkout(params, app.derived());
    const view = {
      params: params || {},
      resolved,
      workout: resolved ? resolved.workout : null,
      originalName: resolved ? resolved.workout.name : '',
      nameEdited: false,
      brand: lastBrand(app.state(), app.storage.get),
      brandAnim: false,
      first: true,
      status: {},            // action key -> { kind: 'busy' | 'ok' | 'error' | 'info', text, path?, file?, fresh }
      drives: null,          // null (not searched) | 'scanning' | [{ root, label }] | { error }
      key: { state: 'unknown', value: null, draft: '', editing: false, error: null, busy: false, reveal: false },
      pushDate: null,
      dateError: null,
      appleLocation: 'outdoor',
      copiedUntil: 0
    };
    const today = app.today();
    view.pushDate = view.workout && isKey(view.workout.date) && view.workout.date >= today ? view.workout.date : today;
    const opener = doc.activeElement;
    const openerKey = opener && opener.getAttribute ? opener.getAttribute('data-key') : null;
    const refs = {};
    const rootEl = h('div.ws');
    let handle = null;
    let closed = false;
    let copiedTimer = null;
    let printNode = null;
    let animUntil = 0;
    let pendingPaint = null;

    // ---------------------------------------------------------------- derived bits
    const locale = () => I18n.getLocale();
    const derived = () => app.derived();
    const validation = () => (view.workout ? Workouts.validate(view.workout) : { ok: false, errors: [{ code: 'workout_invalid', path: '' }], fitStepCount: 0 });
    function eyebrowText() {
      const w = view.workout;
      return w && isKey(w.date) ? t('eyebrow.dated', { date: fmt.date(w.date, 'short') }) : t('eyebrow.undated');
    }
    function titleText() {
      const name = view.workout && typeof view.workout.name === 'string' ? view.workout.name.trim() : '';
      return name ? fmt.typo(name) : t('titleFallback');
    }
    function setStatus(key, value) {
      if (value) value.fresh = true;
      view.status[key] = value || null;
      paint();
    }

    // ---------------------------------------------------------------- render loop
    function captureFocus() {
      const a = doc.activeElement;
      if (!a || !rootEl.contains(a)) return null;
      const key = a.getAttribute('data-key');
      if (!key) return null;
      let start = null, end = null;
      try { start = a.selectionStart; end = a.selectionEnd; } catch (e) { /* not a text field */ }
      return { key, start, end };
    }
    function restoreFocus(saved) {
      if (!saved) return;
      let el = null;
      try { el = rootEl.querySelector('[data-key="' + CSS.escape(saved.key) + '"]'); } catch (e) { el = null; }
      if (!el || typeof el.focus !== 'function') return;
      el.focus({ preventScroll: true });
      if (saved.start !== null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(saved.start, saved.end); } catch (e) { /* date inputs */ } }
    }
    /** Background results (drive search, saved key) wait until the entrance motion has finished. */
    function settle() {
      if (closed) return;
      const wait = animUntil - Date.now();
      if (wait <= 0) { paint(); return; }
      clearTimeout(pendingPaint);
      pendingPaint = setTimeout(() => { pendingPaint = null; paint(); }, wait);
    }
    function markMotion() { animUntil = motion.prefersReduced() ? 0 : Date.now() + 480; }
    function paint() {
      if (closed) return;
      clearTimeout(pendingPaint);
      pendingPaint = null;
      const saved = captureFocus();
      const scroller = handle ? handle.body : null;
      const scroll = scroller ? scroller.scrollTop : 0;
      rootEl.dataset.anim = view.first ? 'on' : 'off';
      Object.keys(refs).forEach(k => { delete refs[k]; });
      dom.mount(rootEl, build());
      icons.hydrate(rootEl);
      if (scroller) scroller.scrollTop = scroll;
      restoreFocus(saved);
      if (view.first) { markMotion(); afterFirstPaint(); }
      view.first = false;
      view.brandAnim = false;
      Object.keys(view.status).forEach(k => { if (view.status[k]) view.status[k].fresh = false; });
    }
    function afterFirstPaint() {
      (root.requestAnimationFrame || setTimeout)(() => {
        if (refs.figDistance && refs.figDistance.dataset.to) {
          motion.countUp(refs.figDistance, Number(refs.figDistance.dataset.to), { from: 0, duration: 420, delay: 120, format: v => fmt.km(v) });
        }
        if (refs.figTime && refs.figTime.dataset.to) {
          motion.countUp(refs.figTime, Number(refs.figTime.dataset.to), { from: 0, duration: 420, delay: 140, format: v => String(Math.round(v)) });
        }
        if (refs.figSteps && refs.figSteps.dataset.to) {
          motion.countUp(refs.figSteps, Number(refs.figSteps.dataset.to), { from: 0, duration: 360, delay: 160, format: v => String(Math.round(v)) });
        }
      });
    }

    // ---------------------------------------------------------------- build: workout card
    function build() {
      if (!view.workout) return emptyState();
      const check = validation();
      return [workoutCard(check), destination(check)];
    }

    function emptyState() {
      return app.components.create('empty', {
        icon: 'watch', title: t('empty.title'), text: t('empty.text'), center: true,
        actions: [h('button.btn.btn-secondary', { type: 'button', dataset: { key: 'ws-empty-plan' }, onClick: () => { handle.close(); setTimeout(() => app.navigate('plan'), 200); } },
          icons.get('calendar'), t('empty.plan'))]
      });
    }

    function workoutCard(check) {
      const w = view.workout;
      const d = derived();
      const group = groupOf(w, view.resolved.templateId);
      return h('section.ws-card.card', { class: 'ws-g-' + group, 'aria-label': titleText() },
        nameField(check),
        check.ok ? figures(w, d) : null,
        check.ok ? profileNode(w, d) : null,
        check.ok ? stepList(w) : null,
        typeof w.description === 'string' && w.description.trim() ? h('p.ws-desc', prose(w.description.trim())) : null,
        check.ok ? estimateNote(w, d) : null,
        errorsBlock(check),
        lastExportLine(w));
    }

    function nameField(check) {
      const w = view.workout;
      const id = 'ws-name';
      const hintId = 'ws-name-hint';
      const nameErr = check.errors.some(e => e.path === 'name');
      const input = h('input.input.ws-name-input', {
        id, type: 'text', value: w.name || '', maxlength: String(NAME_MAX), autocomplete: 'off', spellcheck: 'false',
        dataset: { key: 'ws-name' }, 'aria-describedby': hintId + ' ws-name-count', 'aria-invalid': nameErr ? 'true' : null,
        onInput: e => onName(e.target.value)
      });
      refs.nameInput = input;
      refs.count = h('span.ws-count.num', { id: 'ws-name-count', 'aria-label': t('name.counterLabel', { n: charCount(w.name), max: NAME_MAX }) },
        t('name.counter', { n: charCount(w.name), max: NAME_MAX }));
      refs.hint = h('p.ws-name-hint', { id: hintId, 'aria-live': 'polite' });
      fillHint(refs.hint);
      const reset = view.nameEdited && view.originalName
        ? h('button.btn-link.ws-name-reset', { type: 'button', dataset: { key: 'ws-name-reset' }, onClick: resetName }, icons.get('undo'), t('name.reset'))
        : null;
      refs.reset = reset;
      return h('div.ws-name',
        h('div.ws-name-top', h('label.field-label', { for: id }, t('name.label')), refs.count),
        input,
        h('div.ws-name-bottom', refs.hint, reset));
    }
    function fillHint(el) {
      const name = view.workout.name || '';
      if (!name.trim()) { dom.clear(el); return; }
      if (charCount(name.trim()) <= GARMIN_CHARS) {
        dom.mount(el, icons.get('check', { size: 14, className: 'ws-hint-ok' }), h('span', t('name.garminFull')));
      } else {
        const short = Fit() ? Fit().garminName(name) : Array.from(name.trim()).slice(0, GARMIN_CHARS).join('');
        dom.mount(el, icons.get('watch', { size: 14, className: 'ws-hint-cut' }), h('span', t('name.garminCut'), ' ', h('b.ws-short', short)));
      }
    }
    function onName(value) {
      const wasOk = validation().ok;
      view.workout.name = value;
      view.nameEdited = value !== view.originalName;
      const nowOk = validation().ok;
      if (handle) handle.setTitle(titleText());
      if (wasOk !== nowOk || !!refs.reset !== view.nameEdited) { paint(); return; }
      // Light update while typing: counter, Garmin preview, text preview, error list.
      const n = charCount(value);
      refs.count.textContent = t('name.counter', { n, max: NAME_MAX });
      refs.count.setAttribute('aria-label', t('name.counterLabel', { n, max: NAME_MAX }));
      fillHint(refs.hint);
      if (refs.textPreview) refs.textPreview.textContent = currentText();
      if (refs.errors) dom.mount(refs.errors, errorItems(validation()));
      const card = refs.nameInput && refs.nameInput.closest('section');
      if (card) card.setAttribute('aria-label', titleText());
    }
    function resetName() {
      view.workout.name = view.originalName;
      view.nameEdited = false;
      if (handle) handle.setTitle(titleText());
      paint();
      if (refs.nameInput) refs.nameInput.focus();
    }

    function figures(w, d) {
      const est = Workouts.estimate(w, { easyPaceSecPerKm: easyPaceOf(d.paces) });
      const check = validation();
      const km = est && est.distanceM > 0 ? Math.round(est.distanceM / 100) / 10 : null;
      const minutes = est && est.seconds > 0 ? Math.max(1, Math.round(est.seconds / 60)) : null;
      const approx = h('span.ws-approx', { 'aria-hidden': 'true' }, '\u2248');
      const sr = h('span.sr-only', t('fig.approx') + ' ');
      refs.figDistance = km !== null ? h('span.num', { dataset: { to: String(km) } }, fmt.km(km)) : null;
      refs.figSteps = h('span.num', { dataset: { to: String(check.fitStepCount) } }, String(check.fitStepCount));
      const fig = (label, value, extra) => h('div.ws-fig', h('span.ws-fig-label', label), h('span.ws-fig-value', value), extra || null);
      const timeNode = minutes !== null ? numUnits(fmt.durationWords(minutes * 60)) : null;
      const timeNums = timeNode ? timeNode.querySelectorAll('.num') : [];
      refs.figTime = minutes !== null && minutes < 60 && timeNums.length === 1 ? timeNums[0] : null;
      if (refs.figTime) refs.figTime.dataset.to = String(minutes);
      return h('div.ws-figs',
        fig(t('fig.distance'), km !== null ? [approx.cloneNode(true), sr.cloneNode(true), refs.figDistance, h('span.unit', NB + 'km')] : h('span.num.faint', Format.EMPTY)),
        fig(t('fig.time'), timeNode ? [approx, sr, timeNode] : h('span.num.faint', Format.EMPTY)),
        fig(t('fig.steps'), refs.figSteps, h('span.ws-fig-sub', t('fig.stepsMax', { max: Workouts.LIMITS.maxFitSteps }))));
    }

    function profileNode(w, d) {
      // A single step draws one flat slab: only multi-step sessions get a profile.
      if (w.steps.length < 2 && !w.steps.some(x => x.kind === 'repeat')) return null;
      const blocks = profileBlocks(w, { easyPace: easyPaceOf(d.paces), refPace: d.paces ? d.paces.goalSecPerKm : null });
      if (!blocks.length) return null;
      const total = blocks.reduce((sum, b) => sum + b.seconds, 0) || 1;
      return h('div.ws-profile', { 'aria-hidden': 'true' },
        blocks.map((b, i) => h('i', {
          class: ['ws-blk', 'ws-blk-' + b.intensity, 'grow-y'],
          style: { flexGrow: String(Math.max(0.001, b.seconds / total * 100)), '--lv': String(b.level), '--i': String(Math.min(i, 16)) }
        })));
    }

    function stepList(w) {
      const loc = locale();
      const row = (step, inRepeat) => {
        const target = stepTarget(step);
        return h('li.ws-step', { class: 'ws-step-' + step.intensity },
          h('i.ws-step-bar', { 'aria-hidden': 'true' }),
          h('span.ws-step-name', Workouts.stepName(step, loc, inRepeat)),
          h('span.ws-step-amt.num', stepAmount(step, loc)),
          h('span', { class: ['ws-step-tgt', target.strong ? 'num' : 'faint'] }, target.text));
      };
      return h('ol.ws-steps', { 'aria-label': t('steps.title') },
        w.steps.map(item => item.kind === 'repeat'
          ? h('li.ws-rep',
            h('span.ws-rep-n.num', { 'aria-hidden': 'true' }, item.count + '\u00d7'),
            h('span.sr-only', t('steps.repeat', { n: item.count })),
            h('ol.ws-rep-steps', item.steps.map(s => row(s, true))))
          : row(item, false)));
    }

    function estimateNote(w, d) {
      const est = Workouts.estimate(w, { easyPaceSecPerKm: easyPaceOf(d.paces) });
      if (!est) return null;
      const easy = easyPaceOf(d.paces);
      const usesEasy = (function () {
        let any = false;
        w.steps.forEach(item => (item.kind === 'repeat' ? item.steps : [item]).forEach(s => { if (s.duration.type !== 'open' && (!s.target || s.target.type !== 'pace')) any = true; }));
        return any;
      })();
      const parts = [usesEasy && easy ? t('est.paced', { pace: fmt.pace(easy) }) : t('est.pacedOnly')];
      if (est.openSteps) parts.push(t('est.open', { n: est.openSteps }));
      if (est.unpacedSteps) parts.push(t('est.unpaced'));
      return h('p.ws-est', prose(parts.join(' ')));
    }

    function errorItems(check) {
      return errorEntries(check).map(e => h('li',
        e.where ? h('b', t(e.where.key, e.where.params) + ': ') : null,
        t(e.key, e.params)));
    }
    function errorsBlock(check) {
      if (check.ok) { refs.errors = null; return null; }
      refs.errors = h('ul.ws-err-list', errorItems(check));
      return h('div.callout.callout-danger.ws-errors', { role: 'alert' },
        icons.get('warning'),
        h('div', h('b', t('errors.title')), refs.errors));
    }

    function lastExportLine(w) {
      const log = (app.state().exportLog || []).filter(e => e.workoutId === w.id);
      const last = log[log.length - 1];
      if (!last) return null;
      const at = localTime(last.at);
      const formatKey = 'last.format.' + last.format;
      const what = I18n.has('workout.' + formatKey) ? t(formatKey) : last.format;
      const when = at ? t('last.at', { day: fmt.relDay(at.day, app.today()), time: at.time }) : '';
      return h('p.ws-last', icons.get('check-circle', { size: 14 }), h('span', t('last.label') + ' ' + what + (when ? ', ' + when : '')));
    }

    // ---------------------------------------------------------------- build: destination
    function destination(check) {
      const brand = brandOf(view.brand);
      return h('section.ws-dest', { 'aria-labelledby': 'ws-dest-title' },
        h('div.ws-dest-head', h('h3.ws-h#ws-dest-title', t('dest.title')), h('span.ws-dest-sub', t('dest.sub'))),
        brandGrid(),
        brand ? flowPanel(brand, check) : null);
    }

    function methodLabel(b) {
      if (b.flow === 'text') return t(isAndroid ? 'method.textShare' : 'method.text');
      return t('method.' + b.flow);
    }

    function brandGrid() {
      const tiles = BRANDS.map((b, i) => {
        const on = view.brand === b.id;
        return h('button.ws-brand', {
          type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false',
          tabindex: on || (!view.brand && i === 0) ? '0' : '-1',
          class: [b.wide && 'ws-brand-wide', 'ws-bf-' + b.flow],
          dataset: { key: 'ws-brand-' + b.id, brand: b.id },
          style: { '--i': String(i) },
          onClick: () => selectBrand(b.id)
        },
        h('span.ws-brand-text', h('span.ws-brand-name', t('brand.' + b.id)), h('span.ws-brand-how', methodLabel(b))),
        icons.get(b.icon, { className: 'ws-brand-ic', size: 16 }));
      });
      const grid = h('div.ws-brands', { role: 'radiogroup', 'aria-label': t('dest.label') }, tiles);
      grid.addEventListener('keydown', e => brandKeys(e, tiles));
      return grid;
    }
    function brandKeys(e, tiles) {
      const i = tiles.indexOf(doc.activeElement);
      if (i < 0) return;
      const top = tiles[0].offsetTop;
      let cols = tiles.filter(el => el.offsetTop === top).length || 1;
      let next = null;
      if (e.key === 'ArrowRight') next = i + 1;
      else if (e.key === 'ArrowLeft') next = i - 1;
      else if (e.key === 'ArrowDown') next = Math.min(tiles.length - 1, i + cols);
      else if (e.key === 'ArrowUp') next = i - cols < 0 ? i : i - cols;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tiles.length - 1;
      if (next === null) return;
      e.preventDefault();
      next = (next + tiles.length) % tiles.length;
      selectBrand(tiles[next].dataset.brand, { scroll: false });
    }

    function selectBrand(id, options) {
      const o = options || {};
      const b = brandOf(id);
      if (!b) return;
      const changed = view.brand !== id;
      view.brand = id;
      view.brandAnim = changed;
      if (changed) rememberBrand(id);
      const scan = b.flow === 'fit' && view.drives === null && garminUsb();
      const key = b.flow === 'intervals' && view.key.state === 'unknown';
      if (scan) view.drives = 'scanning';
      if (key) view.key.state = 'loading';
      paint();
      if (changed) markMotion();
      if (scan) scanDrives(true);
      if (key) loadKey();
      const tile = rootEl.querySelector('[data-brand="' + id + '"]');
      if (tile) tile.focus({ preventScroll: true });
      if (changed && o.scroll !== false && refs.flow && handle) {
        const body = handle.body;
        const box = refs.flow.getBoundingClientRect(), view_ = body.getBoundingClientRect();
        if (box.top > view_.bottom - 120 || box.bottom > view_.bottom) {
          refs.flow.scrollIntoView({ behavior: motion.prefersReduced() ? 'auto' : 'smooth', block: 'nearest' });
        }
      }
    }
    function rememberBrand(id) {
      const s = app.state();
      if (s && s.ui && s.ui.lastExportBrand === id) return;
      const r = app.update(draft => { draft.ui = Object.assign({}, draft.ui, { lastExportBrand: id }); }, { reason: 'export-brand', render: false });
      if (!r || !r.ok) app.storage.set(LS_BRAND, id);
    }

    function flowPanel(b, check) {
      let body;
      if (b.flow === 'fit') body = flowGarmin(b, check);
      else if (b.flow === 'apple') body = flowApple(b, check);
      else if (b.flow === 'intervals') body = flowIntervals(b, check);
      else if (b.flow === 'zwo') body = flowZwo(b, check);
      else body = flowText(b, check);
      const panel = h('section.ws-flow.card', { class: [view.brandAnim && 'ws-flow-enter'], 'aria-labelledby': 'ws-flow-title', dataset: { flow: b.flow, brand: b.id } },
        h('div.ws-flow-head',
          h('h3.ws-h#ws-flow-title', t('brand.' + b.id)),
          h('span.chip.chip-sm', methodLabel(b))),
        body);
      refs.flow = panel;
      return panel;
    }

    // ---------------------------------------------------------------- shared flow pieces
    function btn(label, iconName, onClick, o) {
      const opts = o || {};
      return h('button', {
        type: 'button',
        class: ['btn', opts.primary ? 'btn-primary' : 'btn-secondary', opts.lg && 'btn-lg', opts.busy && 'is-busy', opts.cls],
        disabled: opts.disabled || opts.busy ? true : null,
        'aria-busy': opts.busy ? 'true' : null,
        dataset: { key: opts.key },
        onClick
      }, iconName ? icon(iconName) : null, label);
    }
    function lead(text) { return h('p.ws-lead', text); }
    function howto(items, title) {
      return h('div.ws-howto',
        h('h4.ws-h4', title || t('howto')),
        h('ol.ws-howto-list', items.filter(Boolean).map((item, i) => h('li',
          h('span.ws-howto-n.num', { 'aria-hidden': 'true' }, String(i + 1)),
          h('span.ws-howto-text', item)))));
    }
    function notes(items, title) {
      const list = items.filter(Boolean);
      if (!list.length) return null;
      return h('div.ws-notes',
        title === false ? null : h('h4.ws-h4', title || t('good')),
        h('ul', list.map(item => h('li', icons.get('info', { size: 14 }), h('span', item)))));
    }
    function withPath(text, segments, tail) { return [text, ' ', pathNode(segments), tail || '']; }
    function statusNode(key, extra) {
      const st = view.status[key];
      if (!st) return null;
      const icon = st.kind === 'ok' ? 'check-circle' : st.kind === 'error' ? 'warning' : st.kind === 'busy' ? null : 'info';
      return h('div', { class: ['ws-status', 'is-' + st.kind, st.fresh && 'ws-status-new'], role: st.kind === 'error' ? 'alert' : 'status' },
        st.kind === 'busy' ? h('span.ws-spin', { 'aria-hidden': 'true' }) : icons.get(icon, { size: 16, className: 'ws-status-ic' }),
        h('div.ws-status-main',
          h('span.ws-status-text', st.text, st.path ? [' ', pathNode(st.path), '.'] : null),
          st.file ? h('span.ws-status-file', st.file) : null,
          extra && extra.length ? h('span.ws-status-actions', extra) : null));
    }
    function canExport(check) { return check.ok; }
    function exportBlockedNote(check) {
      return check.ok ? null : h('p.ws-blocked', icons.get('warning', { size: 14 }), t('export.invalid'));
    }
    function saveLabel(kindKey) { return t(isAndroid ? 'action.share' : 'action.download', { ext: extOf(kindKey) }); }
    function folderButton(st) {
      const p = Platform();
      if (!st || st.kind !== 'ok' || !st.savedPath || !p || !p.supports || !p.supports.showInFolder) return null;
      return h('button.btn.btn-ghost.btn-sm', { type: 'button', dataset: { key: 'ws-folder-' + st.action }, onClick: () => openFolder(st.savedPath) },
        icons.get('external'), t('action.openFolder'));
    }

    // ---------------------------------------------------------------- Garmin (USB)
    function garminUsb() {
      const p = Platform();
      return !!(p && p.kind === 'desktop' && p.garmin && p.garmin.supported);
    }
    function flowGarmin(b, check) {
      const ok = canExport(check);
      const st = view.status.fit;
      const fileName = view.workout && Fit() ? Fit().fileName(view.workout) : '';
      const busy = st && st.kind === 'busy';
      const parts = [
        lead(t('garmin.lead')),
        isAndroid ? h('div.callout.callout-info.ws-callout', icons.get('info'),
          h('div', t('garmin.android'), h('div.ws-callout-actions', h('button.btn-link.ws-link', { type: 'button', dataset: { key: 'ws-switch-cloud' }, onClick: () => selectBrand('garminCloud') }, t('garmin.androidSwitch'), icons.get('arrow-right', { className: 'ic-end' }))))) : null,
        h('div.ws-actions',
          btn(saveLabel('fit'), isAndroid ? 'share' : 'download', () => saveExport('fit'), { primary: true, lg: true, key: 'ws-save-fit', disabled: !ok, busy })),
        statusNode('fit', [folderButton(st)].filter(Boolean)),
        exportBlockedNote(check),
        garminUsb() ? driveBlock(ok) : null,
        howto([
          t('garmin.s1'),
          t('garmin.s2'),
          withPath(t('garmin.s3'), [t('garmin.path.storage'), t('garmin.path.garmin'), t('garmin.path.newFiles')], '.'),
          fileName ? [t('garmin.s4'), ' ', codeChip(fileName), '.'] : t('garmin.s4Pending'),
          t('garmin.s5'),
          withPath(t('garmin.s6'), [t('garmin.path.training'), t('garmin.path.workouts')], '.')
        ]),
        notes([t('garmin.n0'), t('garmin.n1'), t('garmin.n2'), t('garmin.n3')])
      ];
      return parts;
    }
    function driveBlock(ok) {
      const drives = view.drives;
      const rescan = h('button.btn.btn-ghost.btn-sm.ws-rescan', { type: 'button', dataset: { key: 'ws-rescan' }, disabled: drives === 'scanning' ? true : null, onClick: () => scanDrives(false) },
        icons.get('refresh', { className: drives === 'scanning' ? 'spin' : null }), t('garmin.drive.rescan'));
      if (drives === null || drives === 'scanning') {
        return h('div.ws-drive.is-scanning', { role: 'status' }, h('span.ws-spin', { 'aria-hidden': 'true' }), h('span.ws-drive-msg', t('garmin.drive.scanning')));
      }
      if (!Array.isArray(drives)) {
        return h('div.ws-drive.is-none', icons.get('warning', { size: 16 }), h('span.ws-drive-msg', t('garmin.drive.error', { message: drives.error || '' })), rescan);
      }
      if (!drives.length) {
        return h('div.ws-drive.is-none', icons.get('watch', { size: 16 }), h('span.ws-drive-msg', t('garmin.drive.none')), rescan);
      }
      const st = view.status.garminCopy;
      return h('div.ws-drive.is-found',
        h('div.ws-drive-head', h('span.ws-drive-title', icons.get('watch', { size: 16 }), t('garmin.drive.found')), rescan),
        drives.map((dr, i) => {
          const target = newFilesPath(dr.root);
          const busy = st && st.kind === 'busy' && st.root === dr.root;
          return h('div.ws-drive-row',
            h('div.ws-drive-id', h('span.ws-drive-label', dr.label || dr.root), h('code.ws-code', target)),
            btn(t('garmin.drive.copy'), 'upload', () => copyToWatch(dr), { primary: false, key: 'ws-copy-' + i, disabled: !ok, busy }));
        }),
        statusNode('garminCopy', [folderButton(st)].filter(Boolean)));
    }
    /** quiet: the caller already painted the 'scanning' state. */
    async function scanDrives(quiet) {
      const p = Platform();
      if (!p || !p.garmin || !p.garmin.supported) { view.drives = []; settle(); return; }
      view.drives = 'scanning';
      if (!quiet) paint();
      try {
        const list = await p.garmin.findDrives();
        view.drives = Array.isArray(list) ? list : [];
      } catch (err) {
        view.drives = { error: app.errorText(err) };
      }
      settle();
    }
    async function copyToWatch(drive) {
      if (!validation().ok) return;
      let file;
      try { file = Fit().toFile(view.workout, { timeCreated: new Date(), locale: locale() }); }
      catch (err) { setStatus('garminCopy', { kind: 'error', text: exportErrorText(err) }); return; }
      setStatus('garminCopy', { kind: 'busy', text: t('garmin.drive.copying'), root: drive.root });
      try {
        const r = await Platform().garmin.copy({ root: drive.root, name: file.name, data: file.data });
        if (!r || !r.saved) throw Object.assign(new Error('not saved'), { code: 'write_failed' });
        setStatus('garminCopy', {
          kind: 'ok', action: 'garminCopy', savedPath: r.path || null,
          text: t('garmin.drive.copied', { path: newFilesPath(drive.root) }), path: [t('garmin.path.training'), t('garmin.path.workouts')]
        });
        logExport(FORMAT.garminCopy);
      } catch (err) {
        setStatus('garminCopy', { kind: 'error', text: app.errorText(err) });
      }
    }

    // ---------------------------------------------------------------- Apple Watch
    function flowApple(b, check) {
      const ok = canExport(check);
      const st = view.status.apple;
      const where = app.components.create('segmented', {
        label: t('apple.where'), value: view.appleLocation, key: 'ws-apple-loc',
        options: [{ value: 'outdoor', label: t('apple.outdoor') }, { value: 'indoor', label: t('apple.indoor') }],
        onChange: v => { view.appleLocation = v; }
      });
      return [
        lead(t('apple.lead')),
        h('div.ws-option', h('span.field-label', t('apple.where')), where),
        h('div.ws-actions',
          btn(saveLabel('apple'), isAndroid ? 'share' : 'download', () => saveExport('apple'), { primary: true, lg: true, key: 'ws-save-apple', disabled: !ok, busy: st && st.kind === 'busy' })),
        statusNode('apple', [folderButton(st)].filter(Boolean)),
        exportBlockedNote(check),
        howto([
          t('apple.s1'),
          t('apple.s2'),
          withPath(t('apple.s3'), [t('apple.add')], '.'),
          t('apple.s4')
        ]),
        notes([t('apple.req')]),
        h('div.ws-fallback',
          h('p', t('apple.fallback')),
          btn(saveLabel('fit'), isAndroid ? 'share' : 'download', () => saveExport('fit', 'appleFit'), { key: 'ws-save-apple-fit', disabled: !ok, busy: view.status.appleFit && view.status.appleFit.kind === 'busy', cls: 'btn-sm' }),
          statusNode('appleFit', [folderButton(view.status.appleFit)].filter(Boolean))),
        h('p.ws-unofficial', icons.get('info', { size: 14 }), t('apple.unofficial'))
      ];
    }

    // ---------------------------------------------------------------- intervals.icu
    function httpSupported() {
      const p = Platform();
      return !!(p && p.supports && p.supports.http);
    }
    function flowIntervals(b, check) {
      const ok = canExport(check);
      const account = t('intervals.account.' + b.id);
      const third = h('div.callout.callout-info.ws-callout.ws-third', icons.get('external'),
        h('div', h('b', t('intervals.thirdParty')), ' ', t('intervals.leaves')));
      if (!httpSupported()) {
        return [lead(t('intervals.lead')), third,
          h('div.callout.ws-callout', icons.get('info'), h('div', t('intervals.unavailable'))),
          textActions(check),
          statusNode('text'),
          notes([t('intervals.note.' + b.id)])];
      }
      const st = view.status.intervals;
      const k = view.key;
      let keyPart;
      if (k.state === 'unknown' || k.state === 'loading') keyPart = h('div.ws-keyrow.is-loading', { role: 'status' }, h('span.ws-spin', { 'aria-hidden': 'true' }), t('intervals.key.loading'));
      else if (k.state === 'set' && !k.editing) keyPart = keySaved();
      else keyPart = keySetup();
      const sendBusy = st && st.kind === 'busy';
      const canSend = ok && k.state === 'set' && !k.editing;
      return [
        lead(t('intervals.lead')),
        third,
        keyPart,
        k.state === 'set' && !k.editing ? h('div.ws-send',
          h('div.field.ws-date-field',
            h('label.field-label', { for: 'ws-push-date' }, t('intervals.date.label')),
            h('input.input.ws-date#ws-push-date', {
              type: 'date', value: view.pushDate || '', min: app.today(), dataset: { key: 'ws-push-date' },
              'aria-invalid': view.dateError ? 'true' : null, 'aria-describedby': view.dateError ? 'ws-date-err' : null,
              onChange: e => { view.pushDate = e.target.value; if (view.dateError) { view.dateError = null; paint(); } }
            }),
            view.dateError ? h('p.field-error#ws-date-err', icons.get('warning'), view.dateError) : null),
          btn(t('intervals.send'), 'upload', () => push(b), { primary: true, lg: true, key: 'ws-send', disabled: !canSend, busy: sendBusy })) : null,
        statusNode('intervals', st && st.kind === 'error' && st.keyProblem
          ? [h('button.btn.btn-ghost.btn-sm', { type: 'button', dataset: { key: 'ws-fix-key' }, onClick: () => { view.key.editing = true; view.key.draft = ''; paint(); focusKey('ws-key'); } }, icons.get('edit'), t('intervals.fixKey'))]
          : null),
        st && st.kind === 'ok' && st.warnings && st.warnings.length ? notes(st.warnings, false) : null,
        exportBlockedNote(check),
        howto([
          t('intervals.once.connect', { account }),
          t('intervals.once.threshold'),
          b.id === 'coros' || b.id === 'amazfit' ? t('intervals.note.' + b.id) : null
        ], t('intervals.once.title')),
        b.id === 'coros' || b.id === 'amazfit' ? null : notes([t('intervals.note.' + b.id)])
      ];
    }
    function keyStorageNote() {
      const p = Platform();
      if (p && p.secrets && p.secrets.encrypted) return t('intervals.key.encrypted');
      if (p && p.kind === 'android') return t('intervals.key.plain');
      return t('intervals.key.memory');
    }
    function keySaved() {
      return h('div.ws-keyrow.is-set',
        icons.get('lock', { size: 16, className: 'ws-key-ic' }),
        h('div.ws-key-main', h('span.ws-key-title', t('intervals.key.saved')), h('span.ws-key-sub', keyStorageNote())),
        h('div.ws-key-actions',
          h('button.btn.btn-ghost.btn-sm', { type: 'button', dataset: { key: 'ws-key-change' }, onClick: () => { view.key.editing = true; view.key.draft = ''; view.key.error = null; paint(); focusKey('ws-key'); } }, t('intervals.key.change')),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', dataset: { key: 'ws-key-remove' }, onClick: removeKey }, t('intervals.key.remove'))));
    }
    function keySetup() {
      const k = view.key;
      const input = h('input.input.ws-key-input#ws-key', {
        type: k.reveal ? 'text' : 'password', value: k.draft, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
        placeholder: t('intervals.key.placeholder'), dataset: { key: 'ws-key' },
        'aria-invalid': k.error ? 'true' : null, 'aria-describedby': (k.error ? 'ws-key-err ' : '') + 'ws-key-note',
        onInput: e => { k.draft = e.target.value; if (k.error) { k.error = null; const err = rootEl.querySelector('#ws-key-err'); if (err) err.remove(); e.target.removeAttribute('aria-invalid'); } },
        onKeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } }
      });
      return h('div.ws-setup',
        h('h4.ws-h4', t('intervals.setup.title')),
        h('ol.ws-howto-list',
          h('li', h('span.ws-howto-n.num', { 'aria-hidden': 'true' }, '1'),
            h('span.ws-howto-text', withPath(t('intervals.setup.s1'), [t('intervals.path.settings'), t('intervals.path.developer')], '.'),
              h('span.ws-inline-action', h('button.btn-link.ws-link', { type: 'button', dataset: { key: 'ws-open-intervals' }, onClick: openIntervals }, icons.get('external'), t('intervals.setup.open'))))),
          h('li', h('span.ws-howto-n.num', { 'aria-hidden': 'true' }, '2'), h('span.ws-howto-text', t('intervals.setup.s2')))),
        h('div.ws-keyform',
          h('label.field-label', { for: 'ws-key' }, t('intervals.key.label')),
          h('div.ws-keyline',
            input,
            btn(t('intervals.key.save'), 'check', saveKey, { primary: true, key: 'ws-key-save', busy: k.busy }),
            k.state === 'set' ? h('button.btn.btn-ghost', { type: 'button', dataset: { key: 'ws-key-cancel' }, onClick: () => { k.editing = false; k.error = null; paint(); } }, t('intervals.key.cancel')) : null),
          k.error ? h('p.field-error#ws-key-err', icons.get('warning'), k.error) : null,
          h('p.field-hint#ws-key-note', icons.get('lock', { size: 12 }), ' ', keyStorageNote())));
    }
    function focusKey(key) {
      const el = rootEl.querySelector('[data-key="' + key + '"]');
      if (el) el.focus();
    }
    async function loadKey() {
      const p = Platform();
      if (!p || !p.secrets || !p.secrets.supported) { view.key.state = 'none'; settle(); return; }
      view.key.state = 'loading';
      try {
        const value = await p.secrets.get(SECRET);
        view.key.value = typeof value === 'string' && value.trim() ? value.trim() : null;
        view.key.state = view.key.value ? 'set' : 'none';
      } catch (err) {
        view.key.state = 'none';
        view.key.error = app.errorText(err);
      }
      settle();
    }
    async function saveKey() {
      const k = view.key;
      const value = String(k.draft || '').trim();
      if (!value) { k.error = t('intervals.key.required'); paint(); focusKey('ws-key'); return; }
      k.busy = true;
      paint();
      try {
        await Platform().secrets.set(SECRET, value);
        k.value = value; k.state = 'set'; k.editing = false; k.draft = ''; k.error = null;
        app.update(s => { s.intervals = Object.assign({}, s.intervals, { enabled: true }); }, { reason: 'intervals-key', render: false });
        if (view.status.intervals && view.status.intervals.keyProblem) view.status.intervals = null;
      } catch (err) {
        k.error = app.errorText(err);
      }
      k.busy = false;
      paint();
      focusKey(k.state === 'set' && !k.editing ? 'ws-send' : 'ws-key');
    }
    async function removeKey() {
      const yes = await app.confirm({ title: t('intervals.key.removeTitle'), body: t('intervals.key.removeBody'), confirmLabel: t('intervals.key.remove'), danger: true });
      if (!yes || closed) return;
      try {
        await Platform().secrets.remove(SECRET);
        view.key = { state: 'none', value: null, draft: '', editing: false, error: null, busy: false, reveal: false };
        app.update(s => { s.intervals = Object.assign({}, s.intervals, { enabled: false }); }, { reason: 'intervals-key', render: false, toast: t('intervals.key.removed'), toastKind: 'info' });
      } catch (err) {
        app.toast(app.errorText(err), { kind: 'error' });
      }
      paint();
      focusKey('ws-key');
    }
    async function openIntervals() {
      try { await Platform().openExternal(INTERVALS_SETTINGS); }
      catch (err) { app.toast(t('intervals.setup.openFailed'), { kind: 'error' }); }
    }
    function intervalsErrorText(e) {
      if (!e) return t('export.failed');
      const key = 'intervals.error.' + e.code;
      return I18n.has(key) ? app.t(key, { message: e.message || '', status: e.status || 0 }) : app.t('intervals.error.http_error', { status: e.status || 0 });
    }
    async function push(b) {
      if (!validation().ok) return;
      const date = view.pushDate;
      if (!isKey(date)) { view.dateError = t('intervals.date.invalid'); paint(); focusKey('ws-push-date'); return; }
      if (date < app.today()) { view.dateError = t('intervals.date.past'); paint(); focusKey('ws-push-date'); return; }
      const I = Intervals();
      const w = clone(view.workout);
      if (w.date !== date) { w.date = date; w.id = idForDate(w.id, date); }
      let request, conv;
      try {
        conv = I.convert(w, { locale: locale() });
        request = I.buildRequest(I.toEventsPayload([w], { locale: locale() }), view.key.value);
      } catch (err) {
        const text = err && err.code === 'workout_invalid' ? t('export.invalid')
          : err && err.code && I18n.has('intervals.error.' + err.code) ? intervalsErrorText({ code: err.code }) : app.errorText(err);
        failPush(text, err && err.code === 'api_key_required');
        return;
      }
      setStatus('intervals', { kind: 'busy', text: t('intervals.sending') });
      let response;
      try {
        response = await Platform().http(request);
      } catch (err) {
        // Platform codes first (timeout, network, host_not_allowed …): parseError would call them all "network".
        const text = err && err.code && I18n.has('platform.error.' + err.code) ? app.errorText(err) : intervalsErrorText(I.parseError(err));
        failPush(text, false);
        return;
      }
      const parsed = I.parseResponse(response);
      if (!parsed.ok) { failPush(intervalsErrorText(parsed.error), parsed.error && (parsed.error.code === 'unauthorized' || parsed.error.code === 'forbidden')); return; }
      const warnings = (conv.warnings || []).filter(x => x.code !== 'pace_needs_threshold')
        .map(x => app.t('intervals.warning.' + x.code, x));
      const brandName = t('intervals.account.' + b.id);
      view.status.intervals = {
        kind: 'ok', fresh: true,
        text: t('intervals.sent', { date: fmt.date(date, 'long') }) + ' ' + t('intervals.after', { account: brandName }),
        warnings
      };
      const at = new Date().toISOString();
      app.update(s => {
        s.intervals = Object.assign({}, s.intervals, { enabled: true, lastPush: at, lastError: null });
        return Store.logExport(s, { at, workoutId: view.workout.id, format: FORMAT.intervals });
      }, { reason: 'intervals-push' });
      paint();
    }
    function failPush(text, keyProblem) {
      view.status.intervals = { kind: 'error', text, keyProblem: !!keyProblem, fresh: true };
      app.update(s => { s.intervals = Object.assign({}, s.intervals, { lastError: String(text).slice(0, 500) }); }, { reason: 'intervals-error', render: false });
      paint();
    }

    // ---------------------------------------------------------------- Zwift / TrainingPeaks
    function zwoOptions() {
      const d = derived();
      const Z = Zwo();
      return Z && d.paces ? Z.optionsFromPaces(d.paces, { locale: locale() }) : null;
    }
    function flowZwo(b, check) {
      const ok = canExport(check);
      const opts = zwoOptions();
      const zc = opts && ok ? Zwo().check(view.workout, opts) : null;
      const usable = ok && opts && zc && zc.ok;
      const st = view.status.zwo;
      const refPace = opts ? fmt.pace(opts.referencePaceSecPerKm) : null;
      const steps = b.id === 'zwift'
        ? [withPath(t('zwo.zwift.s1'), [t('zwo.zpath.docs'), t('zwo.zpath.zwift'), t('zwo.zpath.workouts'), t('zwo.zpath.id')], '.'), t('zwo.zwift.s2'), refPace ? t('zwo.zwift.s3', { pace: refPace }) : null]
        : [withPath(t('zwo.tp.s1'), [t('zwo.tpath.library'), t('zwo.tpath.import')], '.'), t('zwo.tp.s2'), t('zwo.tp.s3')];
      return [
        lead(t('zwo.lead')),
        ok && !opts ? h('div.callout.callout-warn.ws-callout', icons.get('warning'), h('div', t('zwo.noPace'))) : null,
        ok && opts && zc && !zc.ok ? h('div.callout.callout-warn.ws-callout', icons.get('warning'), h('div', t('zwo.failed'))) : null,
        h('div.ws-actions', btn(saveLabel('zwo'), isAndroid ? 'share' : 'download', () => saveExport('zwo'), { primary: true, lg: true, key: 'ws-save-zwo', disabled: !usable, busy: st && st.kind === 'busy' })),
        statusNode('zwo', [folderButton(st)].filter(Boolean)),
        exportBlockedNote(check),
        howto(steps),
        b.id === 'trainingpeaks' ? notes([t('zwo.tp.premium'), refPace ? t('zwo.tp.pace', { pace: refPace }) : null]) : null
      ];
    }

    // ---------------------------------------------------------------- text, print, share
    function dateLabel() {
      const w = view.workout;
      return w && isKey(w.date) ? fmt.date(w.date, 'long') : '';
    }
    function currentText() {
      try { return textFor(view.workout, locale(), dateLabel()); } catch (e) { return ''; }
    }
    function textActions(check) {
      const ok = canExport(check);
      const copied = view.copiedUntil > Date.now();
      return h('div.ws-actions',
        h('button', {
          type: 'button', class: ['btn', 'btn-primary', 'btn-lg', 'ws-copy', copied && 'is-copied'], disabled: ok ? null : true,
          dataset: { key: 'ws-copy' }, onClick: copyText
        }, icons.get(copied ? 'check' : 'copy', { className: copied ? 'ws-pop' : null }), copied ? t('action.copied') : t('action.copy')),
        isAndroid
          ? btn(t('action.shareText'), 'share', () => saveExport('txt'), { key: 'ws-share-text', disabled: !ok, busy: view.status.txt && view.status.txt.kind === 'busy' })
          : btn(t('action.print'), 'printer', printWorkout, { key: 'ws-print', disabled: !ok }));
    }
    function flowText(b, check) {
      const ok = canExport(check);
      const extra = [];
      if (b.id === 'polar') {
        const opts = zwoOptions();
        const zc = opts && ok ? Zwo().check(view.workout, opts) : null;
        extra.push(h('div.ws-fallback',
          h('p', t('text.polar')),
          btn(saveLabel('zwo'), isAndroid ? 'share' : 'download', () => saveExport('zwo', 'polarZwo'), { key: 'ws-save-polar-zwo', cls: 'btn-sm', disabled: !(ok && zc && zc.ok), busy: view.status.polarZwo && view.status.polarZwo.kind === 'busy' }),
          statusNode('polarZwo', [folderButton(view.status.polarZwo)].filter(Boolean))));
      } else if (b.id === 'other') {
        extra.push(h('div.ws-fallback',
          h('p', t('text.other')),
          btn(saveLabel('fit'), isAndroid ? 'share' : 'download', () => saveExport('fit', 'otherFit'), { key: 'ws-save-other-fit', cls: 'btn-sm', disabled: !ok, busy: view.status.otherFit && view.status.otherFit.kind === 'busy' }),
          statusNode('otherFit', [folderButton(view.status.otherFit)].filter(Boolean))));
      } else {
        extra.push(notes([t('text.' + b.id)], false));
      }
      const text = ok ? currentText() : '';
      refs.textPreview = ok ? h('pre.ws-text', { tabindex: '0', 'aria-label': t('text.preview') }, text) : null;
      return [
        lead(t(isAndroid ? 'text.leadShare' : 'text.lead')),
        textActions(check),
        statusNode('text'),
        statusNode('print'),
        statusNode('txt', [folderButton(view.status.txt)].filter(Boolean)),
        exportBlockedNote(check),
        refs.textPreview ? h('div.ws-text-wrap', h('h4.ws-h4', t('text.preview')), refs.textPreview) : null,
        extra
      ];
    }
    async function copyText() {
      if (!validation().ok) return;
      const text = currentText();
      let ok = false;
      try {
        if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === 'function') {
          await root.navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (err) { ok = false; }
      if (!ok) ok = legacyCopy(text);
      if (!ok) { setStatus('text', { kind: 'error', text: t('status.copyFailed') }); return; }
      view.copiedUntil = Date.now() + 2200;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { view.copiedUntil = 0; paint(); }, 2300);
      setStatus('text', { kind: 'ok', text: t('status.copied') });
      logExport(FORMAT.text);
    }
    function legacyCopy(text) {
      const host = handle ? handle.panel : doc.body;
      const ta = h('textarea.ws-offscreen', { readonly: true, 'aria-hidden': 'true', tabindex: '-1' }, text);
      host.append(ta);
      let ok = false;
      try { ta.select(); ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      const btnEl = rootEl.querySelector('[data-key="ws-copy"]');
      if (btnEl) btnEl.focus({ preventScroll: true });
      return ok;
    }
    function printWorkout() {
      if (!validation().ok) return;
      cleanupPrint();
      printNode = buildPrint();
      doc.body.append(printNode);
      doc.body.classList.add('ws-printing');
      const done = () => { root.removeEventListener('afterprint', done); cleanupPrint(); };
      root.addEventListener('afterprint', done);
      try {
        root.print();
        setStatus('print', { kind: 'ok', text: t('status.printed') });
        logExport(FORMAT.print);
      } catch (err) {
        done();
        setStatus('print', { kind: 'error', text: t('status.printFailed') });
      }
    }
    function cleanupPrint() {
      doc.body.classList.remove('ws-printing');
      if (printNode) { printNode.remove(); printNode = null; }
    }
    function buildPrint() {
      const w = view.workout;
      const d = derived();
      const loc = locale();
      const est = Workouts.estimate(w, { easyPaceSecPerKm: easyPaceOf(d.paces) });
      const rows = [];
      let n = 0;
      const boxes = count => h('td.ws-p-box', Array.from({ length: count }, () => h('span')));
      const row = (step, inRepeat, reps) => {
        n += 1;
        const target = stepTarget(step);
        rows.push(h('tr', { class: inRepeat ? 'ws-p-in' : null },
          h('td.ws-p-n', String(n)),
          h('td', Workouts.stepName(step, loc, inRepeat)),
          h('td.ws-p-num', stepAmount(step, loc)),
          h('td', { class: target.strong ? 'ws-p-num' : 'ws-p-soft' }, target.text),
          boxes(reps)));
      };
      w.steps.forEach(item => {
        if (item.kind === 'repeat') {
          rows.push(h('tr.ws-p-rep', h('td'), h('td', { colspan: '4' }, t('steps.repeat', { n: item.count }))));
          item.steps.forEach(s => row(s, true, item.count));
        } else row(item, false, 1);
      });
      const estText = est && est.distanceM > 0
        ? t('print.estimate', { distance: '\u2248' + NB + fmt.kmUnit(est.distanceM / 1000), time: '\u2248' + NB + fmt.durationWords(Math.max(1, Math.round(est.seconds / 60)) * 60) })
        : '';
      return h('div.ws-print-root', { 'aria-hidden': 'true' },
        h('div.ws-p-head', h('span.ws-p-brand', t('print.brand')), h('span', t('print.printed', { date: fmt.date(app.today(), 'dayMonthYear') }))),
        h('h1.ws-p-title', fmt.typo(w.name || '')),
        isKey(w.date) ? h('p.ws-p-date', fmt.date(w.date, 'long')) : null,
        typeof w.description === 'string' && w.description.trim() ? h('p.ws-p-desc', fmt.typo(w.description.trim())) : null,
        h('table.ws-p-table',
          h('thead', h('tr', h('th', '#'), h('th', t('print.step')), h('th', t('print.amount')), h('th', t('print.target')), h('th', t('print.done')))),
          h('tbody', rows)),
        estText ? h('p.ws-p-est', estText) : null);
    }

    // ---------------------------------------------------------------- files
    function exportErrorText(err) {
      const code = err && err.code;
      if (code === 'workout_invalid') return t('export.invalid');
      if (code === 'apple_encoder_missing' || code === 'apple_encode_failed' || code === 'apple_option_invalid') return t('export.appleFailed');
      if (code === 'zwo_reference_pace_required' || code === 'zwo_easy_pace_required') return t('zwo.noPace');
      if (code && code.indexOf('zwo_') === 0) return t('zwo.failed');
      if (code && I18n.has('platform.error.' + code)) return app.errorText(err);
      return t('export.failed');
    }
    function buildFile(kindKey) {
      const w = view.workout;
      const loc = locale();
      if (kindKey === 'fit') return Fit().toFile(w, { timeCreated: new Date(), locale: loc });
      if (kindKey === 'apple') return Apple().file(w, { location: view.appleLocation, locale: loc });
      if (kindKey === 'zwo') {
        const opts = zwoOptions();
        if (!opts) throw Object.assign(new Error('no pace'), { code: 'zwo_reference_pace_required' });
        return Zwo().file(w, opts);
      }
      const fitName = Fit() ? Fit().fileName(w) : 'VEYVO_workout.fit';
      return { name: fitName.replace(/\.fit$/i, '.txt'), mime: 'text/plain', data: currentText() };
    }
    async function saveExport(kindKey, statusKey) {
      const key = statusKey || kindKey;
      if (!validation().ok) return;
      let file;
      try { file = buildFile(kindKey); }
      catch (err) { setStatus(key, { kind: 'error', text: exportErrorText(err) }); return; }
      setStatus(key, { kind: 'busy', text: t(isAndroid ? 'status.sharing' : 'status.saving') });
      try {
        const r = await Platform().saveFile(file);
        if (!r || r.canceled || !r.saved) { setStatus(key, null); return; }
        const p = Platform();
        const savedName = r.path ? String(r.path).split(/[\\/]/).pop() || file.name : file.name;
        let text;
        if (r.shared) text = t('status.shared', { name: savedName });
        else if (p.kind === 'desktop') text = t('status.saved', { name: savedName });
        else text = t('status.downloaded', { name: savedName });
        setStatus(key, { kind: 'ok', action: key, text, file: p.kind === 'desktop' && r.path ? r.path : null, savedPath: r.path || null });
        logExport(kindKey === 'txt' ? FORMAT.txt : FORMAT[kindKey]);
      } catch (err) {
        setStatus(key, { kind: 'error', text: exportErrorText(err) });
      }
    }
    async function openFolder(path) {
      let ok = false;
      try { ok = await Platform().showInFolder(path); } catch (err) { ok = false; }
      if (!ok) app.toast(t('status.folderFailed'), { kind: 'error' });
    }
    function logExport(format) {
      const w = view.workout;
      if (!w || !w.id) return;
      app.update(s => Store.logExport(s, { at: new Date().toISOString(), workoutId: String(w.id).slice(0, 100), format }), { reason: 'workout-export' });
      if (!closed) paint();
    }

    // ---------------------------------------------------------------- language switch while open
    const offLanguage = app.on('language', () => {
      if (closed) return;
      // An untouched library or engine workout is rebuilt in the new language (names, step labels).
      if (!view.nameEdited && view.resolved && view.workout) {
        const d = app.derived();
        let fresh = null;
        if (view.resolved.templateId) fresh = resolveWorkout({ templateId: view.resolved.templateId, date: view.resolved.date }, d);
        else if (d.nextWorkout && d.nextWorkout.id === view.workout.id) fresh = resolveWorkout({ date: view.resolved.date }, d);
        if (fresh && fresh.workout) {
          fresh.workout.id = view.workout.id;
          if (isKey(view.workout.date)) fresh.workout.date = view.workout.date;
          view.workout = fresh.workout;
          view.originalName = fresh.workout.name;
        }
      }
      if (handle) {
        handle.setTitle(titleText());
        const eb = handle.head.querySelector('.eyebrow');
        if (eb) eb.textContent = eyebrowText();
      }
      paint();
    });

    // ---------------------------------------------------------------- open
    const startBrand = view.workout ? brandOf(view.brand) : null;
    const startScan = !!(startBrand && startBrand.flow === 'fit' && garminUsb());
    const startKey = !!(startBrand && startBrand.flow === 'intervals');
    if (startScan) view.drives = 'scanning';
    if (startKey) view.key.state = 'loading';
    paint();
    handle = app.dialogs.create({
      title: titleText(),
      eyebrow: eyebrowText(),
      kind: 'sheet',
      size: 'lg',
      className: 'ws-dlg',
      body: rootEl,
      initialFocus: '.dlg-panel',
      onClose() {
        closed = true;
        offLanguage();
        clearTimeout(copiedTimer);
        clearTimeout(pendingPaint);
        cleanupPrint();
        // The opener may have been re-rendered while the sheet was open: refocus its twin by data-key.
        if (openerKey && (!doc.activeElement || doc.activeElement === doc.body)) {
          let twin = null;
          try { twin = doc.querySelector('#main [data-key="' + CSS.escape(openerKey) + '"]'); } catch (e) { twin = null; }
          if (twin) twin.focus({ preventScroll: true });
        }
      }
    });
    // Remembered brand: start its flow's background work (drive search, saved key).
    if (startScan) scanDrives(true);
    if (startKey) loadKey();
    return handle;
  }

  app.dialogs.register('workout', { open: params => openSheet(params) });
  app.dialogs.register('workoutExport', { open: params => openSheet(params) });

  UI.workoutSheet = Object.freeze({
    BRANDS, BRAND_IDS, FORMAT, MESSAGES, SECRET, LS_BRAND,
    brandOf, resolveWorkout, idForDate, groupOf, profileBlocks, errorEntries, textFor, newFilesPath, lastBrand, easyPaceOf
  });
})(globalThis);
