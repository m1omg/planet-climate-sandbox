import {
  clamp, smoothstep, psatH2O, psatCO2, frostPointCO2, YEAR,
  OUTGAS_EARTH, CARBON_RESERVOIR_FACTOR, CO2_EARTH_COL, XUV_FRACTION_SUN, G_EARTH, M_EARTH,
} from './constants.js';
import { iceFraction } from './radiation.js';
import { outgassingScale, radiusFromMass } from './planet.js';
import { NBANDS } from './climate.js';

// ---------------------------------------------------------------------------
// Where the water sits: ocean / sea ice / land ice / vapour / lost to space.
//
// Sea ice and open ocean are kept apart because they behave completely
// differently -- sea ice floats, so it still fills its basin and keeps the
// planet's land fraction down, but it seals the ocean off from the atmosphere
// and shuts down evaporation. Land ice is a separate reservoir again: it sits
// on top of exposed ground and does not fill anything.
// ---------------------------------------------------------------------------
// The oxygen cycle, in kg/m^2 of O2 per year.
//
// Set from Earth rather than guessed. Its atmosphere holds 2141 kg/m^2 of
// oxygen and the real net source is about 1e13 mol/yr, which is 6.3e-4
// kg/m^2/yr and implies a residence time of 3.4 Myr against a literature 2-3.
// O2_BIO is then fixed by requiring an Earth-like biosphere over Earth-like
// volcanism to settle at 0.21 bar.
//
// O2_REDUCTANT puts the threshold near a fifth of Earth's biosphere: low enough
// that an Archean world can sit below it, high enough that crossing it is a
// deliberate act rather than something that happens by itself.
// Share of Earth's silicate weathering that happens on the seafloor rather
// than on land: a quarter, at the low end of the published range.
const SEAFLOOR_SHARE = 0.25;

const O2_TAU_OX = 3.0e6;        // yr, oxidative weathering timescale
const O2_REDUCTANT = 2.0e-4;    // kg/m^2/yr at Earth's volcanism
const O2_BIO = 5.2e-4;          // kg/m^2/yr at an Earth-like biosphere

// ---------------------------------------------------------------------------
// The methane cycle, in kg/m^2 of CH4 per year.
//
// Anchored on Earth's *natural* budget rather than today's, because most of
// today's methane is ours: 1.9 ppm now against 0.72 ppm before we started, and
// with a ten-year lifetime the difference is not a legacy but a standing
// anthropogenic flux. A modern-Earth world in this model therefore relaxes to
// pre-industrial methane within a century, which is what would actually happen,
// and is the same treatment modern CO2 already gets -- a transient, not a
// fixed point.
//
// Natural budget, Saunois et al. 2020: ~218 Tg/yr, which lands 0.72 ppm at a
// ten-year lifetime.
//
// Nearly all of it goes on the biosphere, including the ~38 Tg/yr usually
// filed under "geological". Those seeps are thermogenic -- buried organic
// carbon cooked back out of sedimentary rock -- so they are biological methane
// on a delay, not something the interior would make on its own. A world that
// never had life has no source rock and gets none of it. What is left for the
// interior is the genuinely abiotic part, serpentinisation and mantle carbon at
// a couple of teragrams a year, some twenty times smaller.
//
// The distinction is not academic: put the seeps on the interior and every
// sterile volcanic world in the game grows an Archean methane greenhouse out of
// nothing, which is how this was caught.
const CH4_BIO = 8.07e-4;        // kg/m^2/yr at an Earth-like biosphere, oxic
const CH4_GEO = 7.5e-6;         // kg/m^2/yr at Earth's volcanism, abiotic only
// How much more of a biosphere's carbon goes out as methane when there is no
// oxygen to route it anywhere else. Fitted to leave the Archean at the few
// hundred to one thousand ppm the literature asks for.
//
// It has to stay inside the range that has actually been measured, and 2.7 was
// outside it. Kharecha et al. 2005 put Archean biogenic methane fluxes at a
// third to two and a half times modern, and modern here is CH4_BIO -- which
// lands pre-industrial Earth at 0.8 ppm, the right number, since the 1.9 ppm in
// today's air is mostly ours.
//
// Being outside that range was not a cosmetic overshoot. At 2.7 the anoxic
// source is 2.2e-3 kg/m^2/yr against a photolytic ceiling of 1.6e-3, so on any
// world receiving less than 1.36 S(+) the source exceeded every sink the planet
// had and methane had no steady state at all -- it simply accumulated, for
// ever. A full biosphere that lost its oxygen to volcanic reductants would
// climb past a bar of methane and go on climbing. At 1.5 the source is
// 1.2e-3 and there is an equilibrium anywhere above 0.76 S(+), which is the
// whole habitable zone.
const CH4_ANOX_BOOST = 1.5;
// Net photolytic destruction at Earth's distance from the Sun, which is what
// caps an anoxic methane atmosphere. See methaneLifetime.
const CH4_PHOTO = 1.6e-3;       // kg/m^2/yr at 1 S-earth
// Light at the ground above which a biosphere is no longer light-limited, in
// W/m^2. Earth's mean is 340 and the Archean's 262, so both are saturated and
// neither moves; a world under a closed haze deck gets fractions of a watt.
const CH4_LIGHT_SAT = 50;

// ---------------------------------------------------------------------------
// Us.
//
// Present-day anthropogenic CO2 is about 40 Gt of CO2 a year, which over
// Earth's surface is 7.8e-2 kg/m^2/yr -- some forty times what all the world's
// volcanoes manage, which is the whole point.
//
// It is drawn from a finite reservoir, and that matters more than the rate.
// Fossil carbon is not a tap: recoverable coal, oil and gas together come to
// something like 5000 Gt of carbon (Lenton & Cannell 2002; Archer 2005 uses the
// same figure as the upper bound), which is 36 kg/m^2 of CO2, or about
// thirteen times the pre-industrial atmospheric column. At today's rate that is
// four and a half centuries and then it stops, whatever the slider says.
//
// Without the reservoir the control would be an infinite source and every world
// with it switched on would simply run away given long enough, which is not
// what burning the Earth's fossil carbon does. What it does is spike the CO2
// and then hand it to the carbonate-silicate thermostat, which takes it back
// over a hundred thousand years or so -- the long thaw.
const EMIT_TODAY = 7.8e-2;      // kg/m^2/yr of CO2 at the present-day rate
export const FOSSIL_TOTAL = 36.0;      // kg/m^2 of CO2, ~5000 GtC of recoverable carbon

// How much of what is burnt is still in the air on the timescale that matters.
//
// This does not go through the ocean-and-crust buffer the volcanoes go through,
// and the difference is a factor of twenty-five. That buffer -- kappa, 50 -- is
// an *equilibrium* partition: it is right for a volcanic flux, which is slow
// enough that the whole ocean stays in step with the atmosphere the entire
// time. A fossil pulse is four centuries long, far faster than the ocean turns
// over, so only the surface layer takes part. Roughly half of a pulse this size
// is still airborne after a few hundred years, and the deep ocean and carbonate
// compensation take most of the rest over the following ten thousand.
//
// Run it through kappa instead and burning all five thousand gigatonnes of
// carbon moves the atmosphere from 427 to 500 ppm, which is not what it does.
//
// 0.44 rather than a half, and it is checkable rather than chosen: we have put
// about 1800 Gt of fossil CO2 into the air since 1750, which is 3.53 kg/m^2,
// and the atmosphere went from 280 to 427 ppm. That rise is 1.50 kg/m^2. The
// cumulative airborne fraction is therefore 42%, and the familiar "about half"
// is the fraction of a *recent year's* emissions, not of the whole. At a half
// this model took the historical burn to 463 ppm instead of 427.
const AIRBORNE = 0.44;

// ---------------------------------------------------------------------------
// How much carbon a planet has at all.
//
// Carbon in the bulk silicate Earth -- mantle plus crust, which is everything
// that can ever reach the air -- is a mass fraction of 1.4 +/- 0.4 x 10^-4
// (metal-silicate partitioning studies; Dasgupta & Hirschmann 2010 for the deep
// cycle). Rather more is dissolved in the core, and none of that is coming back.
//
// As CO2 over Earth's surface that is 4.1e6 kg/m^2, or about 400 bar. Two
// independent routes agree: Earth's carbon inventory is put at 2.5e22 mol and
// possibly as high as 1e23, which is 210 to 850 bar, and the mass fraction lands
// in the middle of that. The uncertainty is real and it is roughly a factor of
// two either way; this is a floor-to-ceiling number, not a precise one.
//
// The scaling with planet mass is the honest part. Carbon is a roughly constant
// fraction of the silicates for worlds that accreted from similar material, so
// the inventory follows the mantle mass, and what matters to an atmosphere is
// the column -- inventory over area. That is why the number below divides by
// r^2: a bigger planet has more carbon and less surface to spread it over.
//
//     Mars       0.107 M(+)      51 bar        actual atmosphere 0.006 bar
//     Venus      0.815 M(+)     331 bar        actual atmosphere 92 bar (28%)
//     Earth      1.000 M(+)     400 bar        actual atmosphere 0.0004 bar
//     super-E    3.500 M(+)    1265 bar
//
// Venus having outgassed a quarter of its budget and Mars a ten-thousandth of
// its is the right shape: Venus lost its water and with it the sink, Mars lost
// its volcanism and then its atmosphere. Neither needed a different carbon
// endowment to end up where it is, which is the useful thing this says.
//
// What is deliberately *not* modelled: formation distance and disk C/O, which
// shift the endowment by a factor of a few; core mass fraction, which changes
// how much silicate there is to hold carbon; and impact devolatilisation. Those
// are real and they are why the band is a factor of two wide, but none of them
// is something this model has any way to know about a given world.
const BSE_CARBON = 1.4e-4;      // carbon mass fraction of mantle + crust
// The column below which a hydrodynamic wind cannot organise itself and the
// background gas stops leaving on any timescale that matters here. About ten
// millibars at Earth gravity.
const COL_HYDRO = 1e3 / G_EARTH;                 // kg/m^2, i.e. 0.01 bar
const SILICATE_FRACTION = 0.677; // mantle + crust as a share of planet mass
const CO2_PER_C = 44 / 12;

