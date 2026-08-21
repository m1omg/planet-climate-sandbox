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
  const landIce = clamp(wanted, 0, surface * 0.98);
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
  const V = OUTGAS_EARTH * outgassingScale(p.mass) * p.outgassing;
  const liquid = clamp(1 - dg.iceMean, 0, 1) * smoothstep(0, 0.02, w.water.ocean);
  const landExposed = clamp(p.landFraction * (1 - dg.iceMean), 0, 1);
  const pCO2rel = Math.max(dg.pCO2 / 280e-6, 1e-6);
  const Wr = OUTGAS_EARTH * outgassingScale(p.mass)
           * (landExposed / 0.3)
           * Math.pow(pCO2rel, 0.3)
           * Math.exp(clamp((dg.Tmean - 288) / 13.7, -8, 8))
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
