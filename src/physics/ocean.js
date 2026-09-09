import { clamp, T_CRIT_H2O, P_CRIT_H2O, SIGMA } from './constants.js';

// ---------------------------------------------------------------------------
// How deep the water goes, and what it turns into on the way down.
//
// On a rocky world this is a question with a boring answer: the ocean is two
// and a half kilometres of liquid over rock, its density is 1000 kg/m^3 from
// top to bottom, and treating it as an incompressible film loses nothing worth
// having. That is what the rest of this model does and it is right to.
//
// On a water-rich sub-Neptune the same arithmetic returns a number that is not
// merely imprecise but meaningless. K2-18 b's water inventory, spread over its
// surface at 1000 kg/m^3, is fifteen thousand kilometres deep -- most of the
// way to the planet's centre. Water does not do that. Long before then the
// pressure passes a gigapascal and it freezes, not because it is cold but
// because it is squeezed: the high-pressure ices VI and VII are STABLE ABOVE
// ROOM TEMPERATURE, ice VII up to several hundred kelvin, and they are what a
// deep ocean actually stands on.
//
// So a Hycean ocean has a floor, and the floor is ice rather than rock. This
// module says where it is.
//
// It is a DIAGNOSTIC and nothing here feeds a reservoir. There is no vertical
// ocean grid in this model and inventing one would be a much larger change than
// the readout it serves; what these functions do is take the column the model
// already tracks and say what it must look like if water behaves the way water
// behaves. Classification and the readout consume it. Nothing integrates it.
// ---------------------------------------------------------------------------

export const RHO_WATER_STP = 1000;      // kg/m^3

// Liquid water compresses, and over the range that matters here it compresses a
// lot -- a factor of two by the time the ocean floor is deep enough to freeze.
// Tait/Murnaghan with water's measured bulk modulus and its pressure
// derivative, which is the standard two-parameter form and is good to a few
// percent through the liquid field. K0 is 2.2 GPa (water is about a hundred
// thousand times stiffer than air and still soft enough for this to matter).
const K0 = 2.2e9, K_PRIME = 7.0;
// dT/dP along a water adiabat, divided by T: alpha/(rho·cp) with alpha = 3e-4/K,
// rho = 1000, cp = 4200. About 21 K per GPa at 300 K.
const ADIABAT_K_PER_PA = 3e-4 / (1000 * 4200);
export function waterDensity(pressurePa) {
  if (!(pressurePa > 0)) return RHO_WATER_STP;
  return RHO_WATER_STP * Math.pow(1 + K_PRIME * pressurePa / K0, 1 / K_PRIME);
}

// The high-pressure ices are denser than the liquid they freeze out of, which
// is the opposite of what ordinary ice does and is why they sink and form a
// floor instead of a raft. Held constant: the model has no ice EOS and a fitted
// one would be pretending to a precision the rest of this does not have.
export const RHO_ICE_HP = 1600;         // kg/m^3, ice VI/VII

// Where liquid water freezes under pressure, as a function of temperature.
//
// Two branches because there are two ices. Ice VI is stable from about 0.63 GPa
// at the freezing point up to the VI-VII triple point at 2.216 GPa and 355 K;
// above that it is ice VII, whose melting curve is the Simon-Glatzel form
// anchored on that same triple point. Both are measured, and the exponent is
// what makes ice VII remarkable -- it takes 15 GPa to melt it at 650 K, so a
// deep enough ocean has an ice floor no matter how hot its surface is.
const P_VI_VII = 2.216e9, T_VI_VII = 355;
const P_VI_0 = 0.632e9, T_VI_0 = 273.31;
export function meltingPressure(T) {
  if (T <= T_VI_0) return P_VI_0;
  if (T < T_VI_VII) {
    // Ice VI's melting line over its short range, linear in T to within the
    // accuracy anything downstream of this can use.
    return P_VI_0 + (P_VI_VII - P_VI_0) * (T - T_VI_0) / (T_VI_VII - T_VI_0);
  }
  return P_VI_VII * Math.pow(T / T_VI_VII, 3.24);
}

// --- the cold end: ice Ih, and the ocean that can live under it ------------
//
// The melting curve above is the HIGH-pressure end -- where an ocean deep
// enough freezes from below. This is the other one, and the model had nothing
// for it: ice Ih, the ordinary ice a cold world is covered in, whose melting
// point FALLS with pressure instead of rising. That is what makes a subglacial
// ocean possible at all, and it is why Europa has one.
//
// IAPWS-95's ice Ih melting equation (Wagner, Saul & Pruss 1994), used as
// published. Valid from the triple point down to the ice Ih-III triple point at
// 209.9 MPa and 251.165 K, which is where ice Ih stops being the stable phase
// and the curve turns around.
const T_TRIPLE = 273.16, P_TRIPLE = 611.657;          // K, Pa
const P_IH_III = 209.9e6, T_IH_III = 251.165;         // ice Ih-III triple point
const IH_A = [0.119539337e7, 0.808183159e5, 0.333826860e4];
const IH_B = [0.300000e1, 0.257500e2, 0.103750e3];
export function meltingPressureIh(T) {
  const th = T / T_TRIPLE;
  let pi = 1;
  for (let i = 0; i < 3; i++) pi += IH_A[i] * (1 - Math.pow(th, IH_B[i]));
  return pi * P_TRIPLE;
}

