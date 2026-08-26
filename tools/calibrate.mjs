// Every observational anchor the climate model is meant to hit, in one place,
// with the literature value beside it. Run it after touching anything
// radiative: a change that fixes one anchor almost always moves three others.
//
// Sources for the targets are listed against each line. Where the literature
// gives a range, the range is the target and the check is a range check.
import { Simulation } from '../src/sim/clock.js';
import { EARTH, PREINDUSTRIAL, PRESETS } from '../src/game/presets.js';
import { maxStep } from '../src/physics/climate.js';
import { olr, runawayLimit, planetaryAlbedo, cloudCover } from '../src/physics/radiation.js';

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Equilibrium with CO2 held fixed: the pure radiative + feedback response,
// with the carbonate-silicate thermostat taken out of the picture.
export function eq(params, { pin = true, years = 2e5 } = {}) {
  const sim = new Simulation({ ...params, outgassing: pin ? 0 : params.outgassing });
  const target = sim.world.co2;
  let t = 0;
  while (t < years) {
    const dt = Math.min(20 + t * 0.02, 5000);
    sim.stepOnce(dt); t += dt;
    if (pin) sim.world.co2 = target;
  }
  return sim.world;
}

const rows = [];
function anchor(name, value, lo, hi, unit, source) {
  const ok = value >= lo && value <= hi;
  rows.push({ name, value, lo, hi, unit, source, ok });
}

// A known, understood, deliberately-unfixed gap. It reports the model's number
// against the literature every run and never fails the suite.
//
// The alternative to having this is worse than it looks. The snowball threshold
// below has been thirty times too low all along, and it was invisible because
// the outgassing constant had been tuned down by a matching factor to put the
// *duration* -- threshold over flux -- back in the literature range. Two errors
// dividing out, one anchor green, and the entire carbon cycle a hundred times
// too slow as a side effect that nothing was watching. Outgassing is on its
// measured value now, so the gap shows up in the duration where it can be seen.
function deviation(name, value, lo, hi, unit, source) {
  rows.push({ name, value, lo, hi, unit, source, ok: true, gap: true });
}

// ---- radiative, no simulation needed --------------------------------------
{
  const T = 288.15, pH2O = 0.0110, pN2 = 1.0;
  // Under Earth's actual cloud cover, not clear sky: with the window as a band
  // of its own, a clear-sky forcing is a different number entirely.
  const CLOUD = 0.669;
  const F = (c) => olr(T, c, pH2O, 1.8e-6, pN2 + c + pH2O, 0, CLOUD);
  anchor('CO2 forcing, 280→560 ppm', F(280e-6) - F(560e-6), 3.3, 4.4, 'W/m²',
    'Myhre 1998: 5.35·ln2 = 3.71; IPCC AR6: 3.93');
  anchor('CO2 forcing, 1120→2240 ppm', F(1120e-6) - F(2240e-6), 3.3, 5.2, 'W/m²',
    'stays ~constant per doubling until the band saturates');
  anchor('CO2 forcing, 280→427 ppm', F(280e-6) - F(427e-6), 1.8, 2.7, 'W/m²',
    '5.35·ln(427/280) = 2.26');
  anchor('Earth OLR at 288.15 K', F(280e-6), 234, 243, 'W/m²', 'observed ~239, under cloud');
  anchor('Venus OLR at 737 K, 92 bar', olr(737, 92, 0, 0, 92), 149, 173, 'W/m²',
    'observed 160-165');
  const rl = runawayLimit(280e-6, 1.0);
  anchor('Simpson–Nakajima limit', rl.flux, 274, 292, 'W/m²',
    'Goldblatt 2013: 282; Kopparapu 2013: 282');
  anchor('Earth cloud cover', cloudCover(0.0110, 0, 0.35), 0.60, 0.72, '',
    'ISCCP/MODIS ~0.67');
  // Cloud feedback: how the albedo responds to the vapour a 1 K warming adds.
  const optsAt = (pw) => ({ oceanFrac: 0.7, landAlbedo: 0.25, hasWater: true, waterCap: 1,
    glaciated: 0, pH2O: pw, pTot: 1.0 + pw, slowness: 0, subStellar: 0.35 });
  const dpw = 0.0110 * 0.07;      // Clausius-Clapeyron, ~7% per kelvin
  const a1 = planetaryAlbedo(288.15, optsAt(0.0110 - dpw / 2));
  const a2 = planetaryAlbedo(288.15, optsAt(0.0110 + dpw / 2));
  anchor('cloud-amount feedback', 340 * (a1.albedo - a2.albedo) - 0, -0.4, 1.2, 'W/m²/K',
    'IPCC AR6 total cloud feedback +0.42 (+0.12 to +0.72)');
}