// ---------------------------------------------------------------------------
// How much a planet's own heat drives its volcanism.
//
// Volcanic outgassing is melt production times the CO2 dissolved in the melt --
// ocean-island primary melts average about 4 wt% CO2 -- and melt production is
// driven by the heat coming out of the interior. So a world with a hot inside
// erupts more, which is why Io resurfaces itself and the Moon has not erupted
// in a billion years. GJ 1132 b's modelled 80 W/m2 is thought to leave a magma
// ocean under a few tens of metres of crust, with Io-like volcanism above it
// (Swain et al. 2021).
//
// Anchored so Earth's measured 0.092 W/m2 (47 +/- 2 TW; Davies & Davies 2010)
// gives exactly 1x, which is what the outgassing slider already means.
//
// The exponent is the honest weak point. The *direction* is not in doubt, but
// the rate also depends on the mantle's volatile content, its oxygen fugacity
// and the tectonic regime, none of which this model knows. A half power is
// chosen as a deliberately conservative sub-linear law -- melt production does
// not track heat flux one for one, and the melt gets poorer in volatiles as the
// mantle is depleted. Linear would give GJ 1132 b 870x Earth's volcanism and
// empty its entire carbon budget in nine million years; the half power gives
// 30x and a few hundred million, which is a timescale you can watch.
export const EARTH_INTERNAL_FLUX = 0.092;   // W/m^2
export function meltBoost(p) {
  const F = p.internalHeat ?? EARTH_INTERNAL_FLUX;
  return clamp(Math.sqrt(Math.max(F, 0) / EARTH_INTERNAL_FLUX), 0, 100);
}

export function carbonBudget(massEarths) {
  const m = Math.max(massEarths, 1e-6);
  const r = radiusFromMass(m);
  return BSE_CARBON * CO2_PER_C * SILICATE_FRACTION * m * M_EARTH
    / (4 * Math.PI * r * r);
}

// Area-averaged thickness an ice sheet can reach before it flows and calves
// faster than it accumulates, and the density of glacier ice.
const SHEET_MAX_THICKNESS = 2500;   // m
const RHO_ICE = 917;                // kg/m^3

export function partitionWater(w) {
  const dg = w.diag, d = dg.d;
  const total = totalWater(w);
  if (total <= 0) {
    w.water.ocean = w.water.seaIce = w.water.landIce = w.water.vapour = 0;
    return;
  }

  const vapour = clamp(dg.vapourCol / d.eoColumn, 0, total);
  const surface = total - vapour;

  // How much of the surface is cold enough to freeze.
  let frozenShare = 0;
  for (let i = 0; i < NBANDS; i++) frozenShare += iceFraction(w.T[i]) / NBANDS;

  // Building an ice sheet on land needs a working water cycle to carry the
  // water there. Once the sea is sealed under ice, evaporation collapses and
  // the continents stay bare frozen rock -- Snowball Earth, and the Antarctic
  // Dry Valleys today.
  const openBefore = clamp(dg.flooded * (1 - frozenShare), 0, 1);
  const moisture = smoothstep(0, 0.05, openBefore + dg.vapourCol / Math.max(d.eoColumn, 1e-9));

  // Split the surface water by where it physically sits. Basins hold what the
  // hypsometry says they hold; the rest is what has piled up on land as ice.
  const landShare = clamp(1 - dg.flooded, 0, 1);
  // The sheet extent is a state variable with its own multi-millennial memory
  // (see update()); the mass of ice has to follow the same extent the albedo
  // sees, or the two disagree about how glaciated the planet is.
  const glaciated = clamp(dg.glaciatedShare ?? frozenShare * moisture, 0, 1);

  // How much of the planet's water ends up on land as ice.
  //
  // Normally this is area-limited: thin sheets over whatever ground is cold
  // enough, so the mass scales with the glaciated area. That is Earth, and it
  // is Snowball Earth too -- a uniformly frozen world has nowhere colder than
  // anywhere else, so the oceans stayed put under a kilometre of sea ice.
  //
  // A cold trap changes the limit entirely. On a synchronously rotating world
  // the night side sits a hundred kelvin or more below the substellar point,
  // permanently; water sublimates from the warm side, deposits there, and never
  // comes back. The sheets do not spread, they thicken, so what bounds them is
  // how much water the planet has, not how much ground (Menou 2013; Leconte et
  // al. 2013). The trap is driven by the day-night contrast, which is itself
  // set by how much heat the atmosphere moves -- so a thick atmosphere keeps
  // its sunlit sea and a thin one loses it, which is the observed distinction.
  //
  // This used to be a flat cap of half the surface water, which made a
  // fully trapped world unreachable by construction: every locked planet in a
  // 900-world sweep came out at exactly 50.0% land ice.
  // What stops the trap is that ice sheets flow. They cannot grow arbitrarily
  // thick: past a couple of kilometres they spread under their own weight and
  // calve back into the basins. Antarctica averages about 2.1 km and Greenland
  // 1.7 km, and that is with a continent to sit on.
  //
  // So the night side can only hold what its sheets can carry, which makes
  // trapping a small-inventory phenomenon (Menou 2013): a world with an ocean's
  // worth of water has far more than the cold trap can store and keeps its
  // sunlit sea, while a world with a few percent of one loses all of it.
  const trap = smoothstep(40, 130, (dg.Tmax ?? 0) - (dg.Tmin ?? 0));
  const areaLimited = surface * landShare * glaciated;
  const sheetCapacity = SHEET_MAX_THICKNESS * RHO_ICE / Math.max(d.eoColumn, 1e-9)
                      * landShare * glaciated;
  const wanted = areaLimited + trap * Math.max(0, sheetCapacity - areaLimited);
  // A permanent cold trap has no return path, so it does not stop at some
  // arbitrary residual -- it drains the basins. What is left is whatever is in
  // transit, which is nothing on the timescales here.
  const landIce = clamp(wanted, 0, surface * 0.999);
  const basin = Math.max(0, surface - landIce);
  const seaIce = clamp(basin * frozenShare, 0, basin);

  w.water.vapour = vapour;
  w.water.landIce = landIce;
  w.water.seaIce = seaIce;
  let ocean = Math.max(0, basin - seaIce);

  // Below the triple point liquid water cannot exist at any temperature. What
  // would have been ocean is ice if the surface is cold enough to hold it, and
  // vapour otherwise -- there is no third option.
  const allowed = dg.liquidAllowed ?? 1;
  if (allowed < 1 && ocean > 0) {
    const forced = ocean * (1 - allowed);
    ocean -= forced;
    if (w.T.some((t) => t < 273.16)) w.water.seaIce += forced;
    else w.water.vapour += forced;
  }
  w.water.ocean = ocean;
}

// Total water still on the planet, however it is currently stored.
export function totalWater(w) {
  const x = w.water;
  return (x.ocean || 0) + (x.seaIce || 0) + (x.landIce || 0) + (x.vapour || 0);
}

// Water sitting in the basins: liquid, plus the sea ice floating on it. This is
// what sets how much of the planet is under water.
export function basinWater(w) {
  return (w.water.ocean || 0) + (w.water.seaIce || 0);
}