// ...and the inverse, which is the one the shell actually needs: given the
// pressure at the base of an ice sheet, how warm is the water under it.
//
// Bisection rather than a fitted inverse. The forward curve is monotonic over
// this range and twenty halvings put it inside a millikelvin, which costs
// nothing next to the column solve it sits inside -- and a fit would be one
// more thing that could quietly disagree with the curve above it.
export function meltingTemperatureIh(pPa) {
  if (!(pPa > P_TRIPLE)) return T_TRIPLE;
  if (pPa >= P_IH_III) return T_IH_III;               // ice III below here, not Ih
  let lo = T_IH_III, hi = T_TRIPLE;
  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi);
    if (meltingPressureIh(mid) > pPa) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export const RHO_ICE_IH = 917;          // kg/m^3

// Thermal conductivity of ice Ih is not a constant: k = 651/T W/(m·K) over the
// whole range a shell spans (Klinger 1980; Petrenko & Whitworth 1999). Across a
// shell from 100 K to 270 K that is a factor of 2.7, so treating it as constant
// is not a rounding error -- it is the difference between Europa's shell and
// twice Europa's shell. Integrated, ∫k dT = 651·ln(Tb/Ts), which is why the
// thickness below is a logarithm rather than a ratio.
const K_ICE_INT = 651;                  // W/m, the constant in k = K/T

// How thick an ice shell has to be to carry the interior heat, and whether any
// ocean is left underneath it.
//
// A conductive lid in steady state: whatever heat the interior makes has to
// cross the ice, and the only way across is a temperature gradient from the
// surface up to the melting point at the base. Solve F·d = ∫k dT and the
// thickness falls out -- Ojakangas & Stevenson 1989, the standard result:
//
//     d = 651·ln(T_base / T_surface) / F
//
// Europa: F ≈ 0.05 W/m² of mostly tidal heat, 100 K surface, base near 270 K,
// gives 13 km against an observed 10-30. A snowball Earth on radiogenic heat
// alone -- 0.087 W/m², 220 K surface -- gives 1.6 km, against the ~1 km the
// snowball literature settles on. Neither number is fitted; both are what the
// equation says.
//
// The base temperature and the base pressure are coupled -- deeper ice means
// more pressure means a COLDER melting point means a thinner shell -- so this
// iterates. It converges in two or three passes because the pressure feedback
// is weak: 1 km of ice is 9 MPa, which moves the melting point by a kelvin.
//
// `columnKg` is the whole water inventory over the area it covers. If the shell
// would be thicker than the water is deep, there is no ocean: the world is
// frozen to the floor, which is the honest answer for a small cold body.
export function iceShell(columnKg, g, Tsurf, Fint, pSurfPa = 0) {
  const out = { shellDepth: 0, oceanKg: 0, baseT: T_TRIPLE, basePressure: pSurfPa,
                frozenSolid: false, ocean: false };
  if (!(columnKg > 0) || !(g > 0) || !(Fint > 0)) return out;
  // Warm enough to melt at the surface: this is an ordinary ocean, not a shell.
  if (Tsurf >= meltingTemperatureIh(Math.max(pSurfPa, P_TRIPLE))) return out;
  const totalDepthIfIce = columnKg / RHO_ICE_IH;
  let d = 0, Tb = meltingTemperatureIh(Math.max(pSurfPa, P_TRIPLE));
  for (let i = 0; i < 6; i++) {
    // Never let the log go the wrong way: a surface at or above the base
    // temperature has no gradient to drive, and is handled by the branch above.
    const dNew = K_ICE_INT * Math.log(Math.max(Tb / Math.max(Tsurf, 1), 1 + 1e-12)) / Fint;
    d = Math.min(dNew, totalDepthIfIce);
    const pBase = pSurfPa + RHO_ICE_IH * g * d;
    Tb = meltingTemperatureIh(pBase);
  }
  out.shellDepth = d;
  out.baseT = Tb;
  out.basePressure = pSurfPa + RHO_ICE_IH * g * d;
  // What is left under the shell, as liquid. The shell is ice, so the water it
  // holds is its depth times the ice density -- the rest of the inventory is
  // the ocean.
  const shellKg = Math.min(d * RHO_ICE_IH, columnKg);
  out.oceanKg = Math.max(columnKg - shellKg, 0);
  out.frozenSolid = !(out.oceanKg > 0);
  out.ocean = !out.frozenSolid;
  return out;
}