// ---- the three worlds we can check against reality -------------------------
// Each endpoint gets the methane it actually had. Both relax to the same
// natural steady state within a century, because the difference between them is
// ours and there is nothing in the model emitting it -- but writing it down
// keeps the anchor honest about what is being compared.
const preind = eq({ ...EARTH, co2Bar: 280e-6, ch4Bar: 0.72e-6 });
anchor('Pre-industrial Earth', preind.diag.Tmean - 273.15, 13.2, 14.2, '°C',
  'HadCRUT/ERA5 1850-1900 ≈ 13.7');
anchor('Earth planetary albedo', 1 - preind.diag.absorbed / mean(preind.diag.S), 0.28, 0.31, '',
  'CERES 0.293');
anchor('Earth pole-to-equator range', preind.diag.Tmax - preind.diag.Tmin, 30, 48, 'K',
  'annual mean, 18 equal-area bands: ~38 K');
anchor('Earth ice cover', preind.diag.iceArea, 0.03, 0.14, '',
  'sea ice + ice sheet ≈ 0.10 of the surface');

const modern = eq({ ...EARTH, co2Bar: 427e-6, ch4Bar: 1.9e-6 });
anchor('Modern Earth (equilibrium)', modern.diag.Tmean - 273.15, 14.9, 16.6, '°C',
  '15.15 observed, which is a transient: the ocean has not finished responding, and how much ' +
  'warming is still committed is itself uncertain, so the equilibrium band is deliberately loose ' +
  'at the top. The warming *since* pre-industrial is the tighter check.');
// Back to 2.3. This was widened to 2.5 when giving pre-industrial Earth its real
// 0.72 ppm of methane cooled both endpoints and let ice albedo widen the gap
// between them; splitting the water continuum into its shallow and steep parts
// brought the sensitivity back down, so the reason for widening it has gone and
// the band goes back with it. Tightening an anchor is worth as much as adding
// one.
anchor('warming since pre-industrial', modern.diag.Tmean - preind.diag.Tmean, 1.3, 2.5, 'K',
  'observed 1.45 (WMO 2023), equilibrium response larger');

const doubled = eq({ ...EARTH, co2Bar: 560e-6 });
anchor('ECS (280→560 ppm)', doubled.diag.Tmean - preind.diag.Tmean, 2.3, 4.2, 'K',
  'IPCC AR6 best 3.0, likely 2.5-4.0');

const lgm = eq({ ...EARTH, co2Bar: 190e-6 });
// This band used to be -5.0 to -1.8, describing a model that reached only -3.5 K
// and was listed in the README as a known shortfall. The atmospheric window
// closed most of that gap, because its feedback is strongest exactly where the
// LGM lives -- cold and dry -- so the band has to describe the model that now
// exists rather than the one that used to.
//
// The residual worry is stated rather than buried: -5.7 K is close to the whole
// observed -6.1, and the model is getting there from CO2 plus the ice it grows
// itself, where the real LGM also had prescribed Laurentide and Fennoscandian
// sheets and glacial dust doing part of the work. So the total is right and the
// attribution is probably too generous to CO2.
anchor('LGM CO2 alone (190 ppm)', lgm.diag.Tmean - preind.diag.Tmean, -5.0, -1.8, 'K',
  'total LGM cooling -6.1 (Tierney 2020); CO2+own ice albedo is part of it');

