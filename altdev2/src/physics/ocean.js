import { clamp, T_CRIT_H2O, P_CRIT_H2O } from './constants.js';

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
    depth: 0, liquidDepth: 0, iceDepth: 0,
    basePressure: 0, basePhase: 'none', pMelt: meltingPressure(Tsurf),
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
    let z = 0, mass = 0;
    const dp = (pEnd - pTop) / N;
    for (let i = 0; i < N; i++) {
      const rho = waterDensity(pTop + dp * (i + 0.5));
      z += dp / (rho * g);
      mass += dp / g;
    }
    return { z, mass };
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
      out.basePhase = out.baseTemperature >= T_VI_VII ? 'ice VII' : 'ice VI';
      out.pMelt = pFreeze;
      // Nixon & Madhusudhan's third regime: warm enough and the bottom of the
      // liquid column is past water's critical point before it reaches the ice,
      // so what sits between the ocean and its floor is neither liquid nor
      // vapour but a supercritical layer. Reported as a property of the column
      // rather than as a fourth phase, because there is no boundary to draw --
      // that is what supercritical means.
      out.superLayer = out.baseTemperature > T_CRIT_H2O;
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
  // A floor of rock is what every world this model shipped with has. A floor
  // that is neither rock nor ice is the supercritical interior: too deep for
  // the rock to be reachable, too warm for the water ever to freeze.
  out.basePhase = out.basePressure > P_VI_VII && out.baseTemperature > T_CRIT_H2O
    ? 'supercritical interior' : 'rock';
  return out;
}