// The structure of the water column: how far down it is liquid, where it
// freezes, and what is at the bottom.
//
// `columnKg` is the water actually lying on the surface, in kg/m^2, over the
// area it covers -- the caller divides by the flooded fraction, because an
// ocean over a third of a planet is three times deeper than the same water
// spread everywhere. Integrated downward in pressure rather than depth, since
// pressure is what decides both the density and the phase.
export function oceanStructure(columnKg, g, Tsurf, pSurfBar = 0) {
  const out = {
    depth: 0, liquidDepth: 0, iceDepth: 0, superDepth: 0,
    basePressure: 0, basePhase: 'none', pMelt: meltingPressure(Tsurf),
    meanTemperature: null,
  };
  if (!(columnKg > 0) || !(g > 0)) return out;

  // Past the critical point there is no liquid and no surface to have an ocean
  // on: the atmosphere and the fluid below it are one continuous medium, and
  // "ocean depth" is not a question with an answer. Reported as such rather
  // than as a number.
  if (Tsurf >= T_CRIT_H2O && pSurfBar * 1e5 >= P_CRIT_H2O) {
    out.basePhase = 'supercritical';
    return out;
  }

  // Down through the liquid in pressure steps, accumulating depth as dz =
  // dP/(rho g) with rho following the pressure. Stops at whichever comes first:
  // the water running out, or the melting curve.
  //
  // The temperature goes down with it, and that matters more than it looks. An
  // ocean this deep is convecting and therefore adiabatic, so its floor is
  // hotter than its surface -- about twenty kelvin per gigapascal, from
  // dT/dP = alpha·T/(rho·cp) with water's thermal expansivity. Over a couple of
  // gigapascals that is forty or fifty kelvin, which is the difference between
  // freezing as ice VI and freezing as ice VII, and the melting curve is steep
  // enough that it also moves the floor itself by tens of kilometres. Judging
  // the phase from the surface temperature alone would put the VI/VII boundary
  // at the wrong surface temperature by roughly that much.
  const pBase = columnKg * g;                 // Pa, if it were all liquid above
  let pMelt = out.pMelt;
  // Solved rather than marched, and the first attempt at marching is worth
  // recording because it looked reasonable and was not. Stepping down in
  // pressure by a fraction of the local melting pressure, advancing the adiabat
  // each step, is a positive feedback: a hotter step raises the melting
  // pressure, which lengthens the next step, which heats it further. It ran the
  // ocean floor to thirty thousand kelvin and reported that a Hycean world has
  // no ice at all.
  //
  // Both curves are analytic, so there is no reason to march. Along an adiabat
  // dT/dp = k·T, so T(p) = Tsurf·exp(k·(p − p0)) in closed form; the melting
  // curve inverts to T_melt(p) = 355·(p/2.216 GPa)^(1/3.24). The floor is where
  // those two meet, which is one bisection.
  //
  // And they do not always meet. The melting temperature rises with pressure
  // faster than the adiabat does above about four gigapascals, so a warm enough
  // ocean never freezes however deep it gets -- the adiabat stays in the liquid
  // and then the supercritical field all the way down, which is exactly
  // Pierrehumbert & Furth's "the atmospheric adiabat connects seamlessly to the
  // supercritical water adiabat that extends into the deep interior". That is a
  // real state, not a failure to converge, and it is reported as one.
  //
  // The adiabat is taken to first order -- T = Tsurf·(1 + k·Δp) rather than
  // Tsurf·exp(k·Δp) -- and that is a correction, not a shortcut. The
  // exponential is the exact solution of dT/dp = k·T only while k is constant,
  // and k = alpha/(rho·cp) is emphatically not: water's thermal expansivity
  // collapses under compression. Integrating the exponential across hundreds of
  // gigapascals returned ocean floors at 10^8 K. Over the range where there is
  // still liquid to have an adiabat in -- fifteen gigapascals at the very most,
  // where ice VII melts at the critical temperature -- the two forms differ by
  // a few percent and the linear one does not diverge.
  // The gradient itself weakens with depth, and leaving that out was the last
  // thing wrong here. dT/dp = alpha·T/(rho·cp), and alpha -- water's thermal
  // expansivity -- collapses as the water stiffens: the same bulk modulus that
  // makes it hard to compress makes it reluctant to expand when heated. Holding
  // alpha at its surface value gave an adiabat that climbed 25 K per gigapascal
  // all the way down, which outran the melting curve and reported no ice floor
  // on any world warmer than about 315 K, where the literature finds one up to
  // 413 K.
  //
  // Letting it fall as 1/(1 + p/K0) -- the simplest form with the right
  // behaviour, weakening on the same pressure scale that the compression does
  // -- integrates in closed form to a logarithm, and the boundary lands where
  // the interior models put it.
  const pTop = pSurfBar * 1e5;
  const K_ADIABAT = ADIABAT_K_PER_PA * K0;
  const adiabat = (pp) => Tsurf * (1 + K_ADIABAT * Math.log1p(Math.max(pp - pTop, 0) / K0));
  const meltT = (pp) => (pp <= P_VI_0 ? 0
    : pp < P_VI_VII ? T_VI_0 + (T_VI_VII - T_VI_0) * (pp - P_VI_0) / (P_VI_VII - P_VI_0)
    : T_VI_VII * Math.pow(pp / P_VI_VII, 1 / 3.24));
  // Freezing means the water has got COLDER than the ice it would freeze into:
  // the adiabat has fallen below the melting curve. What matters is the
  // SHALLOWEST pressure at which that is true, and it has to be searched for
  // rather than tested at the bottom, because the two curves generally cross
  // TWICE.
  //
  // The melting curve is steep where ice VII begins and flattens above it,
  // while the adiabat is nearly straight, so going down the adiabat dips below
  // the melting curve around a couple of gigapascals and comes back above it
  // ten or twenty gigapascals further down. The ice is a BAND, with liquid or
  // supercritical fluid on both sides of it -- which is the structure the
  // Hycean interior literature describes, and it is why an ocean floor is not
  // simply "the deepest point". Checking only the bottom of the column found
  // the adiabat back above the curve and concluded, wrongly, that nothing ever
  // freezes.
  const pFloorMax = pTop + pBase;
  const pStart = Math.max(pTop, P_VI_0);
  let pFreeze = 0;
  if (pFloorMax > pStart) {
    // Coarse sweep in log pressure for the first sign change, then bisect
    // inside the bracket it found.
    const SCAN = 240;
    let prev = pStart, prevFrozen = adiabat(pStart) < meltT(pStart);
    if (prevFrozen) pFreeze = pStart;
    else {
      const ratio = Math.pow(pFloorMax / pStart, 1 / SCAN);
      let q = pStart;
      for (let i = 0; i < SCAN; i++) {
        q *= ratio;
        if (adiabat(q) < meltT(q)) {
          let lo = prev, hi = q;
          for (let j = 0; j < 60; j++) {
            const mid = 0.5 * (lo + hi);
            if (adiabat(mid) < meltT(mid)) hi = mid; else lo = mid;
          }
          pFreeze = hi;
          break;
        }
        prev = q;
      }
    }
  }

  // The depth of the liquid column above whatever it stands on, integrating
  // dz = dp/(rho(p)·g) with the compressible density. Cheap and stable: the
  // range is now known, so a fixed number of even steps resolves it.
  const depthTo = (pEnd) => {
    const N = 48;
    let z = 0, mass = 0, zT = 0;
    const dp = (pEnd - pTop) / N;
    for (let i = 0; i < N; i++) {
      const pp = pTop + dp * (i + 0.5);
      const dz = dp / (waterDensity(pp) * g);
      z += dz;
      mass += dp / g;
      // The same steps carry the temperature, because the average temperature of
      // the water is a question the column can answer and the banner was asking
      // the wrong number for. Weighted by DEPTH -- the average you would measure
      // descending through it -- rather than by mass. The two differ by about a
      // kelvin on a deep pool, since dm = dp/g makes a mass average a pressure
      // average while density nearly doubles by 3.5 GPa, and a kelvin is under
      // the precision the line prints at.
      zT += adiabat(pp) * dz;
    }
    return { z, mass, meanT: z > 0 ? zT / z : Tsurf };
  };

  // Where the column stops being a liquid. Above 647.096 K there is no liquid
  // water at any pressure -- that is what a critical temperature is -- so a deep
  // enough adiabat crosses out of the liquid field on its way down and what is
  // under the crossing is supercritical fluid: dense, continuous with the water
  // above it, and not an ocean. The cross-section used to draw the whole column
  // as one liquid band reading "373 → 554 °C", straight across the boundary.
  //
  // Solved rather than searched, from the same closed-form adiabat: it is
  // T = Tsurf(1 + k·ln(1 + Δp/K0)), so the crossing is at
  // Δp = K0·(exp((Tc/Tsurf − 1)/k) − 1). A column whose top is already past the
  // critical temperature is supercritical from the top down and returns zero.
  const pCrit = Tsurf >= T_CRIT_H2O ? pTop
    : pTop + K0 * Math.expm1((T_CRIT_H2O / Tsurf - 1) / K_ADIABAT);
  const superFrom = (pEnd) => (pCrit >= pEnd ? 0 : depthTo(pEnd).z - depthTo(Math.max(pCrit, pTop)).z);
  // The average temperature of the LIQUID, which stops at the critical crossing:
  // `coldT` is the temperature at the TOP of the pool, immediately under the
  // conductive boundary, and the adiabat below it runs thirty kelvin warmer on a
  // buried ocean. Averaging across the crossing would put supercritical fluid
  // into a number called an ocean temperature, which is the same category error
  // the "liquid ocean · 373 → 554 °C" band was fixed for.
  const meanLiquidT = (pEnd) => {
    const pLiq = Math.min(pEnd, pCrit);
    return pLiq > pTop ? depthTo(pLiq).meanT : null;
  };

  if (pFreeze > pTop) {
    const liq = depthTo(pFreeze);
    if (liq.mass < columnKg) {
      const rest = columnKg - liq.mass;
      out.liquidDepth = liq.z;
      out.iceDepth = rest / RHO_ICE_HP;
      out.depth = liq.z + out.iceDepth;
      out.basePressure = pFreeze + rest * g;
      out.baseTemperature = adiabat(pFreeze);
      out.meanTemperature = meanLiquidT(pFreeze);
      out.basePhase = out.baseTemperature >= T_VI_VII ? 'ice VII' : 'ice VI';
      out.pMelt = pFreeze;
      // Nixon & Madhusudhan's third regime: warm enough and the bottom of the
      // liquid column is past water's critical point before it reaches the ice,
      // so what sits between the ocean and its floor is neither liquid nor
      // vapour but a supercritical layer. Reported as a property of the column
      // rather than as a fourth phase, because there is no boundary to draw --
      // that is what supercritical means.
      out.superLayer = out.baseTemperature > T_CRIT_H2O;
      out.superDepth = superFrom(pFreeze);
      return out;
    }
  }

  // The water ran out before it froze: an ocean on rock, which is every world
  // this model shipped with.
  // Nothing froze: the water ran out first, or the adiabat never met the
  // melting curve at all.
  const all = depthTo(pTop + pBase);
  out.depth = out.liquidDepth = all.z;
  out.basePressure = pTop + pBase;
  out.baseTemperature = adiabat(pTop + pBase);
  out.meanTemperature = meanLiquidT(pTop + pBase);
  // A floor of rock is what every world this model shipped with has. A floor
  // that is neither rock nor ice is the supercritical interior: too deep for
  // the rock to be reachable, too warm for the water ever to freeze.
  out.basePhase = out.basePressure > P_VI_VII && out.baseTemperature > T_CRIT_H2O
    ? 'supercritical interior' : 'rock';
  // Reported in both branches now, not just the one that freezes: the readout's
  // "deep water is supercritical" line was silent on an ocean standing on rock
  // whose floor is past the critical point, which is exactly the buried pool.
  out.superDepth = superFrom(pTop + pBase);
  out.superLayer = out.superDepth > 0;
  return out;
}