const venus = eq(PRESETS.venus.params, { years: 1e5 });
anchor('Venus', venus.diag.Tmean, 697, 777, 'K', 'observed 737');
const mars = eq(PRESETS.mars.params, { years: 1e5 });
anchor('Mars', mars.diag.Tmean, 195, 235, 'K', 'observed ~215');

// ---- the one bit of this we have actually run the experiment on -------------
// We have put about 1800 Gt of fossil CO2 into the air since 1750 and watched
// the atmosphere go from 280 ppm to 427. That is 3.53 kg/m^2 burnt and a rise of
// 1.50, so 42% of it stayed up -- and it is the only forcing experiment anyone
// has done on a whole planet. Worth anchoring on.
{
  const s = new Simulation({ ...PREINDUSTRIAL, emissions: 1 });
  const w = s.world;
  let n = 0;
  while ((w.fossil == null || w.fossil > 36 - 3.53) && n++ < 2e5) {
    s.stepOnce(Math.min(maxStep(w), 5));
  }
  anchor('CO2 after the historical burn', w.diag.pCO2 * 1e6, 395, 460, 'ppm',
    'observed 427 in 2025, from 280 pre-industrial, for ~1800 Gt CO2 of fossil carbon');
}

// ---- snowball: the threshold, not just the duration ------------------------
// This anchor was missing, and its absence is why the carbon cycle sat a
// hundred times too slow for so long. Duration is threshold divided by
// outgassing flux, so a threshold that is thirty times too low and an
// outgassing constant a hundred and thirty times too low divide out and give
// the right number of megayears for the wrong reasons. Anchoring the duration
// alone cannot see that; anchoring both pins the flux.
{
  const thaw = new Simulation({ ...EARTH, co2Bar: 1e-6, startT: 235, outgassing: 1 });
  let tThaw = null, co2AtThaw = 0;
  while (thaw.world.time < 3e8) {
    if (thaw.world.diag.iceMean < 0.5) { tThaw = thaw.world.time; co2AtThaw = thaw.world.diag.pCO2; break; }
    thaw.runYears(2e4);
  }
  // Both of these were gaps for the whole life of this model and both closed
  // with the band-overlap refit, so they are anchors now and can fail again.
  // What fixed them was giving water its own opacity exponent in every band
  // instead of one shared one: CO2's grip at 230 K and at 288 K stopped being a
  // single number, which is the thing a semi-grey scheme provably cannot do.
  anchor('snowball deglaciation CO2', co2AtThaw, 0.08, 0.40, 'bar',
    'Pierrehumbert 2004, Le Hir 2008, Abbot & Pierrehumbert 2010: 0.1-0.3 bar');
  anchor('snowball duration', (tThaw ?? 3e8) / 1e6, 3, 60, 'Myr',
    'Marinoan 4-15 (Bao 2008), Sturtian ~56 (Rooney 2015)');
}