// ---------------------------------------------------------------------------
// Hydrogen escape. Two independent ceilings, whichever is tighter:
//
//  * diffusion limit  -- how fast H can even reach the exosphere, set by the
//    cold-trap mixing ratio. Kasting's moist-greenhouse criterion is f > 1e-3.
//  * energy limit     -- how much XUV heating is available to lift it out.
//
// For a Sun-like star the energy limit dominates and a full ocean takes
// 10^8-10^9 yr to disappear, which is the Venus story and the reason a wet
// runaway drifts into a dry one over hundreds of millions of years.
// ---------------------------------------------------------------------------
// Cold-trap geometry. PCT_EARTH is where Earth's tropopause sits as a fraction
// of surface pressure; PCT_TAU is how fast that fraction falls as the surface
// warms and the troposphere deepens, fitted to put Kasting's moist-greenhouse
// criterion (stratospheric H2O past 1e-3) on his 340 K surface.
const PCT_EARTH = 0.10, PCT_TAU = 36.1;   // K
// Diffusion-limited hydrogen loss, in kg/m2/yr per unit H2 mixing ratio.
// Hunten's flux is 2.5e13 f_H atoms/cm2/s and H2 carries two hydrogens, so
// 2.5e13 * 2 * x * 1.66e-24 g/cm2/s, which is 0.0262 kg/m2/yr per unit x.
//
// This started life at 0.118, which is the *water* constant -- the same atom
// flux carried away as 18 g/mol instead of 2. It made hydrogen escape four and a
// half times too fast and put early Mars's sustainable H2 at 0.5% where Ramirez
// et al. compute 1.3%. Checked the other way now: their outgassing flux of
// 2e11 H2/cm2/s balances this loss at x = 0.013, which is their number.
const H2_DIFFUSION = 0.0262;
// Modern Earth's subaerial H2 outgassing: 1e10 H2 molecules/cm2/s, which is
// 2.4e12 mol/yr globally (Ramirez et al. 2014, from Holland's estimate).
// 1.05e-5 kg/m2/yr -- about two per cent of the carbon flux by mass.
const H2_OUTGAS_EARTH = 1.05e-5;
const H2_OXIDISED_LIFETIME = 2;   // years, in air like today's
// 2 H2 + O2 -> 2 H2O, by mass: M(O2)/2M(H2) of oxygen spent and M(H2O)/M(H2) of
// water made, per kilogram of hydrogen burnt. The two-year lifetime is a *trace
// gas* number and assumes the oxidant is effectively infinite beside the
// hydrogen -- true at Earth's 0.55 ppm, false the moment there is a bar of it.
const O2_PER_H2 = 31.998 / (2 * 2.016);    // 7.94 kg of O2 per kg of H2
const H2O_PER_H2 = 18.015 / 2.016;         // 8.94 kg of H2O per kg of H2
// Four hydrogens per methane, weighed as the H2 that carries the same hydrogen.
const H2_PER_CH4 = 2 * 2.016 / 16.043;     // 0.251 kg of H2 per kg of CH4
// Kump & Barley (2007): where a volcano erupts changes what comes out of it.
// Submarine eruptions degas under kilometres of water, at pressures that keep
// sulfur as H2S and leave the mixture reducing; subaerial eruptions degas at one
// bar and their sulfur leaves as SO2, which is not (Gaillard, Scaillet & Arndt
// 2011). The Archean was almost all submarine, and the switch to subaerial
// volcanism as the continents emerged cut the reducing flux the biosphere had to
// outrun. It is one of the standard explanations for why the Great Oxidation
// happened when it did rather than when oxygenic photosynthesis started, and it
// is why a low-land world is a harder place to oxygenate than the same world
// with continents. Land reached the oxygen budget only through weathering
// before this, so an ocean world and a continental one delivered identical
// reducing power per unit volcanism.
//
// The size of it is derived rather than fitted, because fitting it would have
// meant choosing the answer. Volcanic reducing power is H2, CO and H2S. The
// first two are set by mantle fO2 and do not care what pressure the eruption
// happens at; only the sulfur does. Holland (2002) and Catling & Kasting put
// volcanic H2S within a factor of two of H2+CO either way, so a third of the
// budget is the middle of the published range -- and flipping that third from
// reducing to not is a factor of 1/(1-1/3) on the rest.
//
// Modern Earth's land fraction is the unit, so nothing in the present-day
// calibration moves at all: delivery is exactly 1 at 0.29.
const S_SHARE = 1 / 3;
const SUBMARINE_REDOX = 1 / (1 - S_SHARE), LAND_MODERN = 0.29;
const TRAP_FAIL_LO = 1e-4, TRAP_FAIL_HI = 2e-3;

export function escapeRates(w) {
  const p = w.params, dg = w.diag, d = dg.d;
  const pTot = Math.max(1e-6, dg.pTotMean);
  const pH2Omean = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;

  // Stratospheric water mixing ratio -- the thing that decides whether a planet
  // keeps its ocean, and now the textbook relation rather than a power law
  // fitted to it: what gets past a cold trap is the saturation vapour pressure
  // at the trap over the pressure there.
  //
  //     f = psat(T_ct) / p_ct
  //
  // The old fit was a power law in the *surface* mixing ratio, pinned at modern
  // Earth and at a second point its own comment mis-stated: it claimed a surface
  // ratio of 0.25 was "a 340 K surface", where in this model 340 K gives 0.175.
  // So the moist-greenhouse criterion was met about twelve kelvin late, and --
  // much worse -- the curve above it was far too shallow. An ocean at the top of
  // the hot branch took 6.2e10 years to leave, which is thirteen times the age of
  // the Earth and not a moist greenhouse in any useful sense.
  //
  // Two things set the trap, and they pull the same way as a planet warms:
  //
  //   * T_ct rises with the surface, and psat is exponential in it. The existing
  //     linear fit is kept -- it was already here, computed, and then not used
  //     for anything.
  //   * p_ct falls. A warmer, moister troposphere is a deeper one and the
  //     tropopause sits at lower pressure; Earth's is near 0.1 of the surface
  //     pressure. PCT_TAU is the one fitted number here and it is fitted to a
  //     single published point -- Kasting's 1e-3 criterion at a 340 K surface --
  //     rather than to anything downstream of it.
  //
  // Modern Earth then falls out rather than being imposed: a 190 K trap at 0.1
  // bar gives 3e-6, against an observed 4e-6, with nothing tuned to make it.
  // The x^8 term stays for the other end, where the air is mostly steam, the
  // trap has gone entirely and the ratio has to reach one.
  //
  // Evaluated band by band and then area-averaged: escape is dominated by the
  // warmest, wettest latitudes, not by the global mean.
  const xSteam = pH2Omean / pTot;
  const Tct = clamp(190 + 0.62 * (dg.Tmean - 288), 120, 700);
  let fStrat = 0;
  for (let i = 0; i < NBANDS; i++) {
    const x = clamp(dg.pH2O[i] / Math.max(dg.pTot[i], 1e-9), 0, 1);
    const tct = clamp(190 + 0.62 * (w.T[i] - 288), 120, 700);
    const pctFrac = clamp(PCT_EARTH * Math.exp(-(w.T[i] - 288) / PCT_TAU), 1e-6, 0.5);
    const pct = pctFrac * Math.max(dg.pTot[i], 1e-9);
    const trap = psatH2O(tct) / 1e5 / pct;
    // A cold trap does not leak its way into a moist greenhouse -- it fails.
    // Once psat at the trap approaches the pressure there, nothing is being
    // trapped any more and the stratospheric mixing ratio runs up to the
    // tropospheric one, which is what "moist greenhouse" means. Reporting the
    // trap ratio alone gave an ocean 1.2e10 years to leave at the top of the
    // hot branch, where the number for a Sun-like star is 1e8: the trap ratio
    // was still saying 1.6e-3 while the atmosphere below it was a fifth water.
    //
    // TRAP_FAIL_LO is Kasting's criterion, near enough, and by TRAP_FAIL_HI the
    // trap is gone. Earth sits four orders of magnitude below the low end.
    const failed = smoothstep(TRAP_FAIL_LO, TRAP_FAIL_HI, trap);
    fStrat += clamp(trap + x * failed + Math.pow(x, 8), 0, 1) / NBANDS;
  }

  // Diffusion-limited: 2.5e13 * f H atoms/cm^2/s  ->  kg/m^2/yr of water
  const diffusion = fStrat * 0.118 * (dg.g / G_EARTH);

  // Energy-limited: eps * F_xuv * (R_xuv/R)^3 / (g R), integrated over a year.
  // A hot steam envelope puffs up enormously -- the XUV absorption radius moves
  // outward by many scale heights -- so a runaway greenhouse bleeds water far
  // faster than a temperate planet under the same star.
  const xuv = p.insolation * 1361 * p.xuvFraction / 4;
  const H = 1.381e-23 * dg.Tmean / (18 * 1.661e-27 * dg.g);   // steam scale height
  const inflate = clamp(1 + 60 * H / d.R, 1, 2.2);
  const energy = 0.15 * xuv * Math.pow(inflate, 3) / (dg.g * d.R) * YEAR;

  const water = Math.min(diffusion, energy) * (dg.totalWater > 0 ? 1 : 0);

  // Hydrogen leaves faster than anything else and by the same two limits. It is
  // the lightest gas there is, it needs no photolysis to free it, and on a small
  // planet it is gone in a geological instant -- which is exactly why early Mars
  // needed it *maintained* by volcanism rather than inherited (Ramirez et al.
  // 2014), and why a Hycean world has to be massive enough to hold one.
  // Against the *dry* background, not the total. Hydrogen diffuses through the
  // non-condensible gas; water vapour is not a background it has to cross,
  // because it condenses out below the cold trap. Measured against total
  // pressure a steam-loaded Earth looked to this term like a world where
  // hydrogen was a trace gas, its diffusion limit collapsed accordingly, and the
  // planet held two bars of H2 it has no business holding -- Liggins et al.
  // (2020) put an anoxic Earth-mass planet with an Earth-like mantle at 0.2-3%,
  // and Kuramoto et al. argue efficient EUV-driven escape keeps it under 1%.
  const pDryBg = Math.max(pTot - pH2Omean, 1e-9);
  const xH2 = clamp((dg.pH2 ?? 0) / pDryBg, 0, 1);
  // The diffusion limit is a statement about a *trace* gas working its way up
  // through a background. It stops applying once hydrogen is the background:
  // there is nothing left for it to diffuse through, the whole envelope goes
  // hydrodynamically, and what binds is the energy supply alone. Dividing by
  // (1-x) is the cheap way to say that -- the diffusion ceiling lifts out of the
  // way as x approaches one and `min` falls through to the energy limit.
  //
  // It is also what makes hydrogen retention a question about *mass*, which it
  // should be and previously was not. The energy limit goes as 1/(gR), so a ten
  // Earth-mass world keeps an H2 envelope for the age of the universe while a
  // Mars-sized one cannot hold a thick one at all -- and before this, a small
  // anoxic planet sat on the diffusion limit and held far more hydrogen than it
  // has any business holding.
  //
  // And the limit is on *hydrogen*, not on any particular molecule carrying it.
  // What crosses the homopause is atoms, and methane brings four where H2 brings
  // two. Leaving methane out of this was not a small omission: it is half of
  // Catling, Zahnle & McKay (2001), and on their account the larger half. Their
  // early Earth oxidises because biogenic methane rises, is photolysed, and its
  // hydrogen leaves -- carbon stays behind, oxygen stays behind, and the planet
  // ratchets one way. Modern Earth is the same story in miniature: at 1.8 ppm of
  // methane against 0.55 ppm of H2, methane already carries about six times the
  // escaping hydrogen. The model had none of it.
  const xCH4 = clamp((dg.pCH4 ?? 0) / pDryBg, 0, 1);
  const xHeq = clamp(xH2 + 2 * xCH4, 0, 1);      // as the H2 that would carry it
  const h2Diff = xHeq * H2_DIFFUSION * (dg.g / G_EARTH) / Math.max(1 - xHeq, 0.02);
  const h2Energy = 0.15 * xuv * Math.pow(inflate, 3) / (dg.g * d.R) * YEAR * 9;
  // One channel, two carriers, shared in proportion to the hydrogen each brings.
  const hTotal = Math.min(h2Diff, h2Energy);
  const ch4Share = xHeq > 0 ? 2 * xCH4 / xHeq : 0;
  const h2 = (dg.pH2 ?? 0) > 0 ? hTotal * (1 - ch4Share) : 0;
  // What methane could supply if photolysis kept up. It usually cannot, so the
  // actual flux is settled where the methane is destroyed -- hydrogen does not
  // leave until something has broken the molecule -- and this is the ceiling.
  const ch4H2Cap = hTotal * ch4Share;

  // Background gas loss. Gated on the cosmic shoreline: XUV irradiation has to
  // overcome gravitational binding (~ v_esc^4) before N2/CO2 go anywhere.
  const vescRel = d.vesc / 11186;
  const fCrit = 1.15e-3 * Math.pow(vescRel, 4) * 30;
  const gate = smoothstep(0.3, 3, xuv / Math.max(fCrit, 1e-12));
  const background = 0.005 * xuv / (dg.g * d.R) * YEAR * gate;

  return { water, background, h2, ch4H2Cap, fStrat, Tct, diffusion, energy, xSteam };
}