// Which high-pressure ice a floor is made of, from the PRESSURES it spans
// rather than from the temperature at its top. Bridgman's VI/VII point is
// 2.216 GPa, and a band under a deep ocean routinely crosses it: the Low
// Sunlight Hycean's runs from 0.9 to 11 GPa, so seven eighths of it is ice VII
// and all of it was labelled ice VI, because the label was read off the one
// place the ice is coldest and shallowest. A band that crosses is named for
// both -- the model has one temperature in the ice, the point where the water
// froze, and inventing a second to justify splitting the band would be worse
// than naming it honestly.
export function iceKind(pTop, pBase) {
  if (pBase <= P_VI_VII) return 'iceVI';
  if (pTop >= P_VI_VII) return 'iceVII';
  return 'iceHP';
}

// --- what is under a supercritical lid -------------------------------------
//
// `oceanStructure` decides the entire column from the surface, and past the
// critical point that is a two-line answer: no surface, no depths, nothing to
// report. Right for a world that has finished converting. Flatly wrong for one
// part-way through it -- which is the whole of the Buried Ocean state, where a
// hot isothermal lid stands on cold liquid water that has not converted yet
// (Pierrehumbert & Furth 2023). Measured on the cold-start path: 489 Earth
// oceans in the reservoir, `hotLayer` 0.7% converted, and a cross-section
// drawing a hundred kilometres of supercritical fluid resting on bare rock.
//
// So the cold pool is solved as its own column. Its mass is the share of the
// inventory the hot layer has NOT taken -- the same `availCol * hotShare` split
// the vapour ceiling is built on, so there is one definition of how much water
// is up in the air and not two that can disagree. It stands under the whole
// weight of the atmosphere above it, which is why the pressure at its top is
// the surface pressure rather than zero, and it freezes into high-pressure ice
// exactly as any other deep ocean does.
//
// Its temperature is an assumption, and is stated as one rather than dressed up
// as a result: T_COLD_POOL, the same 0 °C that `hotCapacity` measures the cost
// of converting a kilogram of this water from. The model carries no separate
// temperature for water below the lid -- its band temperatures are the
// surface's -- so inventing a second number here would be worse than using the
// one the energy bookkeeping already commits to.
export const T_COLD_POOL = 273.15;

