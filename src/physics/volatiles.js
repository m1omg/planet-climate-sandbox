import {
  clamp, smoothstep, psatH2O, psatCO2, frostPointCO2, YEAR,
  OUTGAS_EARTH, CARBON_RESERVOIR_FACTOR, CO2_EARTH_COL, XUV_FRACTION_SUN, G_EARTH, M_EARTH,
} from './constants.js';
import { iceFraction } from './radiation.js';
import { nonThermalEscape, resurfacingProgress } from './evolution.js';
import { stepLife } from './biosphere.js';
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

// How far the real stratosphere overshoots bare saturation at the cold trap.
// Fixed by modern Earth: saturation at 190 K over a bar is 3.2e-7, and the
// observed stratospheric mixing ratio is 4 ppm. See escapeRates().
const COLD_TRAP_OVERSHOOT = 12.37;

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
// The rest of what an industrial civilisation puts in the air, which is not a
// footnote: CO2 is 2.16 W/m^2 of the 2019 forcing against 1750 and everything
// else together is another 1.16 (IPCC AR6 Table 7.8). Three components, and
// they are kept apart because they behave completely differently.
//
//   METHANE, 0.54 W/m^2, goes into the methane reservoir that already exists
//   rather than being lumped, because the model has the gas and knows what to
//   do with it -- including its shortwave absorption and its ten-year life.
//   Anthropogenic methane is about 360 of the 580 Tg/yr Earth emits, against
//   the 218 Tg/yr natural budget CH4_BIO is anchored on, so it is 1.65x nature
//   at today's rate. This is what the CH4_BIO comment meant by "most of today's
//   methane is ours": until now the model had the natural budget and no us, so
//   a modern Earth relaxed to 0.72 ppm within a century. Now it holds 1.9.
//
//   NITROUS OXIDE AND THE HALOCARBONS, 0.62 W/m^2 between them, are lumped into
//   one effective forcing. Nothing is gained by resolving CFC-12 from HFC-134a
//   from SF6 here: they are all long-lived, well-mixed, and small enough that
//   what matters is the total and the timescale. 150 years is the mass-weighted
//   life of the mixture -- N2O is 116, the CFCs 45-100, SF6 three thousand.
//
//   SULPHATE AEROSOL, and this one cools: -1.1 W/m^2, which is why the planet
//   has warmed 1.3 K and not 2.4. It is emitted by the same combustion and it
//   is gone in about a week, so unlike the gases it tracks activity rather than
//   accumulating -- and that asymmetry is the whole reason it is worth
//   modelling. Stop burning and the aerosol is gone within the decade while the
//   gases stay for centuries, so the planet gets warmer before it gets cooler.
//   That is the termination shock, and with only CO2 in the model there was no
//   way to see it.
//
// The three very nearly cancel to the CO2-only answer at today's rate, which is
// why this could be added without moving the calibration: +0.54 and +0.62
// against -1.1. What it changes is everything away from today's rate.
const CH4_ANTHRO = 1.33e-3;     // kg/m^2/yr of CH4 at the present-day rate
export const OTHER_GHG_FULL = 0.62;   // W/m^2 at 1x, N2O + halocarbons
const OTHER_GHG_TAU = 150;      // yr
export const AEROSOL_FULL = 1.10;     // W/m^2 of cooling at 1x
const AEROSOL_TAU = 5;          // yr -- a week, rounded up to something a solver can see

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
// How long the water takes to actually get there. See partitionWater().
export const TRAP_TAU = 5e4;        // years