// ---------------------------------------------------------------------------
// Carbonate-silicate thermostat, CO2 condensation, and escape, all advanced on
// the same accelerated clock as the temperatures.
// ---------------------------------------------------------------------------
// Ice sheets take tens of thousands of years to grow and rather less to melt:
// ~15 kyr and ~5 kyr e-folding here, which is the asymmetry that gives the
// glacial cycles their sawtooth -- a long ragged descent, an abrupt termination
// (Abe-Ouchi et al. 2013). Advanced once per step, unlike update(), which may
// run several times.
function advanceIceSheet(w, dtYears) {
  const target = w.diag.iceSheetTarget ?? 0;
  if (w.iceSheet == null) { w.iceSheet = target; return; }
  const tau = target > w.iceSheet ? 15000 : 5000;
  w.iceSheet += (target - w.iceSheet) * (1 - Math.exp(-Math.max(dtYears, 0) / tau));
}

// How long a methane molecule lasts, in years.
//
// Methane is not stable, and what destroys it depends entirely on the redox
// state of the air. In today's oxidising atmosphere OH radicals -- made
// downstream of oxygen -- take it out in about a decade. With no free oxygen
// there is no OH, and the only sink is ultraviolet photolysis high up: the
// lifetime stretches to something like ten thousand years, which is why the
// Archean could hold percent-level methane at all. The haze it makes then
// shields the methane underneath it and stretches that further still.
//
// Zahnle 1986; Pavlov et al. 2001; Catling & Zahnle 2020.
//
// `col` and `insol` are optional, and giving them switches on the second thing
// that decides an anoxic methane lifetime: photolysis needs photons, and there
// are only so many. Left out, the answer is the optically thin one.
export function methaneLifetime(pO2, hazeTau = 0, xuvRel = 1, col = 0, insol = 1,
                                pO2End = null) {
  // It does not take much. OH chemistry is running long before an atmosphere
  // looks oxygenated to us: a thousandth of today's oxygen already shortens
  // methane's life by three orders of magnitude, which is why methane and free
  // oxygen essentially cannot coexist, and why the Great Oxidation ended the
  // Archean's methane greenhouse rather than merely denting it.
  // Averaged across the step when the caller knows where the oxygen ended up:
  // the crossover is four decades wide and a single step can span all of it, so
  // taking the lifetime from the oxygen at the start alone is what let methane
  // accumulate at an anoxic lifetime while the air was still oxidising. The
  // average is taken in the oxidising fraction rather than in pO2, because that
  // is the quantity the physics uses and it is bounded in [0,1].
  const oxidising = pO2End == null ? smoothstep(3e-7, 2e-4, pO2)
    : 0.5 * (smoothstep(3e-7, 2e-4, pO2) + smoothstep(3e-7, 2e-4, pO2End));
  // Haze absorbs the ultraviolet that would break methane up, and a more active
  // star supplies more of it. Both act on the photolytic sink, so both scale the
  // photon ceiling below by the same factor they scale the thin lifetime.
  const shield = (1 + 1.5 * Math.max(hazeTau, 0)) / Math.pow(clamp(xuvRel, 0.02, 300), 0.4);
  const tauOx = 10 * shield;
  let tauUv = 1.2e4 * shield;

  // The photon ceiling. A first-order lifetime says a fixed *fraction* of the
  // methane goes each year, which quietly assumes the ultraviolet can always
  // reach all of it. It cannot: methane is opaque to the very wavelengths that
  // destroy it, so past a certain column the sink stops being a fraction and
  // becomes a flux, set by how many photons arrive at all.
  //
  // This is the whole reason Titan still has an atmosphere. It is anoxic, so
  // the thin lifetime would give it ten thousand years, and its five percent of
  // methane would have been gone before the dinosaurs. What it actually gets is
  // ten to a hundred million years, because it sits under one percent of
  // Earth's sunlight with a hundred and twenty times Earth's methane column:
  // photons per molecule some ten thousand times scarcer.
  //
  // CH4_PHOTO is the net destruction flux at Earth's distance -- net, so the
  // large fraction of photolysis products that simply recombine into methane is
  // already taken out. Anchored on Titan's measured haze and ethane production,
  // which is the observable that pins the number.
  if (col > 0 && insol > 0) {
    // The haze shield belongs on the thin lifetime and NOT on this ceiling, and
    // that is not a bookkeeping preference -- putting it on both is a feedback
    // that cannot terminate. Haze lengthens the life of any one molecule by
    // taking the ultraviolet before it gets down there, which is the
    // self-shielding the Archean literature describes, and that is the `shield`
    // factor on tauUv above. But it does not reduce how much methane the planet
    // loses in total, because the haze is *made of* the methane: the photons it
    // intercepts have already broken methane up, higher in the column, and the
    // carbon leaves as tholin instead of leaving as ethane. Titan is the anchor
    // for CH4_PHOTO precisely because its haze production is the observable, so
    // dividing by the shield here counted the same haze twice.
    //
    // What it cost: an anoxic world grew haze, the haze cut its own methane
    // sink, the smaller sink grew more methane, and nothing anywhere brought it
    // back. A world at three times Earth's volcanism climbed past two bar of
    // methane with eighty per cent of its sunlight stopped overhead, and was
    // still climbing at sixty million years. The ceiling is the photon supply,
    // and the photon supply does not care where in the column it is spent.
    const ceiling = CH4_PHOTO * insol;               // kg/m^2/yr
    // A soft saturation rather than a hard min(): the sink approaches the
    // ceiling instead of hitting it, so nothing goes discontinuous at the
    // crossover and a world just short of it is not a world about to break.
    tauUv *= 1 + (col / tauUv) / ceiling;
  }
  return Math.exp(Math.log(tauUv) * (1 - oxidising) + Math.log(tauOx) * oxidising);
}

// Where oxygenic photosynthesis can actually run, as a fraction of the surface.
//
// The bounds are deliberately optimistic: the question is where it is
// *possible*, not where it is comfortable, so each one is the record rather
// than the median.
//
//   temperature  -20 to +73 C. The top is a hard and well-measured limit --
//     oxygenic photosynthesis stops around 73 C, where Synechococcus lividus
//     gives out in the Yellowstone springs, and no phototroph on Earth passes
//     75. The bottom is set by liquid water in brine films rather than by the
//     chemistry: Antarctic cryptoendoliths and snow algae fix carbon at -10 to
//     -20 C.
//   light        the compensation point is astonishingly low. Green sulphur
//     bacteria have been recovered photosynthesising in the Black Sea on about
//     a ten-thousandth of full sunlight, so a fraction of a watt is generous
//     even by the standards of this function.
//   carbon       two constituencies with very different limits, and lumping them
//     was wrong at the starvation end. Marine phytoplankton and cyanobacteria run
//     carbon-concentrating mechanisms and manage on a few ppm. Vascular land
//     plants do not: C3 photosynthesis has a compensation point near 50 ppm, most
//     of it is severely carbon-limited below about 150, and nothing vascular runs
//     below 10 -- which is the CO2-starvation bound on the far end of a
//     biosphere's life, and the reason a brightening star ends one by weathering
//     rather than by heat. See PLANT_HI/PLANT_LO.
//   water        liquid, and enough of it to be a habitat.
//
// Taken band by band rather than from the global mean, because that is how the
// condition actually works. A world whose average is -30 C can still have a
// warm equatorial belt doing the whole planet's photosynthesis, and a tidally
// locked world has a night side where the light term is zero however warm the
// air is.
// Where land plants give out, and where the microbes that are not plants do not.
//
// 150 ppm is where most vascular plants are already carbon-starved and 10 ppm is
// where the last of them stop; C3's compensation point sits near 50 in between.
// Marine phytoplankton keep going to a few ppm on their carbon-concentrating
// mechanisms, so a world does not lose its whole biosphere at 10 ppm -- it loses
// the land half of it, and how big that half is depends on how much land there
// is.
const PLANT_HI = 150e-6, PLANT_LO = 10e-6;      // bar
const MICROBE_HI = 8e-6, MICROBE_LO = 1e-6;     // bar
// Land is about 2.7 times as productive per square metre as open ocean, which is
// what puts 54% of Earth's net primary production on 30% of its surface (Field
// et al. 1998: 56.4 Pg C/yr terrestrial against 48.5 marine). Anchored there and
// then let to run: a landless world is all plankton, a desert world all plants.
const LAND_NPP = 2.7;
export function carbonLimit(pCO2, landFraction) {
  const L = clamp(landFraction, 0, 1);
  const landShare = LAND_NPP * L / Math.max(LAND_NPP * L + (1 - L), 1e-12);
  const plants = smoothstep(PLANT_LO, PLANT_HI, pCO2);
  const microbes = smoothstep(MICROBE_LO, MICROBE_HI, pCO2);
  return landShare * plants + (1 - landShare) * microbes;
}

