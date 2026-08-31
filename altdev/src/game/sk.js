// Slovenčina.
//
// Preklad, nie prepis: kde je anglický originál dlhší, lebo si to vyžaduje
// anglická vetná stavba, je slovenská veta kratšia, a kde slovenčina potrebuje
// pád alebo sloveso navyše, tam ho má. Odborné termíny sú tie, ktoré používa
// slovenská a česká literatúra o planetárnych atmosférach; tam, kde ustálený
// termín neexistuje (runaway greenhouse, waterbelt, eyeball), je použitý opis,
// ktorý hovorí, čo sa deje, a nie kalk z angličtiny.
//
// `ui` sa hľadá podľa anglického originálu, `states`, `scenarios` a `presets`
// podľa id. Chýbajúci záznam znamená angličtinu, nie prázdne miesto.
export const SK = {
  ui: {
    // ---- hlavička a panely -------------------------------------------------
    'Planet Climate': 'Klíma planéty',
    'Sandbox': 'Pieskovisko',
    'An alternative line of work to /dev/. Planetary histories, magnetic fields, resurfacing, and the step-size bugs behind the flickering.':
      'Druhá vetva vývoja popri /dev/. Vývoj planét v čase, magnetické polia, obnova povrchu a chyby v dĺžke kroku, ktoré spôsobovali blikanie.',
    'stable site': 'stabilná verzia',
    'dev': 'dev',
    'Dismiss': 'Zavrieť',
    'Worlds': 'Svety',
    'Saves': 'Uložené svety',
    'Name': 'Názov',
    'Custom world': 'Vlastný svet',
    'What to call this world. It goes into the save slots, the export file and the log line when you load it. Loading a preset puts its own name back.':
      'Ako sa tento svet volá. Názov ide do uložených pozícií, do exportovaného súboru aj do riadku, ktorý sa vypíše po načítaní. Načítanie predvoleného sveta vráti jeho vlastný názov.',
    'Click a slot to load it.': 'Kliknutím na pozíciu ju načítate.',
    'Save…': 'Uložiť…',
    'then pick a slot to overwrite. Slot 1 keeps itself.':
      'a potom vyberte pozíciu, ktorá sa má prepísať. Pozícia 1 sa ukladá sama.',
    'Export all…': 'Exportovať všetko…',
    'Every saved world in one file, to keep somewhere that is not this browser':
      'Všetky uložené svety v jednom súbore — na uchovanie mimo tohto prehliadača',
    'Import…': 'Importovať…',
    'Merge a saves file in. Slots the file does not mention are left alone.':
      'Pripojí súbor s uloženými svetmi. Pozície, ktoré v súbore nie sú, zostanú nedotknuté.',
    'A single world also travels in the address bar — copy the URL.':
      'Jeden svet sa dá preniesť aj v adresnom riadku — stačí skopírovať URL.',
    'Every control is live. Change one mid-run and the planet keeps its current temperature, ice and history — you are intervening on a running world, not restarting it. The four highlighted below also move on their own as the simulation evolves them. Click any value to type it exactly.':
      'Každý ovládací prvok je živý. Ak ho zmeníte počas behu, planéta si ponechá súčasnú teplotu, ľad aj históriu — zasahujete do bežiaceho sveta, nespúšťate ho odznova. Štyri zvýraznené prvky sa navyše hýbu samy, ako ich mení simulácia. Kliknutím na hodnotu ju možno zadať presne.',
    'Body': 'Teleso',
    'Orbit & Star': 'Dráha a hviezda',
    'Atmosphere': 'Atmosféra',
    'Surface & Interior': 'Povrch a vnútro',
    'Controls': 'Ovládanie',
    'Readout': 'Údaje',
    'Planet controls': 'Ovládanie planéty',
    'Show the planet controls': 'Zobraziť ovládanie planéty',
    'Readout and scenarios': 'Údaje a scenáre',
    'Show the readout and scenarios': 'Zobraziť údaje a scenáre',

    // ---- ovládanie pohľadu a času -----------------------------------------
    'Pause the planet’s rotation': 'Zastaviť rotáciu planéty',
    "Pause the planet's rotation": 'Zastaviť rotáciu planéty',
    'Resume the planet’s rotation': 'Znova spustiť rotáciu planéty',
    'Recentre the view': 'Vycentrovať pohľad',
    'Panning speed: 0.5×': 'Rýchlosť otáčania pohľadu: 0,5×',
    'Panning speed: 1×': 'Rýchlosť otáčania pohľadu: 1×',
    'Panning speed: 2×': 'Rýchlosť otáčania pohľadu: 2×',
    'Surface graphics': 'Vzhľad povrchu',
    'Surface maps need WebGL2': 'Mapy povrchu potrebujú WebGL2',
    'Surface maps are not available in this build': 'V tomto zostavení nie sú mapy povrchu k dispozícii',
    'Detail: high': 'Detail: vysoký',
    'Detail: low': 'Detail: nízky',
    'Atmosphere: stylised': 'Atmosféra: štylizovaná',
    'Atmosphere: realistic — true scale height, and an opaque one hides the ground':
      'Atmosféra: realistická — skutočná výšková škála, a nepriehľadná zakrýva povrch',
    'Atmosphere: stylised — the shell is exaggerated so you can see it change':
      'Atmosféra: štylizovaná — obal je zámerne zväčšený, aby boli zmeny viditeľné',
    'Renderer': 'Vykresľovanie',
    'Language': 'Jazyk',
    'Language: English': 'Jazyk: angličtina',
    'Language: Slovak': 'Jazyk: slovenčina',
    'Switch to Slovak': 'Prepnúť na slovenčinu',
    'Switch to English': 'Prepnúť na angličtinu',
    'Pause the simulation (space)': 'Pozastaviť simuláciu (medzerník)',
    'Resume the simulation (space)': 'Pokračovať v simulácii (medzerník)',
    'Pause': 'Pauza',
    'Play': 'Spustiť',
    'Settle': 'Ustáliť',
    'Stop': 'Zastaviť',
    'Run until the climate stops changing': 'Nechať bežať, kým sa klíma prestane meniť',
    'Reset': 'Reštart',
    'Restart this world at t = 0': 'Spustiť tento svet znova od t = 0',
    'pause on reset': 'po reštarte pozastaviť',
    'Start paused after a reset, so you can set the world up before it runs':
      'Po reštarte začať v pauze, aby sa dal svet nastaviť ešte pred behom',
    'age': 'vek',
    'elapsed': 'uplynulo',
    'since mark': 'od míľnika',
    'Mark this moment. The clock then also counts from the mark, so you can time an event you are watching.':
      'Označí tento okamih. Hodiny potom počítajú aj od míľnika, takže sa dá merať trvanie práve prebiehajúcej udalosti.',
    'time acceleration': 'zrýchlenie času',
    'Time acceleration, type to set exactly': 'Zrýchlenie času — hodnotu možno zadať presne',
    'Type a number — the unit is the menu beside it. A whole rate works too: 500 yr, 2 Myr, 1.5 Gyr.':
      'Zadajte číslo — jednotku určuje ponuka vedľa. Funguje aj celý zápis: 500 yr, 2 Myr, 1.5 Gyr.',
    'Time acceleration unit': 'Jednotka zrýchlenia času',
    'Jump to a time acceleration': 'Skok na zvolené zrýchlenie',
    'ease': 'spomaliť',
    'fast': 'rýchlo',
    'custom': 'vlastné',
    'Ease off automatically when the climate tips': 'Automaticky spomaliť, keď sa klíma preklápa',
    'Auto-ease is holding the clock back so this tipping can be ': 'Automatické spomalenie drží hodiny, aby sa dal prevrat ',
    'The climate is changing too fast to skip over — the simulation is running as quickly as it accurately can.':
      'Klíma sa mení príliš rýchlo na to, aby sa dala preskočiť — simulácia beží tak rýchlo, ako to presnosť dovoľuje.',

    // ---- pravý panel -------------------------------------------------------
    'Diagnostics': 'Diagnostika',
    'Milestones': 'Míľniky',
    'time between the things you marked': 'časy medzi označenými okamihmi',
    'Elapsed time when this was marked': 'Uplynutý čas v okamihu označenia',
    'Remove this milestone': 'Odstrániť tento míľnik',
    'Temperature history': 'História teploty',
    'drag to go back': 'ťahaním späť v čase',
    'Drag along this chart to put the world back into its own past. Change something from there and it takes a different route — the path you left is dropped unless you saved it.':
      'Ťahaním po grafe sa svet vráti do vlastnej minulosti. Ak odtiaľ niečo zmeníte, vydá sa inou cestou — pôvodná sa zahodí, pokiaľ ste ju neuložili.',
    'Energy balance': 'Energetická bilancia',
    'where the curves cross, the climate rests': 'kde sa krivky pretínajú, tam klíma spočinie',
    'Zonal profile': 'Zonálny profil',
    'hover for one latitude': 'ukážte myšou na jednu šírku',
    'Each point is one of the eighteen equal-area bands the model actually solves. Hover or drag along it to read that band.':
      'Každý bod je jeden z osemnástich rovnako veľkých pásov, ktoré model naozaj počíta. Prejdením alebo ťahaním sa zobrazia hodnoty daného pásu.',
    'Water inventory': 'Zásoba vody',
    'Scenarios': 'Scenáre',
    'Discovered climates': 'Objavené klímy',
    'Reach a climate state to unlock its entry.': 'Klimatický stav sa odomkne, keď ho planéta dosiahne.',
    'Not yet discovered': 'Zatiaľ neobjavené',
    'About the model': 'O modeli',
    'A zonal energy-balance model over 18 equal-area bands. Longwave radiation uses a semi-grey two-stream fit anchored to modern Earth (240 W/m²), Venus (161 W/m²) and the':
      'Zonálny model energetickej bilancie na 18 rovnako veľkých pásoch. Dlhovlnné žiarenie počíta pološedý dvojtokový vzťah ukotvený na dnešnú Zem (240 W/m²), Venušu (161 W/m²) a na',
    'Simpson–Nakajima runaway limit': 'Simpsonovu–Nakajimovu hranicu úniku',
    'of 283 W/m² — which the fit reproduces rather than imposes, so the runaway greenhouse emerges from the physics.':
      's hodnotou 283 W/m² — ktorú vzťah reprodukuje, a nie predpisuje, takže nekontrolovateľný skleníkový efekt vychádza z fyziky.',
    'Slow processes run on the same accelerated clock: the carbonate–silicate thermostat (~1 Myr), snowball CO₂ build-up (5–50 Myr), and hydrogen escape (10⁸–10⁹ yr to lose an ocean). Physics advances on simulated time only — the trajectory is identical at any frame rate.':
      'Pomalé procesy bežia na tých istých zrýchlených hodinách: uhličitanovo-kremičitanový termostat (~1 mil. rokov), hromadenie CO₂ pod ľadom snehovej gule (5–50 mil. rokov) a únik vodíka (10⁸–10⁹ rokov na stratu oceánu). Fyzika postupuje výlučne v simulovanom čase — trajektória je pri každej snímkovej frekvencii rovnaká.',
    'Source & references': 'Zdrojový kód a literatúra',
    'Free software under the': 'Slobodný softvér pod licenciou',
    'GNU GPL v3': 'GNU GPL v3',
    'or later, with': 'alebo novšou, bez',
    'no warranty': 'akejkoľvek záruky',
    '. The page you are running is its own source: every module arrives unminified, and the repository above is the corresponding source in full. Surface maps are third-party and keep their own terms.':
      '. Táto stránka je zároveň svojím vlastným zdrojovým kódom: každý modul prichádza nezmenšený a repozitár vyššie je úplný zodpovedajúci zdroj. Mapy povrchu pochádzajú od tretích strán a platia pre ne ich vlastné podmienky.',

    // ---- diagnostika: názvy hodnôt ----------------------------------------
    'Mean surface': 'Priemerná teplota povrchu',
    'Day side': 'Denná strana',
    'Night side': 'Nočná strana',
    'Range': 'Rozpätie',
    'Land / ocean': 'Pevnina / oceán',
    'Land / ice': 'Pevnina / ľad',
    'Sea ice / land ice': 'Morský ľad / pevninský ľad',
    'Ice cover': 'Pokrytie ľadom',
    'Cloud cover': 'Oblačnosť',
    'Surface pressure': 'Tlak pri povrchu',
    'CO₂': 'CO₂',
    'Composition': 'Zloženie',
    'Carbon left below': 'Uhlík zostávajúci v plášti',
    'Fossil carbon left': 'Zostávajúci fosílny uhlík',
    'unlimited': 'neobmedzený',
    'Starlight now': 'Aktuálne žiarenie hviezdy',
    'Planet age': 'Vek planéty',
    'Life': 'Život',
    'Absorbed': 'Pohltené',
    'Emitted': 'Vyžiarené',
    'Internal heat': 'Vnútorné teplo',
    'Runaway margin': 'Rezerva do úniku',
    'Water left': 'Zostávajúca voda',
    'Water loss': 'Strata vody',
    'negligible': 'zanedbateľná',
    'Stratospheric H₂O': 'H₂O v stratosfére',
    'Mantle': 'Plášť',

    // ---- hlásenia ----------------------------------------------------------
    'The GPU dropped out — drawing on the CPU instead. The simulation is unaffected.':
      'Grafický procesor vypadol — kreslí sa na procesore. Simulácie sa to nedotýka.',
    'No GPU rendering available here — staying in software':
      'Vykresľovanie na GPU tu nie je dostupné — pokračuje sa softvérovo',
    'Could not save — storage is full or blocked': 'Nepodarilo sa uložiť — úložisko je plné alebo blokované',
    'Could not import — storage is full or blocked': 'Nepodarilo sa importovať — úložisko je plné alebo blokované',
    'Could not read that file': 'Súbor sa nepodarilo prečítať',
    'Nothing to export — every slot is empty': 'Nie je čo exportovať — všetky pozície sú prázdne',
    'That file has no worlds in it': 'V súbore nie je žiadny svet',
    'Pick a slot to save into': 'Vyberte pozíciu, do ktorej sa má uložiť',
    'Fossil carbon put back in the ground': 'Fosílny uhlík je opäť pod zemou',
    'Saved to slot {0}': 'Uložené na pozíciu {0}',
    'Slot {0} is empty — press Save… first': 'Pozícia {0} je prázdna — najprv stlačte Uložiť…',
    'Loaded slot {0} — {1}, {2} in': 'Načítaná pozícia {0} — {1}, v čase {2}',
    'Exported {0} worlds': 'Exportované svety: {0}',
    'Back to {0} — change something, then press play': 'Späť na {0} — zmeňte niečo a spustite',
    'Settled at {0}': 'Ustálené po {0}',
    'Marked “{0}” at {1}': 'Míľnik „{0}“ v čase {1}',
    'New climate discovered — {0}': 'Objavená nová klíma — {0}',
    'Time acceleration runs from {0} to {1} per second': 'Zrýchlenie času siaha od {0} do {1} za sekundu',
    '{0} limited to {1}': '{0} — obmedzené na {1}',
    'Abandon scenario': 'Ukončiť scenár',
    '✓ Complete — {0} elapsed': '✓ Splnené — uplynulo {0}',
    '✕ Failed — {0} elapsed. Reset to try again.': '✕ Nesplnené — uplynulo {0}. Reštartom skúsite znova.',
    '{0} / {1} — in progress': '{0} / {1} — prebieha',
    'after “{0}”': 'po míľniku „{0}“',

    // ---- ovládacie prvky: názvy -------------------------------------------
    'Planet mass': 'Hmotnosť planéty',
    'Sets radius, gravity and how well the world holds its air.':
      'Určuje polomer, gravitáciu a to, ako dobre si svet udrží atmosféru.',
    'Water inventory ': 'Zásoba vody ',
    '1 EO = one Earth ocean. Tracks what is left as the planet loses water.':
      '1 EO = jeden pozemský oceán. Ukazuje, koľko vody planéte zostáva, ako o ňu prichádza.',
    'Basin geometry': 'Geometria panví',
    'How much of this world would stand above the sea at Earth-like water. Actual coverage is worked out from the water it really has — see the readout.':
      'Aká časť sveta by pri pozemskom množstve vody vyčnievala nad hladinu. Skutočné zaliatie sa dopočíta z vody, ktorú planéta naozaj má — pozri údaje vpravo.',
    'Starlight received': 'Prijaté žiarenie hviezdy',
    'Relative to Earth. 1 S⊕ = 1361 W/m². Four decades wide because real bodies are: Titan gets 0.011 and GJ 1132 b takes 18.8, and a slider that ran 0.05 to 4 could not represent three of the worlds shipped with it.':
      'Vzťahuje sa na Zem. 1 S⊕ = 1361 W/m². Rozsah štyroch rádov, lebo taký je aj rozsah skutočných telies: Titan dostáva 0,011 a GJ 1132 b 18,8. Posuvník od 0,05 do 4 by tri z dodávaných svetov vôbec nezobrazil.',
    'The star brightens by 10% every billion years, and the control follows it. The Sun’s real track is 7.4%/Gyr averaged over its life.':
      'Hviezda sa každú miliardu rokov zjasní o 10 % a ovládací prvok sa hýbe s ňou. Skutočná dráha Slnka je v priemere 7,4 % za miliardu rokov.',
    "The star brightens by 10% every billion years, and the control follows it. The Sun's real track is 7.4%/Gyr averaged over its life.":
      'Hviezda sa každú miliardu rokov zjasní o 10 % a ovládací prvok sa hýbe s ňou. Skutočná dráha Slnka je v priemere 7,4 % za miliardu rokov.',
    'brightening star': 'jasnejúca hviezda',
    'Move this control and the star walks to the new value instead of jumping to it. A jump can throw a world across a threshold that the same change made gradually would carry it along — the difference between a 63 °C ocean and a 576 °C steam greenhouse.':
      'Hviezda k novej hodnote prejde postupne, namiesto skoku. Skok dokáže svet prehodiť cez prah, ktorý by tá istá zmena spravená pozvoľna zvládla bez ujmy — rozdiel medzi oceánom pri 63 °C a parným skleníkom pri 576 °C.',
    'smooth changes': 'plynulé zmeny',
    'Star temperature': 'Teplota hviezdy',
    'Stellar XUV activity': 'Aktivita hviezdy v XUV',
    'Drives hydrogen escape. Young suns and red dwarfs are 100–1000× more active.':
      'Poháňa únik vodíka. Mladé slnká a červení trpaslíci sú 100–1000× aktívnejší.',
    'Rotation period': 'Perióda rotácie',
    'Slow rotators grow a thick reflective cloud deck and move heat much more freely. Rotation alone does not make a world synchronous — Venus turns once every 243 days and still sees the sun everywhere. Use the tidal-lock switch for that.':
      'Pomaly rotujúce svety si vytvárajú hrubú odrazivú vrstvu oblakov a prenášajú teplo oveľa voľnejšie. Samotná rotácia však svet neurobí synchrónnym — Venuša sa otočí raz za 243 dní a Slnko aj tak vidí všade. Na to slúži prepínač viazanej rotácie.',
    'Axial tilt': 'Sklon osi',
    'Nitrogen & argon': 'Dusík a argón',
    'The gas that neither condenses nor absorbs: 0.78 bar of it on Earth. Radiatively inert, but it broadens everything else’s absorption lines.':
      'Plyn, ktorý ani nekondenzuje, ani nepohlcuje: na Zemi ho je 0,78 baru. Žiarivo netečný, ale rozširuje absorpčné čiary všetkého ostatného.',
    'Oxygen': 'Kyslík',
    'Made by life, consumed by volcanic gases and by weathering rock. Set the biosphere below the volcanoes and it stays at nothing however long you wait — that threshold is the Great Oxidation.':
      'Vytvára ho život, spotrebúvajú vulkanické plyny a zvetrávajúca hornina. Ak biosféra nestíha sopkám, kyslík zostane na nule, nech sa čaká akokoľvek dlho — tento prah je Veľká oxidačná udalosť.',
    'anoxic': 'bez kyslíka',
    'Carbon dioxide': 'Oxid uhličitý',
    'Evolves on its own: volcanoes add it, weathering removes it, cold traps freeze it out.':
      'Vyvíja sa sám: sopky ho pridávajú, zvetrávanie odoberá, chladné pasce vymrazujú.',
    'Methane': 'Metán',
    'What is in the air now, not what stays. Life makes most of it and the interior a little; oxygen cuts its life from twelve thousand years to ten, so an oxygenated world holds almost none.':
      'Koľko ho je v ovzduší teraz, nie koľko vydrží. Väčšinu vyrába život, trochu vnútro planéty; kyslík skracuje jeho životnosť z dvanástich tisíc rokov na desať, takže okysličený svet ho takmer nemá.',
    'Ground brightness': 'Jas povrchu',
    'Dark basalt 0.10 · rock 0.25 · bright sand 0.40': 'Tmavý bazalt 0,10 · hornina 0,25 · svetlý piesok 0,40',
    'Photosynthetic biosphere': 'Fotosyntetická biosféra',
    'How hard photosynthesis runs — what you are asking for. What the planet can actually support is below, and past about 73 °C it is nothing: that is where the photosystems come apart and no phototroph on Earth lives above it.':
      'Ako naplno beží fotosyntéza — čo od planéty žiadate. Koľko z toho svet naozaj unesie, ukazuje pruh nižšie; nad približne 73 °C je to nič, lebo tam sa rozpadajú fotosystémy a žiadny pozemský fototrof nad touto hranicou nežije.',
    'alive': 'nažive',
    'Industrial CO₂': 'Priemyselné CO₂',
    'Burning fossil carbon: 40 Gt of CO₂ a year at 1×, some forty times every volcano on the planet. It runs on a finite reserve — about 5000 Gt of carbon, four and a half centuries at today’s rate — and then stops on its own.':
      'Spaľovanie fosílneho uhlíka: 40 Gt CO₂ ročne pri 1×, čo je asi štyridsaťnásobok všetkých sopiek planéty dohromady. Beží na konečnej zásobe — asi 5000 Gt uhlíka, štyri a pol storočia pri dnešnom tempe — a potom sa zastaví sám.',
    'Refill': 'Doplniť',
    'Put the fossil carbon back in the ground': 'Vrátiť fosílny uhlík späť pod zem',
    'Ignore the reserve and keep burning for ever. Not how a planet works — but a fair thing to ask.':
      'Ignorovať zásobu a spaľovať donekonečna. Takto planéta nefunguje — ale je to legitímna otázka.',
    'Radiogenic, primordial and — the one that can dominate — tidal. Past about 282 W/m² it boils an ocean on its own, with no help from the star. The buttons set this <em>and</em> the volcanism below, because on a real body the two are not independent.':
      'Rádiogénne, prvotné a — to, ktoré môže prevládnuť — slapové. Nad približne 282 W/m² vyvarí oceán samo, bez pomoci hviezdy. Tlačidlá nastavujú toto <em>aj</em> vulkanizmus nižšie, lebo na skutočnom telese tieto dve veličiny nie sú nezávislé.',
    'realistic decay': 'realistický pokles',
    'Uranium, thorium and potassium decay, the interior cools, and volcanism slows with it. The volcanic outgassing control follows automatically through melt production.':
      'Urán, tórium a draslík sa rozpadajú, vnútro chladne a vulkanizmus s ním slabne. Odplyňovanie sa prispôsobuje samo, cez tvorbu taveniny.',
    'Magnetic field': 'Magnetické pole',
    'A dynamo puts a magnetopause between the atmosphere and the solar wind. Earth’s sits ten radii out, so a hundredth of the wind gets through; with no field at all the wind reaches the top of the air and sputters it away ion by ion. That is what emptied Mars. Under realistic decay it goes out when the core stops convecting — half a billion years for Mars, eight for Earth.':
      'Dynamo stavia medzi atmosféru a slnečný vietor magnetopauzu. Tá zemská leží desať polomerov ďaleko, takže prejde stotina vietra; bez poľa vietor dosiahne až na vrch atmosféry a odprašuje ju ión po ióne. Presne to vyprázdnilo Mars. Pri realistickom poklese pole zhasne, keď jadro prestane prúdiť — po pol miliarde rokov na Marse, po ôsmich na Zemi.',
    'A resurfacing event: the whole mantle’s worth of carbon, all at once. Venus repaved about 80% of itself around 700 Myr ago.':
      'Obnova povrchu: uhlík za celý plášť naraz. Venuša si takto pred asi 700 miliónmi rokov prekryla zhruba 80 % povrchu.',
    "A resurfacing event: the whole mantle's worth of carbon, all at once. Venus repaved about 80% of itself around 700 Myr ago.":
      'Obnova povrchu: uhlík za celý plášť naraz. Venuša si takto pred asi 700 miliónmi rokov prekryla zhruba 80 % povrchu.',
    'resurfacing event': 'obnova povrchu',
    'Resurfacing after': 'Obnova povrchu po',
    'When the mantle turns over and everything dissolved in it comes up at once. Counted from <em>the start of the run</em>, not from the planet’s formation — so it is always ahead of you and never behind. Venus’s repaving is dated to roughly 700 Myr ago, an age of 3.85 Gyr; Early Venus starts at an age of 1.67, which is why that preset asks for 2.18 from its own start.':
      'Keď sa plášť premieša a všetko v ňom rozpustené vyjde naraz na povrch. Počíta sa od <em>začiatku behu</em>, nie od vzniku planéty — takže je vždy pred vami, nikdy za vami. Prekrytie Venuše je datované asi 700 miliónov rokov dozadu, teda do veku 3,85 mld. rokov; Mladá Venuša začína vo veku 1,67, a preto ten svet žiada 2,18 od vlastného začiatku.',
    'Resurfacing size': 'Rozsah obnovy povrchu',
    'How much it multiplies volcanic outgassing by at its peak. Shaped as a smooth pulse so nothing in the solver meets a step change.':
      'Koľkonásobne vo vrchole zosilní odplyňovanie. Má tvar plynulého impulzu, aby v riešiči nikde nevznikol skokový prechod.',
    'Age at start': 'Vek na začiatku',
    'How old the planet already is when the clock starts — so a preset set in the deep past begins part-way along its own life rather than at the beginning of it. This is what the elapsed clock counts on from, and what the resurfacing age below is measured against. The solar system is 4.567 Gyr old.':
      'Aká stará je planéta, keď sa spustia hodiny — svet zasadený do dávnej minulosti tak začína uprostred vlastného života, nie na jeho začiatku. Od tohto veku počítajú hodiny uplynutého času a voči nemu sa meria aj vek obnovy povrchu nižšie. Slnečná sústava má 4,567 mld. rokov.',
    'Volcanic outgassing': 'Vulkanické odplyňovanie',
    'The CO₂ source, and a trickle of abiotic methane. Your one lever inside a snowball — and enough of it holds a world anoxic against its own biosphere. Scaled by internal heat: melt production is what carries dissolved CO₂ up, so a hot interior erupts more.':
      'Zdroj CO₂ a slabý prítok abiotického metánu. Vnútri snehovej gule je to jediná páka — a dosť veľké odplyňovanie udrží svet bez kyslíka napriek jeho vlastnej biosfére. Škáluje sa vnútorným teplom: rozpustené CO₂ vynáša nahor tavenina, takže horúce vnútro vyvrhuje viac.',
    'Never run out of mantle carbon. Not how a planet works — but a fair thing to ask.':
      'Uhlík v plášti sa nikdy neminie. Takto planéta nefunguje — ale je to legitímna otázka.',
    'bottomless mantle': 'nevyčerpateľný plášť',
    'The simulation moves this one on its own': 'Túto hodnotu hýbe simulácia sama',
    '{0} value, type to set exactly': '{0} — hodnotu možno zadať presne',

    // ---- uložené pozície, atmosféra, život ---------------------------------
    'auto': 'auto',
    'empty': 'prázdna',
    'Kept up to date on its own, every 30 s and when you leave the page.':
      'Udržiava sa sama, každých 30 s a pri odchode zo stránky.',
    'Slot {0} is empty': 'Pozícia {0} je prázdna',
    '{0} — {1} elapsed, saved {2}': '{0} — uplynulo {1}, uložené {2}',
    'real surface map': 'skutočná mapa povrchu',
    'Not yet discovered — build a world that reaches this state.':
      'Zatiaľ neobjavené — postavte svet, ktorý sa do tohto stavu dostane.',
    'no atmosphere': 'bez atmosféry',
    'nitrogen and argon: the gas that neither condenses nor absorbs':
      'dusík a argón: plyn, ktorý ani nekondenzuje, ani nepohlcuje',
    'carbon dioxide': 'oxid uhličitý',
    'water vapour': 'vodná para',
    'water past its critical point: neither liquid nor gas':
      'voda za kritickým bodom: ani kvapalina, ani plyn',
    'free oxygen: made by life, or left behind when a lost ocean’s hydrogen escaped':
      'voľný kyslík: vytvorený životom, alebo zostal po tom, čo unikol vodík zo strateného oceánu',
    'methane': 'metán',
    'prokaryotes': 'prokaryoty',
    'eukaryotes': 'eukaryoty',
    'traces': 'stopy',
    '{0}% of the surface': '{0} % povrchu',
    'Cells without a nucleus. Liquid water and an electron donor is the whole requirement: −20 °C to 122 °C, no oxygen needed, no light needed.':
      'Bunky bez jadra. Celá požiadavka je kvapalná voda a donor elektrónov: −20 °C až 122 °C, bez kyslíka, bez svetla.',
    'Cells with a nucleus and mitochondria, so: aerobes. They need free oxygen — a percent or so of Earth’s is enough — and they give out around 60 °C, far short of what a bacterium will take.':
      'Bunky s jadrom a mitochondriami, teda aeróby. Potrebujú voľný kyslík — stačí zhruba percento zemského — a vzdávajú sa okolo 60 °C, teda hlboko pod tým, čo znesie baktéria.',
    'Software rendering — drawn on the CPU. The simulation is unaffected.':
      'Softvérové vykresľovanie — kreslí procesor. Simulácie sa to nedotýka.',
    'WebGL1, as requested — the same shaders at full detail.':
      'WebGL1 podľa požiadavky — tie isté shadery v plnom detaile.',
    'WebGL2 unavailable — drawing with WebGL1, at full detail.':
      'WebGL2 nie je dostupné — kreslí sa cez WebGL1, v plnom detaile.',
    'Type a rate: 500 yr, 2 Myr, 1.5 Gyr. Per second is assumed.':
      'Zadajte rýchlosť: 500 yr, 2 Myr, 1.5 Gyr. Predpokladá sa za sekundu.',
    'Auto-ease is holding the clock back so this tipping can be watched — {0} / s was asked for. Turn off "ease" to run at full speed.':
      'Automatické spomalenie drží hodiny, aby sa dal prevrat sledovať — požadované bolo {0} / s. Plnou rýchlosťou sa pokračuje po vypnutí „spomaliť“.',
    'Marked at {0} elapsed': 'Označené v čase {0}',

    // ---- ponuka zrýchlenia času -------------------------------------------
    'a year a second — watch the industrial era': 'rok za sekundu — priebeh priemyselnej éry',
    'a decade a second': 'desaťročie za sekundu',
    'a century a second — the whole fossil burn in a minute':
      'storočie za sekundu — celé spálenie fosílií za minútu',
    'a thousand years a second': 'tisíc rokov za sekundu',
    'glacial cycles, and the long thaw after a carbon spike':
      'ľadové cykly a dlhé topenie po uhlíkovom výkyve',
    'a hundred thousand a second': 'stotisíc rokov za sekundu',
    'half a million a second': 'pol milióna rokov za sekundu',
    'the carbonate-silicate thermostat works on this timescale':
      'v tejto mierke pracuje uhličitanovo-kremičitanový termostat',
    'five million a second': 'päť miliónov rokov za sekundu',
    'ice sheets, cold traps, the slow drift of a climate':
      'ľadovcové štíty, chladné pasce, pomalý posun klímy',
    'twenty-five million a second': 'dvadsaťpäť miliónov rokov za sekundu',
    'a whole geological era every couple of seconds':
      'celá geologická éra každé dve sekundy',
    'a continent’s worth of time per second': 'čas na presun kontinentu za sekundu',
    'a galactic year a second': 'galaktický rok za sekundu',
    'the fastest this goes — a planet’s whole life in ten seconds':
      'najrýchlejšie, ako to ide — celý život planéty za desať sekúnd',

    // ---- pomenované hodnoty na posuvníkoch --------------------------------
    'dry': 'sucho',
    'none': 'žiadna',
    'dead': 'mŕtve',
    'ocean world': 'oceánický svet',
    'Early Venus': 'Mladá Venuša',
    'Noachian Mars': 'Noachický Mars',
    'Archean': 'Archaikum',
    'Earth': 'Zem',
    'Mars': 'Mars',
    'Venus': 'Venuša',
    'Titan': 'Titan',
    'Moon': 'Mesiac',
    'Europa': 'Európa',
    'Enceladus': 'Enceladus',
    'Io': 'Io',
    'Carboniferous': 'Karbón',
    '10% PAL': '10 % dnešnej Zeme',
    'locked': 'viazaná rotácia',
    'tidally locked': 'viazaná rotácia',

    // ---- vnútro telies -----------------------------------------------------
    'Radiogenic only, and volcanically dead for a billion years.':
      'Len rádiogénne teplo; vulkanicky mŕtvy už miliardu rokov.',
    'Heat modelled, never measured — the InSight mole never got deep enough. The outgassing is higher than Mars’s lava alone would justify because here it has to stand in for everything that puts CO₂ back into that atmosphere: the seasonal polar caps and the regolith, which are what actually hold Mars at six millibars against a solar wind that would otherwise take the lot.':
      'Teplo je modelované, nikdy nemerané — krtko sondy InSight sa nedostal dosť hlboko. Odplyňovanie je vyššie, než by zodpovedalo samotnej marťanskej láve, lebo tu musí zastúpiť všetko, čo vracia CO₂ do atmosféry: sezónne polárne čiapočky a regolit. Práve tie držia Mars na šiestich milibaroch proti slnečnému vetru, ktorý by inak zobral všetko.',
    'A third of Earth’s heat under a stagnant lid, but geologically active with it.':
      'Tretina zemského tepla pod nehybným vekom, a napriek tomu geologicky činná.',
    'Tidal, and about 39 mW/m² at the seafloor. Cryovolcanism moves water, not carbon.':
      'Slapové, asi 39 mW/m² na dne oceánu. Kryovulkanizmus prenáša vodu, nie uhlík.',
    '47 ± 2 TW over the globe. Everything else on this row is measured against it.':
      '47 ± 2 TW na celú planétu. Všetko ostatné v tomto riadku sa meria voči nej.',
    'South-polar, not global — the rest of the moon is nothing like this warm.':
      'Sústredené na južný pól, nie globálne — zvyšok mesiaca zďaleka taký teplý nie je.',
    'The most volcanically active body known. What it erupts is sulphur, not CO₂.':
      'Vulkanicky najčinnejšie známe teleso. Vyvrhuje síru, nie CO₂.',
    'Twice Io’s tidal flux. Its mantle sits above the rock solidus: partially molten.':
      'Dvojnásobok slapového toku Io. Plášť je nad solidom horniny: čiastočne roztavený.',
    'A thousand times Earth’s, from an eccentricity of 0.01. Magma ocean tens of metres down.':
      'Tisícnásobok zemského, pri excentricite iba 0,01. Magmatický oceán pár desiatok metrov pod povrchom.',
  },

  // ---- klimatické stavy ----------------------------------------------------
  states: {
    magma: { name: 'Magmatický oceán',
      blurb: 'Povrch je roztavená hornina. Nad približne 1400 K sa kremičitany tavia a planéta žiari v blízkej infračervenej oblasti; atmosféru, ak nejakú má, tvorí horúca zmes horninových pár a vodnej pary.' },
    dryRunaway: { name: 'Suchý skleníkový únik',
      blurb: 'Venuša. Oceán je preč — vyparil sa, rozložilo ho svetlo a vodík odviala do vesmíru — a zostala hustá suchá atmosféra CO₂ nad povrchom horúcim natoľko, že slabo žiari. V ľudských časových mierkach nezvratné.' },
    wetRunaway: { name: 'Vlhký skleníkový únik',
      blurb: 'Pohltené žiarenie hviezdy spolu s vlastným teplom planéty prekročilo Simpsonovu–Nakajimovu hranicu (~282 W/m²), takže rovnováha neexistuje pri žiadnej teplote. Dokáže to aj samotné slapové teplo, na svete, ktorý by hviezda nechala obývateľný (Barnes a kol. 2013). Oceán sa vyvára do mohutnej parnej atmosféry; skupenské teplo naťahuje tento prechod na ~10⁵ rokov a samotná strata vody trvá ďalších 10⁸–10⁹.' },
    moist: { name: 'Vlhký skleníkový režim',
      blurb: 'Voda je stále kvapalná, ale chladná pasca zlyhala: podiel vody v stratosfére presiahol 10⁻³ a vodík uniká plynule. Krátkodobo obývateľný svet, ktorý však počas stoviek miliónov rokov vyschne (Kasting 1988).' },
    hothouse: { name: 'Skleník bez ľadu',
      blurb: 'Nikde žiadny trvalý ľad, trópy na hranici znesiteľnosti pre zložitý život. Takto vyzerala Zem v kriede a počas paleocénno-eocénneho teplotného maxima.' },
    temperate: { name: 'Mierny a obývateľný',
      blurb: 'Kvapalná voda na väčšine povrchu so stabilným polárnym ľadom. Uhličitanovo-kremičitanový termostat drží tento stav proti pomalým zmenám žiarenia hviezdy v mierke ~1 mil. rokov.' },
    dune: { name: 'Púštny svet',
      blurb: 'Suchozemská planéta s minimom povrchovej vody. Nenasýtený vzduch dovoľuje trópom vyžarovať nad klasickú hranicu úniku a suchá stratosféra škrtí stratu vody — púštne svety preto zostávajú obývateľné oveľa bližšie k hviezde než oceánické (Abe a kol. 2011).' },
    waterworld: { name: 'Oceánický svet',
      blurb: 'Globálny oceán bez akejkoľvek súše. Kontinentálne zvetrávanie je vypnuté, ale morská voda stále prúdi cez čerstvý bazalt v oceánskych chrbtoch a ukladá tam uhlík, takže termostat prežíva — slabší, pomalší a s rovnováhou pri vyššej teplote a vyššom obsahu uhlíka, než by mal svet s kontinentmi.' },
    eyeball: { name: 'Svet-oko',
      blurb: 'Viazaná rotácia: pod hviezdou osvetlený oceán, všade inde trvalý ľad. Hustá vrstva oblakov nad podhviezdnym bodom odráža toľko svetla, že takéto svety zostávajú obývateľné takmer do dvojnásobku zemského ožiarenia (Yang a kol. 2014).' },
    lobster: { name: 'Homárí stav',
      blurb: 'Svet-oko, ktorého otvorená voda sa prenosom tepla v oceáne roztiahla pozdĺž rovníka — teplé klepetá siahajú okolo planéty smerom k nočnej strane.' },
    twilight: { name: 'Súmračný svet',
      blurb: 'Oko je rozpálené, nočná strana ľadová a medzi nimi vedie po terminátore mierny prstenec kvapalnej vody okolo celej planéty. Funguje to len preto, že vody je primálo na prenos tepla: vlhkejší svet by odviedol od podhviezdneho bodu dosť skupenského tepla na vyrovnanie teplôt a potom by hranicu úniku prekročil ako celok, namiesto toho, aby po ňom zostal obývateľný pás (Lobo a kol. 2023).' },
    trapped: { name: 'Púšť s vodou uväznenou v noci',
      blurb: 'Na svete s viazanou rotáciou je nočná strana trvalou chladnou pascou. Všetka voda sa tam presunula ako ľadovcový ľad a na osvetlenej strane zostala vyprahnutá púšť, ktorá ju už nezíska späť.' },
    waterbelt: { name: 'Vodný pás',
      blurb: 'Ľad siaha hlboko do trópov, ale úzky pruh otvoreného rovníkového oceánu prežíva. Skutočne stabilný stav a oveľa mäkšie pristátie než úplná snehová guľa.' },
    snowball: { name: 'Snehová guľa',
      blurb: 'Ľadovo-albedová spätná väzba zamrazila planétu od pólu k pólu. Zvetrávanie sa zastavilo, takže vulkanické CO₂ sa 5–50 miliónov rokov hromadí bez protiváhy, kým 0,1–0,3 baru ľad konečne neprelomí.' },
    marslike: { name: 'Kolaps atmosféry ako na Marse',
      blurb: 'Na zem vymrzla samotná atmosféra. Pod bodom mrazu CO₂ kondenzuje na zimnom póle rýchlejšie, než ho sopky stíhajú dopĺňať, a tlak klesá, kým zvyšok nie je v rovnováhe s čiapočkami. Dá sa z toho dostať: dosť silné odplyňovanie atmosféru zahustí, ohreje póly nad bod mrazu a vráti vzduch tam, kam patrí.' },
    nightfrost: { name: 'Čiastočné vymrznutie na nočnú stranu',
      blurb: 'Atmosféra sneží na temnú stranu. Svet s viazanou rotáciou má pologuľu, ktorá hviezdu nikdy nevidí, a ak klesne pod bod mrazu CO₂, vzduch tam natrvalo kondenzuje — žiadne ročné obdobie ho nevráti, a práve tým sa to líši od Marsu. Tlak klesá, kým sa zvyšok nevyrovná s nánosom na nočnej strane, pričom denná strana zostáva po celý čas teplá, vlhká a obývateľná: planéta s funkčným oceánom pod svojou hviezdou, ktorej za chrbtom potichu uniká atmosféra. To more je súčasťou definície tohto stavu, nie jeho pravdepodobným sprievodným javom — keď zmizne aj posledná kvapka, vymrznutie je úplné a svet sa stáva Vymrznutou nočnou stranou. Zastaviť to dokáže prenos tepla: dosť hustý vzduch prinesie na nočnú stranu dosť tepla, aby ju udržal nad bodom mrazu, takže na mohutnej atmosfére sa proces sám obmedzuje a na tenkej je pascou (Joshi a kol. 1997; Wordsworth 2015; Turbet a kol. 2018 pre planéty TRAPPIST-1).' },
    nightfrozen: { name: 'Vymrznutá nočná strana',
      blurb: 'Vymrznutie je dokončené. Väčšina atmosféry leží ako suchý ľad na pologuli, ktorá hviezdu nikdy nevidí, a voda, ak nejaká je, je zamrznutá vedľa nej — nikde na planéte nie je kvapalná voda a denná strana je holá púšť pod tenkým zvyškom vzduchu. Nejde o iný mechanizmus, ale o koncový stav čiastočného vymrznutia, a rozdiel medzi nimi je more: kým existuje, svet je obývateľný a len mu potichu uniká vzduch; keď zmizne, nie je už o čo prísť. Odlišné od púšte s vodou uväznenou v noci, kde je atmosféra nedotknutá a presunula sa iba voda.' },
    titan: { name: 'Titanovský svet',
      blurb: 'Mrazivý svet pod hustým dusíkovo-metánovým oparom, na kvapalnú vodu ďaleko príliš studený, ale dosť teplý na to, aby po povrchu tiekli iné kvapaliny.' },
    frozen: { name: 'Zamrznutá púšť',
      blurb: 'Chladno, sucho a ticho. Primálo vody na skutočnú snehovú guľu a primálo skleníkového efektu na roztopenie.' },
    thincold: { name: 'Tenká studená púšť',
      blurb: 'Tenká, mrazivá a vysušená atmosféra nad holou zemou — dnešný Mars. Vzduch nekolaboval: jednoducho ho toľko je. Stačí pridať sopky a zhustne, oteplí sa a napokon opäť udrží kvapalnú vodu.' },
    baked: { name: 'Vyprahnutá púšť',
      blurb: 'Horúci bezvodý svet z holej horniny. Voda, ak nejakú mal, je dávno preč, takže povrch nemá čo zmierňovať a denná strana sa jednoducho pečie.' },
    airless: { name: 'Holá skala',
      blurb: 'Za hranicou, kde planéty ešte držia atmosféru: hviezdne XUV strhlo vzduch rýchlejšie, než ho gravitácia dokázala udržať. O klíme sa nedá hovoriť.' },
  },

  // ---- scenáre -------------------------------------------------------------
  scenarios: {
    thaw: {
      name: 'Prelomiť snehovú guľu',
      brief: 'Planéta je zamrznutá od pólu k pólu, ľad odráža takmer všetko späť do vesmíru a sopky sa zastavili. Do ovzdušia nepribúda žiadny uhlík a ani nepribudne, pokiaľ ho tam nedostanete vy. Vráťte na povrch kvapalnú vodu.',
      hint: 'Vnútri snehovej gule sú sopky jediná páka: zvetrávanie potrebuje kvapalnú vodu, takže keď ľad siaha po rovník, neexistuje odber a každý vyvrhnutý gram zostáva. Zvýšte odplyňovanie a nechajte bežať hodiny.',
    },
    hold: {
      name: 'Zadržať únik',
      brief: 'Svet šesť wattov na meter štvorcový pod Simpsonovou–Nakajimovou hranicou — obývateľný, a bez akejkoľvek rezervy. Jeho hviezda je ťažšia než Slnko a spaľuje vodík trikrát rýchlejšie, takže sa táto medzera zatvára sama a neprestane. Udržte planétu obývateľnú miliardu rokov.',
      hint: 'Hviezdu stlmiť neviete a jasnieť jej nezabránite. Vziať sa dá skleníkový efekt: odstráňte CO₂ a držte ho dole, lebo 2,5-násobný vulkanizmus ho vracia späť. Ak to prestane stačiť, pamätajte, že hranica platí pre pohltené žiarenie oproti tomu, čo atmosféra dokáže vyžiariť — zosvetlite povrch, a suchšia planéta vyžaruje lepšie než vlhká.',
    },
    terraform: {
      name: 'Terraformovať studenú púšť',
      brief: 'Malý, studený svet s riedkym vzduchom a stopou pochovaného ľadu. Dajte mu kvapalnú vodu na povrchu.',
      hint: 'Nízka gravitácia znamená, že každý kilogram plynu prinesie menej tlaku. Bude treba veľa CO₂ — a dosť vody v zásobe na to, aby oceán vôbec mohol existovať.',
    },
    eyeball: {
      name: 'Oko červeného trpaslíka',
      brief: 'Svet s viazanou rotáciou navždy otočený k činnému červenému trpaslíkovi. Jedna pologuľa horí, druhá je chladná pasca, ktorá kradne vodu a nikdy ju nevráti. Udržte pod hviezdou otvorený oceán miliardu rokov.',
      hint: 'Hustý vzduch prenáša teplo na nočnú stranu a bráni tomu, aby sa tam voda presunula natrvalo. Sledujte XUV — činný červený trpaslík strháva vodu rýchlo.',
    },
    dune: {
      name: 'Postaviť púštny svet',
      brief: 'Umiestnite obývateľnú planétu tam, kde by sa oceánický svet vyvaril. Púštne planéty prežijú oveľa bližšie k hviezde: nenasýtený vzduch vyžaruje nad klasickú hranicu úniku a suchá stratosféra brzdí stratu vody.',
      hint: 'Proti intuícii, no skutočne (Abe a kol. 2011): dajte jej *menej* vody. Samotné vysušenie však nestačí — pri hlbokých panvách zemského typu sa aj tá troška rozleje do širokých plytkých morí a vzduch zostane vlhký. Zvýšte aj geometriu panví, aby zvyšná voda nemala kam tiecť.',
    },
    oxidation: {
      name: 'Veľká oxidačná udalosť',
      brief: 'Archaický svet bez kyslíka, nad bodom mrazu ho drží milibar metánu. Vaše sinice práve zvládli kyslíkovú fotosyntézu a šíria sa samy — a kyslík s metánom vedľa seba neobstoja. Nedovoľte, aby planéta zamrzla, kým sa okysličí.',
      hint: 'Biosféru neudržíte: zdvojnásobuje sa každých pár miliónov rokov nech robíte čokoľvek a prekročí tok vulkanických redukovadiel pri asi 0,4-násobku Zeme. Odvtedy kyslík skráti život metánu z desiatich tisíc rokov na desať, pričom milibar metánu má hodnotu asi pätnástich wattov na meter štvorcový. Nahraďte tento skleníkový efekt oxidom uhličitým *pred* prekročením, inak ľadovo-albedová spätná väzba vezme celú planétu — a metán, ktorý sa potom vráti, ju už neroztopí.',
    },
    venus: {
      name: 'Zvrátiť Venušu',
      brief: 'Suchý skleníkový únik: 90 barov CO₂, 460 °C a voda dávno rozložená svetlom a odviata preč. Ochlaďte planétu pod bod varu.',
      hint: 'Voda je preč a nevráti sa — posuvník zásoby je však váš. Pochovajte CO₂ a dajte zvetrávaciemu termostatu niečo, s čím môže pracovať.',
    },
    hotbranch: {
      name: 'Horúci oceán',
      brief: 'Svet s plným oceánom pod hviezdou, ktorú ovládate. Za hranicou 50 °C existuje stabilná klíma — more, ktoré zostane morom pri teplote kúpeľa — ale vedie k nej len pomalá cesta a dvere sú úzke. Dostaňte planétu nad 50 °C s neporušeným oceánom a udržte ju tam ešte šesťdesiat miliónov rokov.',
      hint: 'Plynulé zmeny žiarenia sú už zapnuté, takže jedno potiahnutie posunie hviezdu nahor počas dvadsiatich miliónov rokov namiesto skoku — najprv však nechajte bežať hodiny, lebo zmena v čase t = 0 stále skáče. 1,30 S⊕ nestačí a zastaví sa na 40 °C. 1,36 sú tie dvere. 1,40 nimi prejde a už sa nezastaví, a akýkoľvek cieľ dosiahnutý jediným skokom vynesie oceán do neba, albedo s ním, a cesta späť neexistuje.',
    },
  },

  // ---- predvolené svety ----------------------------------------------------
  presets: {
    earth: 'Zem',
    moon: 'Mesiac',
    earlyMoon: 'Pradávny Mesiac',
    preindustrial: 'Predindustriálna Zem',
    earthlike: 'Zemi podobná',
    venus: 'Venuša',
    mars: 'Mars',
    earlyEarth: 'Archaikum',
    earlyVenus: 'Mladá Venuša',
    dryVenus: 'Nikdy nezvlhnutá Venuša',
    earlyMars: 'Noachický Mars',
    snowball: 'Snehová guľa',
    dune: 'Púštny svet',
    eyeball: 'Viazané oko',
    waterworld: 'Oceánický svet',
    titan: 'Titanovský svet',
    trappist1b: 'TRAPPIST-1b',
    trappist1e: 'TRAPPIST-1e',
    gj1132b: 'GJ 1132 b',
    superEarth: 'Superzem',
    futureEarth: 'Zem o 1 mld. rokov',
    hotCarbon: 'Horúci oceán · CO₂',
    hotStar: 'Horúci oceán · žiarenie',
    brink: 'Za hranou',
  },
};