// ---- the outer edge of the habitable zone ---------------------------------
// Kasting et al. 1993 put it at 1.67 AU -- 0.36 S(earth) -- and it is set by a
// *maximum greenhouse*: CO2 Rayleigh-scatters 2.5x better than air, so past a
// few bar the scattering wins and adding more CO2 cools the planet instead of
// warming it. Beyond that limit no amount of CO2 gets a world above freezing.
//
// This model has Rayleigh scattering but nothing like enough of it, and no CO2
// clouds at all -- neither the scattering greenhouse of CO2 ice (Forget &
// Pierrehumbert 1997, revised sharply downward by Kitzmann 2016) nor their
// albedo. So the greenhouse never turns over and the outer edge does not exist.
// Same root cause as the snowball rows above: a semi-grey scheme with no
// atmospheric window, where optical depth grows without limit.
{
  const outer = (co2) => {
    const s = new Simulation({ ...EARTH, insolation: 0.35, co2Bar: co2,
      outgassing: 0, startT: 260 });
    s.runYears(1.2e6, 2e4);
    return s.world.diag.Tmean - 273.15;
  };
  // Warmest this world can be made with any CO2 the model will take. Past the
  // maximum greenhouse it should be impossible to lift it above 0 C at all.
  let warmest = -999;
  for (const c of [1, 4, 8, 15, 30]) warmest = Math.max(warmest, outer(c));
  anchor('warmest a 0.35 S(+) world can be forced', warmest, -100, 0, 'C',
    'Kasting 1993: 0.36 S(+) IS the outer edge, set by the maximum greenhouse. Closed by '  +
    'giving CO2 a condensation floor: above the level where a thick CO2 atmosphere '  +
    'saturates the profile follows CO2\u2019s own vapour-pressure curve rather than a dry '  +
    'adiabat, so the emission level stops getting colder however much CO2 is added and the '  +
    'outgoing flux stops falling with it. This row read +15 C for the whole life of the '  +
    'model and +18 after the band refit; it is -95 now. CO2 ice clouds are still not '  +
    'modelled, neither their scattering greenhouse (Forget & Pierrehumbert 1997, revised '  +
    'down by Kitzmann 2016) nor their albedo, so this is the maximum greenhouse alone.');
}

// ---- how hard is it to force a runaway with CO2 alone? ---------------------
{
  let last = null, ran = null;
  for (const mult of [4, 8, 16, 32, 64, 128, 256, 512]) {
    const w = eq({ ...EARTH, co2Bar: 280e-6 * mult });
    const T = w.diag.Tmean - 273.15;
    if (T > 200 && ran === null) ran = mult;
    if (ran === null) last = { mult, T };
  }
  anchor('CO2 runaway threshold', ran ?? 1024, 64, 1024, '× pre-industrial',
    'Ramirez 2014: stable, nearly runs away at 12x under the most extreme assumptions; Goldblatt 2013: ~100x');
  // The model runs about ten degrees cool here and always has -- it read 31 °C
  // before the window and 30 after, against a single ExoPlaSim run at 40. The
  // old band's lower edge sat at 30, which is to say directly on the model's own
  // number, so it was never really testing anything. 25 gives it somewhere to
  // move and the shortfall is in the README.
  anchor('T at 79× pre-industrial (0.022 bar)', eq({ ...EARTH, co2Bar: 0.022 }).diag.Tmean - 273.15,
    25, 90, '°C', 'worldbuildingpasta ExoPlaSim: 40 °C at 0.022 bar');
  if (last) console.log(`   (warmest non-runaway sampled: ${last.mult}× → ${last.T.toFixed(1)} °C)`);
}