export function photosynthesis(w) {
  const dg = w.diag;
  const water = smoothstep(0, 0.015, w.water.ocean);
  if (water <= 0) return 0;
  const carbon = carbonLimit(dg.pCO2 ?? 0, w.params.landFraction ?? 0.3);
  if (carbon <= 0) return 0;
  // How much of the planet can actually photosynthesise -- and, crucially, out
  // of how much.
  //
  // Summing habitable bands over the whole globe is the right question for a
  // rotating world and the wrong one for a locked world, because the two get
  // their insolation in different currencies. insolationProfile() hands a
  // rotating planet the *diurnal mean*: every band is lit, and the fact that
  // each one is dark half the time is already averaged in. A locked planet gets
  // the instantaneous value, so half its bands sit at exactly zero for ever.
  // Score both against the whole globe and a locked world is charged twice for
  // its night -- once in the model's own physics, and again in a denominator
  // that counts ground the star can never reach as ground life failed to use.
  //
  // Integrate properly and the two come out level. A locked world lights half
  // its area continuously; Earth lights all of its area half the time. Same
  // starlight intercepted, pi R^2 F either way, and since photosynthesis is
  // light-saturated well below full sunlight -- the `lit` threshold below is
  // half a watt, and green sulphur bacteria manage on a ten-thousandth of
  // Earth's -- what limits production is habitable area, not flux. So a locked
  // world whose entire day side is temperate and wet should read the same as
  // Earth, and one with a habitable ring should read as the share of its day
  // that ring covers.
  //
  // Hence: the denominator is the part of the planet the star ever reaches.
  // `litArea` is exactly 1 on every rotating world -- the dimmest band on Earth
  // still gets 204 W/m^2, and even a 90-degree obliquity leaves 17 -- so this
  // changes nothing anywhere except where a permanent night side exists, which
  // is the only place it was wrong.
  let share = 0, litArea = 0;
  for (let i = 0; i < NBANDS; i++) {
    const warm = smoothstep(248, 258, w.T[i]);          // -25 to -15 C
    const cool = 1 - smoothstep(341, 351, w.T[i]);      // +68 to +78 C
    const lit = smoothstep(0.05, 0.5, dg.S ? dg.S[i] : 1361);
    share += (warm * cool * lit) / NBANDS;
    litArea += lit / NBANDS;
  }
  if (litArea <= 0) return 0;      // a world its star never reaches at all
  return water * carbon * (share / litArea);
}

// How fast a biosphere dies, and how slowly it comes back.
//
// Dying is the quick one: past 73 C the photosystems come apart and a forest is
// gone in a season, so a couple of centuries is already generous for a whole
// planet's worth. Coming back is the slow one -- somewhere has to have survived
// and spread. Neither timescale is visible above about a kiloyear a second, but
// they are the right way round, and it means a world that dips over the edge and
// comes back does not simply flicker.
const BIO_DIE = 200;      // yr
const BIO_GROW = 5000;    // yr