export function partitionWater(w, dtYears = 0) {
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
  const target = clamp(wanted, 0, surface * 0.999);

  // ...but it gets there at a rate, not instantly, and that is the whole of it.
  //
  // The sheet's *extent* has had a fifteen-thousand-year memory since it became
  // a state variable; its *mass* did not, and was recomputed algebraically from
  // the target every step. So a world creeping towards the trap threshold could
  // move its entire remaining ocean onto the continents inside one step of any
  // size -- Early Venus did exactly that, dropping the flooded fraction from
  // 0.18 to 0.007 in a single step and taking its cloud deck with it. Absorbed
  // sunlight jumped sixty watts, the planet warmed thirty kelvin, the clock
  // fell to hundredths of a year, and it then cycled between a desert and a
  // moist greenhouse for the rest of the run.
  //
  // Fifty thousand years, and it is the atmosphere's timescale rather than the
  // ice's: what limits a cold trap is how fast the air can carry water to it.
  // Earth's whole atmospheric column is 25 mm of water and turns over in nine
  // days, so moving a 300 m ocean to the poles takes of order 10^4 to 10^5
  // years even with every drop that falls there staying. The sheets themselves
  // are slower still. Nothing in this model is sensitive to which of those two
  // sets the number; what matters is that it is not zero.
  //
  // Both directions, because a trap that releases instantly is the same
  // discontinuity run backwards.
  if (w.landIceMass == null || !isFinite(w.landIceMass)) w.landIceMass = target;
  // Whatever else has happened to the inventory -- escape, condensation,
  // outgassed water -- the sheet cannot hold more than there is.
  w.landIceMass = clamp(w.landIceMass, 0, surface * 0.999);
  if (dtYears > 0) {
    const relax = 1 - Math.exp(-dtYears / TRAP_TAU);
    w.landIceMass += (target - w.landIceMass) * relax;
  } else if (w.landIceMass == null) {
    w.landIceMass = target;
  }
  w.landIceTarget = target;
  // How hard the trap is pulling. Nothing reads this yet, and it is here
  // deliberately: bounding the step on the sheet mass having already fallen out
  // of step with its target is one stride too late by construction -- the stride
  // that opened the gap has been taken -- so a bound wants to know the trap is
  // *live* before anything has moved. Written now because the diagnosis is
  // fresh; wiring it into maxStep on its own moved a carbon-starved eyeball onto
  // the 474 C branch that tools/convergence.mjs now reports, so it waits for
  // that world to be understood.
  w.trapActive = trap * (surface > 1e-4 ? 1 : 0);
  const landIce = clamp(w.landIceMass, 0, surface * 0.999);
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
export function escapeRates(w) {
  const p = w.params, dg = w.diag, d = dg.d;
  const pTot = Math.max(1e-6, dg.pTotMean);
  let pH2Omean = 0;
  for (let i = 0; i < NBANDS; i++) pH2Omean += dg.pH2O[i];
  pH2Omean /= NBANDS;

  // Stratospheric water mixing ratio. The cold trap suppresses it enormously,
  // but the suppression weakens as the lower atmosphere gets wetter. This power
  // law is pinned to two points: modern Earth (surface mixing ratio 0.011 gives
  // the observed ~4 ppm in the stratosphere) and the moist-greenhouse onset
  // (surface 0.25, i.e. a 340 K surface, gives Kasting's 1e-3 criterion). The
  // x^8 term takes over when the air is mostly steam and there is no trap left.
  // Evaluated band by band and then area-averaged: escape is dominated by the
  // warmest, wettest latitudes, not by the global mean.
  const xSteam = pH2Omean / pTot;
  // The cold trap, which was computed here and then read by nothing.
  //
  // `Tct` has been in this function since the escape model was written, is
  // returned in the diagnostics, and no line of the model consumed it. So the
  // one temperature in the whole escape calculation was dead, and the
  // stratospheric mixing ratio was a pure function of pH2O/pTot -- a RATIO.
  //
  // That is fine while the background gas stays put and catastrophic when it
  // does not. Early Venus has no magnetic field, so non-thermal escape strips
  // its nitrogen: the column falls from 1.13e4 kg/m^2 to 47 by age 3.47 Gyr and
  // the surface pressure with it, 1.013 bar to 0.045. The numerator barely
  // moves -- pH2O goes 0.0096 to 0.028 bar on a surface that is still near
  // freezing -- but the DENOMINATOR collapses, so x runs away, fStrat crosses
  // Kasting's 1e-3 moist-greenhouse criterion at an age of 3.4 Gyr with a mean
  // surface temperature of 3 C, and the planet quietly bleeds its ocean to
  // space while frozen. 89% of the inventory left below 35 C. The readout has
  // been flagging that world as a moist greenhouse, in red, at three degrees.
  //
  // A cold trap does not work on a ratio. It works on saturation: whatever the
  // air below is doing, no more water gets past the tropopause than is
  // saturated at the tropopause temperature. So that is the ceiling, and `Tct`
  // is finally what sets it.
  //
  // Both constants are fixed by the two points the empirical fit below is
  // already pinned to, which is why this can be added without recalibrating
  // anything. COLD_TRAP_OVERSHOOT is what modern Earth needs to get from bare
  // saturation at 190 K (3.2e-7) to its observed 4 ppm -- real air overshoots
  // the trap, convection punches through it, and methane oxidation makes more
  // water up there. The slope is then fixed by requiring Kasting's 340 K
  // surface to give 1e-3, which lands it at 0.80 K of trap per K of surface.
  // Earth reads 4.00e-6 and the moist-greenhouse onset reads 1.00e-3: the same
  // two anchors, from saturation physics instead of a power law.
  const Tct = clamp(190 + 0.7997 * (dg.Tmean - 288), 120, 700);
  // Deliberately NOT clamped to 1. How far above unity this runs is exactly the
  // measure of how badly the trap has failed, and the blend below needs it.
  const trapCeiling = Math.max(0, COLD_TRAP_OVERSHOOT * psatH2O(Tct) / (pTot * 1e5));
  let fStrat = 0;
  for (let i = 0; i < NBANDS; i++) {
    const x = clamp(dg.pH2O[i] / Math.max(dg.pTot[i], 1e-9), 0, 1);
    // x^8 written out: three multiplies against a call into pow's exp-and-log.
    const x2 = x * x, x4 = x2 * x2;
    // The fit still runs the show wherever it is the smaller of the two, which
    // is everywhere the atmosphere is thick and the surface temperate -- so
    // Earth, the Archean and every anchor keep the number they had. The
    // ceiling only bites where the fit has stopped meaning anything: a cold
    // surface under an atmosphere that has been blown away.
    const trapped = Math.min(clamp(0.0115 * Math.pow(x, 1.764) + x4 * x4, 0, 1),
                             trapCeiling);

    // ...and when the trap has failed outright, neither number means anything.
    //
    // A cold trap is a place where water condenses. Once the saturation mixing
    // ratio at the tropopause exceeds the amount of water actually present,
    // there is no such place anywhere in the column: nothing condenses at any
    // altitude, the air is well mixed from the ground to the exobase, and the
    // stratospheric mixing ratio is simply x. Kasting's power law is a fit to
    // the regime where a trap exists, and extrapolating it past that point is
    // what kept this model's Venus wet. In full runaway it has 22% water by
    // pressure and the fit returned 7.6e-4 -- suppressing escape 290-fold, on
    // behalf of a cold trap that is 300 K too warm to condense anything. Venus
    // shed a third of its ocean in 650 Myr instead of all of it, arrived at the
    // present under nineteen bar of steam, and sat at 928 K because steam is a
    // far better greenhouse gas than the CO2 that is supposed to be doing the
    // work. The planet was hot for the wrong reason.
    //
    // So the fit is the answer while the trap holds, x is the answer once it
    // cannot, and the crossover is where the ceiling passes x. Smoothed over a
    // factor of three in that ratio, because a discontinuity in escape at the
    // exact moment a planet is running away is a step-size trap.
    const failed = smoothstep(0.3, 1, trapCeiling / Math.max(x, 1e-12));
    fStrat += (trapped + (x - trapped) * failed) / NBANDS;
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

  const escapeScale = clamp(p.escapeScale ?? 1, 0, 100);
  const water = Math.min(diffusion, energy) * (dg.totalWater > 0 ? 1 : 0) * escapeScale;

  // Background gas loss. Gated on the cosmic shoreline: XUV irradiation has to
  // overcome gravitational binding (~ v_esc^4) before N2/CO2 go anywhere.
  const vescRel = d.vesc / 11186;
  const fCrit = 1.15e-3 * Math.pow(vescRel, 4) * 30;
  const gate = smoothstep(0.3, 3, xuv / Math.max(fCrit, 1e-12));
  const background = 0.005 * xuv / (dg.g * d.R) * YEAR * gate * escapeScale;

  // ...and the channel that has no threshold at all: the solar wind stripping
  // ions off whatever the magnetosphere does not cover. See nonThermalEscape.
  const nonThermal = nonThermalEscape(p, d, xuv, pTot) * escapeScale;

  return { water, background, nonThermal, fStrat, Tct, diffusion, energy, xSteam };
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
//   carbon       cyanobacteria run carbon-concentrating mechanisms and draw CO2
//     down to a few ppm. C3 plants give up nearer 50.
//   water        liquid, and enough of it to be a habitat.
//
// Taken band by band rather than from the global mean, because that is how the
// condition actually works. A world whose average is -30 C can still have a
// warm equatorial belt doing the whole planet's photosynthesis, and a tidally
// locked world has a night side where the light term is zero however warm the
// air is.
export function photosynthesis(w) {
  const dg = w.diag;
  const water = smoothstep(0, 0.015, w.water.ocean);
  if (water <= 0) return 0;
  const carbon = smoothstep(1e-6, 8e-6, dg.pCO2 ?? 0);
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
  // Who is living here. Reads the climate, changes nothing about it -- see
  // biosphere.js for why that separation is deliberate.
  stepLife(w, dtYears);

  const p = w.params, dg = w.diag, d = dg.d;
  // Venus's resurfacing supplied the secondary N2 atmosphere as well as CO2.
  // Integrating a cumulative progress curve makes the delivered bar exact even
  // when maxStep changes by orders of magnitude through the event.
  if ((p.resurfacingN2Bar ?? 0) > 0 && dtYears > 0) {
    const a = resurfacingProgress(p, w.time / 1e9);
    const b = resurfacingProgress(p, (w.time + dtYears) / 1e9);
    w.n2 += Math.max(0, b - a) * p.resurfacingN2Bar * 1e5 / d.g;
  }
  const esc = escapeRates(w);
  let escapeO2 = 0;      // kg/m^2/yr, filled in by the water block below

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
      // Oxygen left behind when the hydrogen goes; some is taken up by the
      // crust. Handed to the oxygen cycle below as a rate rather than added
      // here, and that is not tidiness.
      //
      // Added directly, it went into w.o2 *before* the oxygen block ran, and
      // the methane block then read the pre-block value as "the oxygen at the
      // start of the step". On a world whose reductants pin oxygen at zero --
      // every anoxic volcanic world in the game -- that value was not the
      // oxygen the atmosphere had, it was a spike proportional to the step,
      // deposited and removed within the same step. Methane's lifetime pivots
      // over four decades of pO2 and a spike of a few times 1e-5 bar lands in
      // the middle of them, so the lifetime came out a function of dt: 7300
      // years on a 25 kyr step and 5500 on an 87 kyr one. Methane then rang
      // between 0.5 and 2.4 ppm from step to step, and the step controller rang
      // with it. Early Venus spent its whole run doing this.
      escapeO2 = dtYears > 0 ? lostEO * d.eoColumn * (32 / 18) * 0.15 / dtYears : 0;
    }
  }
  // Proportional escape approaches zero asymptotically. Below a trillionth of
  // an Earth ocean the remaining global film is micrometres deep, but leaving
  // subnormal floating-point crumbs alive makes maxStep honour a 5% water-loss
  // bound forever and can hold a fully desiccated Venus to one-year steps.
  const remnant = totalWater(w);
  if (remnant > 0 && remnant < 1e-12) {
    w.water.lost += remnant;
    w.water.ocean = 0; w.water.seaIce = 0; w.water.landIce = 0; w.water.vapour = 0;
  }
  partitionWater(w, dtYears);

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

  // Everything else the same activity emits. `running` is the industrial rate
  // that is actually happening, which is not p.emissions once the reserve has
  // run out: an economy with nothing left to burn has stopped making nitrous
  // oxide and sulphate too. Taken from the CO2 flux so the three can never
  // disagree about whether industry is running.
  {
    const running = EMIT_TODAY > 0 ? clamp(emit / EMIT_TODAY, 0, 100) : 0;
    w.industrial = running;
    // Both semi-implicit, so a long step lands on the answer instead of past it.
    const relaxTo = (have, target, tau) =>
      dtYears > 0 ? (have + (target / tau) * dtYears) / (1 + dtYears / tau) : have;
    w.otherGHG = relaxTo(w.otherGHG ?? 0, OTHER_GHG_FULL * running, OTHER_GHG_TAU);
    w.aerosol = relaxTo(w.aerosol ?? 0, AEROSOL_FULL * running, AEROSOL_TAU);
  }
  const liquid = clamp(1 - dg.iceMean, 0, 1) * smoothstep(0, 0.02, w.water.ocean);
  // Drying can expose basaltic seafloor without turning it into continental
  // crust, so nominal land remains the upper bound. Flooding can also drown
  // those continents, though: count only the smaller of the reference land and
  // the land that is actually still above water.
  const landExposed = clamp(Math.min(p.landFraction, dg.landFrac) * (1 - dg.iceMean), 0, 1);
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
  if (w.carbonDeep == null) {
    w.carbonDeep = Math.max(0, carbonBudget(p.mass)
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
    const source = O2_BIO * w.bio + escapeO2;

    // Reduced volcanic gases, straight out of the ground and into the air.
    // This is the term the biosphere has to outrun, and until it does the
    // atmosphere stays anoxic however long you wait -- which is why the Archean
    // stayed anoxic for a billion years with photosynthesis already running
    // (Catling & Zahnle 2020). The Great Oxidation is that threshold being
    // crossed, and here it falls out of the arithmetic rather than being staged.
    const reductant = O2_REDUCTANT * outgassingScale(p.mass) * p.outgassing * meltBoost(p);

    // Oxidative weathering of the crust: first order in how much oxygen there
    // is, which is what makes the level settle instead of climbing for ever.
    // It needs liquid water, so a planet that has boiled dry keeps whatever its
    // lost ocean left behind -- Venus. The floor is seafloor oxidation: gating
    // it on exposed land alone would leave a waterworld, which has none, with
    // no sink at all.
    const hotDryRock = Math.max(p.hotRockOxidation ?? 0, 0)
      * smoothstep(450, 650, dg.Tmean) * (1 - liquid) / 5e6;
    const weathering = (0.25 + 0.75 * landExposed) * liquid / O2_TAU_OX + hotDryRock;

    // Kept for maxStep: how fast the reservoir is moving right now.
    w.o2Rate = (source - reductant) - w.o2 * weathering;
    // Semi-implicit in the part that depends on w.o2, so a long step cannot
    // overshoot past zero.
    const o2Before = w.o2;
    w.o2 = Math.max(0, (w.o2 + (source - reductant) * dtYears) / (1 + weathering * dtYears));
    w.o2Flux = { source, reductant, weathering: w.o2 * weathering };

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
      // Ours is added beside the biosphere's rather than inside it: it does not
      // scale with how hard photosynthesis is running, it scales with us. It is
      // still gated on there being liquid water and a lit surface, because a
      // civilisation on a frozen or sunless world is not a case this model has
      // anything to say about and letting the term through unconditionally
      // would have put methane on a planet that had boiled dry.
      const bio = (CH4_BIO * Math.max(p.biosphere ?? 0, 0)
          * (1 + (CH4_ANOX_BOOST - 1) * (1 - oxidising))
        + CH4_ANTHRO * (w.industrial ?? 0)) * wet * lit;

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
      // The mantle term is a one-way drain -- carbon leaves the interior and
      // does not go back -- so what it may take is what is there, over the step.
      if (dtYears > 0 && !p.mantleInfinite) {
        geoRate = Math.min(geoRate, Math.max(w.carbonDeep, 0) / CH4_AS_CO2 / dtYears);
      }
      // The biological term is not a drain at all. Methanogens borrow surface
      // carbon and oxidation hands it straight back a decade later, so over any
      // step longer than the methane lifetime the net transfer is nil -- what
      // the loop holds is a standing stock, not a debt.
      //
      // Capping this flux at pool/dt, the way the mantle one is capped, was
      // therefore wrong twice over: it limited a gross flux by a net budget,
      // and it made the answer a function of the step size. On Earth the cap
      // bit by a factor of five, so methane read 0.16 ppm on a 250 kyr step and
      // 0.82 ppm on a 16 kyr one. That is 0.28 W/m^2 of forcing appearing and
      // disappearing with the step, which drove the step controller into a
      // three-step limit cycle -- 0.2 K of temperature ringing, and the clock
      // dropping from 250 kyr steps to 10 kyr for the rest of the run. It is
      // the flicker seen on a brightening Earth.
      //
      // What is actually bounded is the standing stock: the loop cannot hold
      // more carbon as methane than the surface has to lend it. bioRate * tau
      // is that stock, so this is the same conservation guarantee, stated in
      // the quantity it belongs to and independent of the step.
      bioRate = Math.min(bioRate,
        Math.max(w.co2, 0) * kappa / CH4_AS_CO2 / Math.max(tau, 1));
      // Semi-implicit, so an arbitrarily long step still lands on the right
      // answer instead of overshooting past zero.
      w.ch4Source = bioRate + geoRate;
      const ch4Before = w.ch4;
      w.ch4 = Math.max(0, (w.ch4 + w.ch4Source * dtYears) / (1 + dtYears / tau));
      const destroyed = Math.max(0, ch4Before + w.ch4Source * dtYears - w.ch4);

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
  if (esc.background > 0) {
    const f = Math.max(0, 1 - esc.background * dtYears / Math.max(w.n2 + w.co2 + w.o2, 1e-6));
    w.n2 *= f; w.co2 *= f; w.o2 *= f;
  }
  // The non-thermal channel runs whatever the flux, so it is not gated the way
  // the hydrodynamic one above is. It takes the background mixture in
  // proportion, which is close enough: the wind picks off what is at the top of
  // the atmosphere, and on the worlds where this matters that is nearly all CO2
  // anyway. Only what is airborne is exposed -- carbon in the ocean, in the
  // crust or frozen onto the poles is not.
  if (esc.nonThermal > 0) {
    const col = w.n2 + w.co2 + w.o2;
    if (col > 0) {
      const f = Math.max(0, 1 - esc.nonThermal * dtYears / col);
      w.n2 *= f; w.co2 *= f; w.o2 *= f;
    }
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