// Thermal conductivity of liquid water, W/(m·K). Only the cross-section uses it,
// to size the boundary layer that carries the flux across the interface.
const K_WATER = 0.6;

export function coldPoolStructure(dg) {
  const share = 1 - clamp(dg.hotLayer ?? 1, 0, 1);
  const col = Math.max((dg.totalWater ?? 0) * (dg.d?.eoColumn ?? 0) * share, 0);
  return oceanStructure(col, dg.g, dg.coldT ?? T_COLD_POOL, dg.pTotMean ?? 0);
}

// --- the cross-section, as data --------------------------------------------
//
// The stack the readout draws, built here rather than in the renderer so that
// the self-test can read it. What it returns is numbers and English keys: the
// page translates the labels and formats the depths, exactly as it does with
// the state names `classify()` returns.
//
// `airThick` is passed in rather than computed. The visible depth of the sky is
// a rendering question -- five scale heights, or what a transit would see if
// there is an envelope -- and the shortest way for a physics module to answer it
// is to import the renderer, which is the wrong direction.
//
// `T` is what the model knows about the temperature of a band: one number where
// it has one, two where it has both ends of a descent (a sea surface and the
// floor its adiabat reaches). Rock carries none, because nothing here models an
// interior temperature and a plausible-looking number would be an invention.
// The kinds a column can be made of, named once. The renderer keys a colour and
// a label off each one, and there is no way for it to find out that a new kind
// exists except by being told: adding an `interface` band and forgetting the
// entry threw on the first frame that drew one, which is a blank page rather
// than a wrong pixel. So the list lives here, `add` refuses anything not on it,
// and the smoketest holds it against the renderer's table in both directions.
export const LAYER_KINDS = ['envelope', 'air', 'supercritical', 'steam', 'iceIh',
  'interface', 'ocean', 'seaice', 'iceVI', 'iceVII', 'iceHP', 'rock'];

