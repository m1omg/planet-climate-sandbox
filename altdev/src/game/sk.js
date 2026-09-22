// Slovenčina.
//
// Písané tak, ako by to napísal človek, nie prekladač: krátke vety, bežné
// slovné spojenia a žiadne doslovné kalky z angličtiny. Rovnaké termíny ako
// altdev2 (slot, nadkritický, obálka, oceánsky svet, nekontrolovateľný
// skleníkový efekt); kde je anglický text rovnaký, je rovnaký aj preklad.
//
// `ui` sa hľadá podľa anglického originálu, `states`, `scenarios` a `presets`
// podľa id. Chýbajúci záznam znamená angličtinu, nie prázdne miesto.
export const SK = {
  ui: {
    'Planet Climate': 'Klíma planéty',
    'Sandbox': 'Sandbox',
    'An alternative line of work to /dev/. Planetary histories, magnetic fields, resurfacing, and the step-size bugs behind the flickering.':
      'Alternatívna vetva vývoja popri /dev/: história planét, magnetické polia, obnova povrchu a opravy chýb v dĺžke kroku, ktoré spôsobovali blikanie.',
    'stable site': 'stabilná verzia',
    'dev': 'dev',
    'Dismiss': 'Zavrieť',
    'Worlds': 'Svety',
    'Saves': 'Uložené',
    'Name': 'Názov',
    'Custom world': 'Vlastný svet',
    'What to call this world. It goes into the save slots, the export file and the log line when you load it. Loading a preset puts its own name back.':
      'Názov sveta. Uloží sa do slotu, do exportovaného súboru aj do hlásenia pri načítaní. Keď načítate hotový svet, dostane späť svoj pôvodný názov.',
    'Click a slot to load it.': 'Kliknutím na slot ho načítate.',
    'Save…': 'Uložiť…',
    'then pick a slot to overwrite. Slot 1 keeps itself.':
      'a potom vyberte slot, ktorý sa prepíše. Slot 1 sa ukladá sám.',
    'Export all…': 'Exportovať všetko…',
    'Every saved world in one file, to keep somewhere that is not this browser':
      'Všetky uložené svety v jednom súbore, aby ste ich mali aj mimo tohto prehliadača',
    'Import…': 'Importovať…',
    'Merge a saves file in. Slots the file does not mention are left alone.':
      'Pridá svety zo súboru. Sloty, ktoré súbor nepoužíva, zostanú bez zmeny.',
    'A single world also travels in the address bar — copy the URL.':
      'Jeden svet sa dá poslať aj cez adresu stránky — stačí skopírovať URL.',
    'Every control is live. Change one mid-run and the planet keeps its current temperature, ice and history — you are intervening on a running world, not restarting it. The four highlighted below also move on their own as the simulation evolves them. Click any value to type it exactly.':
      'Všetko sa dá meniť aj počas behu. Planéta si pritom ponechá teplotu, ľad aj históriu — zasahujete do bežiaceho sveta, nespúšťate ho odznova. Štyri zvýraznené hodnoty mení aj samotná simulácia. Kliknutím na hodnotu ju môžete zadať presne.',
    'Body': 'Teleso',
    'no carbon outgassing': 'bez sopečného CO₂',
    '{0}× Earth’s outgassing': '{0}× zemské odplyňovanie',
    'Orbit & Star': 'Dráha a hviezda',
    'Atmosphere': 'Atmosféra',
    'Surface & Interior': 'Povrch a vnútro',
    'Controls': 'Ovládanie',
    'Readout': 'Údaje',
    'Planet controls': 'Ovládanie planéty',
    'Show the planet controls': 'Zobraziť ovládanie planéty',
    'Readout and scenarios': 'Údaje a scenáre',
    'Show the readout and scenarios': 'Zobraziť údaje a scenáre',
    'Pause the planet’s rotation': 'Zastaviť otáčanie planéty',
    'Pause the planet\'s rotation': 'Zastaviť otáčanie planéty',
    'Resume the planet’s rotation': 'Znova roztočiť planétu',
    'Planet rotation is paused with the simulation': 'Planéta stojí, lebo je pozastavená simulácia',
    'Recentre the view': 'Vycentrovať pohľad',
    'Panning speed: 0.5×': 'Rýchlosť otáčania pohľadu: 0,5×',
    'Panning speed: 1×': 'Rýchlosť otáčania pohľadu: 1×',
    'Panning speed: 2×': 'Rýchlosť otáčania pohľadu: 2×',
    'Surface graphics': 'Grafika povrchu',
    'Surface maps need WebGL2': 'Mapy povrchu potrebujú WebGL2',
    'Surface maps are not available in this build': 'Mapy povrchu v tejto verzii nie sú',
    'Detail: high': 'Detaily: vysoké',
    'Detail: low': 'Detaily: nízke',
    'Atmosphere: stylised': 'Atmosféra: štylizovaná',
    'Atmosphere: realistic — true scale height, and an opaque one hides the ground':
      'Atmosféra: realistická — v skutočnej hrúbke; nepriehľadná zakryje povrch',
    'Atmosphere: stylised — the shell is exaggerated so you can see it change':
      'Atmosféra: štylizovaná — obal je zväčšený, aby bolo vidieť jeho zmeny',
    'Clouds: shown — click to see the surface underneath':
      'Oblaky: zobrazené — kliknutím uvidíte povrch pod nimi',
    'Clouds: hidden — a view only; they still cool the planet':
      'Oblaky: skryté — len v zobrazení; planétu ďalej ochladzujú',
    'Clouds shown again.': 'Oblaky sú opäť viditeľné.',
    'Clouds hidden — a view only. They still reflect their sunlight and still cool the planet; the readout’s cloud cover has not moved.':
      'Oblaky sú skryté len v zobrazení. Svetlo odrážajú a planétu ochladzujú ďalej; oblačnosť v údajoch sa nezmenila.',
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
    'Run until the climate stops changing': 'Nechať bežať, kým sa klíma neustáli',
    'Reset': 'Reštart',
    'Restart this world at t = 0': 'Spustiť svet odznova od t = 0',
    'pause on reset': 'po reštarte pauza',
    'Start paused after a reset, so you can set the world up before it runs':
      'Po reštarte zostať v pauze, aby ste mohli svet nastaviť ešte pred spustením',
    'age': 'vek',
    'elapsed': 'uplynulo',
    'since mark': 'od míľnika',
    'Mark this moment. The clock then also counts from the mark, so you can time an event you are watching.':
      'Označí tento okamih. Hodiny potom merajú aj čas od neho, takže si môžete stopnúť, ako dlho niečo trvá.',
    'time acceleration': 'zrýchlenie času',
    'Time acceleration, type to set exactly': 'Zrýchlenie času — môžete ho zadať presne',
    'Type a number — the unit is the menu beside it. A whole rate works too: 500 yr, 2 Myr, 1.5 Gyr.':
      'Zadajte číslo — jednotku vyberiete vedľa. Dá sa napísať aj celé: 500 yr, 2 Myr, 1.5 Gyr.',
    'Time acceleration unit': 'Jednotka zrýchlenia času',
    'Jump to a time acceleration': 'Prednastavené zrýchlenia',
    'ease': 'spomaliť',
    'fast': 'rýchlo',
    'custom': 'vlastné',
    'Ease off automatically when the climate tips': 'Automaticky spomaliť, keď sa klíma prevracia',
    'The climate is changing too fast to skip over — the simulation is running as quickly as it accurately can.':
      'Klíma sa mení príliš rýchlo, aby sa dala preskočiť — simulácia ide tak rýchlo, ako jej to presnosť dovolí.',
    'Diagnostics': 'Diagnostika',
    'Milestones': 'Míľniky',
    'Climate epochs': 'Klimatické epochy',
    'Milestone name': 'Názov míľnika',
    'what this world has been, and for how long': 'čím tento svet bol a ako dlho',
    'Clear all': 'Vymazať všetko',
    'Remove every milestone': 'Odstrániť všetky míľniky',
    'Go back to this milestone': 'Vrátiť sa k tomuto míľniku',
    'Go back to the start of “{0}”': 'Vrátiť sa na začiatok epochy „{0}“',
    '{0} to {1}': 'od {0} do {1}',
    'now': 'teraz',
    'Cleared {0} milestones': 'Vymazané míľniky: {0}',
    'Timeline reset to the whole run': 'Časová os opäť ukazuje celý beh',
    'scroll to zoom · shift-scroll to pan · drag to go back':
      'koliesko: priblížiť · Shift + koliesko: posunúť · ťahaním späť v čase',
    'time between the things you marked': 'čas medzi označenými okamihmi',
    'Elapsed time when this was marked': 'Čas od začiatku, keď ste míľnik pridali',
    'Remove this milestone': 'Odstrániť míľnik',
    'Temperature history': 'Vývoj teploty',
    'drag to go back': 'ťahaním späť v čase',
    'Drag along this chart to put the world back into its own past. Change something from there and it takes a different route — the path you left is dropped unless you saved it.':
      'Ťahaním po grafe vrátite svet do jeho minulosti. Ak odtiaľ niečo zmeníte, vývoj pôjde inak — pôvodná budúcnosť sa zahodí, ak ste si ju neuložili.',
    'Energy balance': 'Energetická bilancia',
    'where the curves cross, the climate rests': 'kde sa krivky pretnú, tam sa klíma ustáli',
    'Zonal profile': 'Profil podľa zemepisnej šírky',
    'hover for one latitude': 'myšou ukážete jednu šírku',
    'Each point is one of the eighteen equal-area bands the model actually solves. Hover or drag along it to read that band.':
      'Každý bod je jeden z osemnástich rovnako veľkých pásov, ktoré model počíta. Prejdite po ňom myšou a uvidíte hodnoty pásu.',
    'Water inventory': 'Zásoba vody',
    'Scenarios': 'Scenáre',
    'Discovered climates': 'Objavené klímy',
    'Reach a climate state to unlock its entry.': 'Záznam sa odomkne, keď planéta daný stav dosiahne.',
    'Not yet discovered': 'Ešte neobjavené',
    'About the model': 'O modeli',
    'A zonal energy-balance model over 18 equal-area bands. Longwave radiation uses a semi-grey two-stream fit anchored to modern Earth (240 W/m²), Venus (161 W/m²) and the':
      'Zonálny model energetickej bilancie s 18 rovnako veľkými pásmi. Dlhovlnné žiarenie počíta pološedá dvojprúdová aproximácia nastavená podľa dnešnej Zeme (240 W/m²), Venuše (161 W/m²) a',
    'Simpson–Nakajima runaway limit':
      'Simpsonovej–Nakajimovej hranice nekontrolovateľného skleníkového efektu',
    'of 283 W/m² — which the fit reproduces rather than imposes, so the runaway greenhouse emerges from the physics.':
      '(283 W/m²). Túto hranicu model sám reprodukuje, nie je doň vložená, takže nekontrolovateľný skleníkový efekt vychádza priamo z fyziky.',
    'Slow processes run on the same accelerated clock: the carbonate–silicate thermostat (~1 Myr), snowball CO₂ build-up (5–50 Myr), and hydrogen escape (10⁸–10⁹ yr to lose an ocean). Physics advances on simulated time only — the trajectory is identical at any frame rate.':
      'Pomalé procesy bežia na rovnakých zrýchlených hodinách: uhličitanovo-kremičitanový termostat (~1 mil. rokov), hromadenie CO₂ počas snehovej gule (5–50 mil. rokov) a únik vodíka (strata oceánu trvá 10⁸–10⁹ rokov). Fyzika postupuje len v simulovanom čase — výsledok je rovnaký pri akejkoľvek snímkovej frekvencii.',
    'Source & references': 'Zdrojový kód a literatúra',
    'Free software under the': 'Slobodný softvér pod licenciou',
    'GNU GPL v3': 'GNU GPL v3',
    'or later, with': 'alebo novšou, bez',
    'no warranty': 'akejkoľvek záruky',
    '. The page you are running is its own source: every module arrives unminified, and the repository above is the corresponding source in full. Surface maps are third-party and keep their own terms.':
      '. Táto stránka je zároveň svojím zdrojovým kódom: každý modul sa načítava neminifikovaný a repozitár vyššie obsahuje celý zdrojový kód. Mapy povrchu sú od tretích strán a platia pre ne ich vlastné licencie.',
    'Mean surface': 'Priemerná teplota',
    'Day side': 'Denná strana',
    'Night side': 'Nočná strana',
    'Range': 'Rozpätie',
    'Land / ocean': 'Pevnina / oceán',
    'Land / ice': 'Pevnina / ľad',
    'Sea ice / land ice': 'Morský / pevninský ľad',
    'Ice cover': 'Zaľadnenie',
    'Cloud cover': 'Oblačnosť',
    'Surface pressure': 'Tlak na povrchu',
    'CO₂': 'CO₂',
    'Composition': 'Zloženie',
    'Carbon left below': 'Uhlík v plášti',
    'Fossil carbon left': 'Zostáva fosílneho uhlíka',
    'unlimited': 'neobmedzene',
    'Starlight now': 'Žiarenie hviezdy',
    'Planet age': 'Vek planéty',
    'Life': 'Život',
    'Absorbed': 'Pohltené',
    'Emitted': 'Vyžiarené',
    'Internal heat': 'Vnútorné teplo',
    'Runaway margin': 'Rezerva do hranice',
    'How far below the Simpson–Nakajima limit this world is running. Past it, no temperature balances and the runaway greenhouse begins.':
      'O koľko je tento svet pod Simpsonovou–Nakajimovou hranicou. Za ňou už planéta nemá rovnovážnu teplotu a začína nekontrolovateľný skleníkový efekt.',
    'Water left': 'Zostáva vody',
    'Water loss': 'Strata vody',
    'negligible': 'zanedbateľná',
    'Stratospheric H₂O': 'H₂O v stratosfére',
    'Mantle': 'Plášť',
    'mean surface {0} °C': 'povrch v priemere {0} °C',
    'day {0} °C, night {1} °C': 'deň {0} °C, noc {1} °C',
    'equator {0} °C, poles {1} °C': 'rovník {0} °C, póly {1} °C',
    '{0}% ice': '{0} % ľadu',
    '{0} W/m² imbalance': 'nerovnováha {0} W/m²',
    'losing {0} oceans/Gyr': 'stráca {0} oceánu za mld. rokov',
    '{0} bar CO₂ frozen onto the night side': '{0} baru CO₂ zamrznutého na nočnej strane',
    '{0} bar CO₂ frozen out': '{0} baru CO₂ vymrznutého',
    'surface temperature': 'teplota povrchu',
    'collecting…': 'zbierajú sa údaje…',
    'no water on this world': 'tento svet nemá vodu',
    'anti-stellar': 'protihviezdny bod',
    'substellar': 'podhviezdny bod',
    'time →': 'čas →',
    'equator': 'rovník',
    'N pole': 'S pól',
    'S pole': 'J pól',
    'absorbed': 'pohltené',
    'ocean': 'oceán',
    'sea ice': 'morský ľad',
    'land ice': 'pevninský ľad',
    'vapour': 'para',
    'supercritical': 'nadkritická',
    'lost': 'stratená',
    '0.5×': '0,5×',
    'The GPU dropped out — drawing on the CPU instead. The simulation is unaffected.':
      'Grafická karta vypadla — kreslí sa na procesore. Simulácia beží ďalej bez zmeny.',
    'No GPU rendering available here — staying in software':
      'Vykresľovanie na grafickej karte tu nie je dostupné — kreslí sa softvérovo',
    'Could not save — storage is full or blocked':
      'Nepodarilo sa uložiť — úložisko je plné alebo zablokované',
    'Could not import — storage is full or blocked':
      'Nepodarilo sa importovať — úložisko je plné alebo zablokované',
    'Could not read that file': 'Súbor sa nepodarilo načítať',
    'Nothing to export — every slot is empty': 'Nie je čo exportovať — všetky sloty sú prázdne',
    'That file has no worlds in it': 'V súbore nie sú žiadne svety',
    'Pick a slot to save into': 'Vyberte slot, do ktorého sa má uložiť',
    'Fossil carbon put back in the ground': 'Fosílny uhlík je späť pod zemou',
    'Saved to slot {0}': 'Uložené do slotu {0}',
    'Slot {0} is empty — press Save… first': 'Slot {0} je prázdny — najprv kliknite na Uložiť…',
    'Loaded slot {0} — {1}, {2} in': 'Načítaný slot {0} — {1}, čas {2}',
    'Exported {0} worlds': 'Exportovaných svetov: {0}',
    'Back to {0} — change something, then press play': 'Späť na {0} — niečo zmeňte a spustite',
    'Settled at {0}': 'Ustálené po {0}',
    'Marked “{0}” at {1}': 'Míľnik „{0}“ v čase {1}',
    'New climate discovered — {0}': 'Objavená nová klíma — {0}',
    'Time acceleration runs from {0} to {1} per second': 'Zrýchlenie času je od {0} do {1} za sekundu',
    '{0} limited to {1}': '{0} — obmedzené na {1}',
    'Abandon scenario': 'Ukončiť scenár',
    '✓ Complete — {0} elapsed': '✓ Splnené — za {0}',
    '✕ Failed — {0} elapsed. Reset to try again.': '✕ Nesplnené — po {0}. Reštartujte a skúste znova.',
    '{0} / {1} — in progress': '{0} / {1} — prebieha',
    'after “{0}”': 'po míľniku „{0}“',
    'Planet mass': 'Hmotnosť planéty',
    'Sets radius, gravity and how well the world holds its air.':
      'Určuje polomer, gravitáciu a to, ako dobre planéta udrží atmosféru.',
    'Water inventory ': 'Zásoba vody ',
    '1 EO = one Earth ocean. Tracks what is left as the planet loses water.':
      '1 EO = jeden pozemský oceán. Ukazuje, koľko vody planéte ešte zostáva.',
    'Basin geometry': 'Tvar panví',
    'How much of this world would stand above the sea at Earth-like water. Actual coverage is worked out from the water it really has — see the readout.':
      'Koľko povrchu by bolo nad vodou pri pozemskom množstve vody. Skutočné pokrytie sa počíta z vody, ktorú planéta naozaj má — nájdete ho v údajoch.',
    'Starlight received': 'Žiarenie hviezdy',
    'Relative to Earth. 1 S⊕ = 1361 W/m². Four decades wide because real bodies are: Titan gets 0.011 and GJ 1132 b takes 18.8, and a slider that ran 0.05 to 4 could not represent three of the worlds shipped with it.':
      'Vzhľadom na Zem, 1 S⊕ = 1361 W/m². Rozsah je štyri rády, lebo toľko pokrývajú skutočné telesá: Titan dostáva 0,011 a GJ 1132 b až 18,8. Posuvník od 0,05 do 4 by tri z hotových svetov nezobrazil.',
    'The star brightens by 10% every billion years, and the control follows it. The Sun’s real track is 7.4%/Gyr averaged over its life.':
      'Hviezda každú miliardu rokov zjasnie o 10 % a posuvník sa posúva s ňou. Slnko v skutočnosti jasnie v priemere o 7,4 % za miliardu rokov.',
    'The star brightens by 10% every billion years, and the control follows it. The Sun\'s real track is 7.4%/Gyr averaged over its life.':
      'Hviezda každú miliardu rokov zjasnie o 10 % a posuvník sa posúva s ňou. Slnko v skutočnosti jasnie v priemere o 7,4 % za miliardu rokov.',
    'brightening star': 'jasnejúca hviezda',
    'star spins down': 'hviezda spomaľuje',
    'A young star is magnetically saturated — its dynamo is running flat out and the ratio cannot climb further however fast it spins — and only starts to calm down once it has spun down. How long that takes belongs to the star: a tenth of a billion years for the Sun, one and a half for a late M dwarf. Off, the star never calms down, which is roughly a flare star that stayed young.':
      'Mladá hviezda je magneticky nasýtená — jej dynamo beží naplno a aktivita už nemôže rásť, nech sa točí akokoľvek rýchlo. Upokojovať sa začne, až keď sa jej rotácia spomalí. Ako dlho to trvá, závisí od hviezdy: pri Slnku desatinu miliardy rokov, pri neskorom červenom trpaslíkovi poldruha miliardy. Keď je to vypnuté, hviezda sa nikdy neupokojí — zhruba ako eruptívna hviezda, ktorá zostala mladá.',
    'The star now calms down as it ages — saturated first, then Ribas t⁻¹·²³':
      'Hviezda sa s vekom upokojuje — najprv nasýtená, potom podľa Ribasa t⁻¹·²³',
    'The star stays as active as it is now, for as long as you run it':
      'Hviezda zostane taká aktívna ako teraz, počas celého behu',
    'Move this control and the star walks to the new value instead of jumping to it. A jump can throw a world across a threshold that the same change made gradually would carry it along — the difference between a 63 °C ocean and a 576 °C steam greenhouse.':
      'Hviezda sa k novej hodnote dostane postupne, nie skokom. Skok môže svet prehodiť cez prah, cez ktorý by ho rovnaká, ale pozvoľná zmena bezpečne previedla — je to rozdiel medzi oceánom s teplotou 63 °C a parným skleníkom s 576 °C.',
    'smooth changes': 'plynulé zmeny',
    'Star temperature': 'Teplota hviezdy',
    'Stellar XUV activity': 'XUV aktivita hviezdy',
    'Drives hydrogen escape. Young suns and red dwarfs are 100–1000× more active.':
      'Poháňa únik vodíka. Mladé hviezdy podobné Slnku a červení trpaslíci sú 100–1000× aktívnejší.',
    'Rotation period': 'Doba rotácie',
    'Slow rotators grow a thick reflective cloud deck and move heat much more freely. Rotation alone does not make a world synchronous — Venus turns once every 243 days and still sees the sun everywhere. Use the tidal-lock switch for that.':
      'Pomaly rotujúce planéty majú hrubú vrstvu oblakov, ktorá dobre odráža svetlo, a teplo sa po nich rozvádza oveľa ľahšie. Pomalá rotácia však ešte nie je viazaná rotácia — Venuša sa otočí raz za 243 dní a Slnko aj tak svieti na každú jej stranu. Na to slúži prepínač viazanej rotácie.',
    'Axial tilt': 'Sklon osi',
    'Nitrogen & argon': 'Dusík a argón',
    'The gas that neither condenses nor absorbs: 0.78 bar of it on Earth. Radiatively inert, but it broadens everything else’s absorption lines.':
      'Plyn, ktorý nekondenzuje ani nepohlcuje žiarenie: na Zemi ho je 0,78 baru. Sám nehreje, ale rozširuje absorpčné čiary ostatných plynov.',
    'Oxygen': 'Kyslík',
    'Made by life, consumed by volcanic gases and by weathering rock. Set the biosphere below the volcanoes and it stays at nothing however long you wait — that threshold is the Great Oxidation.':
      'Vyrába ho život, spotrebúvajú ho sopečné plyny a zvetrávanie hornín. Ak je biosféra slabšia než sopky, kyslík zostane na nule, nech čakáte akokoľvek dlho — tento prah je Veľká oxidačná udalosť.',
    'anoxic': 'bez kyslíka',
    'Carbon dioxide': 'Oxid uhličitý',
    'Evolves on its own: volcanoes add it, weathering removes it, cold traps freeze it out.':
      'Mení sa sám: sopky ho pridávajú, zvetrávanie odoberá a v chladných pascách vymŕza.',
    'Methane': 'Metán',
    'What is in the air now, not what stays. Life makes most of it and the interior a little; oxygen cuts its life from twelve thousand years to ten, so an oxygenated world holds almost none.':
      'Koľko ho je v ovzduší práve teraz, nie koľko tam vydrží. Väčšinu vyrába život, trochu vnútro planéty; kyslík mu skráti životnosť z dvanástich tisíc rokov na desať, takže okysličený svet ho nemá takmer vôbec.',
    'Ground brightness': 'Jas povrchu',
    'Dark basalt 0.10 · rock 0.25 · bright sand 0.40':
      'Tmavý bazalt 0,10 · hornina 0,25 · svetlý piesok 0,40',
    'Photosynthetic biosphere': 'Fotosyntetická biosféra',
    'How hard photosynthesis runs — what you are asking for. What the planet can actually support is below, and past about 73 °C it is nothing: that is where the photosystems come apart and no phototroph on Earth lives above it.':
      'Ako intenzívne beží fotosyntéza — teda koľko chcete. Koľko planéta naozaj unesie, je nižšie; nad zhruba 73 °C nič, lebo tam sa rozpadajú fotosystémy a žiadny pozemský fotosyntetizujúci organizmus pri vyššej teplote nežije.',
    'alive': 'nažive',
    'Industrial CO₂': 'Priemyselné emisie CO₂',
    'Burning fossil carbon: 40 Gt of CO₂ a year at 1×, some forty times every volcano on the planet. It runs on a finite reserve — about 5000 Gt of carbon, four and a half centuries at today’s rate — and then stops on its own.':
      'Spaľovanie fosílnych palív: 40 Gt CO₂ ročne pri 1×, asi štyridsaťkrát viac, než vypustia všetky sopky planéty. Zásoby sú konečné — asi 5000 Gt uhlíka, pri dnešnom tempe na štyri a pol storočia — a potom sa spaľovanie samo zastaví.',
    'Refill': 'Doplniť',
    'Put the fossil carbon back in the ground': 'Vrátiť fosílny uhlík pod zem',
    'Ignore the reserve and keep burning for ever. Not how a planet works — but a fair thing to ask.':
      'Ignorovať zásoby a spaľovať donekonečna. Skutočná planéta takto nefunguje, ale vyskúšať sa to dá.',
    'Radiogenic, primordial and — the one that can dominate — tidal. Past about 282 W/m² it boils an ocean on its own, with no help from the star. The buttons set this <em>and</em> the volcanism below, because on a real body the two are not independent.':
      'Rádiogénne, zvyškové teplo zo vzniku planéty a — to môže prevládnuť — slapové. Nad približne 282 W/m² samo vyvarí oceán, bez pomoci hviezdy. Tlačidlá nastavujú toto teplo <em>aj</em> vulkanizmus nižšie, lebo na skutočnom telese spolu súvisia.',
    'realistic decay': 'realistický pokles',
    'Uranium, thorium and potassium decay, the interior cools, and volcanism slows with it. The volcanic outgassing control follows automatically through melt production.':
      'Urán, tórium a draslík sa rozpadajú, vnútro chladne a vulkanizmus s ním slabne. Odplyňovanie sa prispôsobí samo, podľa množstva taveniny.',
    'Magnetic field': 'Magnetické pole',
    'A dynamo puts a magnetopause between the atmosphere and the solar wind. Earth’s sits ten radii out, so a hundredth of the wind gets through; with no field at all the wind reaches the top of the air and sputters it away ion by ion. That is what emptied Mars. Under realistic decay it goes out when the core stops convecting — half a billion years for Mars, eight for Earth.':
      'Dynamo vytvorí medzi atmosférou a slnečným vetrom magnetopauzu. Zemská je desať polomerov Zeme ďaleko, takže sa dnu dostane len stotina vetra; bez poľa vietor dopadá priamo na vrch atmosféry a odprašuje ju ión po ióne. Presne tak prišiel o vzduch Mars. Pri realistickom poklese pole zanikne, keď v jadre ustane prúdenie — na Marse po pol miliarde rokov, na Zemi po ôsmich miliardách.',
    'A resurfacing event: the whole mantle’s worth of carbon, all at once. Venus repaved about 80% of itself around 700 Myr ago.':
      'Obnova povrchu: všetok uhlík z plášťa naraz. Venuša si takto asi pred 700 miliónmi rokov prekryla zhruba 80 % povrchu.',
    'A resurfacing event: the whole mantle\'s worth of carbon, all at once. Venus repaved about 80% of itself around 700 Myr ago.':
      'Obnova povrchu: všetok uhlík z plášťa naraz. Venuša si takto asi pred 700 miliónmi rokov prekryla zhruba 80 % povrchu.',
    'resurfacing event': 'obnova povrchu',
    'Resurfacing after': 'Obnova povrchu po',
    'When the mantle turns over and everything dissolved in it comes up at once. Counted from <em>the start of the run</em>, not from the planet’s formation — so it is always ahead of you and never behind. Venus’s repaving is dated to roughly 700 Myr ago, an age of 3.85 Gyr; Early Venus starts at an age of 1.67, which is why that preset asks for 2.18 from its own start.':
      'Kedy sa plášť premieša a všetko, čo je v ňom rozpustené, sa naraz dostane na povrch. Počíta sa od <em>začiatku behu</em>, nie od vzniku planéty — takže je vždy pred vami, nie za vami. Obnova povrchu Venuše sa datuje asi 700 miliónov rokov do minulosti, teda do veku 3,85 mld. rokov; Mladá Venuša začína vo veku 1,67, preto má tento svet nastavených 2,18 od svojho začiatku.',
    'Resurfacing size': 'Sila obnovy povrchu',
    'How much it multiplies volcanic outgassing by at its peak. Shaped as a smooth pulse so nothing in the solver meets a step change.':
      'Koľkokrát vo vrchole zosilní odplyňovanie. Priebeh je plynulý, aby v riešiči nevznikol skok.',
    'Age at start': 'Vek na začiatku',
    'How old the planet already is when the clock starts — so a preset set in the deep past begins part-way along its own life rather than at the beginning of it. This is what the elapsed clock counts on from, and what the resurfacing age below is measured against. The solar system is 4.567 Gyr old.':
      'Koľko rokov má planéta, keď sa spustí čas — svet z dávnej minulosti tak nezačína na začiatku svojho života, ale niekde v jeho priebehu. Od tohto veku sa počíta uplynutý čas a k nemu sa vzťahuje aj vek obnovy povrchu nižšie. Slnečná sústava má 4,567 mld. rokov.',
    'Volcanic outgassing': 'Sopečné odplyňovanie',
    'The CO₂ source, and a trickle of abiotic methane. Your one lever inside a snowball — and enough of it holds a world anoxic against its own biosphere. Scaled by internal heat: melt production is what carries dissolved CO₂ up, so a hot interior erupts more.':
      'Zdroj CO₂ a trochy abiotického metánu. V snehovej guli je to jediné, čím môžete pohnúť — a dosť silné odplyňovanie udrží svet bez kyslíka aj napriek jeho biosfére. Závisí od vnútorného tepla: rozpustený CO₂ vynáša nahor tavenina, takže horúcejšie vnútro chrlí viac.',
    'Never run out of mantle carbon. Not how a planet works — but a fair thing to ask.':
      'Uhlík v plášti sa nikdy neminie. Skutočná planéta takto nefunguje, ale vyskúšať sa to dá.',
    'bottomless mantle': 'nevyčerpateľný plášť',
    'The simulation moves this one on its own': 'Túto hodnotu mení aj simulácia',
    '{0} value, type to set exactly': '{0} — môžete zadať presne',
    'auto': 'auto',
    'empty': 'prázdny',
    'Kept up to date on its own, every 30 s and when you leave the page.':
      'Ukladá sa sám, každých 30 s a pri odchode zo stránky.',
    'Slot {0} is empty': 'Slot {0} je prázdny',
    '{0} — {1} elapsed, saved {2}': '{0} — čas {1}, uložené {2}',
    'real surface map': 'skutočná mapa povrchu',
    'Not yet discovered — build a world that reaches this state.':
      'Ešte neobjavené — postavte svet, ktorý sa do tohto stavu dostane.',
    'no atmosphere': 'bez atmosféry',
    'nitrogen and argon: the gas that neither condenses nor absorbs':
      'dusík a argón: nekondenzujú a žiarenie nepohlcujú',
    'carbon dioxide': 'oxid uhličitý',
    'water vapour': 'vodná para',
    'water past its critical point: neither liquid nor gas':
      'voda za kritickým bodom: ani kvapalina, ani plyn',
    'free oxygen: made by life, or left behind when a lost ocean’s hydrogen escaped':
      'voľný kyslík: od života, alebo zvyšok po oceáne, z ktorého unikol vodík',
    'methane': 'metán',
    'prokaryotes': 'prokaryoty',
    'eukaryotes': 'eukaryoty',
    'traces': 'stopy',
    '{0}% of the surface': '{0} % povrchu',
    'Cells without a nucleus. Liquid water and an electron donor is the whole requirement: −20 °C to 122 °C, no oxygen needed, no light needed.':
      'Bunky bez jadra. Stačí im tekutá voda a zdroj elektrónov: od −20 °C do 122 °C, bez kyslíka aj bez svetla.',
    'Cells with a nucleus and mitochondria, so: aerobes. They need free oxygen — a percent or so of Earth’s is enough — and they give out around 60 °C, far short of what a bacterium will take.':
      'Bunky s jadrom a mitochondriami, teda organizmy dýchajúce kyslík. Potrebujú voľný kyslík — stačí asi percento zemského — a nad 60 °C hynú, ďaleko pod tým, čo vydrží baktéria.',
    'Software rendering — drawn on the CPU. The simulation is unaffected.':
      'Softvérové vykresľovanie na procesore. Simulácia beží bez zmeny.',
    'WebGL1, as requested — the same shaders at full detail.':
      'WebGL1 podľa voľby — rovnaké shadery v plných detailoch.',
    'WebGL2 unavailable — drawing with WebGL1, at full detail.':
      'WebGL2 nie je k dispozícii — kreslí sa cez WebGL1 v plných detailoch.',
    'Type a rate: 500 yr, 2 Myr, 1.5 Gyr. Per second is assumed.':
      'Zadajte rýchlosť: 500 yr, 2 Myr, 1.5 Gyr (za sekundu).',
    'Auto-ease is holding the clock back so this tipping can be watched — {0} / s was asked for. Turn off "ease" to run at full speed.':
      'Automatické spomalenie brzdí čas, aby bolo vidieť zlom klímy — nastavené je {0} / s. Plnou rýchlosťou to pôjde po vypnutí „spomaliť“.',
    'Marked at {0} elapsed': 'Označené v čase {0}',
    'a year a second — watch the industrial era': 'rok za sekundu — priemyselná éra',
    'a decade a second': 'desaťročie za sekundu',
    'a century a second — the whole fossil burn in a minute':
      'storočie za sekundu — všetky fosílne palivá spálené za minútu',
    'a thousand years a second': 'tisíc rokov za sekundu',
    'glacial cycles, and the long thaw after a carbon spike':
      'doby ľadové a dlhé doznievanie uhlíkového výkyvu',
    'a hundred thousand a second': 'stotisíc rokov za sekundu',
    'half a million a second': 'pol milióna rokov za sekundu',
    'the carbonate-silicate thermostat works on this timescale':
      'v tomto tempe pracuje uhličitanovo-kremičitanový termostat',
    'five million a second': 'päť miliónov rokov za sekundu',
    'ice sheets, cold traps, the slow drift of a climate':
      'ľadovcové štíty, chladné pasce, pomalé zmeny klímy',
    'twenty-five million a second': 'dvadsaťpäť miliónov rokov za sekundu',
    'a whole geological era every couple of seconds': 'celá geologická éra za pár sekúnd',
    'a continent’s worth of time per second': 'presun kontinentov každú sekundu',
    'a galactic year a second': 'galaktický rok za sekundu',
    'the fastest this goes — a planet’s whole life in ten seconds':
      'najvyššia rýchlosť — celý život planéty za desať sekúnd',
    'dry': 'sucho',
    'none': 'nič',
    'dead': 'bez života',
    'ocean world': 'oceánsky svet',
    'Early Venus': 'Mladá Venuša',
    'Noachian Mars': 'Mars v noachiu',
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
    '10% PAL': '10 % dnešného O₂',
    'locked': 'viazaná',
    'tidally locked': 'viazaná rotácia',
    'Radiogenic only, and volcanically dead for a billion years.':
      'Len rádiogénne teplo; sopečne mŕtvy už miliardu rokov.',
    'Heat modelled, never measured — the InSight mole never got deep enough. The outgassing is higher than Mars’s lava alone would justify because here it has to stand in for everything that puts CO₂ back into that atmosphere: the seasonal polar caps and the regolith, which are what actually hold Mars at six millibars against a solar wind that would otherwise take the lot.':
      'Teplo je len vymodelované, nikdy nebolo zmerané — „krtko“ sondy InSight sa nedostal dosť hlboko. Odplyňovanie je vyššie, než by zodpovedalo samotnej láve, lebo tu zastupuje všetko, čo vracia CO₂ do atmosféry: sezónne polárne čiapočky a regolit. Práve tie držia na Marse tlak šesť milibarov proti slnečnému vetru, ktorý by inak odniesol všetko.',
    'A third of Earth’s heat under a stagnant lid, but geologically active with it.':
      'Tretina zemského tepla pod nehybnou litosférou, a predsa geologicky aktívna.',
    'Tidal, and about 39 mW/m² at the seafloor. Cryovolcanism moves water, not carbon.':
      'Slapové, asi 39 mW/m² na morskom dne. Kryovulkanizmus vynáša vodu, nie uhlík.',
    '47 ± 2 TW over the globe. Everything else on this row is measured against it.':
      '47 ± 2 TW na celú planétu. Ostatné hodnoty v tomto riadku sú porovnané s ňou.',
    'South-polar, not global — the rest of the moon is nothing like this warm.':
      'Len okolo južného pólu — zvyšok mesiaca ani zďaleka nie je taký teplý.',
    'The most volcanically active body known. What it erupts is sulphur, not CO₂.':
      'Sopečne najaktívnejšie známe teleso. Chrlí síru, nie CO₂.',
    'Twice Io’s tidal flux. Its mantle sits above the rock solidus: partially molten.':
      'Dvojnásobok slapového toku Io. Plášť je nad solidom horniny, teda čiastočne roztavený.',
    'A thousand times Earth’s, from an eccentricity of 0.01. Magma ocean tens of metres down.':
      'Tisícnásobok zemského, pri excentricite len 0,01. Magmatický oceán pár desiatok metrov pod povrchom.',
  },

  // ---- klimatické stavy ----------------------------------------------------
  states: {
    magma: { name: 'Magmatický oceán',
      blurb: 'Povrch je roztavená hornina. Nad asi 1400 K sa kremičitany tavia a planéta žiari v blízkej infračervenej oblasti; ak má atmosféru, je to horúca zmes pár hornín a vodnej pary.' },
    dryRunaway: { name: 'Suchý nekontrolovateľný skleníkový efekt',
      blurb: 'Venuša. Oceán je preč — vyparil sa, svetlo ho rozložilo a vodík sa stratil vo vesmíre. Zostala hustá suchá atmosféra CO₂ nad povrchom takým horúcim, že slabo žiari. V ľudskej časovej mierke nezvratné.' },
    wetRunaway: { name: 'Vlhký nekontrolovateľný skleníkový efekt',
      blurb: 'Pohltené svetlo hviezdy spolu s vnútorným teplom planéty prekročilo Simpsonovu–Nakajimovu hranicu (~282 W/m²), takže planéta nemá rovnovážnu teplotu. Dokáže to aj samotné slapové teplo na svete, ktorý by hviezda nechala obývateľný (Barnes a kol. 2013). Oceán sa vyvára do mohutnej parnej atmosféry; kvôli skupenskému teplu to trvá asi 10⁵ rokov a strata vody ďalších 10⁸–10⁹ rokov.' },
    moist: { name: 'Vlhký skleník',
      blurb: 'Voda je stále tekutá, ale chladná pasca zlyhala: v stratosfére je viac než 10⁻³ vody a vodík plynule uniká. Nakrátko obývateľný svet, ktorý však za stovky miliónov rokov vyschne (Kasting 1988).' },
    hothouse: { name: 'Skleník bez ľadu',
      blurb: 'Nikde nie je trvalý ľad a trópy sú na hranici toho, čo zložitý život znesie. Takto vyzerala Zem v kriede a počas teplotného maxima na prelome paleocénu a eocénu.' },
    temperate: { name: 'Mierny a obývateľný',
      blurb: 'Tekutá voda na väčšine povrchu a stabilný ľad na póloch. Uhličitanovo-kremičitanový termostat tento stav udržiava proti pomalým zmenám žiarenia hviezdy, v mierke asi milióna rokov.' },
    dune: { name: 'Púštny svet',
      blurb: 'Suchá planéta s minimom vody na povrchu. Nenasýtený vzduch dovoľuje trópom vyžarovať nad klasickú hranicu nekontrolovateľného skleníkového efektu a suchá stratosféra brzdí únik vody — preto púštne svety zostávajú obývateľné oveľa bližšie k hviezde než oceánske (Abe a kol. 2011).' },
    waterworld: { name: 'Oceánsky svet',
      blurb: 'Globálny oceán bez pevniny. Kontinentálne zvetrávanie chýba, ale morská voda stále preteká čerstvým bazaltom v oceánskych chrbtoch a ukladá v ňom uhlík, takže termostat funguje — slabšie, pomalšie a s rovnováhou pri vyššej teplote a vyššom obsahu CO₂ než na svete s kontinentmi.' },
    eyeball: { name: 'Očná guľa',
      blurb: 'Viazaná rotácia: pod hviezdou je otvorený oceán, všade inde trvalý ľad. Hustá oblačnosť nad podhviezdnym bodom odráža toľko svetla, že takéto svety zostávajú obývateľné takmer až do dvojnásobku zemského ožiarenia (Yang a kol. 2014).' },
    lobster: { name: 'Homár',
      blurb: 'Očná guľa, ktorej otvorenú vodu roztiahli oceánske prúdy pozdĺž rovníka — teplé „klepetá“ siahajú okolo planéty smerom k nočnej strane.' },
    twilight: { name: 'Súmračný svet',
      blurb: 'Podhviezdna strana je rozpálená, nočná ľadová a pozdĺž terminátora sa okolo celej planéty tiahne mierny pás tekutej vody. Funguje to len preto, že vody je málo a teplo neroznesie: vlhkejší svet by od podhviezdneho bodu odviedol dosť skupenského tepla na vyrovnanie teplôt a potom by celý prekročil hranicu nekontrolovateľného skleníkového efektu, namiesto toho, aby mu zostal obývateľný pás (Lobo a kol. 2023).' },
    trapped: { name: 'Púšť s vodou na nočnej strane',
      blurb: 'Na svete s viazanou rotáciou je nočná strana trvalou chladnou pascou. Všetka voda sa tam presunula a zamrzla na ľadovce, a na dennej strane zostala vyprahnutá púšť, ktorá ju už späť nedostane.' },
    waterbelt: { name: 'Vodný pás',
      blurb: 'Ľad siaha hlboko do trópov, ale úzky pás otvoreného oceánu okolo rovníka prežíva. Skutočne stabilný stav a oveľa miernejší než úplná snehová guľa.' },
    snowball: { name: 'Snehová guľa',
      blurb: 'Spätná väzba medzi ľadom a albedom zamrazila planétu od pólu po pól. Zvetrávanie sa zastavilo, takže sopečný CO₂ sa 5–50 miliónov rokov hromadí bez odberu, kým ľad napokon neroztopí 0,1–0,3 baru.' },
    marslike: { name: 'Kolaps atmosféry ako na Marse',
      blurb: 'Samotná atmosféra vymrzla na povrch. Pod bodom mrazu CO₂ kondenzuje na zimnom póle rýchlejšie, než ho sopky dopĺňajú, a tlak klesá, kým sa zvyšok nevyrovná s polárnymi čiapočkami. Dá sa to zvrátiť: dosť silné odplyňovanie atmosféru zahustí, póly sa zohrejú nad bod mrazu a vzduch sa vráti.' },
    nightfrost: { name: 'Čiastočné vymŕzanie na nočnej strane',
      blurb: 'Atmosféra sneží na nočnú stranu. Svet s viazanou rotáciou má pologuľu, ktorá hviezdu nikdy nevidí, a keď tam teplota klesne pod bod mrazu CO₂, vzduch tam natrvalo kondenzuje — na rozdiel od Marsu ho nevráti žiadne ročné obdobie. Tlak klesá, kým sa zvyšok nevyrovná s námrazou na nočnej strane; denná strana pritom zostáva teplá, vlhká a obývateľná. Pod hviezdou je fungujúci oceán a za chrbtom planéte pomaly mizne atmosféra. Oceán k tomuto stavu patrí: keď sa minie aj posledná voda, vymrznutie je úplné a svet prejde do stavu Vymrznutá nočná strana. Zastaviť to môže prenos tepla — dosť hustý vzduch prinesie na nočnú stranu toľko tepla, že tam teplota neklesne pod bod mrazu. Pri hustej atmosfére sa proces sám zastaví, pri riedkej je to pasca (Joshi a kol. 1997; Wordsworth 2015; Turbet a kol. 2018 pre TRAPPIST-1).' },
    nightfrozen: { name: 'Vymrznutá nočná strana',
      blurb: 'Vymrznutie je dokončené. Väčšina atmosféry leží ako suchý ľad na pologuli, ktorá hviezdu nikdy nevidí, a voda, ak nejaká je, zamrzla vedľa nej. Tekutá voda nie je nikde na planéte a denná strana je holá púšť pod tenkým zvyškom vzduchu. Je to ten istý proces ako čiastočné vymŕzanie, len dotiahnutý do konca: kým má svet oceán, je obývateľný a len pomaly stráca vzduch. Na rozdiel od púšte s vodou na nočnej strane sa tu nepresunula len voda, ale celá atmosféra.' },
    titan: { name: 'Svet ako Titan',
      blurb: 'Mrazivý svet pod hustým dusíkovo-metánovým oparom — na tekutú vodu príliš studený, ale dosť teplý na to, aby po povrchu tiekli iné kvapaliny.' },
    frozen: { name: 'Zamrznutá púšť',
      blurb: 'Chladno, sucho a ticho. Primálo vody na skutočnú snehovú guľu a primálo skleníkových plynov na roztopenie.' },
    thincold: { name: 'Riedka studená púšť',
      blurb: 'Riedka, mrazivá a suchá atmosféra nad holou zemou — dnešný Mars. Vzduch neskolaboval, jednoducho ho viac nie je. Pridajte sopky a atmosféra zhustne, oteplí sa a napokon znova udrží tekutú vodu.' },
    baked: { name: 'Vyprahnutá púšť',
      blurb: 'Horúci svet z holej horniny bez vody. Ak vodu niekedy mal, dávno je preč, takže teplotu nemá čo tlmiť a denná strana sa jednoducho pečie.' },
    airless: { name: 'Holá skala',
      blurb: 'Planéta za hranicou, kde sa ešte dá udržať atmosféra: XUV žiarenie hviezdy strhávalo vzduch rýchlejšie, než ho gravitácia dokázala udržať. O klíme sa tu nedá hovoriť.' },
  },

  // ---- scenáre -------------------------------------------------------------
  scenarios: {
    thaw: {
      name: 'Prelomiť snehovú guľu',
      brief: 'Planéta je zamrznutá od pólu po pól, ľad odráža takmer všetko svetlo späť do vesmíru a sopky utíchli. Do ovzdušia nepribúda žiadny uhlík a ani nepribudne, ak ho tam nedostanete vy. Vráťte na povrch tekutú vodu.',
      hint: 'V snehovej guli sú sopky jediné, čím môžete pohnúť: zvetrávanie potrebuje tekutú vodu, takže keď ľad siaha až po rovník, CO₂ nič neodoberá a každý vyvrhnutý gram zostane v ovzduší. Zvýšte odplyňovanie a nechajte bežať čas.',
    },
    hold: {
      name: 'Zadržať prehriatie',
      brief: 'Svet šesť wattov na meter štvorcový pod Simpsonovou–Nakajimovou hranicou — obývateľný, ale bez akejkoľvek rezervy. Jeho hviezda je ťažšia než Slnko a spaľuje vodík trikrát rýchlejšie, takže sa rezerva zmenšuje sama a nezastaví sa. Udržte planétu obývateľnú miliardu rokov.',
      hint: 'Hviezdu nestlmíte ani nezastavíte jej zjasňovanie. Môžete jej však vziať skleníkový efekt: odstráňte CO₂ a držte ho na nule, lebo 2,5-násobný vulkanizmus ho vracia. Ak to prestane stačiť, pamätajte, že hranica je daná tým, koľko svetla planéta pohltí oproti tomu, koľko atmosféra dokáže vyžiariť — zosvetlite povrch a suchšia planéta vyžaruje lepšie než vlhká.',
    },
    terraform: {
      name: 'Terraformovať studenú púšť',
      brief: 'Malý, studený svet s riedkym vzduchom a trochou ľadu pod povrchom. Dajte mu tekutú vodu na povrchu.',
      hint: 'Pri nízkej gravitácii dá každý kilogram plynu menší tlak. Budete potrebovať veľa CO₂ — a dosť vody v zásobe, aby oceán vôbec mohol vzniknúť.',
    },
    eyeball: {
      name: 'Oko červeného trpaslíka',
      brief: 'Svet s viazanou rotáciou, navždy natočený k aktívnemu červenému trpaslíkovi. Jedna pologuľa horí, druhá je chladná pasca, ktorá kradne vodu a už ju nevráti. Udržte pod hviezdou otvorený oceán miliardu rokov.',
      hint: 'Hustý vzduch prenáša teplo na nočnú stranu a nedovolí, aby sa tam voda natrvalo presunula. Sledujte XUV — aktívny červený trpaslík odstraňuje vodu rýchlo.',
    },
    dune: {
      name: 'Postaviť púštny svet',
      brief: 'Umiestnite obývateľnú planétu tam, kde by oceánsky svet zovrel. Púštne planéty prežijú oveľa bližšie k hviezde: nenasýtený vzduch vyžaruje nad klasickou hranicou nekontrolovateľného skleníkového efektu a suchá stratosféra brzdí únik vody.',
      hint: 'Proti intuícii, ale je to tak (Abe a kol. 2011): dajte planéte *menej* vody. Samotné vysušenie však nestačí — v hlbokých panvách ako na Zemi sa aj zvyšok vody rozleje do širokých plytkých morí a vzduch zostane vlhký. Zvýšte aj tvar panví, aby zvyšná voda nemala kam tiecť.',
    },
    oxidation: {
      name: 'Veľká oxidačná udalosť',
      brief: 'Archaický svet bez kyslíka, nad bodom mrazu ho drží milibar metánu. Vaše sinice práve zvládli kyslíkovú fotosyntézu a šíria sa samy — a kyslík s metánom spolu nevydržia. Nedovoľte, aby planéta zamrzla, kým sa okysličí.',
      hint: 'Biosféru nezastavíte: každých pár miliónov rokov sa zdvojnásobí, nech robíte čokoľvek, a pri asi 0,4-násobku Zeme prekoná tok sopečných redukovadiel. Potom kyslík skráti životnosť metánu z desiatich tisíc rokov na desať — a milibar metánu hreje asi pätnástimi wattmi na meter štvorcový. Nahraďte tento skleníkový efekt oxidom uhličitým *skôr*, než k tomu dôjde, inak spätná väzba medzi ľadom a albedom zamrazí celú planétu — a metán, ktorý sa potom vráti, ju už neroztopí.',
    },
    venus: {
      name: 'Zvrátiť Venušu',
      brief: 'Suchý nekontrolovateľný skleníkový efekt: 90 barov CO₂, 460 °C a voda dávno rozložená svetlom a stratená. Ochlaďte planétu pod bod varu.',
      hint: 'Voda je preč a nevráti sa — ale posuvník zásoby vody máte v rukách vy. Pochovajte CO₂ a dajte termostatu zvetrávania s čím pracovať.',
    },
    hotbranch: {
      name: 'Horúci oceán',
      brief: 'Svet s plným oceánom pod hviezdou, ktorú ovládate vy. Nad 50 °C existuje stabilná klíma — more, ktoré zostane morom pri teplote horúceho kúpeľa —, ale dostať sa k nej dá len pomaly a úzkymi dverami. Dostaňte planétu nad 50 °C s oceánom, ktorý bude na mieste ešte o šesťdesiat miliónov rokov.',
      hint: 'Plynulé zmeny žiarenia sú už zapnuté, takže jedno potiahnutie posúva hviezdu nahor dvadsať miliónov rokov, nie skokom — najprv však nechajte bežať čas, lebo zmena v čase t = 0 stále skočí. 1,30 S⊕ nestačí a zastaví sa pri 40 °C. 1,36 sú tie dvere. 1,40 nimi prejde a nezastaví sa, a akýkoľvek cieľ dosiahnutý jedným skokom vyparí oceán do atmosféry, albedo s ním, a cesta späť neexistuje.',
    },
  },

  // ---- hotové svety --------------------------------------------------------
  presets: {
    earth: 'Zem',
    moon: 'Mesiac',
    earlyMoon: 'Dávny Mesiac',
    preindustrial: 'Zem pred priemyselnou érou',
    earthlike: 'Svet podobný Zemi',
    venus: 'Venuša',
    mars: 'Mars',
    earlyEarth: 'Archaikum',
    earlyVenus: 'Mladá Venuša',
    dryVenus: 'Vždy suchá Venuša',
    earlyMars: 'Mars v noachiu',
    snowball: 'Snehová guľa',
    dune: 'Púštny svet',
    eyeball: 'Viazaná očná guľa',
    waterworld: 'Oceánsky svet',
    titan: 'Svet ako Titan',
    trappist1b: 'TRAPPIST-1b',
    earlyTrappist1b: 'TRAPPIST-1b · 1 mld. rokov',
    trappist1e: 'TRAPPIST-1e',
    earlyTrappist1e: 'TRAPPIST-1e · 1 mld. rokov',
    gj1132b: 'GJ 1132 b',
    superEarth: 'Superzem',
    futureEarth: 'Zem o miliardu rokov',
    hotCarbon: 'Horúci oceán · CO₂',
    hotStar: 'Horúci oceán · hviezda',
    brink: 'Za hranou',
  },
};
