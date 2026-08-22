import {
  clamp, smoothstep, psatH2O, psatCO2, frostPointCO2, YEAR,
  OUTGAS_EARTH, CARBON_RESERVOIR_FACTOR, CO2_EARTH_COL, XUV_FRACTION_SUN, G_EARTH,
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
export function escapeRates(w) {
  const p = w.params, dg = w.diag, d = dg.d;
  const pTot = Math.max(1e-6, dg.pTotMean);
  const pH2Omean = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;

  // Stratospheric water mixing ratio. The cold trap suppresses it enormously,
  // but the suppression weakens as the lower atmosphere gets wetter. This power
  // law is pinned to two points: modern Earth (surface mixing ratio 0.011 gives
  // the observed ~4 ppm in the stratosphere) and the moist-greenhouse onset
  // (surface 0.25, i.e. a 340 K surface, gives Kasting's 1e-3 criterion). The
  // x^8 term takes over when the air is mostly steam and there is no trap left.
  // Evaluated band by band and then area-averaged: escape is dominated by the
  // warmest, wettest latitudes, not by the global mean.
  const xSteam = pH2Omean / pTot;
  const Tct = clamp(190 + 0.62 * (dg.Tmean - 288), 120, 700);
  let fStrat = 0;
  for (let i = 0; i < NBANDS; i++) {
    const x = clamp(dg.pH2O[i] / Math.max(dg.pTot[i], 1e-9), 0, 1);
    fStrat += clamp(0.0115 * Math.pow(x, 1.764) + Math.pow(x, 8), 0, 1) / NBANDS;
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

  // Background gas loss. Gated on the cosmic shoreline: XUV irradiation has to
  // overcome gravitational binding (~ v_esc^4) before N2/CO2 go anywhere.
  const vescRel = d.vesc / 11186;
  const fCrit = 1.15e-3 * Math.pow(vescRel, 4) * 30;
  const gate = smoothstep(0.3, 3, xuv / Math.max(fCrit, 1e-12));
  const background = 0.005 * xuv / (dg.g * d.R) * YEAR * gate;

  return { water, background, fStrat, Tct, diffusion, energy, xSteam };
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
export function methaneLifetime(pO2, hazeTau = 0, xuvRel = 1) {
  // It does not take much. OH chemistry is running long before an atmosphere
  // looks oxygenated to us: a thousandth of today's oxygen already shortens
  // methane's life by three orders of magnitude, which is why methane and free
  // oxygen essentially cannot coexist, and why the Great Oxidation ended the
  // Archean's methane greenhouse rather than merely denting it.
  const oxidising = smoothstep(3e-7, 2e-4, pO2);
  const years = Math.exp(Math.log(1.2e4) * (1 - oxidising) + Math.log(10) * oxidising);
  return years * (1 + 1.5 * Math.max(hazeTau, 0)) / Math.pow(clamp(xuvRel, 0.02, 300), 0.4);
}

export function stepVolatiles(w, dtYears) {
  advanceIceSheet(w, dtYears);

  // --- methane -------------------------------------------------------------
  // It used to sit wherever the slider put it, for ever, which is why a world
  // could be handed a millibar of the stuff and keep it through anything.
  //
  // The source is whatever sustains the level you asked for -- methanogens on
  // the Archean, the interior on Titan -- and is deliberately not modelled: the
  // control sets the amount this world can hold up, and the chemistry then
  // decides whether it can. Oxygenate the air and the methane collapses,
  // whatever the source; that is the real story of the Great Oxidation.
  {
    const dg = w.diag, p = w.params;
    const tau = methaneLifetime(dg.pO2, dg.hazeTau ?? 0, p.xuvFraction / 3.4e-6);
    if (w.ch4Source == null) w.ch4Source = w.ch4 / tau;
    // Nothing on a four-hundred-kelvin surface is making methane, biologically
    // or geologically. Without this a world could boil its ocean away and keep
    // a millibar of methane going, because the source had no idea the planet
    // had died. Titan is well below this and keeps its cryovolcanic supply.
    const makes = 1 - smoothstep(400, 600, dg.Tmean);
    // Semi-implicit, so an arbitrarily long step still lands on the right
    // answer instead of overshooting past zero.
    w.ch4 = Math.max(0, (w.ch4 + w.ch4Source * makes * dtYears) / (1 + dtYears / tau));
    w.ch4Tau = tau;
  }

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
  const V = OUTGAS_EARTH * outgassingScale(p.mass) * p.outgassing;
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
  // Semi-implicit, so an arbitrarily long step still lands on the right answer
  // instead of overshooting past zero. Weathering goes as C^0.3, so dW/dC =
  // 0.3 W / C. Without this the step-size chooser had to throttle the whole
  // clock to a crawl whenever CO2 was drawn down near zero.
  const dWdC = w.co2 > 1e-12 ? 0.3 * Wr / w.co2 : 0;
  w.co2 = Math.max(0, w.co2 + (V - Wr) * dtYears / kappa / (1 + dtYears * dWdC / kappa));

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
    // Photosynthesis needs liquid water and a temperature something can live
    // at; a world that has boiled or frozen stops making oxygen.
    const alive = smoothstep(0, 0.015, w.water.ocean) * (1 - smoothstep(330, 360, dg.Tmean));
    const source = O2_BIO * Math.max(p.biosphere ?? 0, 0) * alive;

    // Reduced volcanic gases, straight out of the ground and into the air.
    // This is the term the biosphere has to outrun, and until it does the
    // atmosphere stays anoxic however long you wait -- which is why the Archean
    // stayed anoxic for a billion years with photosynthesis already running
    // (Catling & Zahnle 2020). The Great Oxidation is that threshold being
    // crossed, and here it falls out of the arithmetic rather than being staged.
    const reductant = O2_REDUCTANT * outgassingScale(p.mass) * p.outgassing;

    // Oxidative weathering of the crust: first order in how much oxygen there
    // is, which is what makes the level settle instead of climbing for ever.
    // It needs liquid water, so a planet that has boiled dry keeps whatever its
    // lost ocean left behind -- Venus. The floor is seafloor oxidation: gating
    // it on exposed land alone would leave a waterworld, which has none, with
    // no sink at all.
    const weathering = (0.25 + 0.75 * landExposed) * liquid / O2_TAU_OX;

    // Semi-implicit in the part that depends on w.o2, so a long step cannot
    // overshoot past zero.
    w.o2 = Math.max(0, (w.o2 + (source - reductant) * dtYears) / (1 + weathering * dtYears));
    w.o2Flux = { source, reductant, weathering: w.o2 * weathering };
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

  // --- a molten surface degasses hard -------------------------------------
  if (dg.Tmean > 1400) w.co2 += V * 30 * dtYears / 1;

  w.escape = esc;
  w.weathering = { V, W: Wr, kappa, liquid };
}