export function stepVolatiles(w, dtYears) {
  advanceIceSheet(w, dtYears);

  const p = w.params, dg = w.diag, d = dg.d;
  const esc = escapeRates(w);

  // --- water inventory -----------------------------------------------------
  if (totalWater(w) > 0) {
    const lostCol = esc.water * dtYears;                 // kg/m^2
    const lostEO = Math.min(lostCol / d.eoColumn, dg.totalWater);
    const pool = totalWater(w);
    if (pool > 0) {
      const f = 1 - lostEO / pool;
      w.water.vapour *= f; w.water.ocean *= f;
      w.water.seaIce *= f; w.water.landIce *= f;
      w.water.lost += lostEO;
      // oxygen left behind when the hydrogen goes; some is taken up by the crust
      w.o2 += lostEO * d.eoColumn * (32 / 18) * 0.15;
    }
  }
  partitionWater(w);

  // --- carbonate-silicate cycle -------------------------------------------
  // Volcanoes cannot outgas carbon the planet does not have. `outgassing` used
  // to be an infinite tap, and left running it produced 24 000 bar of CO2 --
  // thirty to a hundred times the entire carbon inventory of an Earth-mass
  // world. See carbonBudget().
  // Melt production scales with the heat coming out of the interior, so a
  // tidally heated world genuinely erupts more -- see meltBoost().
  const want = OUTGAS_EARTH * outgassingScale(p.mass) * Math.max(p.outgassing, 0) * meltBoost(p);
  const V = (dtYears > 0 && w.carbonDeep != null && !p.mantleInfinite)
    ? Math.min(want, Math.max(w.carbonDeep, 0) / dtYears) : want;

  // ...and us, on top of the volcanoes, until the fossil carbon runs out.
  if (w.fossil == null) w.fossil = FOSSIL_TOTAL * (1 - clamp(p.fossilUsed ?? 0, 0, 1));
  let emit = 0;
  if ((p.emissions ?? 0) > 0 && dtYears > 0 && (p.fossilInfinite || w.fossil > 0)) {
    // The reserve is what makes this control unable to run a world away, so
    // switching it off is switching off the one thing keeping it honest. It is
    // there because "what if we simply never stopped" is a fair question to want
    // to ask, and the answer is worth seeing; it is not there because a planet
    // works that way.
    emit = p.fossilInfinite ? EMIT_TODAY * p.emissions
                            : Math.min(EMIT_TODAY * p.emissions, w.fossil / dtYears);
    if (!p.fossilInfinite) w.fossil = Math.max(0, w.fossil - emit * dtYears);
  }
  w.emitting = emit;
  const liquid = clamp(1 - dg.iceMean, 0, 1) * smoothstep(0, 0.02, w.water.ocean);
  const landExposed = clamp(p.landFraction * (1 - dg.iceMean), 0, 1);
  const pCO2rel = Math.max(dg.pCO2 / 280e-6, 1e-6);
  // Two silicate sinks, not one.
  //
  // Continental weathering is the familiar one and needs exposed rock. Seafloor
  // weathering does not: ocean water circulates through fresh basalt at the
  // ridges and lays CO2 down as carbonate there, and it is worth something like
  // a quarter of Earth's total silicate sink (Brady & Gislason 1997; Coogan &
  // Dosso 2015; Krissansen-Totton & Catling 2017). Its temperature dependence
  // is weaker, being tied to bottom water rather than to the surface, and its
  // CO2 dependence milder.
  //
  // Leaving it out meant a world with no land had no carbon thermostat at all
  // and its climate simply drifted -- which is both wrong and inconsistent,
  // since the oxygen sink above already leans on seafloor oxidation for exactly
  // the same reason. The split is normalised so Earth's total is unchanged.
  const wLand = (landExposed / 0.3)
              * Math.pow(pCO2rel, 0.3)
              * Math.exp(clamp((dg.Tmean - 288) / 13.7, -8, 8));
  const wSea = (dg.flooded / 0.7)
             * Math.pow(pCO2rel, 0.23)
             * Math.exp(clamp((dg.Tmean - 288) / 28.0, -8, 8));
  const Wr = OUTGAS_EARTH * outgassingScale(p.mass)
           * ((1 - SEAFLOOR_SHARE) * wLand + SEAFLOOR_SHARE * wSea)
           * liquid;
  // Ocean + reactive crust buffer the atmosphere, stretching the feedback from
  // millennia to ~1 Myr. In a hard snowball the sink is gone and CO2 simply
  // piles up until it can break the ice: 0.1-0.3 bar over 5-30 Myr.
  const kappa = 1 + (CARBON_RESERVOIR_FACTOR - 1) * liquid;

  // The interior reservoir, set up on the first step now that kappa is known.
  // Everything not already at the surface is still in the mantle and crust; the
  // surface system holds kappa times the atmospheric column, because that is
  // what kappa means -- Earth's ocean carries some forty-four times the carbon
  // its air does, which is where the 50 came from.
  // `carbonSpent` is how much of that budget the planet has already outgassed
  // and lost before the clock starts, which is not a detail on an old world with
  // a hot interior. GJ 1132 b runs 29x Earth's melt production off 80 W/m^2 of
  // tidal heat: at that rate it empties its entire mantle carbon budget in about
  // twenty megayears, so after gigayears there is nothing left to outgas. Booting
  // it with a full mantle had it build 230 bar of CO2 and 3561 C inside eight
  // megayears, which is the opposite of what JWST sees.
  if (w.carbonDeep == null) {
    const spent = clamp(p.carbonSpent ?? 0, 0, 1);
    w.carbonDeep = Math.max(0, carbonBudget(p.mass) * (1 - spent)
      - kappa * w.co2 - (w.co2Frozen ?? 0));
  }
  // Semi-implicit, so an arbitrarily long step still lands on the right answer
  // instead of overshooting past zero. Weathering goes as C^0.3, so dW/dC =
  // 0.3 W / C. Without this the step-size chooser had to throttle the whole
  // clock to a crawl whenever CO2 was drawn down near zero.
  const dWdC = w.co2 > 1e-12 ? 0.3 * Wr / w.co2 : 0;
  // The exchange with the interior, in surface-system units -- damped exactly
  // once, and then spent on both sides of the ledger.
  //
  // The damping used to be applied to the atmosphere and not to the mantle, so
  // over a long step the surface gave up (Wr-V)·dt·damping while the interior
  // received the whole (Wr-V)·dt. The difference is carbon that never existed,
  // and it is not small: an Earth-like world at five times Earth's volcanism
  // finished twenty billion years holding 951 bar of a 399 bar budget, its
  // mantle *fuller* than it started. That is why the reservoir looked
  // bottomless however long anyone ran it -- it was being refilled from nowhere
  // faster than the volcanoes drained it. A dry world was always exact, because
  // with no liquid there is no weathering and this term is zero; the leak
  // needed a working carbon cycle to hide in.
  const toSurface = (V - Wr) * dtYears / (1 + dtYears * dWdC / kappa);
  w.co2 = Math.max(0, w.co2 + emit * AIRBORNE * dtYears + toSurface / kappa);

  // Close the loop. Weathering does not destroy carbon, it buries it as
  // carbonate, and subduction carries it back down to be outgassed again --
  // which is why Earth has run this cycle for four billion years on an
  // inventory it would otherwise have exhausted in eight hundred million.
  // Fossil carbon we burn is already at the surface, so it does not come out of
  // the interior; it goes back into it through weathering like any other.
  // Weathering is deliberately NOT boosted: it uses outgassingScale purely as a
  // normalisation, and scaling the sink with the source would hold the
  // equilibrium exactly where it was and make the whole coupling a no-op.
  w.carbonDeep = p.mantleInfinite
    ? w.carbonDeep : Math.max(0, w.carbonDeep - toSurface);

  // --- what is actually alive ----------------------------------------------
  // The control is the biosphere you asked for; this is the one the planet can
  // support. They are the same number on a habitable world and they are very
  // much not on a cooked one -- which used to be invisible, because nothing
  // displayed it and the ground stayed green at 800 C.
  {
    const target = Math.max(p.biosphere ?? 0, 0) * photosynthesis(w);
    if (w.bio == null) w.bio = target;
    else {
      const tau = target < w.bio ? BIO_DIE : BIO_GROW;
      w.bio += (target - w.bio) * (1 - Math.exp(-Math.max(dtYears, 0) / tau));
    }
  }

  // --- the oxygen cycle ----------------------------------------------------
  // Built to mirror the carbon one above, because it is the same shape: a
  // reservoir with a source you control and sinks the planet decides.
  //
  //   carbon    co2Bar   <- outgassing   -> silicate weathering, cold traps
  //   oxygen    o2Bar    <- biosphere    -> volcanic reductants, oxidative weathering
  //
  // Oxygen used to exist only as a fossil of hydrogen escape, which meant the
  // only route to an oxygen-rich atmosphere was to boil an ocean. That is the
  // Venus story, not Earth's.
  {
    // How much of the surface photosynthesis can run on. This used to be a
    // single smoothstep on the global mean temperature between 330 and 360 K,
    // which is neither the right quantity nor the right numbers: it is a local
    // condition, and 57 C is nowhere near where phototrophs actually stop.
    const source = O2_BIO * w.bio;

    // Reduced volcanic gases, straight out of the ground and into the air.
    // This is the term the biosphere has to outrun, and until it does the
    // atmosphere stays anoxic however long you wait -- which is why the Archean
    // stayed anoxic for a billion years with photosynthesis already running
    // (Catling & Zahnle 2020). The Great Oxidation is that threshold being
    // crossed, and here it falls out of the arithmetic rather than being staged.
    //
    // How *reduced* those gases are is a separate question from how much gas
    // there is, and this term used to answer only the second. `mantleRedox`
    // already scales the hydrogen a world outgasses; it was ignored here, so
    // the model could not say "the same volcanism, delivering less reducing
    // power" -- which is the thing the Great Oxidation actually needs. A world
    // whose mantle is more reduced puts more H2, CO and H2S into the air per
    // unit melt, and each of those consumes oxygen.
    //
    // Earth's present mantle is the unit, so `mantleRedox` of 1 leaves every
    // number here exactly where it was.
    //
    // And *where* it erupts, which used to be missing entirely: land fraction
    // reached the oxygen budget only through weathering, so an ocean world and a
    // continental one delivered identical reducing power per unit volcanism.
    // SUBMARINE_REDOX above is why they should not.
    // Continent, not ice-free continent: a volcano under a kilometre of ice is
    // still degassing into air at one bar, and it is the sea that changes what
    // comes out. So this reads p.landFraction rather than landExposed, and
    // modern Earth's 0.29 leaves the present-day oxygen budget exactly where it
    // was.
    const emerged = clamp((p.landFraction ?? LAND_MODERN) / LAND_MODERN, 0, 1);
    const delivery = SUBMARINE_REDOX + (1 - SUBMARINE_REDOX) * emerged;
    const reductant = O2_REDUCTANT * outgassingScale(p.mass) * p.outgassing * meltBoost(p)
                    * Math.max(p.mantleRedox ?? 1, 0) * delivery;

    // Hydrogen that leaves the planet never consumes anything on it.
    //
    // The charge above bills the oxygen budget for volcanic reducing power as
    // though all of it is delivered, which is right for modern Earth: H2 lasts
    // two years in this air and is oxidised, not lost. On an anoxic world it is
    // not right at all. There, H2 accumulates until escape balances the source,
    // and what goes to space is reducing power the atmosphere never has to
    // answer for. The budget had the charge and no credit, so a world was billed
    // eightfold for its volcanism and refunded nothing when eight times as much
    // of it left the planet -- a one-sided error, pointing the way it hurts.
    //
    // This is Catling, Zahnle & McKay (2001): hydrogen escape irreversibly
    // oxidising the early Earth, and the reason an Archean can set up its own
    // oxygenation rather than needing a biosphere five times Earth's.
    //
    // Netted off the charge rather than added as free O2, and that distinction
    // is the whole of it. Escaping hydrogen does not *make* oxygen -- it fails
    // to consume it, and the oxidation it leaves behind goes mostly into the
    // crust as ferric iron and sulfate. Adding it as O2 would oxygenate an
    // anoxic world out of nothing, which is exactly the error this is fixing,
    // pointed the other way. Floored at zero: you cannot un-charge more than you
    // were charged, however much hydrogen a Hycean envelope is shedding.
    //
    // Both carriers count. Hydrogen that left as H2 and hydrogen that left as
    // the four atoms of a photolysed methane are the same reducing power gone to
    // space, and on an anoxic world the second is the larger stream -- which is
    // precisely Catling's argument and not a detail of it.
    const escapedReducing = (Math.max(esc.h2 ?? 0, 0) + Math.max(w.ch4Escape ?? 0, 0)) * O2_PER_H2;
    const reductantNet = Math.max(0, reductant - escapedReducing);

    // Oxidative weathering of the crust: first order in how much oxygen there
    // is, which is what makes the level settle instead of climbing for ever.
    // It needs liquid water, so a planet that has boiled dry keeps whatever its
    // lost ocean left behind -- Venus. The floor is seafloor oxidation: gating
    // it on exposed land alone would leave a waterworld, which has none, with
    // no sink at all.
    const weathering = (0.25 + 0.75 * landExposed) * liquid / O2_TAU_OX;

    // Kept for maxStep: how fast the reservoir is moving right now -- and it
    // has to be *all* of the terms, which it was not.
    //
    // Oxygen left behind by escaping hydrogen is credited a few hundred lines
    // up, where the water is lost, and it was missing from here entirely. On a
    // world that is losing an ocean it is the largest term by far, and it very
    // nearly cancels the reductant sink: the reservoir sits in a steady balance
    // at a few thousandths of a kg/m^2 and goes nowhere for hundreds of
    // megayears, while this rate reported it emptying in thirty years.
    //
    // maxStep believed it, because believing it is this rate's job. The oxygen
    // bound there allows a tenth of the reservoir per step, so on a wet runaway
    // it clamped the clock to five-year steps for ever -- on a planet where
    // nothing whatever was happening. Reported from the live site as 2.2 kyr/s
    // on a 1006 C world; Earth at 1.4 S(+) took 300 001 steps to cross 500 Myr
    // and now takes 884.
    //
    // Nothing about the physics moves: this is a diagnostic the integrator reads
    // and it was wrong about a quantity the integrator then had to respect.
    const photolytic = totalWater(w) > 0 ? Math.max(esc.water, 0) * (32 / 18) * 0.15 : 0;
    w.o2Rate = (source + photolytic - reductantNet) - w.o2 * weathering;
    // Semi-implicit in the part that depends on w.o2, so a long step cannot
    // overshoot past zero.
    const o2Before = w.o2;
    w.o2 = Math.max(0, (w.o2 + (source - reductantNet) * dtYears) / (1 + weathering * dtYears));
    w.o2Flux = { source, reductant: reductantNet, gross: reductant,
                 escaped: escapedReducing, weathering: w.o2 * weathering,
                 delivery, escapedH2: Math.max(esc.h2 ?? 0, 0) * O2_PER_H2,
                 escapedCH4: Math.max(w.ch4Escape ?? 0, 0) * O2_PER_H2 };

    // --- methane -----------------------------------------------------------
    // Deliberately *after* the oxygen, and this ordering is load-bearing.
    //
    // Methane's lifetime pivots on pO2 by three orders of magnitude across four
    // decades of it. Run methane first and it is integrated for the whole step
    // against the oxygen the previous step left behind -- so a step that spans
    // the Great Oxidation crossover accumulates thousands of ppm at a lifetime
    // that stopped being true early in it. That is not a small error: it put a
    // super-Earth at 74 C on fine steps and 579 C on coarse ones, and no bound
    // computed from the state at the start of the step can see it coming,
    // because at the start methane is sitting quietly in equilibrium.
    //
    // So the lifetime is taken from the oxygen *across* the step, averaged in
    // the quantity that actually enters the physics -- the oxidising fraction,
    // which is bounded in [0,1] and well behaved however far pO2 moves.
    {
      const g = d.g;
      const tau = methaneLifetime(o2Before * g / 1e5, dg.hazeTau ?? 0,
        p.xuvFraction / XUV_FRACTION_SUN, w.ch4, p.insolation, w.o2 * g / 1e5);

      // Life makes most of it. Oxygen does *not* switch this off, even though
      // methanogens are strict anaerobes: Earth runs twenty-one percent oxygen
      // and still emits a hundred and fifty teragrams a year, out of waterlogged
      // soil and sediment and guts, because anoxic microhabitats survive inside
      // an oxic world. What oxygen changes is how much of the biosphere's carbon
      // goes down that route -- on an anoxic world it is nearly all of it, and
      // on ours it is a sideline. Hence the boost rather than a cutoff.
      const oxidising = smoothstep(3e-7, 2e-4, 0.5 * (o2Before + w.o2) * g / 1e5);
      // Note this uses its own thermal limit rather than the oxygen cycle's
      // `alive`. Oxygen comes from photosynthesis, which gives up somewhere
      // around 330-360 K; methane comes from archaea, and they are famously
      // thermophilic -- Methanopyrus kandleri grows at 122 C. Handing
      // methanogens the photosynthesis ceiling is not a small conservatism, it
      // is a feedback loop with no brake: hotter kills the biosphere, which
      // removes the methane, which removes the haze, which lets in the sunlight
      // that made it hotter. A super-Earth sitting at 70 C -- the middle of that
      // band -- oscillated between 7 C and 75 C on it, and how far a step
      // reached decided whether it escaped the cycle into a runaway. That was
      // the whole of the step-size dependence; the haze self-shielding, which
      // was the other suspect, turned out to be innocent. What limits
      // methanogens here is the same thing that limits everything, `makes`, at
      // the point the surface stops being habitable at all.
      const wet = smoothstep(0, 0.015, w.water.ocean);
      // Light, though, it does need -- and that is a different gate from the
      // thermal one above, which is why it does not bring the oscillation back
      // with it.
      //
      // Methanogens do not photosynthesise, but almost all of them eat
      // something that did: the organic carbon raining down from the surface.
      // Cut the light and the substrate goes with it. This was missing, and it
      // is not a corner case, because the gas makes the smog that does the
      // cutting. A world whose haze had closed over -- absorbed sunlight
      // reading 0.0 W/m² at the ground -- went on producing methane at the full
      // Earth rate for ever, and at 0.274 S(+) with an Io-like interior it
      // reached SEVEN HUNDRED BARS of it and was still climbing.
      //
      // Proportional to the light, not a threshold on it. photosynthesis()'s
      // own bounds are survival limits -- the record, a ten-thousandth of full
      // sunlight, where green sulphur bacteria have been recovered in the Black
      // Sea -- and asking "could anything live here" is the wrong question for
      // a rate. What sets the methane flux is how much carbon the biosphere
      // fixes, and below saturation that is very nearly linear in the light it
      // gets. Used as a threshold this gate still passed 30% of Earth's methane
      // flux on a world whose haze let 0.2 W/m² reach the ground.
      //
      // CH4_LIGHT_SAT is where a biosphere stops being light-limited. At a
      // seventh of Earth's mean it leaves Earth and the Archean untouched --
      // both are saturated -- and only bites in the dark.
      //
      // The loop it closes is *negative*: more methane, more haze, less light,
      // less methane. The one the note above warns about ran the other way,
      // through temperature, and this does not touch temperature. What matters
      // is that the light is measured at the ground, through `swTrans`, and not
      // at the top of the atmosphere; photosynthesis() itself still reads the
      // unattenuated `S`, which is a separate and smaller version of the same
      // oversight.
      let ground = 0;
      for (let i = 0; i < NBANDS; i++) ground += dg.S[i] * (dg.swTrans ?? 1) / NBANDS;
      const lit = clamp(ground / CH4_LIGHT_SAT, 0, 1);
      const bio = CH4_BIO * Math.max(p.biosphere ?? 0, 0) * wet * lit
        * (1 + (CH4_ANOX_BOOST - 1) * (1 - oxidising));

      // And the interior makes the rest: serpentinisation and the seeps.
      const geo = CH4_GEO * outgassingScale(p.mass) * Math.max(p.outgassing ?? 0, 0) * meltBoost(p);

      // Nothing on a four-hundred-kelvin surface is making methane, biologically
      // or geologically. Without this a world could boil its ocean away and keep
      // a millibar of methane going, because the source had no idea the planet
      // had died. Titan is well below this and keeps its cryovolcanic supply.
      const makes = 1 - smoothstep(400, 600, dg.Tmean);

      // Methane is made of carbon, and until now it was made of nothing.
      //
      // Both terms were pure sources against no reservoir, which is invisible
      // while methane is a trace gas and absurd when it is not: the world that
      // prompted this held three hundred bar of CH4 -- eight hundred bar of
      // carbon -- while its mantle still had four hundred bar of its own, so
      // the planet was carrying twice the carbon it was ever given. The CO2
      // cycle has been drawing on a finite budget since carbonBudget() went in;
      // methane simply was not part of that accounting.
      //
      // It comes out of the two reservoirs the CO2 cycle already uses, and by
      // the same logic: the seeps and serpentinisation draw on the mantle, and
      // the biosphere recycles surface carbon -- methanogens eat what fell from
      // above, they do not mine it. Both are capped by what is actually there,
      // so an exhausted pool stops the source rather than going negative.
      const CH4_AS_CO2 = 44 / 16;    // the same carbon, weighed as CO2
      let bioRate = bio * makes, geoRate = geo * makes;
      // The geological source is a *drain*: its carbon comes out of the mantle
      // and is debited below, so capping its rate at what is left over the step
      // is right and keeps the reservoir from going negative.
      if (dtYears > 0 && !p.mantleInfinite) {
        geoRate = Math.min(geoRate, Math.max(w.carbonDeep, 0) / CH4_AS_CO2 / dtYears);
      }
      // The biological source is a *loop*, and treating it as a drain was a bug
      // with teeth. Methanogens recycle carbon that is already at the surface:
      // what they emit is CO2 again within a methane lifetime, and nothing is
      // debited for it anywhere in this function. Capping that rate at
      // (surface carbon)/dt therefore said a longer step may make less methane
      // per year than a short one -- so a half-megayear stride allowed a sixth
      // of the source a millennial one did, and Earth's methane collapsed from
      // 800 to 126 ppb on every long step and climbed back over the short ones
      // after it. A clean period-five limit cycle in the step controller, worth
      // 0.4 K and a tenfold slowdown, and invisible until methane's 7.7 um band
      // was strong enough for anyone to feel it.
      //
      // What the carbon really limits is the *standing stock*: the air cannot
      // hold more carbon as methane than the surface system has. That is a cap
      // on the reservoir, applied after the step, and it does not care how long
      // the step was.
      w.ch4Source = bioRate + geoRate;
      const ch4Before = w.ch4;
      // Semi-implicit, so an arbitrarily long step still lands on the right
      // answer instead of overshooting past zero.
      w.ch4 = Math.max(0, (w.ch4 + w.ch4Source * dtYears) / (1 + dtYears / tau));
      w.ch4 = Math.min(w.ch4, Math.max(w.co2, 0) * kappa / CH4_AS_CO2
                            + Math.max(w.carbonDeep, 0) / CH4_AS_CO2);
      const destroyed = Math.max(0, ch4Before + w.ch4Source * dtYears - w.ch4);

      // Where the hydrogen goes. Photolysis frees four hydrogens per methane,
      // and on an anoxic world they go to space rather than finding their way
      // back into water: that is the irreversible oxidation of Catling, Zahnle &
      // McKay (2001), and it is credited against the volcanic reductant charge
      // in the oxygen block above, on the next step. Two ceilings bind it --
      // what escapeRates says can cross the homopause, and what photolysis is
      // actually breaking up here, because hydrogen cannot leave a molecule that
      // is still intact.
      w.ch4Escape = dtYears > 0
        ? Math.min(destroyed * H2_PER_CH4 / dtYears, Math.max(esc.ch4H2Cap ?? 0, 0))
        : 0;

      // Destroyed methane hands its carbon back to the surface pool, whatever
      // destroyed it, so the cycle closes where it opened.
      //
      // The anoxic route really is different in kind -- photolysis polymerises
      // the carbon into tholin, the hydrogen escapes, and what settles out is
      // buried, which is Catling's irreversible oxidation of the early Earth --
      // and sending that share to the interior instead was tried first. It does
      // not work here, and the reason is structural rather than a tuning
      // failure: burial is one-way, so at steady state it is a pump running
      // surface-to-mantle at the full production rate for ever. An anoxic world
      // at five times Earth's volcanism would have pushed six thousand bar
      // through it in twenty billion years, emptied its surface pool, and then
      // gone on crediting the mantle with carbon the surface no longer had,
      // because the debit clamps at zero and the credit does not.
      //
      // Representing it properly needs an organic-carbon reservoir the model
      // does not have. Closing the loop is the conservative approximation: it
      // cannot manufacture carbon and it cannot pump it, and what it gives up
      // is a slow burial term that on Earth is about a tenth of the total.
      w.co2 = Math.max(0, w.co2 + (destroyed - bioRate * dtYears) * CH4_AS_CO2 / kappa);
      if (!p.mantleInfinite) {
        w.carbonDeep = Math.max(0, w.carbonDeep - geoRate * dtYears * CH4_AS_CO2);
      }
      w.ch4Tau = tau;
    }
  }

  // --- CO2 condensation onto polar caps (Mars-like collapse) ---------------
  let coldFrac = 0, Tcold = 1e9;
  for (let i = 0; i < NBANDS; i++) { if (w.T[i] < Tcold) Tcold = w.T[i]; }
  const pCO2Pa = w.co2 * dg.g;
  const pEq = psatCO2(Tcold);
  const tau = 2000; // years
  const relax = 1 - Math.exp(-dtYears / tau);
  if (pCO2Pa > pEq * 1.001) {
    for (let i = 0; i < NBANDS; i++) if (w.T[i] < frostPointCO2(pCO2Pa)) coldFrac += 1 / NBANDS;
    if (coldFrac > 0) {
      const target = pEq / dg.g;
      const move = (w.co2 - target) * relax * clamp(coldFrac * 3, 0, 1);
      w.co2 -= move; w.co2Frozen += move;
    }
  } else if (w.co2Frozen > 0) {
    const target = Math.min(w.co2Frozen, (pEq / dg.g - w.co2));
    const move = Math.max(0, target) * relax;
    w.co2 += move; w.co2Frozen -= move;
  }

  // --- atmospheric escape of the background gas ---------------------------
  //
  // Energy-limited escape is a constant mass flux, not a fractional one, and
  // subtracting a constant flux from a reservoir that is nearly empty is how a
  // result becomes a property of the step size: a long stride took the column
  // straight to zero and the next step's outgassing put some back, so a stripped
  // world's atmosphere was whatever one step's volcanism happened to be.
  //
  // The flux is throttled by the column instead. Hydrodynamic escape needs an
  // outflow to organise itself over many scale heights above the surface; as the
  // column falls toward one scale height there is no longer a wind, the exobase
  // sits on the ground, and what is left leaves by Jeans escape at a rate that
  // is negligible on these timescales. COL_HYDRO is that column, in surface-
  // pressure terms about ten millibars at Earth gravity, and the cube is there
  // because that transition is sharp rather than gradual: either the XUV heating
  // organises a transonic outflow or it does not, which is the whole content of
  // being on one side of the cosmic shoreline or the other.
  //
  // What this buys is a real steady state. A world above the cosmic shoreline
  // with volcanoes still running settles where escape balances outgassing rather
  // than oscillating between empty and one step's worth.
  if (esc.background > 0) {
    const col = Math.max(w.n2 + w.co2 + w.o2, 0);
    if (col > 0) {
      const t = col / (col + COL_HYDRO);
      const rate = esc.background * t * t * t;
      const k = rate / col;                       // first order in the thin limit
      const f = 1 / (1 + k * Math.max(dtYears, 0));
      w.n2 *= f; w.co2 *= f; w.o2 *= f;
    }
  }

  // --- hydrogen: outgassed by a reduced mantle, and leaking the whole time ---
  //
  // The balance is the point. Hydrogen escapes so fast that its abundance is a
  // steady state between volcanism and loss rather than an inventory, which is
  // why Ramirez et al. (2014) have to argue for a *sustained* 5-20% on early
  // Mars rather than an initial one, and why they end up an uncomfortable factor
  // of four short with their own best outgassing estimate.
  //
  // The source scales the same way carbon does -- melt production, so planet
  // size and interior heat -- times how reduced the mantle is. `mantleRedox` is
  // 1 for an Earth-like oxidised mantle and rises as fO2 falls; Ramirez puts
  // early Mars around twenty, three log units below the iron-wustite buffer.
  if (w.h2 == null) w.h2 = 0;
  {
    const redox = Math.max(p.mantleRedox ?? 1, 0);
    const src = H2_OUTGAS_EARTH * outgassingScale(p.mass) * Math.max(p.outgassing, 0)
              * meltBoost(p) * redox;
    // Semi-implicit, like every other reservoir here, and for a sharper reason
    // than the others. Escape is very nearly first order in the amount present,
    // and on an anoxic world the reservoir turns over in about half a megayear
    // -- shorter than the steps this model is designed to take. Integrated
    // explicitly, as it was, any step past twice that e-folding time made it
    // oscillate instead of settle: at a fixed five-megayear step the Archean's
    // steady 17.65 kg/m2 became a sawtooth between zero and 184. Nothing
    // downstream noticed while escaping hydrogen was merely lost; it matters now
    // that the same flux credits the oxygen budget, because the sawtooth drove a
    // Great Oxidation that the physics does not have. Hydrogen was the one
    // reservoir with neither an implicit form nor a bound in maxStep and it now
    // has both. This form is exact at steady state and cannot overshoot past
    // zero at any step, in either the diffusion-limited or the energy-limited
    // regime.
    const kEsc = w.h2 > 0 ? Math.max(esc.h2 ?? 0, 0) / w.h2 : 0;
    const h2Before = w.h2;
    w.h2 = Math.max(0, (w.h2 + src * dtYears) / (1 + kEsc * dtYears));
    // And free oxygen takes it straight back out. Escape alone left modern Earth
    // holding 134 ppm of hydrogen against an observed 0.55, because on an
    // oxygenated world escape is not what limits it -- reaction is. H2 lasts
    // about two years in today's air and geological ages in anoxic air, which is
    // the same redox switch that governs methane, for the same reason.
    //
    // It lands at 2 ppb rather than 0.55, and the shortfall is in the *source*
    // rather than in this sink: the only H2 source here is volcanic, where most
    // of the real Earth's comes from methane photolysis, biomass burning and the
    // ocean. Nothing downstream depends on it -- Earth's hydrogen escape is
    // carried by methane, not by H2, and comes out at 8e7 atoms/cm2/s against an
    // observed ~1e8 -- but the number is wrong and saying so is cheaper than
    // letting the sentence above imply otherwise.
    //
    // The kinetics set the rate and the oxygen sets the budget, and it used to
    // be only the first of those: a bare exponential that consumed no oxygen
    // and made no water, so ten bars of hydrogen disappeared in two centuries
    // while the O2 moved by six parts in a million. A bar of H2 needs 7.94 bar
    // of O2 to finish and Earth has 0.21, so past that ratio it is the oxygen
    // that runs out. The air ends up reduced, the leftover hydrogen is stable
    // -- the anoxic branch, reached from the oxic one -- and the switch closes
    // itself, because `oxidising` is a function of the pO2 being spent here.
    //
    // Escape is untouched by this and stays where it is: it is the slow,
    // gravity-limited loss that decides what a planet can hold over geological
    // time, and it is the reason a bar of hydrogen does not last for ever even
    // once the oxygen is gone.
    const oxidising = smoothstep(3e-7, 2e-4, dg.pO2);
    if (oxidising > 0 && w.h2 > 0) {
      const tau = H2_OXIDISED_LIFETIME / oxidising;
      const wanted = w.h2 * (1 - Math.exp(-Math.max(dtYears, 0) / tau));
      const afford = Math.max(w.o2, 0) / O2_PER_H2;
      const burnt = Math.min(wanted, afford);
      if (burnt > 0) {
        w.h2 -= burnt;
        // Only the hydrogen burnt *faster than it is being made* is charged to
        // the oxygen. The steady volcanic trickle is already paid for, once, by
        // O2_REDUCTANT above -- that term is the reduced volcanic gases the
        // biosphere has to outrun, and O2_BIO is fitted against it to put Earth
        // at 0.21 bar. Billing it again here is billing the same reductant
        // twice: it added 42% to the flux and took Earth's oxygen, its surface
        // pressure and its carbon cycle out with it. In steady state this term
        // is zero and nothing moves; it bites only on hydrogen that arrived by
        // some other route, which is exactly the case that was broken.
        const excess = Math.max(0, burnt - src * dtYears);
        w.o2 = Math.max(0, w.o2 - excess * O2_PER_H2);
        // The water from it, on the same footing and for the same reason.
        w.water.ocean += excess * H2O_PER_H2 / Math.max(d.eoColumn, 1e-9);
      }
    }
    // The rate maxStep bounds on is the one the reservoir *realised*, source
    // and escape and oxidation together. Bounding on source-minus-escape alone
    // looks at modern Earth -- where hydrogen is in a two-year chemical steady
    // state and escape is a rounding error -- and sees a reservoir turning over
    // in four centuries, which held the clock to 376-year steps and cost a
    // factor of forty on a world where nothing is happening.
    w.h2Rate = dtYears > 0 ? (w.h2 - h2Before) / dtYears : 0;
  }

  // --- a molten surface degasses hard -------------------------------------
  // A magma ocean has no crust to hold anything down, so it gives up its carbon
  // thirty times faster. Out of the same finite reservoir as everything else:
  // this term had no budget either, and between them the two accounted for the
  // 24 000 bar.
  if (dg.Tmean > 1400 && w.carbonDeep > 0) {
    const molten = Math.min(V * 30, dtYears > 0 ? w.carbonDeep / dtYears : 0);
    w.co2 += molten * dtYears;
    w.carbonDeep = Math.max(0, w.carbonDeep - molten * dtYears);
  }

  w.escape = esc;
  // V carries the emissions so maxStep's carbon bound sees them: forty times
  // the volcanic flux doubles the atmospheric reservoir in a few decades, and a
  // step chosen against volcanism alone would stride straight over it.
  // The emissions are folded in at their airborne share and multiplied back up
  // by kappa, so that maxStep's carbon bound -- which divides by kappa -- sees
  // the flux the atmosphere actually gets. Forty times the volcanic rate
  // doubles the reservoir in a few decades, and a step chosen against volcanism
  // alone would stride straight over the whole industrial era.
  w.weathering = { V: V + emit * AIRBORNE * kappa, W: Wr, kappa, liquid };
}