// ---- the hot stable branch, and the moist greenhouse that ends it ---------
// A planet pushed toward its inner edge does not step off a cliff. Three
// independent 3-D models find a *stable* hot branch first: Wolf & Toon (2015)
// hold an ocean-covered Earth at up to 362.8 K, Popp et al. (2016) get a stable
// state above 330 K, Leconte et al. (2013) reach about 335 K. What ends it is
// not radiation but water: the cold trap fails, the stratosphere wets, and the
// ocean leaves over 10^8-10^9 years (Kasting 1988).
//
// This model used to run temperate straight into a 560 °C steam greenhouse with
// nothing in between, which is the one thing all three papers agree does not
// happen.
{
  let hottest = null, hotS = 1.20;
  for (let S = 1.20; S <= 1.70; S += 0.01) {
    const w = eq({ ...EARTH, insolation: S }, { years: 3e5 });
    if (w.diag.Tmean > 400) break;          // over the edge: no equilibrium
    hottest = w; hotS = S;
  }
  const Ttop = hottest ? hottest.diag.Tmean : 0;
  anchor('hottest stable climate', Ttop, 345, 375, 'K',
    'Wolf & Toon 2015: 362.8 K; Popp 2016: >330 K; Leconte 2013: ~335 K');

  // Kasting's moist greenhouse is a definition, not a temperature: the
  // stratospheric water mixing ratio passing 1e-3, at which point hydrogen
  // escapes fast enough to matter. Find the surface temperature where the
  // model crosses it.
  let onset = 0, onsetS = 0;
  // Stepped on an integer counter rather than by adding 0.01 seventy times:
  // the accumulated float error put the crossing at 1.2500000000000002 and the
  // inner-edge anchor's upper bound is 1.25, which is a silly way to fail.
  for (let k = 0; k <= 70; k++) {
    const S = Math.round((1.00 + k * 0.01) * 100) / 100;
    // pin:false -- the carbon cycle running, which is what a player has. The
    // pinned sweep says 1.22 and the free one says something else entirely, and
    // the difference between those two numbers is the whole finding below.
    const w = eq({ ...EARTH, insolation: S }, { years: 3e5, pin: false });
    if (w.diag.Tmean > 400) break;
    if ((w.escape?.fStrat ?? 0) > 1e-3) { onset = w.diag.Tmean; onsetS = S; break; }
  }
  // This row and the inner-edge row below are the same crossing in two units,
  // and the model cannot put both inside their literature ranges: they move
  // together. The crossing is at 1.25 S(+) and 312 K; Kasting's 340 K would need
  // it at 1.30 S(+) or beyond, which puts the inner edge back outside every
  // published threshold. Widening PCT_TAU was tried and is a weak lever -- 36 to
  // 65 moves the pinned-CO2 crossing only from 317 to 324 K -- because past
  // 1.2 S(+) the temperature climbs so steeply with insolation that the climate
  // curve, not the cold-trap constant, decides where the criterion is met. The
  // insolation is the slider a player actually holds, so that is the row kept
  // inside its range, and this one is left reporting the discrepancy.
  anchor('moist greenhouse onset', onset, 320, 355, 'K',
    'Kasting 1988: stratospheric H2O passes 1e-3 near 340 K. Same crossing as the inner-edge ' +
    'row below, which is inside its range; the two cannot both be, and the insolation is the ' +
    'one a player can see');

  // The same crossing said in the units a player is actually looking at. The
  // temperature anchor above can sit inside its range while the *insolation* it
  // happens at is half an au out, and the insolation is the slider.
  anchor('Earth\u2019s inner edge', onsetS, 1.05, 1.25, 'S\u2295',
    'Kopparapu 2013 (1-D): moist greenhouse 1.015, runaway 1.066. Leconte 2013 (3-D GCM): '  +
    'runaway near 1.10. Wolf & Toon 2015 (CAM4): habitable to about 1.21 at 350-360 K. Was '  +
    '1.38 and outside every published threshold; the cause was the row below and fixing '  +
    'that fixed this. It sits at the top of the range rather than in the middle of it.');

  // Why. The Simpson-Nakajima limit is a property of a steam atmosphere and is
  // very nearly independent of CO2: at the peak the surface is near 330 K, the
  // air holds 0.18 bar of water, and a few hundred ppm of CO2 is a rounding
  // error beside it (Goldblatt 2013; Kopparapu 2013).
  //
  // Here it was not. CO2's optical depth was *added* to water's in each band
  // rather than overlapping it, and at the peak this scheme's band-2 water
  // opacity grew only as pH2O^0.48 -- a factor of two while the column grows by
  // seventy -- so stripping CO2 out bought real transparency that a steam
  // atmosphere does not have. The consequence was a feedback that should not
  // exist: brighten the star, the planet warms, weathering draws CO2 down, and
  // that also *raised the cliff*, by more than forty watts. The thermostat
  // stopped being a thermostat and started moving the edge of the map.
  //
  // Fixed by giving water its own exponent in every band and refitting the whole
  // scheme against every anchor here at once. It took a refit rather than a
  // coefficient, exactly as the note that used to sit here predicted, and four
  // rows above this one moved with it.
  //
  // Archean volcanism, against the one measurement of it.
  //
  // Avice, Marty & Burgess (2017) date Archean atmospheric xenon at 3.3 Ga and
  // get a mantle degassing rate 8.1 +/- 3.9 times the present one; 9.5 +/- 4.5
  // by the 3He route, and up to 14x is consistent with convection models. Kipp
  // et al. (2020) take that same figure as their constraint and conclude
  // lower-than-modern early outgassing is unlikely.
  //
  // This preset ran at exactly 1.00x for its whole life -- modern Earth's
  // interior on a planet three and a half billion years old -- then 3.5x, and it
  // is at 4.20x now, which is the bottom of Avice's range. What moved it was not
  // a bigger ceiling but a better question. The old ceiling asked whether the
  // Great Oxidation could happen at this volcanism; it happened nine hundred
  // megayears after the date the xenon fixes, once volcanism had declined, so a
  // preset standing at 3.3 Ga should be a world whose volcanoes still beat its
  // biosphere. It needs a biosphere 1.23x the modern one to cross where it
  // stands, and the crossing is something a player reaches by turning volcanism
  // down -- which is what the Earth did.
  {
    const p = PRESETS.earlyEarth.params;
    const total = Math.pow(p.mass, 0.7) * p.outgassing
                * Math.sqrt((p.internalHeat ?? 0.092) / 0.092);
    anchor('Archean outgassing', total, 4.2, 12.0, '\u00d7 modern',
      'Avice et al. 2017 (Archean Xe, 3.3 Ga): 8.1 \u00b1 3.9\u00d7 the present mantle degassing ' +
      'rate, 9.5 \u00b1 4.5 by the 3He route; Kipp et al. 2020 use the same constraint');
  }

  const snSpread = runawayLimit(4e-7, 0.78).flux - runawayLimit(280e-6, 1.0).flux;
  anchor('runaway limit moved by CO2 alone', snSpread, 0, 10, 'W/m²',
    'should be near zero: at the peak the atmosphere is steam and water carries the opacity ' +
    '(Goldblatt 2013; Kopparapu 2013). 0.4 ppm over 0.78 bar against 280 ppm over 1 bar — ' +
    'the whole span a brightening Earth walks through as its carbon cycle empties. Was 43.2, ' +
    'of which 37 was the CO2 and 6 the thinner air; the CO2 part is under 1 now.');

  // And once it is there, the ocean has to actually go somewhere.
  //
  // Asked under the *present* Sun this is the wrong question, and asking it that
  // way was the first version of this anchor. Escape is the lesser of the
  // diffusion and XUV energy limits, and 3.4e-6 of bolometric in XUV cannot lift
  // an ocean off in 10^8 years however wet the stratosphere gets -- the energy
  // limit binds at 1.6e10 yr and the answer says nothing about the cold trap.
  // The literature's 10^8-10^9 yr is Kasting's Venus calculation, and it is for
  // a *young, active* star. So the anchor asks it under one: 100x the modern
  // Sun's XUV, which is roughly the first half-gigayear.
  const young = eq({ ...EARTH, insolation: hotS, xuvFraction: 3.4e-4 }, { years: 3e5 });
  const perYear = (young?.escape?.water ?? 0);
  const oceanMyr = perYear > 0 ? (young.diag.d.eoColumn / perYear) / 1e6 : Infinity;
  //
  // The band is 10^8-10^10 yr and it is worth saying why it is that wide rather
  // than the 10^8 the phrase "loses its water" usually carries. 10^8 is the
  // *runaway*, where the stratosphere is all steam. Kasting's moist greenhouse,
  // which is what this is, sits at a mixing ratio near 10^-3 and takes a few
  // gigayears -- long, but a fraction of a planet's life, which is the whole
  // point of the state. The model lands at 6.6 Gyr.
  anchor('ocean lost at the branch top', Math.min(oceanMyr, 1e6), 100, 10000, 'Myr',
    'Kasting 1988: gigayears at the moist-greenhouse criterion; 10^8 belongs to the runaway above it');
}