export function columnLayers(w, dg, airThick, scaleH = 0) {
  const ob = dg.oceanBase || {};
  const Ts = dg.Tmean;
  const layers = [];
  const add = (kind, metres, T, note, args) => {
    if (!LAYER_KINDS.includes(kind)) throw new Error(`unknown layer kind: ${kind}`);
    if (metres > 0) layers.push({ kind, metres, T, note, noteArgs: args || [] });
  };
  // A water column drawn as the phases it is actually in. Above the critical
  // temperature there is no liquid at any pressure, so a column whose adiabat
  // crosses it is an ocean over a supercritical layer and has to be drawn as
  // two bands -- one of them was drawn as a single "liquid ocean · 373 → 554 °C",
  // which names a phase water does not have at 554 °C.
  // A water column, drawn as the phases AND the temperatures it is actually in.
  //
  // `topT` is the temperature at the top of the water -- the sea surface on an
  // open ocean, the critical point under a lid, since that is where the fluid
  // above stops being supercritical. `bulkT` is the water below, which is not
  // the same number: an ocean heated from above is stably stratified, so the
  // interior lags and the model carries that lag as `coldT`.
  //
  // Between them is a conductive boundary layer, and its thickness is not a free
  // parameter: it is the layer that carries the flux crossing it. F = k·ΔT/δ
  // with water's own conductivity, so δ = k·ΔT/F -- tens of metres on a world
  // absorbing a few hundred watts, hundreds on a dim one. Thin against a column
  // hundreds of kilometres deep, which is exactly what makes it reasonable to
  // hold one temperature for everything under it, and drawing the two without it
  // is what put 800 °C fluid directly on 30 °C water.
  const addWater = (st, depth, topT, bulkT, note, args) => {
    if (!(depth > 0)) return;
    const jump = topT - bulkT;
    const flux = Math.max(dg.mixedFlux ?? 0, 1e-6);
    // Never more than a fiftieth of the water it sits on. A dim world with a big
    // jump can put k*dT/F above the whole column, and a boundary layer thicker
    // than the thing it bounds is not a boundary layer -- it means the column is
    // too thin to be stratified at all, so the cap swallows it and the water is
    // drawn as one temperature. The metre floor is the other end: below that it
    // is a sliver nobody can see and a number nobody can read.
    // A fiftieth of the water it SITS ON, and what it sits on is the liquid --
    // not the whole pool. Most of a settled pool is supercritical, so a cap of
    // 2% of the column let a 1.66 km boundary layer swallow the 600 m of liquid
    // underneath it whole: the cross-section drew a Buried Ocean with no ocean
    // band in it at all, which is the exact contradiction this state was fixed
    // for once already. Caught in a browser at a hundred megayears.
    const deepAll = Math.min(st.superDepth ?? 0, depth);
    const liquidPart = Math.max(depth - deepAll, 0);
    const bound = liquidPart > 0 ? liquidPart : depth;
    const skin = jump > 0.5
      ? clamp(K_WATER * jump / flux, Math.min(1, bound), Math.max(0.02 * bound, 0)) : 0;
    if (skin > 0) add('interface', skin, [topT, bulkT], '{0} W/m² across it', [flux < 1 ? flux.toFixed(2) : flux.toFixed(1)]);
    const rest = Math.max(depth - skin, 0);
    const deep = Math.min(st.superDepth ?? 0, rest);
    const baseT = st.baseTemperature ?? bulkT;
    add('ocean', rest - deep, [bulkT, Math.min(baseT, T_CRIT_H2O)], note, args);
    // Above the critical pressure -- and this crossing is at 478 times it --
    // liquid and supercritical are one continuous fluid with no transition
    // between them, so the band edge is where the name changes and not where
    // anything happens. Said on the band, because a drawn line is a boundary
    // the eye believes.
    add('supercritical', deep, [Math.max(bulkT, T_CRIT_H2O), baseT],
      depth > deep ? 'no boundary' : note, depth > deep ? [] : args);
  };

  const pTot = dg.pTotMean ?? 0;
  // Past the critical point the air and the fluid under it are one medium, so
  // the top band IS the supercritical column -- there is no second boundary to
  // draw beneath it and no thickness to give one. A separate band was drawn
  // there once, at a hard-coded hundred kilometres, and it was an invention on
  // top of a contradiction: the water it claimed to show was the water the
  // liquid band below was missing.
  // "The surface has gone over": the classifier's own test rather than the
  // ocean solver's later one, so the column the picture draws switches from the
  // sea to the pool at the moment the state does.
  const lid = (dg.hotTarget ?? 0) > 0.5 || ob.basePhase === 'supercritical';
  const envShare = (dg.pH2 ?? 0) + (dg.pHe ?? 0);
  // No pressure on the air band: it is a tile of its own two rows above this in
  // the readout, and the line is long enough with a thickness and a temperature
  // on it to start losing its own label to an ellipsis on a narrow panel.
  // With a pool under it the lid's own base is at the critical temperature --
  // that is where it stops being supercritical -- so it reads as the descent it
  // is rather than as one number belonging to its top.
  //
  // The sky is not one thing, and it was drawn as one. Two errors, both of them
  // reported from play and both of them mine.
  //
  // It ran the WRONG WAY. The band read `1621 → 374 °C`, top to bottom, which
  // is an atmosphere that is hottest at the top -- written on the reasoning that
  // the fluid stops being supercritical where it meets the water. It does not:
  // going down you get hotter, and `Tmean` is the base of the sky, not its top.
  // The critical crossing is UP, where the pressure falls through 220.6 bar.
  //
  // And ALL of it was called supercritical. Supercritical needs both: hotter
  // than 647 K and denser than 220.6 bar. On the buried world measured here the
  // base is 3618 K under 2388 bar, so the critical pressure is
  // ln(2388/220.6) = 2.4 scale heights up -- about 143 km of a sky that is 14.7
  // scale heights deep. The other twelve are ordinary steam, cooling to the
  // temperature the planet actually radiates at, and calling them supercritical
  // put a phase on nine tenths of an atmosphere that is not in it. The same bug
  // labelled a 20 bar, 338 K cold start "supercritical" -- eleven times too thin
  // and half the temperature.
  const H = scaleH > 0 ? scaleH : airThick / 5;
  const pCritBar = P_CRIT_H2O / 1e5;
  const sky = Math.max(airThick, 1);
  const superSky = lid && Ts > T_CRIT_H2O && pTot > pCritBar
    ? Math.min(H * Math.log(pTot / pCritBar), sky) : 0;
  // The top of the drawn sky is near the level the planet radiates from, which
  // is the one temperature up there the model actually knows.
  const tEff = Math.pow(Math.max(dg.emitted ?? 0, 1e-6) / SIGMA, 0.25);
  const cool = Math.max(sky - superSky, 0);
  // Two thousand bar of water vapour is steam, and calling it "atmosphere" on a
  // world whose sea is in the sky says nothing about where the sea went.
  // `Array.isArray` is false for a Float64Array, which is what the band arrays
  // are, so this took the scalar branch, compared an object against a number,
  // got false, and labelled a sky that is 99.2% water vapour "atmosphere".
  const pH2Omean = dg.pH2O?.length
    ? [...dg.pH2O].reduce((a, b) => a + b, 0) / dg.pH2O.length : (+dg.pH2O || 0);
  const coolKind = envShare > 0.5 * pTot ? 'envelope'
    : pH2Omean > 0.5 * pTot ? 'steam' : 'air';
  if (superSky > 0) {
    // Cool steam on top of the supercritical fluid, meeting it at the critical
    // point -- which is where the crossing is, rather than at the water.
    if (cool > 0) add(coolKind, cool, [Math.min(tEff, T_CRIT_H2O), T_CRIT_H2O],
      'above the critical pressure');
    add('supercritical', superSky, [T_CRIT_H2O, Ts], 'no surface');
  } else {
    add(lid ? 'steam' : coolKind, sky,
      tEff < Ts - 0.5 ? [tEff, Ts] : [Ts], lid ? 'no surface' : null);
  }

  if (lid) {
    const cp = dg.coldPool;
    if (cp && cp.liquidDepth > 0) {
      const cold = 100 * (1 - clamp(dg.hotLayer ?? 1, 0, 1));
      const top = dg.coldT ?? T_COLD_POOL;
      // Nothing sits at 800 °C directly on water at 30. What is between them is a
      // conductive boundary layer, and how thick it is is not a free parameter:
      // it is the layer that carries the flux crossing the interface, F = k·ΔT/δ
      // with water's own conductivity, so δ = k·ΔT/F. Tens of metres on a world
      // absorbing a few hundred watts and hundreds on a dim one -- thin against
      // a column hundreds of kilometres deep, which is exactly what makes it
      // reasonable to hold one temperature for everything under it.
      //
      // "still cold" was written when this water was assumed to be at freezing.
      // It is the share of the inventory the hot layer has not taken.
      // The full jump, not a jump from the critical point. What meets the water
      // is the BASE of the fluid column, and the base is the hottest part of it
      // -- the critical crossing is two scale heights up in the sky. Cutting the
      // boundary at 374 °C made the layer thinner than the temperature step
      // across it, which is the one thing a conductive layer's thickness is
      // supposed to be a statement about.
      addWater(cp, cp.liquidDepth, Math.max(Ts, top), top,
        '{0}% not converted', [cold.toFixed(0)]);
      if (cp.iceDepth > 0) {
        add(iceKind(cp.pMelt, cp.basePressure), cp.iceDepth,
          [cp.baseTemperature], '{0} GPa at the floor', [(cp.basePressure / 1e9).toFixed(1)]);
      }
    }
  } else {
    // A cold-started world converts from the top down, and `hotLayer` is how
    // much of the column has actually gone over rather than how much wants to.
    const hot = clamp(dg.hotLayer ?? 0, 0, 1);
    const liquid = ob.liquidDepth ?? 0;
    // The water under the surface skin. Never warmer than the surface: a pool
    // that has been left behind by a COOLING surface overturns rather than
    // sitting there, which is the asymmetry advanceColdPool already carries.
    const bulk = Math.min(dg.coldT ?? Ts, Ts);
    if (hot > 0.005 && liquid > 0) {
      add('supercritical', liquid * hot, [Ts], '{0}% converted', [(hot * 100).toFixed(0)]);
      addWater(ob, liquid * (1 - hot), Math.min(Ts, T_CRIT_H2O), bulk, 'still liquid');
    } else {
      const ice = (w.water.seaIce ?? 0) + (w.water.landIce ?? 0);
      const tot = ice + (w.water.ocean ?? 0);
      const sub = dg.subglacial;
      if (sub && sub.ocean) {
        // Frozen at the top, liquid underneath. The shell carries the whole
        // temperature drop from the surface to the melting point at its base --
        // that IS what sets its thickness -- so it is drawn as a descent rather
        // than a slab, and the water below starts at the base temperature the
        // shell hands it rather than at the surface.
        add('iceIh', sub.shellDepth, [Ts, sub.baseT],
          '{0} km of shell over liquid', [(sub.shellDepth / 1000).toFixed(1)]);
        // Solve the water under the shell as its own column: it starts at the
        // pressure the ice above it applies, and if it is deep enough it has an
        // ice VI floor of its own -- which is Ganymede, and is a real structure
        // rather than a flourish.
        // Solved once in the diagnostics, read here: the banner quotes the same
        // object, so the two cannot drift apart.
        const under = sub.under
          ?? oceanStructure(sub.oceanKg, dg.g, sub.baseT, sub.basePressure / 1e5);
        addWater(under, under.liquidDepth, sub.baseT, sub.baseT,
          'liquid under {0} km of ice', [(sub.shellDepth / 1000).toFixed(1)]);
        if (under.iceDepth > 0) {
          add(iceKind(under.pMelt, under.basePressure ?? 0), under.iceDepth,
            [under.baseTemperature ?? sub.baseT], '{0} GPa at the floor',
            [((under.basePressure ?? 0) / 1e9).toFixed(1)]);
        }
      } else if (tot > 0 && ice / tot > 0.5) {
        add('seaice', liquid || 1000, [Ts], 'frozen through');
      } else addWater(ob, liquid, Math.min(Ts, T_CRIT_H2O), bulk);
    }
    // The subglacial branch above solves its own column under the shell and
    // draws that column's floor. `ob` is the same water solved as if it had a
    // surface, so letting this run as well would stack a second, contradictory
    // floor under the first.
    const drewOwnFloor = !!(dg.subglacial && dg.subglacial.ocean) && !(hot > 0.005 && liquid > 0);
    if (ob.iceDepth > 0 && !drewOwnFloor) {
      add(iceKind(ob.pMelt, ob.basePressure ?? 0), ob.iceDepth,
        [ob.baseTemperature ?? Ts], '{0} GPa at the floor',
        [((ob.basePressure ?? 0) / 1e9).toFixed(1)]);
    }
  }
  add('rock', Math.max((dg.d?.R ?? 6.371e6) * 0.35, 1), null, 'silicate interior');
  return layers;
}