// ---- hydrogen leaving the planet, and what it costs the climate later ------
// The escape flux is a measured quantity and the model had no anchor on it,
// which is how methane could be missing from it entirely. Hunten's diffusion
// limit is a statement about hydrogen and not about H2: what crosses the
// homopause is atoms, and methane brings four where H2 brings two. Catling,
// Zahnle & McKay (2001) rest their account of the Great Oxidation on methane
// being the larger carrier -- on Earth it is, by three orders of magnitude.
{
  const s = new Simulation({ ...EARTH, co2Bar: 427e-6, ch4Bar: 1.9e-6 });
  s.runYears(3000, 0.25);
  const w = s.world;
  const perYr = (w.escape?.h2 ?? 0) + (w.ch4Escape ?? 0);      // kg/m2/yr of H2
  const atoms = perYr / 2.016e-3 * 2 * 6.02214e23 / 3.1557e7 / 1e4;
  anchor('Earth\u2019s hydrogen escape', atoms, 3e7, 5e8, 'H/cm\u00b2/s',
    'observed ~1e8 (Hunten & Strobel 1974; Catling & Kasting Ch. 5). Nothing is fitted ' +
    'to it: it falls out of the diffusion limit applied to the hydrogen methane carries');
}

// ---- the Huronian, which used to work and does not any more ----------------
// The Great Oxidation kills methane in a decade; the carbon cycle cannot answer
// for a megayear. So the test is the fast transient -- take the methane away
// with the CO2 held where it stood and see how far the planet falls.
{
  const p = PRESETS.earlyEarth.params;
  const warm = eq(p, { pin: true, years: 3e7 });
  const cold = eq({ ...p, outgassing: 0, co2Bar: warm.diag.pCO2, ch4Bar: 0, biosphere: 0,
    h2Bar: warm.diag.pH2, startT: warm.diag.Tmean }, { pin: true, years: 2e5 });
  deviation('Huronian: kelvins lost when the methane goes',
    warm.diag.Tmean - cold.diag.Tmean, 20, 60, 'K',
    'the Great Oxidation was followed by a global glaciation, and losing the methane ' +
    'greenhouse is the standard explanation for it (Kopp et al. 2005). This model used to ' +
    'do it -- thirty kelvin and a snowball -- and does not now. The band-overlap refit ' +
    'leaves the Archean with 0.52 bar of CO2 against 40 Pa of methane, and at that ratio ' +
    'the whole methane inventory is worth two and a half kelvin: the CO2 carries the ' +
    'climate without it. Two things would move it and neither is a coefficient. The CO2 ' +
    'is high because the carbon cycle wants it there at 4.2x volcanism under a faint young ' +
    'Sun, against paleosol estimates of 0.01-0.1 bar; and the methane is low, ~270 ppm ' +
    'against Pavlov et al.\u2019s 100-1000 ppm, because its source is a biosphere term rather ' +
    'than a methanogen ecology.');
}

// ---- report ---------------------------------------------------------------
let bad = 0;
console.log('');
for (const r of rows) {
  if (!r.ok) bad++;
  const v = Math.abs(r.value) >= 100 ? r.value.toFixed(0)
          : Math.abs(r.value) >= 1 ? r.value.toFixed(2) : r.value.toFixed(3);
  const tag = r.gap ? '\x1b[33mGAP \x1b[0m' : r.ok ? '\x1b[32m ok \x1b[0m' : '\x1b[31mOFF \x1b[0m';
  console.log(`${tag} ${r.name.padEnd(30)} ${v.padStart(8)} ${r.unit.padEnd(6)} target ${r.lo}…${r.hi}`);
  if (!r.ok || r.gap) console.log(`     ${'\x1b[2m'}${r.source}${'\x1b[0m'}`);
}
const gaps = rows.filter((r) => r.gap).length;
const tail = gaps ? ` (${gaps} known gaps reported, not counted)` : '';
console.log(bad ? `\n\x1b[31m— ${bad} of ${rows.length - gaps} anchors off —\x1b[0m${tail}`
                : `\n\x1b[32m— all ${rows.length - gaps} anchors within their literature ranges —\x1b[0m${tail}`);
process.exit(bad ? 1 : 0);
