// Physics and determinism checks. Run in the browser with ?selftest=1 (results
// go to the console), or headlessly with `node src/selftest.js`.
import { Simulation } from './sim/clock.js';
import { EARTH, PREINDUSTRIAL, PRESETS } from './game/presets.js';
import { volcanicActivity } from './physics/planet.js';
import { classify, reasonText } from './physics/classify.js';
import { runawayLimit, olr, hazeOpacity, hazeShortwave, ch4Shortwave, cloudWhiteness,
         planetaryAlbedo } from './physics/radiation.js';
import { T_CRIT_H2O, P_CRIT_H2O, steamOpacity, psatCO2, frostPointCO2, smoothstep } from './physics/constants.js';
import { NBANDS, maxStep, lockFactor, slowRotation, insolationProfile } from './physics/climate.js';
import { SLIDERS, INTERIOR_BODIES, parseValue, toSlider, fromSlider, snapToDisplay } from './game/controls.js';
import { SCENARIOS } from './game/scenarios.js';
import { SLOTS, buildSaveFile, parseSaveFile, planImport } from './game/saves.js';
import { RESTORE_CAP, pushRestore, findRestore, truncateAfter } from './game/timeline.js';
import { captureWorld, applyWorld } from './game/snapshot.js';
import { floodedFraction, waterForFlooded, MIN_SEA_DEPTH,
         MAX_BASIN_DEPTH } from './physics/hypsometry.js';
import { surfaceGravity } from './physics/planet.js';
import { methaneLifetime, photosynthesis, carbonBudget, FOSSIL_TOTAL, meltBoost } from './physics/volatiles.js';
import { atmosphereLook, cloudLook, scaleHeight } from './render/atmosphere.js';
import { seaLevelForLand, thermalGlow, GLOW_A, GLOW_B, vegetationColor,
         SOLAR_VEGETATION, stellarVegetation } from './render/terrain.js';
import { radiogenic, brightnessAfter, evolvedParams, approach, EARTH_AGE, dynamoLifetime,
         windExposure, nonThermalEscape, resurfacingBoost, resurfacingProgress,
         xuvAtAge, saturationAge, SOLAR_TEMP } from './physics/evolution.js';
import { bakeTerrain } from './render/cpushade.js';
import { DEFAULT_PAN_SPEED, PAN_SPEEDS, panRadiansPerPixel, wheelZoomFactor } from './render/camera.js';

let pass = 0, fail = 0;
const log = [];
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`;
  log.push(line);
  console.log(`%c${line}`, `color:${ok ? '#4ec98a' : '#ff6b57'}`);
  return ok;
}
const near = (v, target, tol) => Math.abs(v - target) <= tol;

function settle(params, years) {
  const s = new Simulation(params);
  s.runYears(years);
  return s;
}

// The inner edge of the habitable zone, by bisection: the lowest flux at which
// this world ends up with no liquid sea left. Deliberately a local copy rather
// than an import from tools/ -- this file also runs in the browser under
// ?selftest, where nothing outside src/ is served.
function lostItsOcean(w) {
  const total = w.water.ocean + w.water.seaIce + w.water.landIce + w.water.vapour;
  return total > 0 && w.water.ocean / total < 0.02 && w.diag.Tmean > 330;
}
function threshold(params, lo = 0.8, hi = 3.0, tol = 0.03) {
  const at = (S) => lostItsOcean(settle({ ...params, insolation: S }, 3e6).world);
  if (at(lo)) return lo;
  if (!at(hi)) return hi;
  while (hi - lo > tol) { const m = (lo + hi) / 2; if (at(m)) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

export function run() {
  pass = 0; fail = 0; log.length = 0;
  console.log('%c— Planet Climate Sandbox: self-test —', 'font-weight:bold');

  // ---- 1. radiative anchors -----------------------------------------------
  const rl = runawayLimit(280e-6, 1.0);   // 1 bar of background air, as in the literature setup
  check('Simpson–Nakajima limit ≈ 282 W/m² (literature)',
    near(rl.flux, 283, 6), `${rl.flux.toFixed(1)} W/m² at ${rl.T} K`);
  check('Modern Earth OLR ≈ 240 W/m²',
    near(olr(288, 280e-6, 0.0110, 1.8e-6, 1.011), 238, 6),
    `${olr(288, 280e-6, 0.0110, 1.8e-6, 1.011).toFixed(1)} W/m²`);
  check('Venus OLR ≈ 160 W/m² at 737 K, 92 bar',
    near(olr(737, 92, 0, 0, 92), 161, 12), `${olr(737, 92, 0, 0, 92).toFixed(0)} W/m²`);

  // ---- 2. the three worlds we can check against reality --------------------
  const earth = settle(EARTH, 2e7);   // let the carbonate-silicate thermostat converge
  check('Earth settles at 288 K ± 3',
    near(earth.world.diag.Tmean, 288, 3), `${earth.world.diag.Tmean.toFixed(1)} K`);
  check('Earth keeps polar ice but stays mostly open',
    earth.world.diag.iceMean > 0.005 && earth.world.diag.iceMean < 0.25,
    `${(earth.world.diag.iceMean * 100).toFixed(0)}% ice`);
  check('Earth is classified habitable', classify(earth.world).habitable, classify(earth.world).name);

  const venus = settle(PRESETS.venus.params, 1e5);
  check('Venus settles near 737 K ± 40',
    near(venus.world.diag.Tmean, 737, 40), `${venus.world.diag.Tmean.toFixed(0)} K`);
  check('Venus is a dry runaway', classify(venus.world).id === 'dryRunaway', classify(venus.world).name);

  const mars = settle(PRESETS.mars.params, 1e5);
  check('Mars settles near 215 K ± 25',
    near(mars.world.diag.Tmean, 215, 25), `${mars.world.diag.Tmean.toFixed(0)} K`);

  const moon = new Simulation(PRESETS.moon.params).world;
  check('The Moon preset is the real airless, dry lunar body',
    near(moon.params.mass, 0.0123, 1e-6)
      && moon.diag.pTotMean < 1e-5 && moon.diag.totalWater === 0
      && moon.params.rotationHours > 655 && moon.params.rotationHours < 656
      && classify(moon).id === 'airless',
    `${moon.params.mass} M⊕, ${moon.params.rotationHours.toFixed(2)} h day, ${classify(moon).name}`);

  check('Mouse-wheel zoom follows the usual direction',
    wheelZoomFactor(120) > 1 && wheelZoomFactor(-120) < 1,
    `wheel out ${wheelZoomFactor(120).toFixed(3)}× · wheel in ${wheelZoomFactor(-120).toFixed(3)}× camera distance`);
  check('Panning offers directly selectable slow, normal and fast multipliers',
    PAN_SPEEDS.join(',') === '0.5,1,2' && DEFAULT_PAN_SPEED === 1
      && near(panRadiansPerPixel(1, 0.5), 0.5 * panRadiansPerPixel(1, 1), 1e-12)
      && near(panRadiansPerPixel(1, 2), 2 * panRadiansPerPixel(1, 1), 1e-12),
    `${PAN_SPEEDS.join('× · ')}× · ${DEFAULT_PAN_SPEED}× default`);

  check('The historical Moon and both Venus climate paths are available',
    !!PRESETS.earlyMoon && !!PRESETS.dryVenus,
    `early Moon ${PRESETS.earlyMoon ? 'present' : 'missing'} · dry Venus ${PRESETS.dryVenus ? 'present' : 'missing'}`);

  if (PRESETS.earlyMoon) {
    const lunar = new Simulation({ ...PRESETS.earlyMoon.params });
    lunar.runYears(1e6, 1e5);
    const p1 = lunar.world.diag.pTotMean;
    lunar.runYears(69e6, 5e5);
    check('Ancient lunar volcanism makes a thin, transient atmosphere',
      PRESETS.earlyMoon.params.n2Bar >= 0.008 && PRESETS.earlyMoon.params.n2Bar <= 0.012
        && PRESETS.earlyMoon.params.water >= 0.36e-7
        && PRESETS.earlyMoon.params.water <= 1.86e-7
        && p1 > 0.005 && lunar.world.diag.pTotMean < 0.001
        && lunar.world.diag.totalWater > 1e-7,
      `${(PRESETS.earlyMoon.params.n2Bar * 1000).toFixed(0)} mbar initially · `
      + `${(p1 * 1000).toFixed(1)} mbar at 1 Myr · `
      + `${(lunar.world.diag.pTotMean * 1000).toFixed(2)} mbar at 70 Myr · `
      + `${lunar.world.diag.totalWater.toExponential(2)} EO water retained`);
  }

  // Campbell's one-atmosphere alien-plant predictions are deliberately not a
  // simple warm/cool hue ramp. Pin the distinctive anchors, and the important
  // compatibility rule: Earth under its actual Sun keeps its existing greens.
  {
    const a = vegetationColor(9600), f = vegetationColor(7300);
    const g = vegetationColor(5772), k = vegetationColor(4590);
    const m = vegetationColor(3200), late = vegetationColor(2500);
    check('Vegetation colour follows the host star’s spectral class',
      a[0] > a[1] && f[2] > 1.8*f[0]
        && g[1] > 3*g[0] && k[0] > 2.5*k[1]
        && m[2] > m[0] && Math.max(...late) - Math.min(...late) < 0.13,
      'A brown · F blue-violet · G2 green · K orange · M violet/blue to pale tan');
    const leaf = [0.11, 0.26, 0.11];
    const solarLeaf = stellarVegetation(leaf, SOLAR_VEGETATION);
    const orangeLeaf = stellarVegetation(leaf, k);
    check('Earth stays naturally green at 5772 K, and changes when its star does',
      solarLeaf.every((v, i) => v === leaf[i]) && orangeLeaf[0] > orangeLeaf[1],
      `solar ${solarLeaf.map((v) => v.toFixed(2)).join('/')} · K4 ${orangeLeaf.map((v) => v.toFixed(2)).join('/')}`);
  }

  // Basins have finite relief. The old power law multiplied by
  // (1 - landFraction), so its exact endpoint hid twelve Earth oceans in a
  // zero-area, infinite-depth reservoir: water.ocean said 12 EO while the globe
  // and readout both said 0% ocean. These are the two reported URLs, including
  // their short elapsed times.
  {
    const reportedEarth = settle({ ...EARTH, landFraction: 1, water: 12,
      co2Bar: 0.000475454, ch4Bar: 0.00000205607, emissions: 1,
      fossilUsed: 0.098, brightening: 1, realisticGeology: true }, 4).world;
    const reportedBarren = settle({ ...EARTH, landFraction: 1, water: 12,
      biosphere: 0, co2Bar: 0.0563, ch4Bar: 0.0000011447, outgassing: 20,
      startT: 310.45, realisticGeology: true }, 56).world;
    check('Finite relief puts both reported twelve-ocean inventories on the surface',
      reportedEarth.diag.totalWater > 11.9 && reportedEarth.diag.flooded > 0.999
        && reportedBarren.diag.totalWater > 11.9 && reportedBarren.diag.flooded > 0.999,
      `${reportedEarth.diag.totalWater.toFixed(2)} EO → ${(reportedEarth.diag.flooded * 100).toFixed(0)}% ocean · ` +
      `${reportedBarren.diag.totalWater.toFixed(2)} EO → ${(reportedBarren.diag.flooded * 100).toFixed(0)}% ocean`);
    check('…and both labels follow the ocean the globe now shows',
      classify(reportedEarth).id === 'waterworld' && classify(reportedBarren).id === 'waterworld',
      `${classify(reportedEarth).name} · ${classify(reportedBarren).name}`);
    const allOceanReference = settle({ ...EARTH, landFraction: 0, water: 12,
      co2Bar: 0.000475454, ch4Bar: 0.00000205607, emissions: 1,
      fossilUsed: 0.098, brightening: 1, realisticGeology: true }, 4).world;
    const weatheringScale = Math.max(Math.abs(allOceanReference.weathering.W), 1e-30);
    check('…and drowned high ground no longer weathers as exposed continent',
      Math.abs(reportedEarth.weathering.W - allOceanReference.weathering.W) / weatheringScale < 1e-10,
      `weathering differs by ${((reportedEarth.weathering.W - allOceanReference.weathering.W)
        / weatheringScale).toExponential(1)}`);

    // …and Venus can now be terraformed into something that looks terraformed.
    // Its basin geometry is 0.8 because about a fifth of the planet is lowland
    // plain, which is where an ocean goes before it starts overtopping uplands.
    const cooled = settle({ ...PRESETS.venus.params, insolation: 1.0, water: 1,
      co2Bar: 3e-4, startT: 288 }, 3e6).world;
    const cs = classify(cooled);
    check('…and a cooled, watered Venus gets a sea rather than a bare ball',
      cooled.diag.flooded > 0.1 && cs.id === 'temperate',
      `${(cooled.diag.Tmean - 273.15).toFixed(1)} °C, ` +
      `${(cooled.diag.flooded * 100).toFixed(0)}% ocean → ${cs.name}`);

    // The dry Venus that ships is untouched by that, which is the point of
    // deriving coverage from water rather than from the slider.
    const dry = settle(PRESETS.venus.params, 1e5).world;
    check('…while Venus as it ships is exactly as dry as it was',
      dry.diag.flooded < 1e-6 && classify(dry).id === 'dryRunaway',
      `${(dry.diag.flooded * 100).toFixed(2)}% flooded, ${dry.diag.Tmean.toFixed(0)} K`);
  }

  // Two hot oceans that are hot for opposite reasons, and the point of the pair
  // is that the temperature is the same and nothing else is. Each has to still
  // be a sea at 100 Myr, or the preset is a transient wearing a preset's name.
  {
    const co2 = settle(PRESETS.hotCarbon.params, 1e8).world;
    const sun = settle(PRESETS.hotStar.params, 1e8).world;
    check('A hot ocean can be made by its air or by its star, at the same temperature',
      Math.abs(co2.diag.Tmean - sun.diag.Tmean) < 3
        && co2.diag.Tmean > 320 && co2.water.ocean > 0.9 && sun.water.ocean > 0.9
        && PRESETS.hotCarbon.params.landFraction === 0
        && PRESETS.hotStar.params.landFraction === 0
        && co2.diag.flooded > 0.995 && sun.diag.flooded > 0.995,
      `CO₂-heated ${(co2.diag.Tmean - 273.15).toFixed(1)} °C at ${co2.diag.pCO2.toFixed(4)} bar · ` +
      `star-heated ${(sun.diag.Tmean - 273.15).toFixed(1)} °C at ` +
      `${(sun.diag.pCO2 * 1e6).toFixed(2)} ppm`);
    // …and the thermostat is what makes them opposites: the bright world
    // weathers its own greenhouse away and stays hot regardless, which is the
    // whole reason the second one is not simply the first one with a brighter
    // star. Three orders of magnitude is the claim, so test for three.
    check('…and the bright one gets there having stripped its own greenhouse away',
      co2.diag.pCO2 / sun.diag.pCO2 > 1e3,
      `${(co2.diag.pCO2 / sun.diag.pCO2).toExponential(1)}× more CO₂ on the world ` +
      `whose air is doing the work`);
  }

  // One thousandth of starlight from that branch there is no equilibrium at all.
  // 1.338 S⊕ holds its ocean for 100 Myr; the preset sits at 1.339 and loses the
  // whole thing in about 13 kyr. Both halves matter: a preset called Over the
  // Edge that quietly settled would be a lie, and an edge that is not an edge --
  // one where the stable neighbour also cooks -- would be a different lie.
  {
    const over = settle(PRESETS.brink.params, 3e4).world;
    const under = settle({ ...PRESETS.brink.params, insolation: 1.338 }, 1e8).world;
    check('A world a thousandth over the limit crosses it, and its neighbour does not',
      over.water.ocean < 0.05 && over.diag.Tmean > 500
        && under.water.ocean > 0.9 && under.diag.Tmean < 340,
      `1.339 S⊕ → ${(over.diag.Tmean - 273.15).toFixed(0)} °C, ocean ` +
      `${(over.water.ocean * 100).toFixed(0)}% · 1.338 S⊕ → ` +
      `${(under.diag.Tmean - 273.15).toFixed(1)} °C, ocean ${(under.water.ocean * 100).toFixed(0)}%`);
  }

  // ---- 3. the runaway, and how long it takes -------------------------------
  {
    const s = new Simulation({ ...EARTH, insolation: 2.6, xuvFraction: 1e-4 });
    let tOnset = null, tSteam = null, tLost = null, sawMoist = false, sawWet = false;
    while (s.world.time < 5e9) {
      const w = s.world;
      if (tOnset === null && w.diag.Tmean > 320) tOnset = w.time;
      if (tSteam === null && w.diag.Tmean > 620) tSteam = w.time;
      if (tLost === null && w.water.lost > 0.9) { tLost = w.time; break; }
      const id = classify(w).id;
      if (id === 'moist') sawMoist = true;
      if (id === 'wetRunaway') sawWet = true;
      s.runYears(Math.max(5, w.time * 0.06));
    }
    check('A runaway greenhouse actually runs away', tSteam !== null,
      tSteam ? `steam atmosphere by ${tSteam.toExponential(1)} yr` : 'never reached');
    // How long a runaway takes is set by energy conservation: an Earth ocean
    // needs ~7e12 J/m² of latent heat, so the transient is that divided by
    // whatever net flux the planet is running. It is therefore fast under
    // strong forcing and slow near the threshold -- and never instantaneous.
    const transientAt = (S) => {
      const x = new Simulation({ ...EARTH, insolation: S, xuvFraction: 1e-4 });
      let a = null;
      while (x.world.time < 2e7) {
        const T = x.world.diag.Tmean;
        if (a === null && T > 320) a = x.world.time;
        if (a !== null && T > 620) return x.world.time - a;
        x.runYears(Math.max(2, x.world.time * 0.03));
      }
      return null;
    };
    const near = transientAt(1.35), hard = transientAt(2.6);
    check('Runaway takes centuries to millennia — never instantaneous',
      near !== null && hard !== null && hard > 50 && near < 1e6,
      `${hard.toExponential(1)} yr at 2.6 S⊕, ${near.toExponential(1)} yr near threshold`);
    check('…and is slower the closer the planet sits to the threshold',
      near > hard * 1.5, `${(near / hard).toFixed(1)}× slower near the edge`);
    check('Ocean loss takes 10⁸–10⁹ yr under a young-Sun XUV (Kasting 1988)',
      tLost !== null && tLost > 3e7 && tLost < 5e9, tLost ? `${tLost.toExponential(1)} yr` : 'not lost');
    check('It passes through the moist greenhouse on the way', sawMoist, sawMoist ? 'seen' : 'skipped');
    check('It passes through the wet runaway on the way', sawWet, sawWet ? 'seen' : 'skipped');
  }

  // ---- 3b. the modern climate problem --------------------------------------
  // Anchored on the instrumental record and IPCC AR6 rather than on anything
  // internal. tools/calibrate.mjs carries the full set with sources.
  {
    // CO2 held fixed, so this is the radiative + feedback response with the
    // carbonate-silicate thermostat taken out of the picture.
    const held = (ppm) => {
      const x = new Simulation({ ...EARTH, co2Bar: ppm * 1e-6, outgassing: 0 });
      const c = x.world.co2;
      let t = 0;
      while (t < 2e5) { const dt = Math.min(20 + t * 0.02, 5000); x.stepOnce(dt); t += dt; x.world.co2 = c; }
      return x.world;
    };
    const pre = held(280), now = held(427), two = held(560), lgm = held(190);
    check('Pre-industrial Earth settles at 13.7 °C (1850–1900 observed)',
      near(pre.diag.Tmean - 273.15, 13.7, 0.6), `${(pre.diag.Tmean - 273.15).toFixed(2)} °C`);
    check('Modern Earth is warmer by roughly the observed 1.45 K',
      // 2.5, not 2.3. See the note in tools/calibrate.mjs: pre-industrial Earth
      // now gets its real 0.72 ppm of methane rather than today's 1.9, which
      // cooled both endpoints and let the ice-albedo feedback widen the gap.
      now.diag.Tmean - pre.diag.Tmean > 1.3 && now.diag.Tmean - pre.diag.Tmean < 2.5,
      `${(now.diag.Tmean - pre.diag.Tmean).toFixed(2)} K at 427 ppm (equilibrium, so above the transient 1.45)`);
    check('Climate sensitivity 2.5–4 K per doubling (IPCC AR6: 3.0)',
      two.diag.Tmean - pre.diag.Tmean > 2.5 && two.diag.Tmean - pre.diag.Tmean < 4.0,
      `${(two.diag.Tmean - pre.diag.Tmean).toFixed(2)} K`);
    check('Glacial CO₂ cools the planet by several kelvin',
      lgm.diag.Tmean - pre.diag.Tmean < -1.8 && lgm.diag.Tmean - pre.diag.Tmean > -5.5,
      `${(lgm.diag.Tmean - pre.diag.Tmean).toFixed(2)} K at 190 ppm ` +
      `(the full LGM −6.1 K also had ice sheets and dust the model is not given)`);
    check('Earth keeps a realistic equator-to-pole gradient',
      pre.diag.Tmax - pre.diag.Tmin > 30 && pre.diag.Tmax - pre.diag.Tmin < 48,
      `${(pre.diag.Tmax - pre.diag.Tmin).toFixed(1)} K across 18 equal-area bands`);

    // CO2 forcing must be logarithmic. A power law fitted to Venus made every
    // doubling hit harder than the last, and tipped the planet into a runaway
    // at a few percent CO2 -- an outcome the literature puts at a hundred times
    // pre-industrial or beyond.
    const F = (c) => olr(288.15, c, 0.011, 1.8e-6, 1.011 + c);
    const d1 = F(280e-6) - F(560e-6), d3 = F(1120e-6) - F(2240e-6);
    check('CO₂ forcing ≈ 3.7–3.9 W/m² per doubling (Myhre 1998)',
      near(d1, 3.8, 0.6), `${d1.toFixed(2)} W/m²`);
    check('…and stays that way doubling after doubling',
      Math.abs(d3 - d1) < 1.0, `${d1.toFixed(2)} then ${d3.toFixed(2)} W/m²`);

    // Ramirez et al. 2014: Earth's climate is stable against CO2 alone;
    // Goldblatt et al. 2013 put a possible threshold near 100x pre-industrial.
    const hot = held(280 * 100);
    check('CO₂ alone does not run away at 100× pre-industrial (Ramirez 2014)',
      hot.diag.Tmean < 400, `${(hot.diag.Tmean - 273.15).toFixed(0)} °C at 2.8 % CO₂`);
  }

  // ---- 3c. ice sheets have inertia, and water has a critical point ----------
  {
    // Kilometres of ice do not appear the moment a continent drops below
    // freezing: tens of thousands of years to build, rather less to melt
    // (Abe-Ouchi et al. 2013). That asymmetry is the sawtooth of the glacial
    // cycles, and without it the albedo had a hair trigger.
    // Volcanoes off and CO2 pinned, so the thermostat cannot warm the world back
    // up while we are watching the ice build.
    const s = new Simulation({ ...PREINDUSTRIAL, insolation: 0.97, outgassing: 0 });
    const held = s.world.co2;
    const at = (yrs) => {
      while (s.world.time < yrs) {
        s.stepOnce(Math.min(maxStep(s.world), 200, yrs - s.world.time));
        s.world.co2 = held;
      }
      return s.world.iceSheet;
    };
    const early = at(2000), late = at(60000);
    const target = s.world.diag.iceSheetTarget;
    check('Ice sheets take tens of millennia to grow, not an instant',
      target > 0.05 && early < late * 0.55,
      `${(early * 100).toFixed(1)} % of land after 2 kyr vs ${(late * 100).toFixed(1)} % ` +
      `after 60 kyr, heading for ${(target * 100).toFixed(1)} %`);

    // Above 647 K and 220 bar there is no liquid water at any pressure: the
    // liquid and the vapour stop being different things. A wet runaway must
    // therefore show no sea at all, not a hot one.
    const wet = new Simulation({ ...EARTH, co2Bar: 1, startT: 288 });
    let n = 0;
    while (wet.world.time < 5e6 && n++ < 3e5) wet.runYears(2e5, 2e5);
    const d = wet.world.diag;
    check('A full runaway ends as supercritical fluid, not as vapour',
      (d.superFrac ?? 0) > 0.95 && (wet.world.diag.Tmean > T_CRIT_H2O),
      `${((d.superFrac ?? 0) * 100).toFixed(0)}% of the airborne water is past the critical point`);
    check('…and an Earth-like planet has none of it',
      (settle(EARTH, 1e6).world.diag.superFrac ?? 0) < 1e-6);
    check('A supercritical planet has no ocean, however much water it has',
      d.Tmean < T_CRIT_H2O || (wet.world.water.ocean < 1e-6 && d.flooded < 1e-3),
      `${(d.Tmean - 273.15).toFixed(0)} °C under ${d.pTotMean.toFixed(0)} bar ` +
      `(critical point ${(T_CRIT_H2O - 273.15).toFixed(0)} °C / ${(P_CRIT_H2O / 1e5).toFixed(0)} bar): ` +
      `ocean ${(d.flooded * 100).toFixed(1)} %`);
  }

  // ---- 3d. the night-side cold trap ----------------------------------------
  // On a synchronously rotating world the far side never sees the star, so it
  // sits a hundred kelvin or more below the substellar point, permanently.
  // Water sublimates from the warm side, deposits there, and does not come
  // back: the planet keeps its whole inventory and none of it is liquid
  // (Menou 2013; Leconte et al. 2013).
  //
  // This state was very nearly unreachable. partitionWater capped land ice at
  // half the surface water — a flat number, under a comment claiming it was the
  // water available above the basins — so the trap could never finish, and
  // every locked world in a 900-world sweep came out at exactly 50.0% land ice.
  // The classifier then compounded it by asking whether the substellar point
  // was warm enough for liquid water rather than whether any water was there,
  // so a bone-dry 285 K desert was filed as an eyeball. One world in nine
  // hundred reached the trapped state; it is 113 now.
  {
    // Drier and dimmer than the borderline case: trapped and twilight are two
    // basins of the same system, and a recipe sitting between them lands in
    // whichever one the integrator's step sequence happens to steer it to.
    const locked = settle({ ...EARTH, tidallyLocked: true, rotationHours: 240,
      // The pressure is pinned deliberately, and not because 0.3 is special.
      // At this water inventory the two basins interleave rather than dividing
      // at a threshold: sweeping the pressure gives trapped, trapped, twilight,
      // trapped, twilight... with no plateau to sit in the middle of. That is
      // pre-existing -- the same sweep does the same thing on the version before
      // the methane cycle was rewritten -- and it is what the note above means
      // by two basins of the same system. So: a fixed point, checked to land in
      // the trapped basin, rather than a range that cannot be made robust.
      //
      // Internal heat turned out to be another axis the basins interleave
      // along: at the old 0.25 bar this world was trapped with a dead interior
      // and twilight with Earth's 0.092 W/m2, because a little night-side heat
      // is enough to hold a sliver of liquid at the terminator. That is real,
      // not a regression. Thinning the air to 0.05 bar moves less heat to the
      // night side and deepens the trap: it now holds at 0, 0.03, 0.092, 0.13
      // and 0.18 W/m2 -- still with one interleaved miss at 0.06, because the
      // interleaving is a property of the system and not of the recipe.
      //
      // Re-pinned again, from 0.05 bar to 0.03, when methane's shortwave
      // absorption went in. That term is worth 7e-5 of the sunlight on this
      // world -- two hundredths of a watt -- and it was enough to move it from
      // trapped to twilight, which is the point of the note above and worth
      // restating: do not read a flip here as a physics regression without
      // measuring the size of the perturbation first.
      //
      // Sweeping water and pressure against internal heat again found no point
      // that is trapped at 0, 0.092 and 0.2 W/m^2 together -- 0.025/0.03 gives
      // trapped, trapped, twilight and 0.03/0.03 gives twilight, trapped,
      // twilight. So this is still one fixed point in the trapped basin and not
      // a robust region, exactly as before; the interleaving has not gone away
      // and is not expected to.
      water: 0.03, landFraction: 0.7, insolation: 0.9, n2Bar: 0.03,
      // A bare rocky world: no oxygen, and nothing alive to make any. Inheriting
      // Earth's 0.21 bar would nearly double its atmosphere and move enough heat
      // to the night side to stop the trap.
      o2Bar: 0, biosphere: 0,
      co2Bar: 1e-3, outgassing: 0.3, startT: 280 }, 2e7);
    const w = locked.world, st = classify(w);
    check('A locked world with a modest ocean traps it all on the night side',
      st.id === 'trapped', `${st.name}, ${(w.water.landIce / w.diag.totalWater * 100).toFixed(0)}% of the water as night-side ice`);
    check('…while keeping the water it started with, just not as liquid',
      w.diag.totalWater > 0.02 && w.water.ocean / w.diag.totalWater < 0.05,
      `${w.diag.totalWater.toFixed(3)} EO left, ${(w.water.ocean / w.diag.totalWater * 100).toFixed(1)}% of it liquid`);
    check('…and no sea left on the globe, so the label matches the picture',
      w.diag.flooded < 0.04, `${(w.diag.flooded * 100).toFixed(1)}% of the surface still flooded`);
    check('…and a sunlit face hot enough to be a desert, not an ice cap',
      st.Tsub > 320 && st.Tsub - st.Tanti > 100,
      `substellar ${(st.Tsub - 273.15).toFixed(0)} °C, antistellar ${(st.Tanti - 273.15).toFixed(0)} °C`);

    // An eyeball is the same geometry with enough water that the sheets cannot
    // hold it: ice flows and calves back, so a deep ocean keeps its sunlit sea.
    // If this stops being true the two states have collapsed into one.
    const eyeball = settle(PRESETS.eyeball.params, 2e7);
    check('…but a world with a real ocean keeps its sunlit sea',
      classify(eyeball.world).id === 'eyeball' || classify(eyeball.world).id === 'lobster',
      `${classify(eyeball.world).name}, ${(eyeball.world.water.landIce / eyeball.world.diag.totalWater * 100).toFixed(0)}% as land ice`);
  }

  // ---- 3e. terminator habitability -----------------------------------------
  // A habitable ring between a scorching eye and a glacial night side. It needs
  // a land planet: water vapour is what carries heat away from the substellar
  // point, so a wetter world evens the temperatures out and crosses the runaway
  // limit as a whole instead of leaving a habitable band (Lobo et al. 2023).
  {
    const locked = (water, land) => settle({ ...EARTH, tidallyLocked: true,
      rotationHours: 400, water, landFraction: land, insolation: 1.0,
      n2Bar: 0.3, o2Bar: 0, biosphere: 0, co2Bar: 3e-4, outgassing: 0.3, startT: 300 }, 2e7);

    const land = locked(0.08, 0.9), lw = land.world, ls = classify(lw);
    let ring = 0;
    for (let i = 0; i < NBANDS; i++) if (lw.T[i] > 275 && lw.T[i] < 320) ring++;
    check('A locked land planet keeps a habitable ring at the terminator',
      ls.id === 'twilight', ls.name);
    check('…with an eye past boiling and a night side under deep frost',
      ls.Tsub > 340 && ls.Tanti < 265,
      `eye ${(ls.Tsub - 273.15).toFixed(0)} °C, terminator ring ${ring} bands, night ${(ls.Tanti - 273.15).toFixed(0)} °C`);

    // The paper's central claim, and the reason the state requires a land
    // planet: give the same world an ocean and the band closes.
    const aqua = locked(3.0, 0.0), as = classify(aqua.world);
    check('…but the same world with an ocean is not a Twilight World',
      as.id !== 'twilight',
      `${as.name}; day-night contrast ${(aqua.world.diag.Tmax - aqua.world.diag.Tmin).toFixed(0)} K ` +
      `against the land planet's ${(lw.diag.Tmax - lw.diag.Tmin).toFixed(0)} K`);
  }

  // ---- 3e2. hot locked water worlds do not chatter --------------------------
  // Regression from the exact shared URL in the Orion's Arm feedback. The
  // quasi-static shortcut was multiplying a sub-year accuracy step into a few
  // hundred years while a nightside ice sheet was still steering humidity and
  // albedo. The accepted nonlinear solve descended, but the repeated oversized
  // steps made the world alternate between Twilight and Baked Desert for ever.
  // A short fixed-fine trace stays on the Twilight branch; the adaptive trace
  // has to do the same without paying fixed-fine cost everywhere else.
  {
    const sim = new Simulation({ ...PRESETS.earth.params,
      water: 0.0327, insolation: 1.06, rotationHours: 912,
      tidallyLocked: true, obliquity: 0,
      n2Bar: 0.779428, o2Bar: 0.140816, co2Bar: 0.239721,
      ch4Bar: 2.23125e-7, emissions: 1, fossilUsed: 0.098,
      internalHeat: 0.0816658, realisticGeology: true });
    const w = sim.world, end = 4e5, warm = 1e5;
    let steps = 0, flips = 0, previous = null, maxMove = 0;
    while (w.time < end && steps < 30000) {
      const before = w.diag.Tmean;
      sim.stepOnce(Math.min(maxStep(w), end - w.time));
      steps++;
      if (w.time < warm) continue;
      const state = classify(w).id;
      if (previous && state !== previous) flips++;
      previous = state;
      maxMove = Math.max(maxMove, Math.abs(w.diag.Tmean - before));
    }
    check('A hot, wet locked world does not chatter across a climate boundary',
      flips <= 1 && maxMove < 1.25 && steps < 30000,
      `${flips} state flips, ${maxMove.toFixed(2)} K largest mean step, ${steps} steps / 400 kyr`);
  }

  // ---- 3f. a sea has to be deep enough to be a sea --------------------------
  // The hypsometric power law is calibrated in the middle of its range and is
  // badly wrong at the bottom: taken literally it floods 1.6% of a planet with
  // a millionth of an ocean, twenty centimetres deep. Since the renderer draws
  // whatever fraction it returns as open water, a world the model itself called
  // bone dry came out with blue seas along its terminator.
  {
    const ref = 2.75e6;                       // kg/m², one Earth ocean
    const deepest = (basin) => basin / (floodedFraction(basin, 0.5, ref) * 1000);
    check('A vanishing ocean pools rather than spreading out',
      floodedFraction(1e-6 * ref, 0.5, ref) < 0.001,
      `a millionth of an ocean floods ${(floodedFraction(1e-6 * ref, 0.5, ref) * 100).toFixed(3)}% of the surface`);
    let shallowest = Infinity;
    for (let e = 0; e >= -8; e -= 0.25) shallowest = Math.min(shallowest, deepest(Math.pow(10, e) * ref));
    check('…and no sea is ever drawn shallower than it could physically be',
      shallowest > MIN_SEA_DEPTH * 0.99, `thinnest sea ${shallowest.toFixed(0)} m deep`);
    check('Earth-sized inventories are untouched by that floor',
      near(floodedFraction(ref, 0.3, ref), 0.7, 1e-9) && near(floodedFraction(0.5 * ref, 0.3, ref), 0.7 * Math.pow(0.5, 0.25), 1e-9),
      `1 EO floods ${(floodedFraction(ref, 0.3, ref) * 100).toFixed(1)}%`);
  }

  // ---- 3g. how long an ocean takes to boil ----------------------------------
  // This is an energy problem, not a rate problem: vaporising an Earth ocean
  // needs L_vap x 2.75e6 kg/m^2 = 6.6e12 J/m^2, so the time is that divided by
  // whatever net flux the planet is running. Turbet et al.'s often-quoted ~10^5
  // yr is a planet sitting a few W/m^2 over the limit; one at 1.4 S⊕ runs about
  // 57 W/m^2 and boils in a couple of thousand years. The physical content is
  // the scaling, so that is what is checked.
  {
    const NEED = 2.4e6 * 2.75e6 / 3.156e7;      // J/m², expressed in W/m²·years
    const boil = (S) => {
      const x = new Simulation({ ...EARTH, insolation: S });
      const w = x.world;
      let t0 = null, f0 = null;
      for (let n = 0; n < 3e5 && w.time < 3e6; n++) {
        x.stepOnce(Math.min(maxStep(w), 2e4));
        if (t0 === null && w.diag.Tmean > 320) { t0 = w.time; f0 = w.diag.imbalance; }
        if (t0 !== null && w.water.ocean < 0.02 * w.diag.totalWater) return { dt: w.time - t0, f0 };
      }
      return { dt: null, f0 };
    };
    const hard = boil(2.6), mild = boil(1.416);
    const pred = (f) => NEED / f;
    const ok = (r) => r.dt !== null && r.dt < pred(r.f0) * 1.6 && r.dt > pred(r.f0) * 0.25;
    check('Boiling an ocean takes the time energy conservation says it should',
      ok(hard) && ok(mild),
      `at 2.6 S⊕ ${hard.dt.toExponential(1)} yr against ${pred(hard.f0).toExponential(1)} predicted; ` +
      `at 1.416 S⊕ ${mild.dt.toExponential(1)} yr against ${pred(mild.f0).toExponential(1)}`);
    check('…so a planet barely over the limit boils far more slowly than one well past it',
      mild.dt > hard.dt * 1.5,
      `${(mild.dt / hard.dt).toFixed(1)}× longer at 1.416 S⊕ than at 2.6 S⊕`);
  }

  // ---- 3h. the steam envelope must not hide the thing it is made of ---------
  // The opacity was linear in vapour pressure and saturated at 3 bar, which is
  // 134 °C -- and at 134 °C some 95% of an Earth ocean is still liquid. So the
  // planet turned featureless white at the very start of a runaway and stayed
  // that way, hiding the sea actually boiling away.
  {
    const x = new Simulation({ ...EARTH, insolation: 1.416 });
    const w = x.world;
    let worst = 0;
    for (let n = 0; n < 3e5 && w.time < 3e6; n++) {
      x.stepOnce(Math.min(maxStep(w), 2e3));
      const pw = w.diag.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
      // Early in the boil, while the ocean is essentially intact, the envelope
      // must still be see-through enough to show it. Not later: once a tenth of
      // an Earth ocean is airborne that is twenty-seven bar of steam, and a
      // steam atmosphere that thick genuinely is opaque -- which is what Venus
      // looks like, and not a rendering choice to argue with.
      if (w.water.ocean > 0.95 * w.diag.totalWater) worst = Math.max(worst, steamOpacity(pw));
      if (w.water.ocean < 0.02 * w.diag.totalWater) break;
    }
    check('The steam envelope stays see-through while the ocean is still intact',
      worst < 0.70, `envelope reaches ${(worst * 100).toFixed(0)}% opacity while 95% of the sea remains ` +
      `(it was 100% by 3 bar, which is 134 °C, with the ocean barely touched)`);
    check('…and closes over completely once the ocean is airborne',
      steamOpacity(270) > 0.99, `${(steamOpacity(270) * 100).toFixed(0)}% at 270 bar`);
  }

  // ---- 3i. organic haze and the anti-greenhouse -----------------------------
  // Ultraviolet light polymerises methane into tholins, but only in a reducing
  // atmosphere: the haze switches on past CH4/CO2 ~ 0.1 and free oxygen
  // destroys it (Trainer et al. 2006; Zerkle et al. 2012). It absorbs sunlight
  // high up and is nearly transparent in the thermal infrared, so it cools the
  // ground without trapping anything -- the anti-greenhouse (McKay, Pollack &
  // Courtin 1991).
  {
    // A hundred thousand years, not twenty million. Titan's methane is not in
    // steady state and cannot be: there is nothing on that moon making five
    // percent of an atmosphere, and the photolysis works through it in ten to a
    // hundred million years (Yung, Allen & Pinto 1984; Nixon et al. 2018). The
    // model reproduces that, so it has to be asked about Titan as observed.
    const titan = settle(PRESETS.titan.params, 1e5);
    check('Titan settles at its observed 94 K',
      near(titan.world.diag.Tmean, 94, 4), `${titan.world.diag.Tmean.toFixed(1)} K`);
    check('…and it is the haze that puts it there',
      titan.world.diag.hazeTau > 0.2 && titan.world.diag.hazeSW < 0.7,
      `optical depth ${titan.world.diag.hazeTau.toFixed(2)}, ` +
      `${((1 - titan.world.diag.hazeSW) * 100).toFixed(0)}% of the sunlight stopped above the ground`);

    check('An oxygen-rich world grows no haze however much methane it has',
      hazeOpacity(0.05, 1e-6, 0.2, 1) === 0);
    check('Nor does an oxidised one: the CH₄/CO₂ switch',
      hazeOpacity(1e-3, 0.02, 0, 1) === 0 && hazeOpacity(1e-2, 0.02, 0, 1) > 0.1,
      `CH₄/CO₂ 0.05 → clear, 0.5 → τ ${hazeOpacity(1e-2, 0.02, 0, 1).toFixed(2)}`);
    check('Modern Earth is far from hazy', hazeOpacity(1.9e-6, 427e-6, 0.21, 1) === 0);

    // The Archean thermostat, which turns over TWICE and for two different
    // reasons. It used to be attributed entirely to the haze; most of it is not.
    //
    // Methane's own near-infrared bands take sunlight and put it high in the
    // atmosphere, so past a certain amount more methane cools the ground with
    // no smog involved at all. Eager-Nash et al. 2023 put that first peak
    // between 30 and 300 Pa and the model lands it at 60. Only well past that,
    // once CH4/CO2 clears about 0.1, does the tholin haze switch on and take
    // the surface down hard. So the sweep has to span three decades, not the
    // half-decade it used to: at the old 8-55 mbar range every point was
    // already past both turns and on the floor.
    const arch = (ch4) => {
      // biosphere off: with no volcanic reductants to outrun, even a small one
      // oxygenates the air and kills the methane, which is correct but is not
      // what this test is about.
      const x = new Simulation({ ...PRESETS.earlyEarth.params, ch4Bar: ch4, outgassing: 0, biosphere: 0 });
      // Methane is pinned as well as CO2 now. Without it this measures how much
      // survives three hundred thousand years, not what it is worth while it is
      // there -- and since the photolytic ceiling makes the lifetime depend on
      // the column, the low end of the sweep decayed to nothing and returned
      // the same bare-CO2 temperature for every point.
      const c = x.world.co2, m = x.world.ch4;
      let n = 0;
      while (x.world.time < 3e5 && n++ < 3e4) {
        x.stepOnce(Math.min(maxStep(x.world), 2e3)); x.world.co2 = c; x.world.ch4 = m;
      }
      return x.world.diag;
    };
    const ch4s = [1e-5, 3e-5, 1e-4, 3e-4, 6e-4, 1e-3, 3e-3, 8e-3, 2e-2, 5.5e-2];
    const ds = ch4s.map(arch);
    const Ts = ds.map((d) => d.Tmean);
    let peak = 0;
    for (let i = 1; i < Ts.length; i++) if (Ts[i] > Ts[peak]) peak = i;
    check('Archean methane warms only up to a point, and that point is where the literature puts it',
      ch4s[peak] * 1e5 >= 30 && ch4s[peak] * 1e5 <= 300,
      `warmest at ${(ch4s[peak] * 1e5).toFixed(0)} Pa CH\u2084 (${(Ts[peak] - 273.15).toFixed(1)} \u00b0C); ` +
      `Eager-Nash 2023 peak at 30-300 Pa`);
    // The first turn is the gas on its own: still no haze at all where it falls.
    const after = ds.findIndex((d, i) => i > peak && Ts[i] < Ts[peak] - 2);
    check('\u2026and the first turn is methane shading the ground itself, with no haze yet',
      after > 0 && ds[after].hazeSW > 0.999 && ds[after].ch4SW < 0.99,
      `${(ch4s[after] * 1e5).toFixed(0)} Pa is ${(Ts[peak] - Ts[after]).toFixed(1)} K below the peak with ` +
      `${((1 - ds[after].ch4SW) * 100).toFixed(1)}% of the sunlight taken by methane and none by haze`);
    // And the second is the smog, which is a much bigger hammer.
    const last = ds.length - 1;
    check('\u2026and the second is the haze, which takes the planet down much harder',
      ds[last].hazeSW < 0.8 && Ts[last] < Ts[after] - 15,
      `by ${(ch4s[last] * 1e3).toFixed(0)} mbar the haze stops ` +
      `${((1 - ds[last].hazeSW) * 100).toFixed(0)}% of the sunlight and the surface is ` +
      `${(Ts[last] - 273.15).toFixed(1)} \u00b0C`);
  }

  // ---- 3i2. what a hot surface actually looks like --------------------------
  // The night side used to be painted with a glow taken from the planet's mean
  // temperature. A mean is not a temperature any ground has: GJ 1132 b runs a
  // 1270 K day side against a 692 K night side for a 920 K mean, and that mean
  // washed the dark half in orange four times brighter than the terrain under
  // it -- carrying no surface detail, because it varied only with the smooth
  // day-to-night ramp. It read as a blur, which is how it was reported.
  {
    // The anchor is Planck itself, integrated over 400-700 nm, rather than the
    // fitted constants handed back to me. If the fit drifts from the physics
    // this fails whatever the constants say.
    const h = 6.62607015e-34, c = 2.99792458e8, kB = 1.380649e-23;
    const B = (l, T) => 2 * h * c * c / Math.pow(l, 5) / (Math.exp(h * c / (l * kB * T)) - 1);
    const visFrac = (T) => {
      let vis = 0, tot = 0;
      for (let l = 1e-8; l < 2e-4; l *= 1.002) {
        const b = B(l, T) * l * 0.002;
        tot += b;
        if (l >= 4e-7 && l <= 7e-7) vis += b;
      }
      return vis / tot;
    };
    const ref = visFrac(1500);
    const worst = [900, 1000, 1100, 1200, 1300, 1400, 1500].reduce((m, T) => {
      const want = visFrac(T) / ref, got = thermalGlow(T);
      return Math.max(m, Math.abs(got - want) / want);
    }, 0);
    check('The visible glow of hot rock follows Planck, not a straight line',
      worst < 0.2,
      `worst error ${(worst * 100).toFixed(0)}% against the integrated 400-700 nm ` +
      `fraction, 900-1500 K`);

    // The Draper point, ~798 K, is where solids first glow dull red. Venus's
    // surface sits at 737 K and does not -- which is why pictures of it are lit
    // by daylight through the cloud, not by the ground. Under the old formula
    // it glowed, and so did every night side of every hot world.
    check('\u2026so nothing below the Draper point glows, Venus\u2019s 737 K ground included',
      thermalGlow(737) < 1e-4 && thermalGlow(692) < 1e-4 && thermalGlow(500) < 1e-8,
      `692 K ${thermalGlow(692).toExponential(1)} \u00b7 737 K ${thermalGlow(737).toExponential(1)} ` +
      `\u00b7 798 K ${thermalGlow(798).toExponential(1)}, against 1.0 at 1500 K`);
    check('\u2026while genuinely molten ground still does',
      thermalGlow(1400) > 0.2 && thermalGlow(1800) > 1,
      `1400 K ${thermalGlow(1400).toFixed(2)} \u00b7 1800 K ${thermalGlow(1800).toFixed(2)}`);

    // GJ 1132 b is the world it was reported on. Its night side must be dark
    // and its day side must not be.
    {
      const w = settle({ ...PRESETS.gj1132b.params }, 5e6).world;
      const night = Math.min(...w.T), day = Math.max(...w.T);
      check('GJ 1132 b\u2019s night side is dark, and its day side is not',
        thermalGlow(night) < 1e-3 && thermalGlow(day) > 0.05,
        `night ${night.toFixed(0)} K glows ${thermalGlow(night).toExponential(1)}, ` +
        `day ${day.toFixed(0)} K glows ${thermalGlow(day).toFixed(2)}`);
    }

    // The matching GLSL check -- that the shader carries the same curve -- lives
    // in tools/glslcheck.mjs. It cannot live here: this file also runs in the
    // browser, through ?selftest, where there is no filesystem to read from.
  }

  // ---- 3i3. the mean is not a temperature a locked world has ----------------
  // TRAPPIST-1b settles at a global mean of -1.5 C, which reads as temperate
  // and describes nowhere on it: the day side never sets and sits at 237 C, the
  // night side never sees the star and sits at -186 C. Reporting the mean alone
  // was actively misleading, and "534 bar CO2 frozen out" alongside it read as
  // a frozen planet rather than as a cold trap on the dark half.
  {
    const w = settle({ ...PRESETS.trappist1b.params }, 1.7e9).world;
    const st = classify(w);
    check('A locked world reports its two sides, because its mean describes neither',
      w.diag.lam > 0.5 && st.Tsub - st.Tanti > 300
        && st.Tanti < w.diag.Tmean && w.diag.Tmean < st.Tsub,
      `TRAPPIST-1b: day ${(st.Tsub - 273.15).toFixed(0)} \u00b0C, ` +
      `night ${(st.Tanti - 273.15).toFixed(0)} \u00b0C, mean ` +
      `${(w.diag.Tmean - 273.15).toFixed(1)} \u00b0C`);
    check('\u2026and says where its CO\u2082 went, since half of it is hot enough to melt lead',
      reasonText(w, st).includes('night side'),
      reasonText(w, st));
    // The banner is the line people actually read, so both sides belong in it
    // and not only in the stats panel -- and a rotating world must not grow a
    // day and a night it does not have.
    {
      const spin = settle({ ...EARTH }, 1e5).world;
      check('\u2026and the banner carries both sides on a locked world, and neither on a spinning one',
        /day .* \u00b0C, night .* \u00b0C/.test(reasonText(w, st))
        && !/night/.test(reasonText(spin, classify(spin))),
        reasonText(spin, classify(spin)));
    }

    // The physics behind it, which is a real and named prediction rather than
    // an artefact: below a certain pressure the night side is a cold trap and
    // the atmosphere collapses onto it (Joshi 1997; Wordsworth 2015; Koll &
    // Abbot 2016). Above it, transport keeps the night side warm enough to hold
    // the gas. The model has the threshold as well as the behaviour, and it
    // must not collapse a thick atmosphere.
    const end = (co2Bar) => {
      const x = settle({ ...PRESETS.trappist1b.params, co2Bar, outgassing: 0 }, 1e6).world;
      return { air: x.diag.pCO2, night: Math.min(...x.T) };
    };
    const thin = end(0.1), thick = end(2);
    check('A thin atmosphere collapses onto the night side; a thick one does not',
      thin.air < 1e-6 && thick.air > 1,
      `0.1 bar \u2192 ${thin.air.toExponential(1)} bar left (night ${thin.night.toFixed(0)} K), ` +
      `2 bar \u2192 ${thick.air.toFixed(2)} bar left (night ${thick.night.toFixed(0)} K)`);

    // A collapse under way and a collapse that has finished are two different
    // planets, and they were sharing a name and a description. The description
    // is the specific problem: the partial state says the day side "can stay
    // warm, wet and inhabited the whole time ... a planet with a working ocean
    // under its sun", which is exactly why the state is worth having -- and it
    // was being shown to worlds whose water was entirely frozen onto the dark
    // side. Reported by a player, who was right.
    //
    // TRAPPIST-1e is both worlds, one flux apart. At its own 0.646 S(+) the
    // collapse is under way and the promise holds: 49 C day side with a sea on
    // it. Dim the star to 0.5 and the same planet has no liquid water at all --
    // and before this split it still read as the partial state, ocean and all.
    const wetSide = settle({ ...PRESETS.trappist1e.params }, 6.6e7).world;
    const frozen = settle({ ...PRESETS.trappist1e.params, insolation: 0.5 }, 6.6e7).world;
    const share = (w) => (w.diag.totalWater > 1e-9 ? w.water.ocean / w.diag.totalWater : 0);
    const ws = classify(wetSide), fs = classify(frozen);
    check('A nightside collapse with a sea and one without are not the same state',
      ws.id === 'nightfrost' && fs.id === 'nightfrozen',
      `0.646 S\u2295 \u2192 ${ws.name} (day ${(ws.Tsub - 273.15).toFixed(0)} \u00b0C, ` +
      `${(share(wetSide) * 100).toFixed(0)}% of its water liquid) \u00b7 ` +
      `0.5 S\u2295 \u2192 ${fs.name} (day ${(fs.Tsub - 273.15).toFixed(0)} \u00b0C, ` +
      `${(share(frozen) * 100).toFixed(1)}% liquid)`);
    // And the promise itself, checked against the world rather than against the
    // branch: any state whose blurb claims liquid water has to have some.
    check('\u2026and a state that promises a working ocean only appears on a world with one',
      !/working ocean/.test(ws.blurb) || share(wetSide) > 0.02,
      `${ws.name}: ${(share(wetSide) * 100).toFixed(0)}% liquid, ` +
      `${(wetSide.diag.flooded * 100).toFixed(0)}% of the surface flooded`);
    check('\u2026while the finished one says the water is frozen out, and it is',
      /no liquid water anywhere/.test(fs.blurb) && share(frozen) < 0.02,
      `${fs.name}: ${(share(frozen) * 100).toFixed(2)}% liquid, ` +
      `${(frozen.diag.pTotMean * 1000).toFixed(1)} mbar of air left`);
  }

  // ---- 3j. what the atmosphere actually looks like --------------------------
  {
    const earth = settle(EARTH, 2e6).world;
    const stylised = atmosphereLook(earth, 0, false), real = atmosphereLook(earth, 0, true);
    check('A real atmosphere is a hairline, and the stylised one is not',
      real.thickness > 0.004 && real.thickness < 0.011 && stylised.thickness > 0.05,
      `Earth: ${(real.thickness * 100).toFixed(2)}% of the radius realistically, ` +
      `${(stylised.thickness * 100).toFixed(0)}% stylised (scale height ${(scaleHeight(earth.diag) / 1000).toFixed(1)} km)`);
    check('…and the stylised mode never hides the ground', stylised.veil === 0);

    const venus = settle(PRESETS.venus.params, 1e5).world;
    check('Ninety bar of air shows cloud tops and nothing else',
      atmosphereLook(venus, 0, true).veil > 0.9,
      `Venus veiled ${(atmosphereLook(venus, 0, true).veil * 100).toFixed(0)}%`);
    const titanW = settle(PRESETS.titan.params, 2e7).world;
    check('…and so does a tholin haze',
      atmosphereLook(titanW, 0, true).haze > 0.85,
      `Titan haze opacity ${(atmosphereLook(titanW, 0, true).haze * 100).toFixed(0)}%`);
  }

  // ---- 3j-2. cover is not opacity -------------------------------------------
  // The renderer drew dg.cloud straight, so every temperate world wore a solid
  // overcast: Earth's real two-thirds cover is mostly thin and broken, and you
  // can see the ocean through it. What makes a deck opaque is water in the air.
  {
    const meanOf = (w) => {
      const dg = w.diag, n = dg.cloud.length;
      return [dg.cloud.reduce((a, b) => a + b, 0) / n, dg.pH2O.reduce((a, b) => a + b, 0) / n];
    };
    const [ec, eh] = meanOf(settle(EARTH, 2e6).world);
    const drawn = cloudLook(ec, eh);
    check('A temperate world is not drawn under a solid overcast',
      drawn < ec * 0.8 && drawn > 0.35,
      `Earth: ${(ec * 100).toFixed(0)}% cover, drawn as ${(drawn * 100).toFixed(0)}% at ${(eh * 1e3).toFixed(0)} mbar of vapour`);

    // …but a genuinely steamy one is. 0.4 bar of CO2 puts this world at ~339 K
    // and 0.17 bar of vapour, which is the tropical-storm look.
    const hot = settle({ ...EARTH, co2Bar: 0.4, outgassing: 0 }, 2e5).world;
    const [hc, hh] = meanOf(hot);
    const hotDrawn = cloudLook(hc, hh);
    check('…while a hot, humid one keeps its dense deck',
      hotDrawn > hc * 0.95,
      `${hot.diag.Tmean.toFixed(0)} K, ${(hh * 1e3).toFixed(0)} mbar of vapour: ` +
      `${(hc * 100).toFixed(0)}% cover drawn as ${(hotDrawn * 100).toFixed(0)}%`);

    check('…and thinning never runs backwards with humidity',
      [0, 0.005, 0.02, 0.05, 0.1, 0.2, 5, 300].every((h, i, a) =>
        i === 0 || cloudLook(0.67, h) >= cloudLook(0.67, a[i - 1]) - 1e-12),
      'monotonic in vapour pressure');

    const dry = meanOf(settle(PRESETS.mars.params, 1e5).world);
    check('…and a dry world had no deck to thin in the first place',
      cloudLook(dry[0], dry[1]) < 0.02,
      `Mars drawn at ${(cloudLook(dry[0], dry[1]) * 100).toFixed(1)}%`);
  }

  // ---- 3j-3. a slow rotator is not a locked world ---------------------------
  // Lock used to be inferred from the rotation period, which cannot tell you:
  // this model's own Locked Eyeball is synchronous at 264 h while Venus turns
  // once every 5832 h and is not locked at all. Under a thick atmosphere the
  // mistake is invisible, because circulation erases the contrast. Strip the
  // air off and it is fatal -- the world is handed a hemisphere that is never
  // lit, which is a cold trap that eats the atmosphere for ever.
  {
    const venusRot = { ...PRESETS.venus.params };
    check('Turning slowly does not make a world tidally locked',
      lockFactor(venusRot) === 0 && lockFactor({ ...venusRot, tidallyLocked: true }) === 1,
      `Venus at ${venusRot.rotationHours} h is not locked; the Eyeball at ` +
      `${PRESETS.eyeball.params.rotationHours} h is, because it says so`);

    check('…but it still moves heat like one',
      slowRotation(venusRot) > 0.99,
      `slow-rotation factor ${slowRotation(venusRot).toFixed(2)} at 243 days`);

    // ...and moving heat like one is not the half of it. A planet whose solar
    // day is months long stops sweeping its convection around the globe and
    // parks it over the substellar point, where it builds a deep tower with an
    // anvil on top: optically thick, and far brighter than the thin stratus and
    // cirrus mixture Earth's 0.310 was fitted to. That deck is what keeps a slow
    // rotator habitable out to nearly twice Earth's flux (Yang, Boue, Fabrycky &
    // Abbot 2014) and what put Way et al.'s (2016) paleo-Venus at 11 C under
    // 1.40 S(+) -- 40% more sunlight than Earth gets -- with a 243-day day.
    //
    // Before this the model had the mechanism named in a comment and worth
    // essentially nothing: the inner edge moved from 1.32 S(+) at a 24-hour day
    // to 1.36 at 243 days. Four hundredths, where the literature wants seven
    // tenths. Every one of Way's three simulations boiled, including the two
    // their GCM puts below 15 C.
    {
      const paleoVenus = { ...EARTH, mass: 0.815, n2Bar: 1.0126, o2Bar: 0,
        co2Bar: 400e-6, ch4Bar: 1e-6, water: 0.108, landFraction: 0.40,
        landAlbedo: 0.2, biosphere: 0, outgassing: 0, obliquity: 2.6,
        emissions: 0, fossilUsed: 0, startT: 288 };
      const fast = threshold({ ...paleoVenus, rotationHours: 24 });
      const slow = threshold({ ...paleoVenus, rotationHours: 5832 });
      check('A slow rotator keeps its ocean far closer to its star',
        slow > fast + 0.4,
        `inner edge ${fast.toFixed(2)} S⊕ at a 24-hour day, ${slow.toFixed(2)} at 243 days`);

      const simB = settle({ ...paleoVenus, rotationHours: 5832, insolation: 1.70 }, 3e6).world;
      check('…so Way et al.\u2019s paleo-Venus is temperate under 70% more sunlight than Earth',
        simB.diag.Tmean > 273 && simB.diag.Tmean < 313 && simB.water.ocean > 0.05,
        `${(simB.diag.Tmean - 273.15).toFixed(1)} °C against ROCKE-3D's 15, ` +
        `with ${simB.water.ocean.toFixed(3)} EO still liquid`);

      // The same planet spun up. Way's Sim D is 45 K hotter than Sim A on
      // rotation alone, and this is the control that says the effect above is
      // about rotation and not about the composition being forgiving.
      const spun = settle({ ...paleoVenus, rotationHours: 24, insolation: 1.70 }, 3e6).world;
      check('…and spinning it up on nothing else loses it',
        spun.diag.Tmean > simB.diag.Tmean + 100,
        `${(spun.diag.Tmean - 273.15).toFixed(0)} °C at a 24-hour day against ` +
        `${(simB.diag.Tmean - 273.15).toFixed(0)} °C at 243 days`);
    }

    // Cloud is only as white as the light falling on it. Water reflects well in
    // the visible and absorbs past about 1.4 um; a G star puts 88% of its output
    // shortward of that and TRAPPIST-1, at 2566 K, puts 46%. It is the same
    // reason the ice-albedo feedback is weak around M dwarfs (Joshi & Haberle
    // 2012; Shields et al. 2013). Without it the deck above was worth as much
    // around a red dwarf as around the Sun, and it took TRAPPIST-1e from 0.9 C
    // to -18 C on nothing but a term that should never have applied there.
    check('Cloud reflects a red dwarf\u2019s light worse than the Sun\u2019s',
      Math.abs(cloudWhiteness(5772) - 1) < 1e-9
        && cloudWhiteness(2566) > 0.35 && cloudWhiteness(2566) < 0.6
        && cloudWhiteness(3270) > cloudWhiteness(2566),
      `Sun 1.00, GJ 1132 ${cloudWhiteness(3270).toFixed(2)}, ` +
      `TRAPPIST-1 ${cloudWhiteness(2566).toFixed(2)}`);

    // ...and the deck needs a sea to build itself out of. A deep convective
    // tower is fed by a moist boundary layer over open water, so a world whose
    // water is all frozen onto its night side does not get one. Gating on
    // rotation alone gave it the bright deck anyway, cooled the sunlit face
    // below the temperature that makes it a desert, and removed the night-side
    // cold trap from the reachable parameter space -- a sweep of thirty-six
    // configurations across water, nitrogen and insolation found it at none.
    {
      const wet = planetaryAlbedo(300, { oceanFrac: 0.7, landAlbedo: 0.2, hasWater: true,
        waterCap: 1, glaciated: 0, pH2O: 0.02, pTot: 1.0, slowness: 1, subStellar: 0.35,
        cloudWhite: 1 }).albedo;
      const dry = planetaryAlbedo(300, { oceanFrac: 0.0, landAlbedo: 0.2, hasWater: true,
        waterCap: 1, glaciated: 0, pH2O: 0.02, pTot: 1.0, slowness: 1, subStellar: 0.35,
        cloudWhite: 1 }).albedo;
      check('…and a slow rotator with no sea grows no bright deck',
        wet > dry + 0.05,
        `albedo ${wet.toFixed(3)} over a 70% ocean, ${dry.toFixed(3)} over none`);
    }

    // ---- growing old ----------------------------------------------------
    // A star burns helium ash into a denser core, the core contracts, and it
    // fuses faster: the Sun has gained about 40% since it formed. An interior
    // does the opposite -- uranium, thorium and potassium run down, and the
    // volcanism they drive runs down with them.
    {
      check('A young planet makes about five times the radiogenic heat',
        Math.abs(radiogenic(EARTH_AGE) - 1) < 1e-9
          && radiogenic(0) > 4.5 && radiogenic(0) < 6,
        `${radiogenic(0).toFixed(2)}× at formation, 1.00× now, ` +
        `${radiogenic(2).toFixed(2)}× at 2 Gyr`);

      // The interior is the only thing decaying, but volcanism has to come with
      // it: melt production is what carries dissolved carbon up, and the model
      // already ties the two together through meltBoost.
      const young = new Simulation({ ...EARTH, realisticGeology: true, startAge: 0.5,
        internalHeat: 0.092 * radiogenic(0.5), outgassing: 1 });
      const heat0 = young.world.params.internalHeat;
      const melt0 = meltBoost(young.world.params);
      young.runYears((EARTH_AGE - 0.5) * 1e9, 5e6);
      check('…so a world started young arrives at exactly today\u2019s interior',
        Math.abs(young.world.params.internalHeat - 0.092) < 1e-4
          && Math.abs(meltBoost(young.world.params) - 1) < 1e-3,
        `${(heat0 * 1e3).toFixed(0)} mW/m² and ${melt0.toFixed(2)}× melt at 0.5 Gyr → ` +
        `${(young.world.params.internalHeat * 1e3).toFixed(1)} mW/m² and ` +
        `${meltBoost(young.world.params).toFixed(2)}× at ${EARTH_AGE} Gyr`);

      // Tidal heat is not radiogenic heat and must not run down the same curve.
      // GJ 1132 b's 80 W/m² comes from an eccentricity of 0.01 held by a
      // resonance with GJ 1132 c: it is set by the orbit, not by how much
      // potassium-40 is left, so it is the same today as it was three billion
      // years ago while Earth's 0.092 is a third of what it was. Both worlds run
      // with the decay switched on here; only one of them cools.
      const kneaded = new Simulation({ ...PRESETS.gj1132b.params });
      const cooling = new Simulation({ ...EARTH, realisticGeology: true, internalHeat: 0.092 });
      const heatK0 = kneaded.world.params.internalHeat;
      const heatC0 = cooling.world.params.internalHeat;
      kneaded.runYears(3e9, 5e6);
      cooling.runYears(3e9, 5e6);
      check('Tidal heat does not decay on a half-life, and radiogenic heat does',
        Math.abs(kneaded.world.params.internalHeat - heatK0) < 1e-6
          && cooling.world.params.internalHeat < 0.75 * heatC0,
        `GJ 1132 b ${heatK0.toFixed(1)} → ${kneaded.world.params.internalHeat.toFixed(1)} W/m² · ` +
        `Earth ${(heatC0 * 1e3).toFixed(0)} → ` +
        `${(cooling.world.params.internalHeat * 1e3).toFixed(0)} mW/m² over 3 Gyr`);

      // …and every world whose interior is a real one runs it. A preset or a
      // scenario that quietly holds its interior still for a billion years is
      // the one place this model would be lying about time.
      const REAL = ['earth', 'moon', 'earlyMoon', 'preindustrial', 'venus', 'mars', 'titan', 'earlyEarth',
                    'earlyVenus', 'dryVenus', 'earlyMars', 'futureEarth',
                    'trappist1b', 'trappist1e', 'gj1132b'];
      const noDecay = REAL.filter((k) => !PRESETS[k].params.realisticGeology);
      const flatScenarios = SCENARIOS.filter((s) => !s.params.realisticGeology);
      check('Every real world, and every scenario, ages its interior',
        noDecay.length === 0 && flatScenarios.length === 0,
        noDecay.length || flatScenarios.length
          ? `missing on ${[...noDecay, ...flatScenarios.map((s) => s.id)].join(', ')}`
          : `${REAL.length} real worlds, ${SCENARIOS.length} scenarios`);
      // The tidal presets have to name a flux they actually carry, or the split
      // above silently decays something it should not, or nothing at all.
      const badTidal = ['trappist1b', 'trappist1e', 'gj1132b'].filter((k) => {
        const q = PRESETS[k].params;
        return !(q.tidalHeat > 0) || q.tidalHeat > q.internalHeat + 1e-12;
      });
      check('…and the tidally heated worlds declare how much of that heat is tidal',
        badTidal.length === 0,
        badTidal.length ? badTidal.join(', ')
          : ['trappist1b', 'trappist1e', 'gj1132b']
              .map((k) => `${k} ${PRESETS[k].params.tidalHeat} W/m²`).join(' · '));

      // Brightening moves the control, not just the sum inside the model -- the
      // point of it is watching the star change -- and it follows the star's own
      // curve rather than a flat rate. Gough (1981) puts the Sun 35.6% brighter
      // three billion years from now, and the curve has to be ACCELERATING to
      // get there: the first billion years buy 9.6% and the third 12.2%. A
      // compounding rate cannot do that, which is why it is gone.
      const sun = new Simulation({ ...EARTH, brightening: 1, outgassing: 0,
        emissions: 0, fossilUsed: 0 });
      const sunAt = (gyr) => brightnessAfter({ brightening: 1,
        startAge: EARTH_AGE, starTemp: 5772 }, gyr);
      sun.runYears(3e9, 5e6);
      const firstGyr = sunAt(1) - 1, thirdGyr = sunAt(3) - sunAt(2);
      check('…and a brightening star carries its own control with it',
        Math.abs(sun.world.params.insolation - sunAt(3)) < 1e-3
          && Math.abs(sunAt(3) - 1.3565) < 1e-3 && thirdGyr > firstGyr * 1.2,
        `${sun.world.params.insolation.toFixed(4)} S⊕ after 3 Gyr, against Gough's ` +
        `${sunAt(3).toFixed(4)} — and steepening, ${(firstGyr * 100).toFixed(1)}% in the ` +
        `first Gyr against ${(thirdGyr * 100).toFixed(1)}% in the third`);

      // ...and it never runs backwards, and never off the end of the world.
      //
      // Gough's fit has a pole at 1.6 main-sequence lifetimes. Past it the
      // curve inverts, and the guard that was supposed to catch that divided by
      // Math.max(negative, 1e-6). Dragging the star temperature to 7265 K --
      // an A star, whose main sequence is shorter than the default startAge --
      // took the world to 1009838 S(+) and a magma ocean at 3727 C.
      {
        let worst = 0, backwards = null, seen = 0;
        for (const T of [2300, 3000, 4000, 5772, 6500, 7265, 8000, 9500, 12000]) {
          for (const startAge of [0.1, 1, 4.567, 10]) {
            let prev = 0;
            for (const gyr of [0.1, 1, 3, 6, 12, 50]) {
              const f = brightnessAfter({ brightening: 1, startAge, starTemp: T }, gyr);
              seen++;
              if (!(f >= 1) || !isFinite(f)) backwards = backwards
                ?? `${T} K at ${startAge} Gyr, +${gyr}: ${f}`;
              if (f < prev - 1e-12) backwards = backwards
                ?? `${T} K at ${startAge} Gyr dimmed between ${gyr} and the step before`;
              prev = f;
              worst = Math.max(worst, f);
            }
          }
        }
        // 2.67 is not a fudge, it is the whole main sequence: Gough puts a
        // zero-age star at 0.714 of its present luminosity and the end of its
        // hydrogen burning at 1.908, and 1.908/0.714 is 2.67. Nothing this
        // model can be asked for may exceed the span of a stellar lifetime.
        check('A star brightens, monotonically, and stops at the end of its life',
          !backwards && worst <= 2.68,
          backwards ?? `${seen} star-age-span combinations, brightest ` +
          `${worst.toFixed(3)}x against the 2.67 a whole main sequence is worth ` +
          `— where the old guard returned 2.5e+6`);
      }

      // Absolute functions of age, not rates integrated alongside the climate:
      // the answer must not depend on how the clock happened to chop the run up.
      const coarse = new Simulation({ ...EARTH, brightening: 1, realisticGeology: true,
        startAge: 1, outgassing: 0, emissions: 0, fossilUsed: 0 });
      const fine = new Simulation({ ...EARTH, brightening: 1, realisticGeology: true,
        startAge: 1, outgassing: 0, emissions: 0, fossilUsed: 0 });
      coarse.runYears(2e9, 5e6);
      for (let i = 0; i < 40; i++) fine.runYears(5e7, 2e5);
      check('…and neither depends on how the clock chopped the run up',
        Math.abs(coarse.world.params.insolation - fine.world.params.insolation) < 1e-6
          && Math.abs(coarse.world.params.internalHeat - fine.world.params.internalHeat) < 1e-9,
        `one 2 Gyr run and forty 50 Myr ones agree to ` +
        `${Math.abs(coarse.world.params.insolation - fine.world.params.insolation).toExponential(1)} S⊕`);

      // Off by default, and off means off.
      const still = new Simulation({ ...EARTH, outgassing: 0, emissions: 0, fossilUsed: 0 });
      const s0 = still.world.params.insolation, h0 = still.world.params.internalHeat;
      still.runYears(2e9, 5e6);
      check('…and a world with both modes off does not age at all',
        still.world.params.insolation === s0 && still.world.params.internalHeat === h0,
        `${s0} S⊕ and ${(h0 * 1e3).toFixed(0)} mW/m² after two billion years`);
    }

    // ---- the dynamo, and the wind that gets in without one ---------------
    {
      check('A small core keeps its dynamo for a fraction of the time a big one does',
        Math.abs(dynamoLifetime(0.107) - 0.5) < 0.05 && dynamoLifetime(1) > 4.567,
        `Mars ${dynamoLifetime(0.107).toFixed(2)} Gyr — where its crustal remanence stops — ` +
        `against Earth's ${dynamoLifetime(1).toFixed(1)}`);

      // Not a free constant: Earth's magnetopause is about ten radii out, so a
      // hundredth of the cross-section a bare Earth would present.
      check('…and a field that stands the wind off ten radii out lets a hundredth through',
        Math.abs(windExposure(1) - 0.01) < 0.001 && windExposure(0) === 1,
        `${windExposure(1).toFixed(3)} of the wind reaches a magnetised Earth, ` +
        `${windExposure(0).toFixed(2)} an unmagnetised one`);

      check('…and a young star is far harsher in the ultraviolet than an old one',
        xuvAtAge(EARTH_AGE) === 1 && xuvAtAge(0.5) > 10 && xuvAtAge(0.5) < 25,
        `${xuvAtAge(0.5).toFixed(0)}× at half a billion years, ${xuvAtAge(1).toFixed(1)}× at one, ` +
        `1× now (Ribas et al. 2005)`);

      // A young star is not simply "the old one, scaled". It spends its first
      // stretch magnetically saturated -- rotating fast enough that the dynamo
      // is running flat out and the XUV ratio cannot climb any further -- and
      // only starts to fall once it has spun down. How long that lasts is a
      // property of the star: a G dwarf is out of it inside a hundred million
      // years, a late M dwarf holds it for well over a billion, which is most
      // of why the TRAPPIST-1 planets are in the state they are.
      check('A star holds its ultraviolet flat while it is saturated, then falls',
        Math.abs(xuvAtAge(0.02, SOLAR_TEMP) / xuvAtAge(0.09, SOLAR_TEMP) - 1) < 1e-9
          && xuvAtAge(1, SOLAR_TEMP) < xuvAtAge(0.5, SOLAR_TEMP)
          && Math.abs(xuvAtAge(1, SOLAR_TEMP) / Math.pow(1 / EARTH_AGE, -1.23) - 1) < 1e-9,
        `Sun saturated to ${saturationAge(SOLAR_TEMP).toFixed(2)} Gyr, then Ribas t^-1.23`);

      check('…and a late M dwarf stays saturated for an order of magnitude longer',
        saturationAge(2566) / saturationAge(SOLAR_TEMP) > 8
          && saturationAge(2566) < 3 && saturationAge(3270) > saturationAge(SOLAR_TEMP),
        `TRAPPIST-1 ${saturationAge(2566).toFixed(2)} Gyr · GJ 1132 ${saturationAge(3270).toFixed(2)} · `
        + `Sun ${saturationAge(SOLAR_TEMP).toFixed(2)}`);

      // The bug this replaced: the XUV decline lived inside the brightening
      // branch, so it only ran on worlds whose star was also getting brighter.
      // Every M-dwarf preset carries brightening: 0 -- correctly, their
      // luminosity really is flat -- which meant XUV was pinned for the entire
      // run on the four worlds where XUV is the dominant process.
      {
        const dwarf = { ...PRESETS.trappist1e.params };
        const base = { insolation: dwarf.insolation, xuvFraction: dwarf.xuvFraction };
        const after = evolvedParams(dwarf, base, 1e9);
        check('Stellar ultraviolet ages even when the star is not brightening',
          dwarf.brightening === 0 && after.xuvFraction > 0
            && after.xuvFraction < base.xuvFraction * 0.9,
          `TRAPPIST-1e ${(base.xuvFraction / 3.4e-6).toFixed(0)}× solar → `
          + `${(after.xuvFraction / 3.4e-6).toFixed(0)}× after 1 Gyr, with brightening off`);
        // …and the bolometric track must still be the thing `brightening` gates,
        // or turning it off would quietly start moving the star's luminosity.
        check('…while its luminosity stays exactly where it was put',
          after.insolation === undefined,
          'brightening: 0 leaves insolation untouched');
      }

      // Strong volcanism has to be visible from orbit, and it has to be the
      // same number in the physics and in the picture. Melt production, not
      // the CO2 that rides up with it: a mantle whose carbon is exhausted
      // still erupts, it simply erupts volatile-poor lava, and a world that
      // went quiet on the shader while its interior was still molten would be
      // telling a lie the model does not believe.
      check('Volcanic activity is a diagnostic, scaled by melt production',
        Math.abs(volcanicActivity({ mass: 1, outgassing: 1, internalHeat: 0.092 }) - 1) < 1e-9
          && volcanicActivity({ mass: 1, outgassing: 0, internalHeat: 0.092 }) === 0,
        `Earth reads 1.00 at 1x outgassing, 0 with the volcanoes off`);

      // Io is the case this exists for: the most volcanically active body
      // known, and it is tidal heat rather than the control that does it.
      {
        const io = volcanicActivity({ mass: 0.015, outgassing: 1, internalHeat: 2.0 });
        const earth = volcanicActivity({ mass: 1, outgassing: 1, internalHeat: 0.092 });
        const cranked = volcanicActivity({ mass: 1, outgassing: 20, internalHeat: 0.092 });
        check('…so a tidally heated moon and a cranked slider both read as violent',
          io > earth * 4 && cranked > earth * 15 && cranked === 20 * earth,
          `Io-like ${io.toFixed(1)}x Earth from heat alone · 20x outgassing reads ${cranked.toFixed(0)}x`);
      }

      // …and the renderer has to actually receive it. A number computed and
      // never passed to a shader is the exact bug that shipped twice before.
      {
        const s = new Simulation({ ...EARTH, outgassing: 12, internalHeat: 0.5 });
        s.runYears(1e4);
        const dg = s.world.diag;
        check('…and the world carries it where the renderer can read it',
          dg.volcanism > 1 && Math.abs(dg.volcanism
            - volcanicActivity(s.world.params)) < 1e-9,
          `diag.volcanism ${dg.volcanism.toFixed(1)}x Earth`);
      }

      // Auto-ease has to slow the clock, not chop it up. It used to do the
      // second: the per-frame allowance was overshot by a single solver step,
      // the leftover credit was thrown away to stop it banking a burst, and the
      // next frame could not afford a step at all -- so it advanced nothing,
      // so there was no movement to measure, so the governor stopped asking for
      // fine steps and the next affordable step was bigger still. Measured at
      // 76% of frames advancing nothing, in runs of up to nine, separated by
      // million-year jumps. That is not an eased clock, it is a stuttering one,
      // and no amount of watching it would show you a transition.
      {
        const s = new Simulation({ ...EARTH, insolation: 1.6, brightening: 0 });
        s.rate = 1e7;
        s.autoEase = true;
        s.runYears(2e4);                       // get it moving
        const frames = [];
        for (let i = 0; i < 240; i++) frames.push(s.advance(1 / 60));
        const dead = frames.filter((f) => f === 0).length;
        let worstRun = 0, run = 0;
        for (const f of frames) { run = f === 0 ? run + 1 : 0; worstRun = Math.max(worstRun, run); }
        const live = frames.filter((f) => f > 0);
        const spread = live.length ? Math.max(...live) / Math.min(...live) : Infinity;
        check('Auto-ease slows the clock without ever stopping it',
          dead === 0 && worstRun === 0 && spread < 10,
          `${dead}/240 frames advanced nothing, longest stall ${worstRun}, `
          + `fastest frame ${spread.toFixed(1)}× the slowest`);
      }

      // …and it still has to actually hold the transition back, at any rate the
      // slider offers. Rate-independence is the property that makes it useful:
      // asking for a hundred Myr a second gives the same watchable seconds as
      // asking for one.
      {
        const watch = (ease, rate) => {
          const s = new Simulation({ ...EARTH, insolation: 1.6, brightening: 0 });
          s.rate = rate; s.autoEase = ease;
          let n = 0;
          while (n < 60 * 120 && s.world.diag.Tmean < 500) { s.advance(1 / 60); n++; }
          return n / 60;
        };
        const off = watch(false, 1e7), on = watch(true, 1e7), fast = watch(true, 1e8);
        check('…and holds a runaway back by the same watchable seconds at any rate',
          on > off * 20 && Math.abs(on - fast) < 0.5 && on > 1 && on < 60,
          `runaway in ${off.toFixed(2)} s unheld · ${on.toFixed(2)} s eased at 10 Myr/s · `
          + `${fast.toFixed(2)} s eased at 100 Myr/s`);
      }

      // A world that is merely wobbling is not in a transition, and must not be
      // treated as one. This is what the first version of the fix got wrong: it
      // asked the solver for small steps on EVERY frame the governor was armed
      // rather than only on frames that were actually moving, which held a
      // settled Titan to a tenth of the rate it was asked for and alternated
      // between two step sizes while the planet did nothing. Checked across the
      // presets and rates people actually use, and against the same run with
      // the governor off, because a stiff world is slow either way and that is
      // the physics rather than the ease.
      {
        const walk = (params, rate, ease) => {
          const s = new Simulation({ ...params });
          s.rate = rate; s.autoEase = ease;
          s.runYears(1e3);
          const T0 = s.world.diag.Tmean;
          const f = [];
          for (let i = 0; i < 120; i++) f.push(s.advance(1 / 60) / (rate / 60));
          // Alternation is a REVERSAL -- fast, slow, fast -- not a change. A
          // governor letting go of a world as its transition ends accelerates
          // over several frames, and counting that as stutter was measuring
          // the feature. Only direction changes larger than 2x either way
          // count, which is what "it keeps alternating" actually describes.
          let swings = 0;
          for (let i = 2; i < f.length; i++) {
            const a = f[i - 2] + 1e-12, b = f[i - 1] + 1e-12, c = f[i] + 1e-12;
            const up = b / a, down = c / b;
            if ((up > 2 && down < 0.5) || (up < 0.5 && down > 2)) swings++;
          }
          return { mean: f.reduce((x, y) => x + y, 0) / f.length, swings,
                   // how far the world actually travelled, in log temperature
                   span: Math.abs(Math.log(s.world.diag.Tmean / T0)) };
        };
        const bad = [];
        for (const id of ['earth', 'preindustrial', 'titan', 'waterworld', 'earlyEarth']) {
          // Up to 10 Myr/s, which is the range these are actually played at.
          // Past it a frame covers so much simulated time that an ordinary
          // world genuinely is in visible motion, and holding it back is the
          // feature rather than a fault.
          for (const rate of [1e5, 1e6, 1e7]) {
            const on = walk(PRESETS[id].params, rate, true);
            const off = walk(PRESETS[id].params, rate, false);
            // The governor's contract, tested as a contract rather than as a
            // number: it may hold back a world that would otherwise cross the
            // screen faster than the target, and it may not touch any other. So
            // the discriminator is how far the world travels with the governor
            // OFF -- two seconds of watching at 120 frames, against the target
            // for that long. Under it, hands off; over it, holding back is the
            // feature. The Archean at 10 Myr/s is over it, and is meant to be.
            const inMotion = off.span > 0.1 * 2;
            // A tenth is the tolerance, and the Archean is why it is not
            // tighter: it holds a real equilibrium offset -- a cold world under
            // a faint sun with a tenth of a bar of CO2, a long way from where
            // it is going even while its net temperature barely moves -- and
            // the governor reads that offset and takes about 10% off the clock
            // for it. Steadily, with no stutter, which is the governor working.
            // What this check is for is the other thing: a world held back for
            // nothing, or held back unevenly.
            if ((!inMotion && on.mean < off.mean * 0.85 - 1e-9) || on.swings > off.swings) {
              bad.push(`${id}@${rate.toExponential(0)} ${(100 * on.mean).toFixed(0)}% vs `
                + `${(100 * off.mean).toFixed(0)}% off, swings ${on.swings}/${off.swings}`
                + `, span ${off.span.toFixed(3)}`);
            }
          }
        }
        check('…and does not throttle or stutter a world that is only wobbling',
          bad.length === 0, bad.length ? bad.join(' · ') : '15 preset/rate pairs, none held back');
      }

      // A world that is not doing anything must not be held back at all.
      {
        const s = new Simulation({ ...EARTH, brightening: 0 });
        s.rate = 1e8; s.autoEase = true;
        let dead = 0;
        for (let i = 0; i < 600; i++) if (s.advance(1 / 60) === 0) dead++;
        check('…and leaves a settled world alone',
          dead === 0 && s.easeFactor > 0.9,
          `${dead}/600 dead frames, clock running at ${(s.easeFactor * 100).toFixed(0)}% of the rate asked for`);
      }

      // The whole point of the channel: it is what a planet's gravity and its
      // field together decide, and Mars loses on both counts.
      const d = (m) => ({ vesc: 11186 * Math.sqrt(m / Math.cbrt(m)) });
      const marsD = { vesc: 5030 }, earthD = { vesc: 11186 };
      const bare = nonThermalEscape({ magneticField: 0 }, marsD, 1361 * 3.4e-6 / 4);
      const shielded = nonThermalEscape({ magneticField: 1 }, earthD, 1361 * 3.4e-6 / 4);
      check('…so an unmagnetised Mars is stripped hundreds of times faster than a magnetised Earth',
        bare / shielded > 100 && bare / shielded < 10000,
        `${(bare / shielded).toFixed(0)}× — 24 from gravity, 100 from the field`);
    }

    // Mars, run forward through its own history. This is the check that says the
    // escape channel above is the right size rather than merely present.
    {
      const mars = new Simulation({ ...PRESETS.earlyMars.params,
        realisticGeology: true, brightening: 1 });
      const w = mars.world;
      const t0 = w.diag.Tmean, ocean0 = w.water.ocean;
      // runYears stops at its own step guard, so drive it until the clock gets there.
      const to = (yrs) => { let g = 0; while (w.time < yrs - 1 && g++ < 400) {
        const b = w.time; mars.runYears(yrs - w.time, 5e6); if (w.time <= b + 1) break; } };
      // 0.1 Gyr in is 3.87 Gya, which is inside the window the valley networks
      // were cut in. By 3.77 the ocean has gone, which is where they stop.
      to(0.1e9);
      const wetT = w.diag.Tmean, wetOcean = w.water.ocean;
      to((4.567 - 0.6) * 1e9);
      check('A Noachian Mars is warm and wet, and does not stay either',
        t0 > 273 && ocean0 > 0.01 && wetOcean > 0.005 && w.water.ocean < 1e-4
          && w.diag.Tmean < 220,
        `${(t0 - 273.15).toFixed(1)} °C with ${ocean0.toFixed(3)} EO at 3.97 Gya, ` +
        `${(wetT - 273.15).toFixed(1)} °C at 3.87, ` +
        `${(w.diag.Tmean - 273.15).toFixed(0)} °C and dry today`);
      check('…and it ends up as the Mars we have, to a few millibars',
        w.diag.pCO2 > 0.002 && w.diag.pCO2 < 0.02 && classify(w).id !== 'airless',
        `${(w.diag.pCO2 * 1e3).toFixed(1)} mbar against Mars's 6.0, ` +
        `${(w.diag.Tmean - 273.15).toFixed(0)} °C against -63, → ${classify(w).name}`);

      // The counterfactual, which is the part that says it was the field and not
      // something else: give Mars a dynamo that never dies and it keeps its air.
      //
      // `realisticGeology` is switched off here rather than left to the preset,
      // and that is the whole counterfactual rather than a detail. The preset
      // now carries it on, and with it on a 0.107 M(+) core stops convecting at
      // 0.5 Gyr -- before this run even starts, at 0.6. So the field would be
      // handed over and immediately taken away again, and the two runs would be
      // the same run. "A dynamo that never dies" has to say so.
      const kept = new Simulation({ ...PRESETS.earlyMars.params, brightening: 1,
        realisticGeology: false, magneticField: 1 });
      const kw = kept.world;
      let g = 0;
      while (kw.time < (4.567 - 0.6) * 1e9 && g++ < 400) {
        const b = kw.time; kept.runYears((4.567 - 0.6) * 1e9 - kw.time, 5e6);
        if (kw.time <= b + 1) break;
      }
      check('…while the same Mars with a magnetic field keeps it',
        kw.diag.pCO2 > 0.5,
        `${kw.diag.pCO2.toFixed(2)} bar left with a dynamo, ` +
        `${(w.diag.pCO2 * 1e3).toFixed(1)} mbar without one`);
    }

    // Earth is the control on the other side: it has a field, and its nitrogen
    // is not supposed to be going anywhere.
    {
      const e = new Simulation({ ...EARTH, realisticGeology: true, brightening: 1,
        startAge: 0.6, insolation: 1 / Math.pow(1.10, 3.967), outgassing: 1 });
      const w = e.world;
      let g = 0;
      while (w.time < 3.967e9 && g++ < 400) {
        const b = w.time; e.runYears(3.967e9 - w.time, 5e6); if (w.time <= b + 1) break;
      }
      check('…and an Earth with a field keeps its nitrogen and its ocean for four billion years',
        w.diag.pN2 > 0.7 && w.water.ocean > 0.7 && w.diag.Tmean > 273 && w.diag.Tmean < 310,
        `${w.diag.pN2.toFixed(3)} bar of N₂ left of 0.78, ` +
        `${w.water.ocean.toFixed(2)} EO of ocean, ${(w.diag.Tmean - 273.15).toFixed(1)} °C`);
    }

    // A resurfacing event: the mantle turning over, as a pulse rather than a step.
    {
      const p = { resurfacingAge: 3.85, resurfacingBoost: 300, resurfacingSpan: 50 };
      // ...and it does to a planet what Venus's did to Venus. Way et al.'s
      // paleo-Venus does not end because the Sun brightened -- this model rides
      // the hot branch straight past that, which is their thesis too, that it
      // stayed habitable for two billion years. What ends it is the mantle
      // turning over: eighty percent of the surface repaved, and the carbon that
      // came up with it going into an atmosphere that no longer had an ocean to
      // weather it back down.
      //
      // 70x is what puts Venus's ninety-two bar into the air out of this
      // planet's mantle; above about 150x the mantle itself runs out and the
      // answer stops moving.
      {
        const at = 4.567 - 0.715;
        // Venus gets 1.911 S(+) now, so this is what it got 715 Myr ago -- read
        // backwards off the star's own curve rather than off a flat rate.
        const venusish = { ...PRESETS.earlyVenus.params, realisticGeology: true,
          brightening: 1, startAge: at, co2Bar: 0.037, startT: 303,
          insolation: 1.911 / brightnessAfter({ brightening: 1, startAge: at,
            starTemp: 5772 }, 0.715), resurfacingSpan: 40 };
        // 0.05 Gyr *after this run starts*, which is the same instant it always
        // was: the world begins at an age of `at` and the event is placed 50 Myr
        // in. The control is elapsed time now, not age, so that it cannot be
        // set behind the clock -- see resurfacingBoost.
        const run = (boost) => {
          const s = new Simulation({ ...venusish, resurfacingAge: 0.05,
            resurfacingBoost: boost });
          let g = 0;
          while (s.world.time < 0.715e9 && g++ < 600) {
            const b = s.world.time; s.runYears(0.715e9 - s.world.time, 5e6);
            if (s.world.time <= b + 1) break;
          }
          return s.world;
        };
        const quiet = run(1), repaved = run(70);
        check('…and one the size of Venus\u2019s puts Venus\u2019s atmosphere into the air',
          repaved.diag.pCO2 > 60 && repaved.diag.pCO2 < 200
            && repaved.diag.pCO2 > quiet.diag.pCO2 * 4,
          `${repaved.diag.pCO2.toFixed(0)} bar against Venus's 92, from ` +
          `${quiet.diag.pCO2.toFixed(1)} bar without the event`);
      }

      check('A resurfacing event is a pulse, not a step',
        resurfacingBoost(p, 3.85) === 300 && resurfacingBoost(p, 3.5) === 1
          && resurfacingBoost(p, 4.2) === 1 && resurfacingBoost(p, 3.80) > 50
          && resurfacingBoost({ ...p, resurfacingAge: 0 }, 3.85) === 1,
        `1× at 3.5 Gyr, ${resurfacingBoost(p, 3.80).toFixed(0)}× at 3.80, ` +
        `300× at 3.85, 1× again by 4.2 — and off when no time is set`);

      // The argument the whole control rests on. It is placed in elapsed time
      // rather than in the planet's age precisely so that it cannot be set
      // behind the clock: an age of 3.85 on a world that begins at 4.567 -- and
      // most of them do -- is an event eight hundred million years before the
      // run starts, which never fires and gives the interface no way to say so.
      // Elapsed time has no such value. Every argument this function can be
      // given, from a world's first instant onward, is one it can still reach.
      // Exactly the two historical Venus paths ship with the event armed.
      // Modern Venus in particular must not: it starts at an
      // age of 4.567, which is 715 Myr *after* the repaving happened, so an
      // armed pulse there would be a second resurfacing the planet never had.
      // Its mantle carbon is already in its atmosphere -- that is what the 88
      // bar in the preset is.
      {
        const armed = Object.entries(PRESETS).filter(([, v]) =>
          v.params.resurfacingAge > 0 && v.params.resurfacingBoost > 1);
        check('Only the two Venus histories ship with a resurfacing event armed',
          armed.length === 2 && armed.some(([k]) => k === 'earlyVenus')
            && armed.some(([k]) => k === 'dryVenus')
            && PRESETS.venus.params.resurfacingAge === 0
            && PRESETS.venus.params.resurfacingBoost === 1,
          `armed on ${armed.map(([k]) => k).join(', ')}`);
      }

      check('\u2026and it is placed ahead of the clock, never behind it',
        resurfacingBoost(p, 0) === 1 && SLIDERS.find((d) => d.key === 'resurfacingAge').min === 0
          && PRESETS.earlyVenus.params.resurfacingAge
             + PRESETS.earlyVenus.params.startAge > 3.8
          && PRESETS.earlyVenus.params.resurfacingAge
             + PRESETS.earlyVenus.params.startAge < 3.9,
        `Early Venus starts at ${PRESETS.earlyVenus.params.startAge} Gyr old and repaves ` +
        `${PRESETS.earlyVenus.params.resurfacingAge} Gyr later — an age of ` +
        `${(PRESETS.earlyVenus.params.startAge + PRESETS.earlyVenus.params.resurfacingAge).toFixed(3)}, ` +
        `which is Venus's 715 Myr ago`);

      // ...and the world it leaves behind at the present day has to be Venus.
      //
      // Getting the runaway to happen on schedule is only half of it. Venus is
      // not merely hot: it is hot AND DRY, 737 K under 92 bar that is 96.5%
      // CO2 and 30 ppm water. A model that boils the ocean on time and then
      // keeps the steam gets the temperature badly wrong in the same motion,
      // because steam is a far better greenhouse gas than CO2 -- this run used
      // to arrive at 928 K with nineteen bar of water still in the air, having
      // shed a third of its ocean in the 650 Myr it had left.
      {
        const sim = new Simulation({ ...PRESETS.earlyVenus.params });
        const vw = sim.world;
        const span = (4.567 - PRESETS.earlyVenus.params.startAge) * 1e9;
        while (vw.time < span) sim.stepOnce(Math.min(maxStep(vw), 5e6));
        const left = vw.water.ocean + vw.water.seaIce + vw.water.landIce + vw.water.vapour;
        const pH2O = vw.diag.pH2O.reduce((a, b) => a + b, 0) / vw.diag.pH2O.length;
        check('Early Venus arrives at the present day as the Venus we have',
          Math.abs(vw.diag.Tmean - 737) < 8 && Math.abs(vw.diag.pTotMean - 92) < 3
            && vw.diag.pCO2 > 86 && vw.diag.pCO2 < 91
            && vw.diag.pN2 > 3.2 && vw.diag.pN2 < 3.8
            && vw.diag.pO2 < 0.05 && pH2O < 0.01,
          `${vw.diag.Tmean.toFixed(0)} K (737), ${vw.diag.pTotMean.toFixed(1)} bar (92), ` +
          `${vw.diag.pCO2.toFixed(1)} bar CO₂, ${vw.diag.pN2.toFixed(2)} bar N₂, ` +
          `${vw.diag.pO2.toExponential(1)} bar O₂, ${pH2O.toExponential(1)} bar H₂O, ` +
          `${left.toExponential(2)} EO left`);
      }

      if (PRESETS.dryVenus) {
        const sim = new Simulation({ ...PRESETS.dryVenus.params });
        const vw = sim.world;
        const span = (4.567 - PRESETS.dryVenus.params.startAge) * 1e9;
        let maxOcean = vw.water.ocean;
        while (vw.time < span) {
          sim.stepOnce(Math.min(maxStep(vw), 5e6, span - vw.time));
          maxOcean = Math.max(maxOcean, vw.water.ocean);
        }
        const pH2O = vw.diag.pH2O.reduce((a, b) => a + b, 0) / vw.diag.pH2O.length;
        check('Never-Wet Venus never condenses an ocean and still arrives at modern Venus',
          maxOcean < 1e-10 && Math.abs(vw.diag.Tmean - 737) < 8
            && Math.abs(vw.diag.pTotMean - 92) < 3
            && vw.diag.pCO2 > 86 && vw.diag.pCO2 < 91
            && vw.diag.pN2 > 3.2 && vw.diag.pN2 < 3.8
            && vw.diag.pO2 < 0.05 && pH2O < 0.01,
          `${maxOcean.toExponential(1)} EO maximum ocean · ${vw.diag.Tmean.toFixed(0)} K · `
          + `${vw.diag.pTotMean.toFixed(1)} bar = ${vw.diag.pCO2.toFixed(1)} CO₂ + `
          + `${vw.diag.pN2.toFixed(2)} N₂ + ${vw.diag.pO2.toExponential(1)} O₂`);
      }

      check('Resurfacing delivery is an exact cumulative ledger',
        resurfacingProgress(PRESETS.earlyVenus.params, 0) === 0
          && resurfacingProgress(PRESETS.earlyVenus.params, 10) === 1,
        '0 before the pulse, 1 after it');
    }

    // Smoothing turns a slider into a destination. It exists because of the
    // result below it: the same drag, applied at once or walked to, leaves two
    // different planets, and only the walk can reach the hot branch on purpose.
    {
      const base = { ...EARTH, outgassing: 0, emissions: 0, fossilUsed: 0, biosphere: 0 };
      const run = (smooth) => {
        const s = new Simulation({ ...base, smoothInsolation: smooth });
        s.runYears(3e6, 2e5);
        s.setParams({ insolation: 1.36 });
        s.runYears(2e8, 5e5);
        return s.world;
      };
      const jumped = run(false), walked = run(true);
      check('The same change of starlight, walked to rather than jumped to, keeps the ocean',
        lostItsOcean(jumped) && walked.water.ocean > 0.8 && walked.diag.Tmean > 320,
        `1.00 → 1.36 S⊕: at once ${(jumped.diag.Tmean - 273.15).toFixed(0)} °C and no sea, ` +
        `walked ${(walked.diag.Tmean - 273.15).toFixed(0)} °C with ${walked.water.ocean.toFixed(2)} EO`);
      check('…and it arrives where it was sent',
        Math.abs(walked.params.insolation - 1.36) < 1e-6 && walked.insolationTarget == null,
        `ended at ${walked.params.insolation.toFixed(4)} S⊕ with nothing left to walk`);
      check('…while approach() cannot overshoot whichever way it is going',
        approach(1.0, 1.36, 1e12) === 1.36 && approach(1.36, 1.0, 1e12) === 1.0
          && approach(1.0, 1.36, 1e5) > 1.0 && approach(1.0, 1.36, 1e5) < 1.36,
        'up, down, and a partial step in between');
    }

    // ---- the door only opens one way ------------------------------------
    // A runaway greenhouse is not a temperature, it is a bifurcation, and the
    // flux a world tips at depends on how it got there. Walk a planet up to
    // 1.36 S(+) in small steps and it settles at about 63 C with its ocean
    // intact -- the hot branch that Wolf & Toon (2015) ran to 362.8 K and Popp
    // et al. (2016) found above 330 K, an ocean at bath temperature. Throw the
    // same planet at the same flux in one jump and the surface overshoots, the
    // sea goes into the air, the steam is dark rather than bright, and there is
    // no way back.
    //
    // Both are self-consistent runs of the same model at the same insolation.
    // That is the physics and not an integration failure, and the evidence is
    // that the gradual path CONVERGES: sixteen steps and sixty-four agree to a
    // degree, while four -- jumps too big to track the branch -- tip like the
    // abrupt one. What must not happen is the fine end still moving.
    {
      const base = { ...EARTH, outgassing: 0, emissions: 0, fossilUsed: 0, biosphere: 0 };
      const walk = (steps) => {
        const s = new Simulation({ ...base, insolation: 1.00 });
        s.runYears(3e6, 2e5);
        for (let i = 1; i <= steps; i++) {
          s.world.params.insolation = 1.00 + 0.36 * (i / steps);
          s.runYears(2e6, 2e5);
        }
        return s.world;
      };
      const gentle = walk(16), gentler = walk(32);
      const thrown = settle({ ...base, insolation: 1.36 }, 1e7).world;

      check('A world walked to the runaway limit keeps an ocean the same world thrown there loses',
        gentle.water.ocean > 0.8 && gentle.diag.Tmean > 320 && gentle.diag.Tmean < 360
          && lostItsOcean(thrown),
        `1.36 S⊕ either way: gradually ${(gentle.diag.Tmean - 273.15).toFixed(0)} °C with ` +
        `${gentle.water.ocean.toFixed(2)} EO liquid, abruptly ` +
        `${(thrown.diag.Tmean - 273.15).toFixed(0)} °C with ${thrown.water.ocean.toFixed(2)}`);

      check('…and that is the physics, not the step sequence — the gradual path converges',
        Math.abs(gentle.diag.Tmean - gentler.diag.Tmean) < 1.0,
        `${(gentle.diag.Tmean - 273.15).toFixed(1)} °C over 16 steps against ` +
        `${(gentler.diag.Tmean - 273.15).toFixed(1)} °C over 32`);

      // And the branch is a place, not a transient: it holds its energy balance
      // and it is still there a hundred million years later.
      const held = new Simulation(gentle.params);
      Object.assign(held.world.water, gentle.water);
      for (let i = 0; i < held.world.T.length; i++) held.world.T[i] = gentle.T[i];
      held.world.co2 = gentle.co2; held.world.n2 = gentle.n2;
      held.world.o2 = gentle.o2; held.world.ch4 = gentle.ch4;
      held.runYears(1e8, 5e5);
      check('…and the hot branch is somewhere a world can actually live',
        held.world.water.ocean > 0.8 && Math.abs(held.world.diag.imbalance) < 0.05,
        `${(held.world.diag.Tmean - 273.15).toFixed(0)} °C and ` +
        `${held.world.water.ocean.toFixed(2)} EO after another 100 Myr, ` +
        `imbalance ${held.world.diag.imbalance.toFixed(3)} W/m²`);

      // The initial temperature is not a way in. The ocean's heat capacity
      // erases it: starting the air at 63 C and at 27 C gives the same runaway
      // to the tenth of a degree, because what decides this is the history of
      // the forcing and nothing else.
      const hotStart = settle({ ...base, insolation: 1.36, startT: 336 }, 1e7).world;
      check('…and you cannot get onto it by starting hot, only by arriving slowly',
        Math.abs(hotStart.diag.Tmean - thrown.diag.Tmean) < 0.5 && lostItsOcean(hotStart),
        `starting at 63 °C ends at ${(hotStart.diag.Tmean - 273.15).toFixed(1)} °C, ` +
        `same as starting at 15 °C`);
    }

    const S = insolationProfile(venusRot);
    check('…and every point on it sees the star',
      Math.min(...S) > 0,
      `dimmest band gets ${Math.min(...S).toFixed(0)} W/m², not zero`);
    check('…while a genuinely locked world keeps its permanent night',
      Math.min(...insolationProfile({ ...venusRot, tidallyLocked: true })) === 0);

    // The case that started this: strip a slow rotator's atmosphere with hard
    // XUV and it used to freeze every molecule the volcanoes made afterwards,
    // for ever, at any outgassing rate.
    const bare = { ...PRESETS.venus.params, mass: 0.81, insolation: 4, xuvFraction: 2941,
                   landAlbedo: 0.15, water: 0, landFraction: 1, outgassing: 1.2 };
    const w = settle(bare, 5e7).world;
    check('…so a stripped slow rotator does not freeze its air onto a dark side it has not got',
      (w.co2Frozen ?? 0) < 1e-6 && Math.min(...w.T) > 273,
      `coldest band ${Math.min(...w.T).toFixed(0)} K, ` +
      `${((w.co2Frozen ?? 0) * w.diag.g / 1e5).toExponential(1)} bar frozen out`);
  }

  // ---- 3j-4. CO2 condenses above its triple point too ------------------------
  // psatCO2 returned 10 kbar for anything warmer than 216.58 K, which says a
  // twenty-bar CO2 atmosphere cannot condense at any temperature. It can.
  {
    const lit = [[216.58, 5.185], [240, 12.83], [260, 24.19], [280, 41.60], [300, 67.10]];
    let worst = 0, at = 0;
    for (const [T, bar] of lit) {
      const err = Math.abs(psatCO2(T) / 1e5 - bar) / bar;
      if (err > worst) { worst = err; at = T; }
    }
    check('The liquid branch of the CO₂ vapour curve matches the measured one',
      worst < 0.01, `worst ${(worst * 100).toFixed(1)}% at ${at} K`);

    check('…so twenty bar of CO₂ has a condensation point well above the triple point',
      frostPointCO2(20e5) > 250 && frostPointCO2(20e5) < 258,
      `${frostPointCO2(20e5).toFixed(1)} K at 20 bar, against 216.6 K before`);

    check('…and above the critical point nothing condenses at all',
      psatCO2(310) > 1e8 && frostPointCO2(200e5) <= 304.14,
      `critical point 304.13 K / 73.77 bar`);

    check('…while Mars\'s own frost point is untouched',
      Math.abs(frostPointCO2(600) - 147.8) < 1.0,
      `${frostPointCO2(600).toFixed(1)} K at 6 mbar`);
  }

  // ---- 3j-5. internal heat ---------------------------------------------------
  // The model used to be heated by starlight alone. GJ 1132 b is modelled at
  // 80 W/m2 of tidal flux, ~1000x Earth's, which puts a magma ocean under a few
  // tens of metres of crust (Swain et al. 2021); Barnes et al. 2013 show tidal
  // flux crossing the runaway limit on its own and desiccating a planet that
  // looks perfectly habitable by insolation. None of that was reachable.
  //
  // Both papers add the interior flux straight to absorbed sunlight, so that is
  // what this does, and the consequences follow from energy conservation rather
  // than from anything new being invented.
  {
    // Energy conservation: at equilibrium the planet must radiate what it takes
    // in from both directions. This is the whole claim, so it is measured over
    // a range rather than asserted at one point.
    let worst = 0, worstAt = 0;
    for (const F of [0, 1, 10, 60]) {
      const w = settle({ ...EARTH, internalHeat: F, outgassing: 0 }, 3e6).world;
      const gained = w.diag.emitted - w.diag.absorbed;
      const err = Math.abs(gained - F);
      if (err > worst) { worst = err; worstAt = F; }
    }
    check('A planet radiates its own internal heat as well as its sunlight',
      worst < 0.35, `worst ${worst.toFixed(3)} W/m² out at ${worstAt} W/m² in`);

    // ...and the greenhouse amplifies it exactly as it amplifies sunlight, so a
    // flux far below the runaway limit still moves the surface a long way.
    const cold = settle({ ...EARTH, internalHeat: 0, outgassing: 0 }, 3e6).world;
    const hot = settle({ ...EARTH, internalHeat: 20, outgassing: 0 }, 3e6).world;
    check('…and internal heat warms the surface, amplified like any other forcing',
      hot.diag.Tmean - cold.diag.Tmean > 8,
      `20 W/m² is worth ${(hot.diag.Tmean - cold.diag.Tmean).toFixed(1)} K here`);

    // The imbalance is what Settle stops on. Leave the interior out of it and a
    // heated world sits at a permanent false imbalance and Settle never returns.
    const heated = settle({ ...EARTH, internalHeat: 80, outgassing: 0 }, 5e6).world;
    check('…and a settled world with internal heat reads as settled',
      Math.abs(heated.diag.imbalance) < 0.05,
      `imbalance ${heated.diag.imbalance.toFixed(4)} W/m² at 80 W/m² internal`);

    // The Tidal Venus. Insolation alone leaves this world temperate; the
    // interior alone carries it past the Simpson-Nakajima limit.
    const tv = settle({ ...EARTH, insolation: 0.9, internalHeat: 320, outgassing: 0 }, 2e6).world;
    const rl = runawayLimit(tv.diag.pCO2, tv.diag.pN2 + tv.diag.pCH4);
    check('A world can be driven into a runaway by its own interior alone',
      tv.diag.Tmean > 450 && rl.flux - (tv.diag.absorbed + tv.diag.Fint) < 0,
      `${tv.diag.Tmean.toFixed(0)} K, margin ` +
      `${(rl.flux - (tv.diag.absorbed + tv.diag.Fint)).toFixed(0)} W/m² at 0.9 S⊕`);

    // Heat drives melt production, and melt carries dissolved CO2 up with it.
    check('Melt production is anchored so Earth outgasses at exactly 1×',
      Math.abs(meltBoost({ internalHeat: 0.092 }) - 1) < 0.01,
      `Io ${meltBoost({ internalHeat: 1.5 }).toFixed(1)}×, ` +
      `GJ 1132 b ${meltBoost({ internalHeat: 80 }).toFixed(0)}×`);

    // ...and that has to actually move the equilibrium, in a bounded way. Two
    // opposite mistakes are possible and this catches both. Boost weathering
    // too -- it shares the same mass scaling -- and source and sink rise
    // together, so the answer never leaves 360 ppm. Overshoot instead and the
    // world falls off the carbon cliff documented below and lands at 32 bar.
    // A one-sided "it went up" assertion passes happily on the second one.
    //
    // 0.35 W/m2 is chosen to stay on the stable branch: it is a melt boost of
    // 1.95x, and the cliff is at 2.7x.
    const plain = settle({ ...EARTH, internalHeat: 0.092 }, 3e7).world;
    const volcanic = settle({ ...EARTH, internalHeat: 0.35 }, 3e7).world;
    const ratio = volcanic.diag.pCO2 / plain.diag.pCO2;
    check('…so a warmer interior runs a richer carbon cycle, and not a runaway one',
      ratio > 2 && ratio < 100,
      `${(plain.diag.pCO2 * 1e6).toFixed(0)} ppm → ${(volcanic.diag.pCO2 * 1e6).toFixed(0)} ppm ` +
      `(${ratio.toFixed(1)}×) at 1.95× the melt`);

    // The carbon cliff, which turned out not to be a carbon cliff.
    //
    // It was real and it is in the log: an Earth-like world at 2.8x outgassing
    // used to sit at 3400 ppm and 20 C for fourteen million years and then
    // stagger into a 521 C steam greenhouse it could not leave, by way of a
    // 1147 C overshoot. It was diagnosed here as a thermostat problem needing
    // the atmospheric window this scheme does not have, and it was reported and
    // left alone on that basis.
    //
    // That diagnosis was wrong, and the giveaway was in the trace all along:
    // CO2 was *falling* while the temperature exploded. What actually happened
    // is that three times Earth's volcanism puts out more reductant than an
    // Earth-like biosphere can outrun, the air goes anoxic, and the methane
    // sink -- which is oxygen -- disappears with it. Methane then had no
    // ceiling at all, because it was longwave-only: 178 W/m^2 of forcing at
    // 0.1 bar where the literature maximum is nine. Give methane the shortwave
    // absorption it really has and the runaway is gone.
    //
    // What is left in its place is a real transition and a modest one. The air
    // still goes anoxic between 2.6x and 2.8x, methane still climbs to a few
    // thousand ppm, and the world gets *colder* by about seven kelvin, because
    // past a hundred pascals more methane cools a planet rather than warming it
    // (Byrne & Goldblatt 2015; Eager-Nash et al. 2023). That is the direction
    // the literature gives, and it is a step rather than a cliff.
    const ladder = [1, 2, 2.6, 2.8, 3.5, 5, 8].map(
      (og) => ({ og, w: settle({ ...EARTH, outgassing: og }, 3e7).world }));
    const hottest = Math.max(...ladder.map((r) => r.w.diag.Tmean));
    check('No amount of volcanism up to 8× Earth\u2019s runs the planet away',
      hottest < 373,
      ladder.map((r) => `${r.og}× ${(r.w.diag.Tmean - 273.15).toFixed(0)}°`).join('  '));

    // The same ladder, integrated at a hundred times the step.
    //
    // This is a regression guard rather than a bug's headstone, and it is worth
    // being exact about which: on the step controller as it ships, this passes
    // both with the trust region in stepTemperature and without it, because the
    // controller as it ships does not take strides long enough to reach the
    // failure. What it guards against is the failure being reachable again.
    //
    // It is reachable. Loosening the quasi-static stride -- an obvious thing to
    // try, and it was tried, because it is worth two orders of magnitude on a
    // tidally locked world -- put three of these seven rungs on 530 C or on 20 C
    // according to nothing but where the step boundaries fell, by way of single
    // steps of 3349 kelvin out of states whose linearised prediction was under
    // three. That is what "the volcanism bistability" turned out to be, and the
    // trust region is what makes it not happen; measured on the same loosened
    // controller, the largest single step went from 3349 K to 25.
    //
    // The two caps are 5 Myr and 50 kyr because those are the two that
    // disagreed then. tools/convergence.mjs sweeps six caps down to 2 kyr and is
    // the thorough version; this is the cheap one that has to hold every run,
    // including in the browser.
    {
      const atCap = (og, cap) => {
        const sim = new Simulation({ ...EARTH, outgassing: og });
        const w = sim.world;
        let g = 0;
        while (w.time < 3e7 && g++ < 1e5) {
          sim.stepOnce(Math.min(maxStep(w), cap, 3e7 - w.time));
        }
        return w.diag.Tmean;
      };
      let worstGap = 0, at = 0;
      for (const { og } of ladder) {
        const gap = Math.abs(atCap(og, 5e6) - atCap(og, 5e4));
        if (gap > worstGap) { worstGap = gap; at = og; }
      }
      check('\u2026and the same ladder integrated 100\u00d7 finer lands in the same place',
        worstGap < 2,
        `worst disagreement ${worstGap.toFixed(2)} K, at ${at}\u00d7 volcanism`);
    }

    const below = ladder.find((r) => r.og === 2.6).w;
    const above = ladder.find((r) => r.og === 2.8).w;
    check('\u2026and losing the oxygen cools it by a few kelvin, not by hundreds',
      below.diag.pO2 > 1e-4 && above.diag.pO2 < 1e-6
        && below.diag.Tmean - above.diag.Tmean > 2
        && below.diag.Tmean - above.diag.Tmean < 25,
      `2.6× → ${(below.diag.Tmean - 273.15).toFixed(1)} °C oxic, ` +
      `2.8× → ${(above.diag.Tmean - 273.15).toFixed(1)} °C anoxic on ` +
      `${(above.diag.pCH4 * 1e6).toFixed(0)} ppm CH\u2084`);

    // Carbon is conserved. This is the check that would have caught the leak,
    // and it is worth stating why it took so long to notice: a dry world was
    // always exact, because with no liquid there is no weathering and the
    // interior exchange is zero. The leak needed a *working* carbon cycle to
    // hide in, and it scaled with the flux through it -- at five times Earth's
    // volcanism a world finished twenty billion years holding 951 bar against a
    // 399 bar budget, its mantle fuller than it started, which is exactly why
    // the reservoir looked bottomless however long anyone ran it.
    //
    // Note this counts kappa*co2, not co2. The surface system holds kappa times
    // the atmospheric column -- that is what kappa means -- and counting the
    // air alone makes a conserving model look like it is losing carbon.
    {
      const totalC = (w) => {
        const k = w.weathering?.kappa ?? 1;
        return (k * w.co2 + (w.co2Frozen ?? 0) + (w.ch4 ?? 0) * 44 / 16 + (w.carbonDeep ?? 0))
          * w.diag.g / 1e5;
      };
      const budget = carbonBudget(1) * 9.81 / 1e5;
      const worlds = [
        ['Earth', {}],
        ['5\u00d7 volcanism', { outgassing: 5 }],
        ['dry, 5\u00d7 volcanism', { outgassing: 5, water: 0, landFraction: 1 }],
      ].map(([name, over]) => [name, totalC(settle({ ...EARTH, ...over }, 2e10).world)]);
      const worst = Math.max(...worlds.map(([, c]) => Math.abs(c - budget) / budget));
      check('A planet still has the carbon it started with after twenty billion years',
        worst < 0.05,
        worlds.map(([n, c]) => `${n} ${c.toFixed(0)}`).join(' \u00b7 ') +
        ` bar against a ${budget.toFixed(0)} bar budget`);
    }

    // The mantle is not a bottomless tap. A boosted world drains it.
    const drained = settle({ ...EARTH, internalHeat: 40, water: 0, landFraction: 1 }, 2e9).world;
    check('…but it cannot outgas carbon the planet does not have',
      drained.carbonDeep < 0.02 * carbonBudget(1),
      `${(drained.carbonDeep / carbonBudget(1) * 100).toFixed(1)}% of the budget left`);
    const endless = settle({ ...EARTH, internalHeat: 40, water: 0, landFraction: 1,
                             mantleInfinite: true }, 2e9).world;
    check('…unless you ask it to, which is a fair question with an ugly answer',
      endless.co2 * endless.diag.g / 1e5 > drained.co2 * drained.diag.g / 1e5 * 1.5,
      `${(drained.co2 * drained.diag.g / 1e5).toFixed(0)} bar → ` +
      `${(endless.co2 * endless.diag.g / 1e5).toFixed(0)} bar unlimited`);

    // A world written before this existed must not lose its volcanism to a
    // missing field: saves, URL hashes and scenario params all predate it.
    const legacy = settle({ ...EARTH, internalHeat: undefined }, 1e6).world;
    check('…and a world saved before any of this still has an interior',
      Math.abs(legacy.diag.Fint - 0.092) < 1e-9,
      `defaults to Earth's ${legacy.diag.Fint} W/m²`);
  }

  // ---- 3k. the coastline has to be where the model says it is ---------------
  // Sea level is a threshold on the baked height field. It used to be a straight
  // line, thr = 0.625 - 0.25*land, which was right only near the middle: asking
  // for 30% land drew 14.8% and asking for 70% drew 81%. The basin-geometry
  // control was misreporting the one thing it controls.
  {
    const W = 256, H = 128;
    const wgt = [];
    for (let y = 0; y < H; y++) {
      const a = Math.sin(((y + 0.5) / H) * Math.PI);   // an equirectangular row
      for (let x = 0; x < W; x++) wgt.push(a);         // near the pole is tiny
    }
    const tot = wgt.reduce((a, b) => a + b, 0);
    const drawn = (seed, land) => {
      const D = bakeTerrain(seed, W, H), thr = seaLevelForLand(land);
      let a = 0;
      for (let i = 0; i < W * H; i++) if (D.data[i * 4] > thr) a += wgt[i];
      return a / tot;
    };
    let worst = 0, at = 0;
    for (const seed of [3, 91]) {
      for (const land of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const e = Math.abs(drawn(seed, land) - land);
        if (e > worst) { worst = e; at = land; }
      }
    }
    check('The globe draws the land fraction the model asked for',
      worst < 0.04, `worst error ${(worst * 100).toFixed(1)} points, at ${(at * 100).toFixed(0)}% land ` +
      `(the old straight-line sea level was out by 15 points at 30%)`);
  }

  // ---- 3k2. the methane greenhouse has a ceiling ---------------------------
  // Methane was longwave-only, which gave it a forcing that simply grew: 178
  // W/m^2 at 0.1 bar. The measured maximum is nine. Byrne & Goldblatt 2014 get
  // 9 W/m^2 and Eager-Nash et al. 2023 get 8.5, because the near-infrared bands
  // absorb sunlight aloft and the total turns over once that catches up with
  // the longwave -- "the shortwave absorption becomes significant for
  // pCH4 > 10 Pa". Past the peak, more methane cools.
  //
  // This is the check that would have caught the seven-hundred-degree flash an
  // anoxic world used to fall into, and it is cheap: no simulation, just the
  // forcing curve against the number in the paper.
  {
    const T = 288.15, pCO2 = 0.01, pH2O = 0.011, pN2 = 1.0;   // their pCO2 = 1000 Pa
    const ABS = 200;                                          // Archean absorbed sunlight
    const base = olr(T, pCO2, pH2O, 0, pN2 + pCO2 + pH2O);
    const Pas = [1, 3, 10, 30, 60, 100, 200, 300, 600, 1000, 2000, 3500];
    const F = Pas.map((Pa) => base - olr(T, pCO2, pH2O, Pa / 1e5, pN2 + pCO2 + pH2O + Pa / 1e5)
                            - ABS * ch4Shortwave(Pa / 1e5));
    const max = Math.max(...F), at = Pas[F.indexOf(max)];
    check('Methane\u2019s total forcing peaks at the measured 8.5-9 W/m\u00b2 and turns over',
      max <= 9.5 && at >= 30 && at <= 300 && F[F.length - 1] < max - 0.5,
      `peak ${max.toFixed(1)} W/m\u00b2 at ${at} Pa, down to ${F[F.length - 1].toFixed(1)} at 3500 Pa`);
    check('\u2026and modern Earth\u2019s 1.8 ppm is untouched by it',
      240 * ch4Shortwave(1.8e-6) < 0.05,
      `${(240 * ch4Shortwave(1.8e-6) * 1e3).toFixed(0)} mW/m\u00b2 of sunlight taken`);

    // The other half: an anoxic world with a full biosphere must have a methane
    // steady state at all. The anoxic source used to be 2.2e-3 kg/m^2/yr
    // against a photolytic ceiling of 1.6e-3, so below 1.36 S(+) the source
    // beat every sink the planet had and the column simply grew without bound.
    // Kharecha et al. 2005 put Archean biogenic fluxes at a third to two and a
    // half times modern, which is what it is held inside now.
    const source = 8.07e-4 * 1.5;            // CH4_BIO * CH4_ANOX_BOOST
    let col = 1e-3, bounded = true;
    for (let k = 0; k < 4000; k++) {
      col += (source - col / methaneLifetime(0, 0, 1, col, 0.8, 0)) * 1e3;
      if (!(col < 1e6)) { bounded = false; break; }
    }
    const pbar = col * 9.81 / 1e5;
    check('An anoxic biosphere reaches a methane steady state instead of growing without bound',
      bounded && pbar < 0.05,
      bounded ? `settles at ${(pbar * 1e6).toFixed(0)} ppm-bar at 0.8 S\u2295 (Kharecha 2005: 100-35 000 ppmv)`
              : 'unbounded');
  }

  // ---- 3k3. the interior buttons -------------------------------------------
  // Nine real bodies, each setting internal heat and volcanism together because
  // on an actual planet they are not independent. The number worth checking is
  // the one the tooltip shows: the *total* outgassing, which is the slider
  // value times the melt boost the heat already supplies. Get that arithmetic
  // wrong in either direction and the button quietly asks for the wrong world.
  {
    let bad = 0;
    for (const b of INTERIOR_BODIES) {
      const total = b.outgassing * meltBoost({ internalHeat: b.heat });
      if (Math.abs(total - b.total) > Math.max(0.05 * b.total, 0.02)) {
        bad++;
        console.log(`      ${b.name}: says ${b.total}×, computes ${total.toFixed(2)}×`);
      }
    }
    check('Every interior button\u2019s stated total matches heat × volcanism',
      bad === 0, `${INTERIOR_BODIES.length} bodies, ` +
      `${INTERIOR_BODIES[0].name} ${INTERIOR_BODIES[0].heat} W/m² to ` +
      `${INTERIOR_BODIES[INTERIOR_BODIES.length - 1].name} ${INTERIOR_BODIES[INTERIOR_BODIES.length - 1].heat}`);

    // They have to be reachable on the controls they set, and survive the
    // slider round trip -- a button that lands on 79.4 W/m² is a broken button.
    const hs = SLIDERS.find((d) => d.key === 'internalHeat');
    const os = SLIDERS.find((d) => d.key === 'outgassing');
    const trip = (d, v) => snapToDisplay(d, fromSlider(d, Math.round(toSlider(d, v))));
    const off = INTERIOR_BODIES.filter((b) =>
      b.heat > hs.max || b.outgassing > os.max
      || Math.abs(trip(hs, b.heat) - b.heat) > Math.max(b.heat * 0.02, 1e-9)
      || Math.abs(trip(os, b.outgassing) - b.outgassing) > Math.max(b.outgassing * 0.02, 1e-9));
    check('\u2026and every one of them round-trips through the sliders it sets',
      off.length === 0,
      off.length ? off.map((b) => b.name).join(', ') : 'all nine land where they say');

    // And the bodies that are also world presets must agree with them, or picking
    // Venus from the presets and Venus from this row gives two different Venuses.
    const agrees = (id, key) => {
      const b = INTERIOR_BODIES.find((x) => x.id === id), p = PRESETS[key].params;
      return b.heat === p.internalHeat && b.outgassing === p.outgassing;
    };
    check('\u2026and Moon, Venus, Mars and GJ 1132 b agree with their world presets',
      agrees('moon', 'moon') && agrees('venus', 'venus')
        && agrees('mars', 'mars') && agrees('gj1132b', 'gj1132b'),
      `Moon ${PRESETS.moon.params.internalHeat} W/m² × ${PRESETS.moon.params.outgassing}, ` +
      `Venus ${PRESETS.venus.params.internalHeat} W/m² × ${PRESETS.venus.params.outgassing}, ` +
      `GJ 1132 b ${PRESETS.gj1132b.params.internalHeat} × ${PRESETS.gj1132b.params.outgassing}`);

    // End to end, through the carbon cycle rather than through meltBoost on its
    // own: press the button and the world really does outgas what the tooltip
    // said, measured against an Earth-mass Earth. This is the check that stands
    // in for clicking them, and it is the stronger one -- it would catch the
    // pair being applied to the wrong controls, or one of them not being
    // applied at all.
    const flux = (heat, og) => {
      const x = new Simulation({ ...EARTH, internalHeat: heat, outgassing: og });
      x.stepOnce(1);
      return x.world.weathering.V;
    };
    const ref = flux(0.092, 1);
    const wrong = INTERIOR_BODIES.filter((b) => {
      const got = flux(b.heat, b.outgassing) / ref;
      return Math.abs(got - b.total) > Math.max(0.06 * b.total, 0.02);
    });
    check('\u2026and pressing one really does outgas what its tooltip claims',
      wrong.length === 0,
      wrong.length ? wrong.map((b) => `${b.name} says ${b.total}× got ` +
        `${(flux(b.heat, b.outgassing) / ref).toFixed(2)}×`).join('; ')
      : INTERIOR_BODIES.map((b) => `${b.name} ${(flux(b.heat, b.outgassing) / ref).toFixed(2)}×`).join(', '));
  }

  // ---- 3k4. methane in the dark ---------------------------------------------
  // The gas makes the smog that blocks the light, and the light is what its
  // source runs on -- so leaving that loop open let a world under a closed haze
  // deck produce methane at the full Earth rate for ever. At 0.274 S(+) with an
  // Io-like interior it reached seven hundred bar and was still climbing, on a
  // planet whose entire carbon budget is four hundred bar of CO2 equivalent.
  //
  // Two things were missing and both are here: the biosphere needs light that
  // actually reaches the ground, and the methane has to be made of carbon that
  // came from somewhere.
  {
    const w = settle({ ...EARTH, mass: 1.2, insolation: 0.274, o2Bar: 0,
      co2Bar: 1.06, ch4Bar: 1.9e-6, outgassing: 5, internalHeat: 1.5, startT: 286.85 }, 2e10).world;
    check('A dark hazy world does not grow a hundred bar of methane out of nothing',
      w.diag.pCH4 < 20,
      `${w.diag.pCH4.toFixed(2)} bar CH\u2084 after 20 Gyr, was 744 and rising`);
    // The gate is proportional, not a cutoff, so this is a throttle rather than
    // a switch: the haze closes until the light it still passes supports only
    // as much methane as photolysis can take away. That is the loop closing.
    check('\u2026because the haze it makes throttles the biosphere that makes it',
      w.diag.swTrans < 0.3 && w.ch4Source < 1.0 * 8.07e-4,
      `${(w.diag.swTrans * 100).toFixed(1)}% of the sunlight reaches the ground and the ` +
      `methane source sits at ${(w.ch4Source / 8.07e-4 * 100).toFixed(0)}% of Earth\u2019s, ` +
      `down from 171% with the loop open`);
  }

  // ---- 3l. methane is not a stable gas -------------------------------------
  // It used to sit wherever the slider put it, for ever. In today's oxidising
  // air OH radicals destroy it in about a decade; with no free oxygen the only
  // sink is ultraviolet photolysis high up and the lifetime stretches to ten
  // thousand years, which is why the Archean could hold percent-level methane
  // at all (Zahnle 1986; Pavlov 2001; Catling & Zahnle 2020).
  {
    const anox = methaneLifetime(0, 0, 1);
    check('Methane lasts ~10 kyr in anoxic air and ~10 yr in ours',
      near(anox, 1.2e4, 3e3) && near(methaneLifetime(0.21, 0, 1), 10, 3),
      `${anox.toExponential(1)} yr anoxic, ${methaneLifetime(0.21, 0, 1).toFixed(0)} yr at present-day oxygen`);
    // The point the Great Oxidation turns on: it takes very little oxygen.
    const trace = methaneLifetime(2e-4, 0, 1);
    check('…and a thousandth of today\u2019s oxygen already all but ends it',
      trace / anox < 0.01,
      `lifetime falls to ${(trace / anox * 100).toFixed(2)}% of the anoxic value, so the steady state does too`);
    check('…while its own haze shields it and buys it time',
      methaneLifetime(0, 0.5, 1) > anox * 1.5,
      `${(methaneLifetime(0, 0.5, 1) / anox).toFixed(1)}× longer under haze`);

    // Methane is far less stable than CO2, and it must actually decay.
    // Nothing making it: no biosphere, no volcanism.
    const s = new Simulation({ ...EARTH, ch4Bar: 1e-3, co2Bar: 0.01,
      biosphere: 0, outgassing: 0 });
    const w = s.world;
    const ch4Start = w.ch4;
    s.runYears(1e5, 2e3);
    check('Methane decays when nothing is making it',
      w.ch4 < 0.02 * ch4Start,
      `${(w.ch4 / ch4Start * 100).toFixed(2)}% left after 100 kyr, where CO₂ would still be there`);

    // ---- methane is a reservoir, not a target level -----------------------
    // This is the regression test for the bug that prompted the change. The
    // methane source used to be inferred once, from the level asked for and the
    // lifetime at that instant, and then frozen. A world built oxic had a
    // ten-year lifetime, so sustaining 1.9 ppm implied a large flux; the same
    // world built anoxic had a twelve-thousand-year lifetime and implied a flux
    // twelve hundred times smaller. Take the oxygen away afterwards and the
    // first world grew thousands of ppm of methane while the second sat at 1.9
    // for ever -- identical settings, two different planets, and which one you
    // got depended on the order you had touched the sliders in.
    {
      // The contract, stated as directly as it can be: what the slider is set to
      // must not survive in the answer. Four worlds identical but for their
      // starting methane, from none at all to ten thousand ppm, all have to end
      // at the level this biosphere sustains. Under the old contract each one
      // held its own number for ever.
      const runs = [0, 1.9e-6, 1e-4, 1e-2].map((ch4Bar) => settle({ ...EARTH, ch4Bar }, 1e5).world);
      const ends = runs.map((w) => w.diag.pCH4 * 1e6);
      const spread = (Math.max(...ends) - Math.min(...ends)) / Math.max(...ends);
      // The tolerance is 10%, not 1%, and the reason is that these four are no
      // longer the same world. Methane is made of carbon now, and destroying it
      // in oxidising air hands that carbon back as CO2 -- so the world built
      // with 10 000 ppm of methane is carrying 27 500 ppm of CO2 equivalent
      // that the empty one never had, which is most of a doubling once the
      // ocean has taken its share. It settles a little warmer and holds a
      // little more methane, and that is correct rather than slop. Under the
      // bug this is guarding against the spread was not seven percent but a
      // factor of five thousand: each world simply held whatever it was given.
      check('Methane forgets what the slider was set to',
        spread < 0.10 && Math.abs(ends[0] - 0.80) < 0.1,
        `0, 1.9, 100 and 10 000 ppm all settle at ` +
        `${ends.map((e) => e.toFixed(2)).join(' / ')} ppm`);
      // And the carbon that came with it really did go somewhere, rather than
      // being quietly deleted.
      const co2s = runs.map((w) => w.diag.pCO2 * 1e6);
      check('\u2026but the carbon it was made of does not vanish with it',
        co2s[3] > co2s[0] * 1.2,
        `starting with 10 000 ppm CH\u2084 leaves ${co2s[3].toFixed(0)} ppm CO\u2082 ` +
        `against ${co2s[0].toFixed(0)} with none`);

      // And on an anoxic world, where the level it settles at is a thousand
      // times higher and the lifetime a thousand times longer.
      const anox = { ...EARTH, biosphere: 0.2, outgassing: 1, co2Bar: 0.02,
        insolation: 0.9, o2Bar: 0 };
      const lo = settle({ ...anox, ch4Bar: 0 }, 5e6).world.diag.pCH4;
      const hi = settle({ ...anox, ch4Bar: 1e-4 }, 5e6).world.diag.pCH4;
      // Not exact, and the reason is physics rather than slop: hydrogen escape
      // leaves each world a slightly different trace of oxygen, and methane's
      // lifetime is a steep function of trace oxygen -- fifteen parts per
      // billion of it is worth a few percent of the lifetime. That sensitivity
      // is the whole point of the Great Oxidation, so it is not something to
      // tune away.
      check('…on an anoxic world too, where it settles a thousand times higher',
        Math.abs(lo - hi) / Math.max(lo, hi) < 0.05 && lo * 1e6 > 100,
        `starting from nothing gives ${(lo * 1e6).toFixed(0)} ppm, from 100 ppm ` +
        `gives ${(hi * 1e6).toFixed(0)} ppm — ` +
        `${(Math.abs(lo - hi) / Math.max(lo, hi) * 100).toFixed(1)}% apart`);

      // Even a full percent to start with, which is enough haze to shade the
      // ground hard. It used to freeze the world into a snowball it could not
      // leave, and that stopped being true when the carbon cycle was put on its
      // measured speed: the thermostat now answers on the timescale a haze
      // actually lasts, and the world comes back to where the others are.
      const tipped = settle({ ...anox, ch4Bar: 1e-2 }, 5e6).world;
      check('…and even a hundred times too much of it converges to the same level',
        Math.abs(tipped.diag.pCH4 - lo) / Math.max(tipped.diag.pCH4, lo) < 0.10
          && tipped.diag.Tmean > 273,
        `10 000 ppm to start ends at ${(tipped.diag.pCH4 * 1e6).toFixed(0)} ppm ` +
        `against ${(lo * 1e6).toFixed(0)} from nothing, at ` +
        `${(tipped.diag.Tmean - 273.15).toFixed(0)} °C`);
    }

    // An Earth-like biosphere makes Earth's methane, which is the calibration.
    // 0.72 ppm, the pre-industrial value: the rest of today's 1.9 is ours, and
    // with a ten-year lifetime that part is a standing emission, not a legacy.
    {
      const w = settle({ ...EARTH }, 1e4).world;
      check('An Earth-like biosphere sustains pre-industrial methane',
        near(w.diag.pCH4 * 1e6, 0.72, 0.2),
        `${(w.diag.pCH4 * 1e6).toFixed(2)} ppm, against 0.72 observed before we started`);
    }

    // A dead but volcanically active world gets the abiotic flux and no more.
    // Getting this wrong is not subtle: file Earth's ~38 Tg/yr of thermogenic
    // seeps under "geological" rather than under the biosphere that originally
    // buried the carbon, and every sterile volcanic world grows an Archean
    // methane greenhouse from nothing.
    {
      const dead = settle({ ...EARTH, o2Bar: 0, biosphere: 0, outgassing: 1,
        co2Bar: 3e-3, insolation: 0.9 }, 5e6).world;
      check('A sterile volcanic world gets abiotic methane only, not a greenhouse',
        dead.diag.pCH4 * 1e6 < 30 && dead.diag.pCH4 * 1e6 > 1,
        `${(dead.diag.pCH4 * 1e6).toFixed(1)} ppm with nothing alive on it`);
    }

    // ---- the photon ceiling -------------------------------------------------
    // Photolysis needs photons, so past the column where methane goes opaque to
    // its own destroying wavelengths the sink stops being a fixed fraction per
    // year and becomes a fixed flux. Without this Titan is a paradox: anoxic, so
    // twelve thousand years, so its five percent of methane should have been
    // gone a hundred times over.
    {
      const thin = methaneLifetime(0, 0, 1, 0.01, 1);
      check('A thin methane atmosphere is destroyed at the thin rate',
        near(thin, 1.2e4, 1e3), `${thin.toExponential(2)} yr at 10 g/m²`);
      const titan = settle(PRESETS.titan.params, 1e5).world;
      check('…but Titan\u2019s is opaque and starved of light, so it lasts 10-100 Myr',
        titan.ch4Tau > 1e7 && titan.ch4Tau < 1e9,
        `${(titan.ch4Tau / 1e6).toFixed(0)} Myr, against ~12 kyr from the thin rate alone`);
      // Which also means it is not in steady state, and cannot be: nothing on
      // that moon is making five percent of an atmosphere.
      const later = settle(PRESETS.titan.params, 3e8).world;
      check('…and is therefore a transient, gone in a few hundred Myr',
        later.diag.pCH4 < 0.05 * titan.diag.pCH4,
        `5.0% now, ${(later.diag.pCH4 * 100).toFixed(2)}% after 300 Myr`);
    }

    // Oxygen itself must not pile up from a trickle of water loss, or every
    // world silently oxidises and loses its methane for no reason.
    const quiet = settle({ ...EARTH, insolation: 1.0, o2Bar: 0, biosphere: 0 }, 3e7).world;
    check('A world that has barely lost any water stays anoxic',
      quiet.diag.pO2 < 1e-5,
      `${quiet.water.lost.toExponential(1)} EO lost, ${quiet.diag.pO2.toExponential(1)} bar O₂`);
    // ...but a real runaway still oxidises one, which is the Venus story.
    const cooked = settle({ ...EARTH, insolation: 1.6, xuvFraction: 1e-4, ch4Bar: 1e-3,
      o2Bar: 0, biosphere: 0 }, 5e8).world;
    check('…but a planet that loses its ocean is oxidised, and its methane gone',
      cooked.diag.pO2 > 1 && cooked.diag.pCH4 < 1e-5,
      `${cooked.water.lost.toFixed(2)} EO lost, ${cooked.diag.pO2.toFixed(0)} bar O₂, ` +
      `CH₄ ${cooked.diag.pCH4.toExponential(1)} bar`);
  }

  // ---- 3m. the oxygen cycle -------------------------------------------------
  // Oxygen used to be a fossil of hydrogen escape and nothing else, so the only
  // route to an oxygen-rich atmosphere was to boil an ocean -- the Venus story,
  // not Earth's. It is now the same shape as the carbon cycle: a reservoir with
  // a source you control and sinks the planet decides.
  {
    const held = (bio, extra = {}, yr = 5e7) => {
      const x = new Simulation({ ...EARTH, biosphere: bio, ...extra });
      const w = x.world;
      let n = 0;
      while (w.time < yr && n++ < 5e4) x.stepOnce(Math.min(maxStep(w), 2e5));
      return w;
    };
    const earth = held(1);
    check('An Earth-like biosphere holds 0.21 bar of oxygen',
      near(earth.diag.pO2, 0.21, 0.04), `${earth.diag.pO2.toFixed(3)} bar`);
    check('…and that is what gives its methane a ten-year life',
      near(methaneLifetime(earth.diag.pO2, 0, 1), 10, 2),
      `${methaneLifetime(earth.diag.pO2, 0, 1).toFixed(1)} yr, against ${methaneLifetime(0, 0, 1).toExponential(1)} with no oxygen`);

    // The threshold, which is the whole point: below the volcanic reductant
    // flux the air stays anoxic however long you wait.
    const below = held(0.25, {}, 2e8), above = held(0.8);
    check('A biosphere the volcanoes outrun leaves the air anoxic for ever',
      below.diag.pO2 < 1e-6, `${below.diag.pO2.toExponential(1)} bar after 200 Myr at 0.25× Earth`);
    check('…and one that outruns them oxygenates the planet',
      above.diag.pO2 > 0.05, `${above.diag.pO2.toFixed(3)} bar at 0.8× Earth`);
    check('…so more volcanism can put an oxygenated world back under',
      held(1, { outgassing: 4 }).diag.pO2 < 0.5 * earth.diag.pO2,
      `${held(1, { outgassing: 4 }).diag.pO2.toFixed(3)} bar at 4× volcanism`);

    // Oxidative weathering is first order in pO2, so the level settles instead
    // of climbing for ever -- including on a world with no land at all, which
    // would otherwise have no sink.
    const rich = held(3, {}, 1e9);
    check('Oxygen settles at a level rather than climbing without bound',
      rich.diag.pO2 < 2.0, `${rich.diag.pO2.toFixed(2)} bar at 3× Earth after a billion years`);
    const sea = settle({ ...PRESETS.waterworld.params, biosphere: 3 }, 1e9).world;
    check('…even on a waterworld, where seafloor oxidation is the only sink',
      sea.diag.pO2 < 2.0, `${sea.diag.pO2.toFixed(2)} bar with no exposed land`);

    // The worlds that should have none.
    for (const [k, name] of [['venus', 'Venus'], ['mars', 'Mars'], ['titan', 'Titan']]) {
      const w = settle(PRESETS[k].params, 1e5).world;
      check(`${name} stays anoxic`, w.diag.pO2 < 1e-4, `${w.diag.pO2.toExponential(1)} bar`);
    }
  }

  // ---- 3m2. where photosynthesis can run ------------------------------------
  // Optimistic bounds, and taken band by band rather than from the global mean,
  // because it is a local condition.
  {
    const earth = settle(EARTH, 2e5).world;
    check('All of Earth is fit for photosynthesis',
      Math.abs(photosynthesis(earth) - 1) < 1e-6,
      `${(photosynthesis(earth) * 100).toFixed(2)}% of the surface`);

    // The upper limit is a real and well-measured one: oxygenic photosynthesis
    // stops around 73 C, where Synechococcus lividus gives out, and nothing on
    // Earth passes 75.
    //
    // Driven directly rather than by settling a world at that temperature,
    // because no such world exists: the hottest stable climate the model
    // supports with an ocean is 59 C, and the next step up is a runaway at 594.
    // The bound is therefore one that only ever bites in transit -- on the way
    // into a runaway, where it should stop the biosphere before the ocean is
    // gone rather than after.
    {
      const t = new Simulation({ ...EARTH }); t.runYears(2e5);
      const at = (K) => { for (let i = 0; i < NBANDS; i++) t.world.T[i] = K;
        return photosynthesis(t.world); };
      check('…and stops between 68 and 78 °C, where phototrophs actually stop',
        at(273 + 60) > 0.99 && at(273 + 73) > 0.2 && at(273 + 73) < 0.8
          && at(273 + 85) < 1e-6,
        `100% at 60 °C, ${(at(273 + 73) * 100).toFixed(0)}% at 73 °C, ` +
        `${(at(273 + 85) * 100).toFixed(2)}% at 85 °C`);
      check('…and at the cold end where the brine films go, not where water freezes',
        at(273 - 10) > 0.99 && at(273 - 30) < 1e-6,
        `100% at -10 °C, ${(at(273 - 30) * 100).toFixed(2)}% at -30 °C`);
    }

    // A tidally locked world has a night side, and no amount of warmth makes up
    // for having no light. This is the check the old global-mean test could not
    // express at all.
    //
    // It used to assert that a locked world scored roughly its lit fraction,
    // which quietly baked in the wrong denominator -- see 3o2b. The claim in the
    // sentence above is the one worth keeping, and it can be made directly and
    // far more sharply: warm the entire night side to a perfect 20 C and nothing
    // happens, because there is still no light there.
    const locked = settle({ ...PRESETS.eyeball.params }, 2e7).world;
    const dark = photosynthesis(locked);
    const night = [];
    for (let i = 0; i < NBANDS; i++) {
      if (smoothstep(0.05, 0.5, locked.diag.S[i]) < 0.01) { night.push(i); locked.T[i] = 293; }
    }
    check('…and no amount of warmth makes up for having no light',
      night.length > 4 && photosynthesis(locked) === dark,
      `${night.length} of ${NBANDS} bands in permanent night; warming every one of ` +
      `them to 20 °C leaves photosynthesis at ${(dark * 100).toFixed(0)}%, unchanged`);

    // Carbon starvation: cyanobacteria draw CO2 down to a few ppm, but not to
    // nothing.
    const starved = settle({ ...EARTH, co2Bar: 1e-7, outgassing: 0 }, 1e4).world;
    check('…and none of a world with no carbon left to fix',
      photosynthesis(starved) < 0.01,
      `${(starved.diag.pCO2 * 1e6).toFixed(3)} ppm CO₂, ` +
      `${(photosynthesis(starved) * 100).toFixed(2)}% of the surface`);
  }

  // ---- 3m3. burning the fossil carbon ---------------------------------------
  // A finite reserve, not an infinite tap. That is the part that matters: the
  // control cannot run a world away, because the carbon runs out first.
  {
    const s = new Simulation({ ...PRESETS.earth.params });
    const w = s.world;
    const to = (yr) => { while (w.time < yr) s.stepOnce(Math.min(maxStep(w), yr - w.time)); };
    to(150);
    const mid = { co2: w.diag.pCO2, T: w.diag.Tmean };
    check('Industrial CO₂ rises about as fast as ours has',
      mid.co2 * 1e6 > 700 && mid.co2 * 1e6 < 1300,
      `${(mid.co2 * 1e6).toFixed(0)} ppm after 150 years, from 427`);

    to(600);
    check('…until the fossil carbon runs out, which it does in a few centuries',
      w.fossil < 1e-6 && w.emitting < 1e-6,
      `reserve empty after ~${(36 / 7.8e-2).toFixed(0)} years at today's rate`);
    check('…having roughly tripled the CO₂ and stopped there',
      w.diag.pCO2 * 1e6 > 1600 && w.diag.pCO2 * 1e6 < 3000,
      `peaks at ${(w.diag.pCO2 * 1e6).toFixed(0)} ppm, ` +
      `${(w.diag.Tmean - 273.15).toFixed(1)} °C`);

    // Half of a pulse this fast stays in the air. Running it through the
    // ocean-and-crust buffer the volcanoes use -- an equilibrium partition, and
    // the ocean cannot turn over in four centuries -- gives 500 ppm instead of
    // 2200, which is not what burning five thousand gigatonnes does.
    const peak = w.diag.pCO2;
    to(2e6);
    check('…and no world with it switched on can run away, because it is finite',
      w.diag.pCO2 <= peak * 1.01 && w.diag.Tmean < 320,
      `still ${(w.diag.pCO2 * 1e6).toFixed(0)} ppm and ` +
      `${(w.diag.Tmean - 273.15).toFixed(1)} °C two million years later`);

    // And nothing else inherits it. The app boots from this preset rather than
    // the bare EARTH constant, so this is also what a fresh load starts on.
    const others = Object.entries(PRESETS).filter(([k]) => k !== 'earth')
      .filter(([, v]) => (v.params.emissions ?? 0) > 0);
    // The plain Earth-like world is for trying something without the answer
    // being about this planet in particular: no industry, no real coastlines.
    check('There is an Earth-like world with none of Earth\u2019s specifics',
      PRESETS.earthlike && PRESETS.earthlike.params.emissions === 0
        && PRESETS.earthlike.params.fossilUsed === 0,
      'Earth-like: no industry, procedural continents, emissions still available');

    check('…and only Earth has anyone on it',
      others.length === 0 && PRESETS.earth.params.emissions === 1,
      others.length ? others.map(([k]) => k).join(', ')
        : 'the Earth preset burns, every other preset is at zero');

    // Pre-industrial Earth has more of it left, because nobody had touched it.
    const modern = new Simulation({ ...PRESETS.earth.params });
    const preind = new Simulation({ ...PRESETS.preindustrial.params });
    modern.stepOnce(1); preind.stepOnce(1);
    check('Pre-industrial Earth still has all its fossil carbon, modern Earth does not',
      preind.world.fossil > 0.999 * FOSSIL_TOTAL
        && Math.abs(modern.world.fossil / FOSSIL_TOTAL - 0.902) < 0.02,
      `${(preind.world.fossil / FOSSIL_TOTAL * 100).toFixed(0)}% against ` +
      `${(modern.world.fossil / FOSSIL_TOTAL * 100).toFixed(0)}% — the ~1800 Gt of CO₂ ` +
      `we have already burnt is a tenth of what is down there`);

    // …and the amount already gone is the same carbon that raised the CO2, which
    // is the only forcing experiment anyone has run on a whole planet.
    {
      const h = new Simulation({ ...PREINDUSTRIAL, emissions: 1 });
      let n = 0;
      while ((h.world.fossil == null || h.world.fossil > FOSSIL_TOTAL - 3.53) && n++ < 2e5) {
        h.stepOnce(Math.min(maxStep(h.world), 5));
      }
      check('…and burning that much really does take 280 ppm to about 427',
        near(h.world.diag.pCO2 * 1e6, 427, 35),
        `${(h.world.diag.pCO2 * 1e6).toFixed(0)} ppm, against the 427 observed ` +
        `(the cumulative airborne fraction is 42%, not the half a single year gives)`);
    }

    // The reserve can be switched off, which is the one thing that puts the
    // infinite tap back. Worth a test precisely because it removes a guard.
    // Untouched means untouched at whatever it started with -- modern Earth
    // starts at 90%, not 100% -- so the check is that it did not move at all.
    const start = (1 - 0.098) * FOSSIL_TOTAL;
    const forever = settle({ ...PRESETS.earth.params, fossilInfinite: true }, 3000).world;
    check('…unless the reserve is switched off, and then it never stops',
      Math.abs(forever.fossil - start) < 1e-6 && forever.diag.pCO2 > 4 * 427e-6,
      `${(forever.diag.pCO2 * 1e6).toFixed(0)} ppm after 3 kyr with the reserve still ` +
      `exactly where it started, at ${(forever.fossil / FOSSIL_TOTAL * 100).toFixed(0)}%`);
  }

  // ---- 3n. the Great Oxidation, played forwards -----------------------------
  // The whole chain, measured rather than asserted: oxygen crosses the volcanic
  // reductant flux, methane's lifetime collapses, the methane goes with it, and
  // the greenhouse it was providing goes too.
  {
    const s = new Simulation({ ...PRESETS.earlyEarth.params });
    const w = s.world;
    const to = (yr) => { while (w.time < yr) s.stepOnce(Math.min(maxStep(w), yr - w.time, 5e3)); };
    to(2e6);
    const before = { T: w.diag.Tmean, ch4: w.diag.pCH4, o2: w.diag.pO2 };
    check('An Archean world sits anoxic and warm on its methane',
      before.o2 < 1e-6 && before.T > 273,
      `${(before.T - 273.15).toFixed(1)} °C, ${(before.ch4 * 1e6).toFixed(0)} ppm CH₄, no oxygen`);

    w.params.biosphere = 1.5;          // photosynthesis takes off
    to(2e6 + 5e3);
    check('…oxygen crosses the reductant flux within a few thousand years',
      w.diag.pO2 > 1e-5, `${w.diag.pO2.toExponential(1)} bar after 5 kyr`);

    // A few thousand more. The methane responds to the oxygen the *previous*
    // step computed -- ordinary operator splitting -- so a single five-thousand
    // year stride can step straight over the crossover. It is a one-step lag in
    // a transient and the end state is untouched, but it means this has to be
    // sampled at the rate the transition happens rather than in one jump.
    to(2e6 + 2e4);
    check('…and takes the methane with it',
      w.diag.pCH4 < 0.2 * before.ch4,
      `${(w.diag.pCH4 / before.ch4 * 100).toFixed(2)}% of the methane left after 20 kyr`);

    to(2e6 + 4e4);
    check('…and losing that greenhouse freezes the planet',
      w.diag.Tmean < before.T - 30 && w.diag.iceMean > 0.9,
      `${(before.T - 273.15).toFixed(1)} °C → ${(w.diag.Tmean - 273.15).toFixed(1)} °C, ` +
      `${(w.diag.iceMean * 100).toFixed(0)}% ice`);

    // The sting: the ocean freezes, so the biosphere stops, so the oxygen that
    // caused all this is consumed -- and the planet stays frozen anyway, because
    // the same dead biosphere is not making methane either.
    //
    // This used to say the methane came back, and it did, which was wrong: the
    // methane source was a frozen number inferred once at the start and it had
    // no idea whether anything was alive to sustain it. With the source coming
    // from the biosphere the trap shuts twice over. Removing the trigger does
    // not undo the damage, because whatever the world had before the oxygen is
    // not coming back on its own.
    to(2e6 + 2e6);
    check('…after which the trigger removes itself and the world stays frozen anyway',
      w.diag.pO2 < 1e-6 && w.diag.pCH4 < 0.1 * before.ch4 && w.diag.iceMean > 0.9,
      `oxygen gone, but only ${(w.diag.pCH4 / before.ch4 * 100).toFixed(1)}% of the methane ` +
      `back with nothing alive to make it, still ` +
      `${(w.diag.iceMean * 100).toFixed(0)}% ice at ${(w.diag.Tmean - 273.15).toFixed(1)} °C`);

    // And it is winnable: replace the methane greenhouse with CO2 first.
    const won = (() => {
      const x = new Simulation({ ...PRESETS.earlyEarth.params, co2Bar: 0.25 });
      const v = x.world;
      let n = 0;
      while (v.time < 1e6 && n++ < 3e4) x.stepOnce(Math.min(maxStep(v), 5e3));
      v.params.biosphere = 1.5;
      while (v.time < 5e6 && n++ < 6e4) x.stepOnce(Math.min(maxStep(v), 5e3));
      return v;
    })();
    check('…but with the CO₂ raised first, the world survives being oxygenated',
      won.diag.pO2 > 0.01 && won.diag.Tmean > 273 && won.diag.iceMean < 0.5,
      `${won.diag.pO2.toFixed(3)} bar O₂ at ${(won.diag.Tmean - 273.15).toFixed(1)} °C, ` +
      `${(won.diag.iceMean * 100).toFixed(0)}% ice`);
  }

  // ---- 3o. a waterworld has a thermostat too --------------------------------
  // Ocean water circulates through fresh basalt at the ridges and lays CO2 down
  // as carbonate, which is about a quarter of Earth's silicate sink and the
  // whole of a landless world's (Brady & Gislason 1997; Coogan & Dosso 2015;
  // Krissansen-Totton & Catling 2017). Without it a world with no continents
  // had no carbon thermostat at all and simply drifted.
  {
    const sea = (S) => settle({ ...PRESETS.waterworld.params, insolation: S }, 3e9).world;
    const dim = sea(0.95), bright = sea(1.05);
    check('A waterworld regulates its CO₂ despite having no land',
      dim.diag.pCO2 > bright.diag.pCO2 * 1.4,
      `${dim.diag.pCO2.toExponential(1)} bar at 0.95 S⊕ against ${bright.diag.pCO2.toExponential(1)} at 1.05`);
    check('…and stays habitable across that range',
      dim.diag.Tmean > 273 && bright.diag.Tmean < 350,
      `${(dim.diag.Tmean - 273.15).toFixed(0)} °C to ${(bright.diag.Tmean - 273.15).toFixed(0)} °C`);
  }

  // ---- 3o2. the biosphere that is actually there -----------------------------
  // The control is what you ask for. This is what the planet supports, and the
  // difference used to be invisible: nothing displayed it and the ground stayed
  // green at 800 C, which is what prompted this.
  {
    const earth = settle({ ...EARTH }, 2e5).world;
    check('An Earth-like world supports the biosphere it is asked for',
      near(earth.diag.bio, 1, 0.02), `${earth.diag.bio.toFixed(3)}× alive`);

    const cooked = settle({ ...EARTH, co2Bar: 178, water: 2 }, 2e5).world;
    check('…and a cooked one supports none of it, whatever the control says',
      cooked.diag.bio < 1e-3 && cooked.diag.Tmean > 600,
      `${(cooked.diag.Tmean - 273.15).toFixed(0)} °C, control still at ` +
      `${cooked.params.biosphere.toFixed(2)}×, actually alive ${cooked.diag.bio.toFixed(3)}×`);

    check('…and asking for none gives none',
      settle({ ...EARTH, biosphere: 0 }, 1e4).world.diag.bio === 0, 'nothing alive');
    check('…and asking for three times Earth gives three times Earth',
      near(settle({ ...EARTH, biosphere: 3 }, 2e5).world.diag.bio, 3, 0.05),
      'a world can be lusher than this one');

    // It comes back, which is the half that makes it a biosphere rather than a
    // switch: something survived and spread.
    const back = new Simulation({ ...EARTH, co2Bar: 0.393 });
    back.runYears(5e4);
    const dead = back.world.diag.bio;
    back.world.co2 = 280e-6 * 1e5 / back.world.diag.g;
    back.runYears(3e5);
    check('…and it grows back once the world is habitable again',
      dead < 0.2 && back.world.diag.bio > 0.9,
      `${dead.toFixed(3)}× under the greenhouse, ${back.world.diag.bio.toFixed(3)}× ` +
      `after it cleared`);
  }

  // ---- 3o1z. the clock eases through a tipping ------------------------------
  // At the ten-Myr-a-second this game is mostly played at, the transition every
  // one of these worlds is ABOUT happens inside a single frame: the planet is
  // temperate, and then it is not. Auto-ease spends a fixed budget of
  // |d ln T| per wall-clock second, which is the only unit that serves both a
  // thirty-kelvin glaciation and a seven-hundred-kelvin runaway.
  //
  // Driven by hand at a nominal sixty frames a second, so this measures the
  // governor and not the machine it is running on.
  {
    const play = (ease, extra, stop, rate) => {
      const s = new Simulation({ ...EARTH, ...extra });
      s.rate = rate; s.autoEase = ease;
      let frames = 0;
      while (!stop(s.world) && frames < 60 * 600) { s.advance(1 / 60); frames++; }
      return frames / 60;
    };
    const boil = { insolation: 1.6, outgassing: 0 };
    const freeze = { insolation: 0.85, co2Bar: 1e-6, outgassing: 0 };
    const hot = (w) => w.diag.Tmean > 500, cold = (w) => w.diag.Tmean < 255;
    const rawHot = play(false, boil, hot, 1e7), easedHot = play(true, boil, hot, 1e7);
    const rawCold = play(false, freeze, cold, 1e7), easedCold = play(true, freeze, cold, 1e7);
    check('Auto-ease makes a runaway and a glaciation last long enough to watch',
      easedHot > 1.5 && easedHot > rawHot * 20 && easedCold > 0.7 && easedCold > rawCold * 20,
      `runaway ${rawHot.toFixed(2)}s \u2192 ${easedHot.toFixed(1)}s, ` +
      `glaciation ${rawCold.toFixed(2)}s \u2192 ${easedCold.toFixed(1)}s`);

    // ...and it costs nothing whatever when nothing is happening. A settled
    // Earth with the governor armed must run at exactly the rate asked for:
    // a control that quietly taxed every steady world would be worse than the
    // problem it solves.
    const still = new Simulation({ ...EARTH });
    still.rate = 1e7; still.autoEase = true;
    for (let i = 0; i < 600; i++) still.advance(1 / 60);
    check('\u2026and does nothing at all to a world that is not tipping',
      still.easeFactor > 0.999 && still.world.time > 0.95e8,
      `${still.world.time.toExponential(2)} yr in ten seconds at 10 Myr/s, ` +
      `ease factor ${still.easeFactor.toFixed(3)}`);

    // The budget is in log temperature, so the same setting has to serve two
    // events that differ by a factor of twenty in kelvin. That is the whole
    // argument for the unit, and it is worth a check of its own: both land
    // inside a factor of four of each other in wall-clock seconds.
    // Four was the old bound, and it was loose because the old governor never
    // reached its target: it bottomed out on maxStep's own limits instead, at
    // 2.8 s and 1.3 s, which happen to be closer together than the events are.
    // Now that the target is actually hit, the ratio of the two durations IS
    // the ratio of the two log-temperature spans -- 0.55 against 0.13 -- so the
    // check can say what it always meant.
    check('\u2026and one setting serves both, because the budget is in log temperature',
      easedHot / easedCold < 5 && easedCold / easedHot < 5,
      `${easedHot.toFixed(1)}s against ${easedCold.toFixed(1)}s, for transitions ` +
      `of 212 K and 33 K`);
  }

  // ---- 3o2a. boiling a planet kills what is on it ---------------------------
  // The room a biosphere has and the time it takes to lose it are two different
  // questions, and this model was only getting the first one right. A world run
  // into a wet runaway had `lifeRoom` correctly at zero from the moment its
  // ocean passed 122 C -- and went on reporting 100% prokaryote coverage,
  // because the population was relaxing towards that zero with the two-million
  // year time constant that belongs to an ice sheet advancing over a habitat.
  // It read "prokaryotes 100% of the surface" at a mean surface of 288 C.
  //
  // The asymmetry is the point. Heat has no refugia and cold has plenty of
  // them, so the same loss of habitable ground has to resolve at two different
  // speeds depending on which end it happened at.
  {
    const boil = new Simulation({ ...EARTH, insolation: 1.6, outgassing: 0 });
    let hot = null;
    for (let i = 0; i < 6000 && boil.world.diag.Tmean < 520; i++) {
      boil.stepOnce(Math.min(maxStep(boil.world), 1e5));
      if (!hot && boil.world.diag.Tmean > 420) hot = boil.world.time;
    }
    check('A planet whose ocean has boiled is sterile, and quickly',
      boil.world.life.pro < 1e-3 && boil.world.life.euk < 1e-3 && boil.world.time < 5e4,
      `${(boil.world.diag.Tmean - 273.15).toFixed(0)} C after ` +
      `${boil.world.time.toFixed(0)} yr, prokaryotes ${boil.world.life.pro.toExponential(1)} ` +
      `(was 1.00 for the next two million years)`);

    // ...and a snowball is not a sterilisation. Everything alive today came
    // through one, which is the strongest single argument for refugia there is.
    const ice = new Simulation({ ...EARTH, insolation: 0.75, co2Bar: 1e-6,
      outgassing: 0, startT: 250 });
    ice.runYears(2e6, 2e4);
    const early = ice.world.life.pro;
    ice.runYears(1.8e7, 5e4);                    // ...and twenty million more
    check('\u2026while a world that froze over keeps its prokaryotes',
      ice.world.diag.Tmean < 255 && ice.world.life.pro > 0.02
        && ice.world.life.pro >= early * 0.9,
      `${(ice.world.diag.Tmean - 273.15).toFixed(0)} C and ` +
      `${(ice.world.life.pro * 100).toFixed(1)}% still there after 20 Myr — ` +
      `under the ice, not on the surface, which reads ` +
      `${(Math.max(...ice.world.T) - 273.15).toFixed(0)} C at its warmest`);
  }

  // ---- 3o2b. a locked world is not charged twice for its night ---------------
  // The biosphere is scored on habitable area, which is right, but it used to
  // be scored against the whole globe -- and a tidally locked world has half a
  // globe the star can never reach. That half is dark in the model's physics
  // AND counted in the denominator as ground life failed to use, so a locked
  // world with a perfectly temperate, wet, sunlit day side could not read above
  // half of Earth however good it was.
  //
  // The two are not comparable as written. insolationProfile() hands a rotating
  // world its DIURNAL MEAN, so every band is lit and the night is already
  // averaged in; a locked world gets the instantaneous value. Integrated over
  // time and area they are level -- half the area lit always, against all of it
  // lit half the time, the same pi R^2 F -- and photosynthesis is light
  // saturated far below full sunlight, so what limits it is habitable area.
  {
    const rotating = ['preindustrial', 'waterworld', 'dune'].map((k) => {
      const w = settle({ ...PRESETS[k].params, biosphere: 1 }, 2e6).world;
      return [PRESETS[k].name, photosynthesis(w)];
    });
    // Every rotating world must be untouched by this: the dimmest band on Earth
    // still gets 204 W/m^2 and the `lit` threshold is half a watt, so the
    // denominator is exactly 1 and the arithmetic is identical to before.
    check('Scoring life by habitable area leaves every rotating world exactly as it was',
      rotating.every(([, p]) => Math.abs(p - 1) < 1e-9),
      rotating.map(([n, p]) => `${n} ${p.toFixed(3)}`).join(' · '));

    // And a locked world is now scored on the half of it that has a day.
    const eye = settle({ ...PRESETS.eyeball.params, biosphere: 1 }, 3e6).world;
    let lit = 0;
    for (let i = 0; i < NBANDS; i++) lit += smoothstep(0.05, 0.5, eye.diag.S[i]) / NBANDS;
    check('\u2026while a locked world is judged on the half of it the star reaches',
      lit < 0.6 && photosynthesis(eye) > 0.6,
      `${(lit * 100).toFixed(0)}% of the Locked Eyeball ever sees light and ` +
      `${(photosynthesis(eye) * 100).toFixed(0)}% of that is habitable — it read ` +
      `${(photosynthesis(eye) * lit * 100).toFixed(0)}% before, as though its night were a failure`);

    // The gates that should still kill a world still do. Carbon starvation is
    // the one that catches people out: switch volcanism off and weathering
    // draws the CO2 to nothing, and nothing photosynthesises without carbon,
    // however warm and wet the day side is.
    const starved = settle({ ...PRESETS.eyeball.params, biosphere: 1, outgassing: 0,
      co2Bar: 1e-7 }, 3e7).world;
    check('\u2026and a world with no carbon left is still dead, however sunlit and wet',
      photosynthesis(starved) === 0 && starved.water.ocean > 0.001,
      `${(starved.diag.pCO2 * 1e6).toFixed(2)} ppm CO\u2082 with ` +
      `${starved.water.ocean.toFixed(3)} EO of liquid water still there`);
  }

  // ---- 3o3. the Great Oxidation is a scenario you can lose --------------------
  // It used not to be. The biosphere sat at 0.2x for ever, below the 0.385x
  // where oxygen starts outrunning the volcanoes, so the event simply never
  // happened unless the player reached over and started it -- and doing nothing
  // was rewarded with a stable world, which is the opposite of the lesson.
  {
    const S = SCENARIOS.find((x) => x.id === 'oxidation');
    const play = (co2) => {
      const sim = new Simulation({ ...S.params, ...(co2 != null ? { co2Bar: co2 } : {}) });
      const w = sim.world;
      let n = 0;
      while (w.time < S.limit && n++ < 4e5) {
        if (S.evolve) w.params.biosphere = S.evolve(w);
        sim.stepOnce(Math.min(maxStep(w), 2e3));
        if (S.fail && S.fail(w)) return { r: 'lose', w };
        if (S.check(w)) return { r: 'win', w };
      }
      return { r: 'timeout', w };
    };

    check('Life takes off on its own, so the Great Oxidation happens without you',
      S.evolve && S.evolve({ time: 0 }) < 0.25 && S.evolve({ time: 3e8 }) > 0.95,
      `${S.evolve({ time: 0 }).toFixed(2)}× at the start, ` +
      `${S.evolve({ time: 1e7 }).toFixed(2)}× at 10 Myr, ` +
      `${S.evolve({ time: 3e8 }).toFixed(2)}× by the end — and it stops at Earth's own`);

    const idle = play(null);
    check('…so doing nothing loses the planet',
      idle.r === 'lose' && idle.w.diag.Tmean < 260,
      `frozen solid at ${(idle.w.diag.Tmean - 273.15).toFixed(0)} °C, ` +
      `${(idle.w.time / 1e6).toFixed(0)} Myr in`);

    const played = play(0.25);
    check('…and replacing the methane greenhouse with CO₂ first wins it',
      played.r === 'win' && played.w.diag.Tmean > 273,
      `oxygenated at ${(played.w.diag.Tmean - 273.15).toFixed(0)} °C with ` +
      `${played.w.diag.pO2.toExponential(1)} bar of O₂`);

    // The interesting part is that it is close. Too little CO2 and the ice wins
    // anyway, which is what makes it worth playing rather than a formality.
    check('…but only just: too little CO₂ and the ice still takes it',
      play(0.10).r !== 'win',
      'a hundred millibars is not enough to hold it above freezing');
  }

  // ---- 3p. the carbon budget ------------------------------------------------
  // Volcanoes cannot outgas carbon the planet does not have.
  {
    const bar = (m) => carbonBudget(m) * surfaceGravity(m) / 1e5;
    check('An Earth-mass world has ~400 bar of CO₂ worth of carbon in it',
      near(bar(1), 400, 60),
      `${bar(1).toFixed(0)} bar, against 210–850 from the two published routes ` +
      `(2.5e22–1e23 mol C, and a bulk-silicate mass fraction of 1.4e-4)`);

    // Scales with the mantle it is dissolved in, over the surface it has to
    // spread across. Mars really does have less carbon, and by about this much.
    check('…and a small world proportionally less, a large one more',
      bar(0.107) < 60 && bar(0.107) > 40 && bar(3.5) > 1000,
      `Mars-mass ${bar(0.107).toFixed(0)} bar · Venus-mass ${bar(0.815).toFixed(0)} · ` +
      `Earth ${bar(1).toFixed(0)} · 3.5 M⊕ ${bar(3.5).toFixed(0)}`);

    // The regression test for what prompted this. Left running, the outgassing
    // control used to be an infinite tap.
    const cooked = settle({ ...EARTH, insolation: 4, outgassing: 20 }, 5e9).world;
    check('Runaway outgassing stops at the budget instead of running away',
      cooked.diag.pCO2 < 1.05 * bar(1) && cooked.diag.pCO2 > 0.5 * bar(1)
        && cooked.diag.Tmean < 2500,
      `${cooked.diag.pCO2.toFixed(0)} bar and ${cooked.diag.Tmean.toFixed(0)} K, ` +
      `where it used to reach 24 000 bar and hit the 4000 K integrator clamp`);
    check('…having actually emptied the planet, not stopped for another reason',
      cooked.carbonDeep / carbonBudget(1) < 0.02,
      `${(cooked.carbonDeep / carbonBudget(1) * 100).toFixed(1)}% of the carbon left below`);

    // But it is a cycle, not a drain: weathering buries carbon that subduction
    // returns. Without that, Earth would exhaust its inventory in 800 Myr at
    // its own outgassing rate and the thermostat would simply stop.
    const old = settle({ ...EARTH }, 5e9).world;
    check('A working carbon cycle does not consume the planet',
      old.carbonDeep / carbonBudget(1) > 0.98 && old.diag.pCO2 * 1e6 > 100,
      `${(old.carbonDeep / carbonBudget(1) * 100).toFixed(1)}% still below after 5 Gyr, ` +
      `CO₂ steady at ${(old.diag.pCO2 * 1e6).toFixed(0)} ppm`);

    // Venus is the check that costs nothing: it is not tuned, and it lands on
    // the fraction its 92 bar implies.
    const venus = settle(PRESETS.venus.params, 2e7).world;
    const outgassed = 1 - venus.carbonDeep / carbonBudget(0.815);
    check('…and Venus has outgassed about the quarter of its carbon it should have',
      outgassed > 0.15 && outgassed < 0.45,
      `${(outgassed * 100).toFixed(0)}% of a ${bar(0.815).toFixed(0)} bar budget is in the air`);
  }

  // ---- 4. snowball, and its hysteresis -------------------------------------
  {
    const cold = settle({ ...EARTH, co2Bar: 1e-6, startT: 240 }, 5e4);
    check('Stripping CO₂ freezes the planet over',
      cold.world.diag.iceMean > 0.9, `${(cold.world.diag.iceMean * 100).toFixed(0)}% ice`);

    // the same 280 ppm that supports a temperate Earth cannot thaw a snowball
    const stuck = new Simulation({ ...EARTH, co2Bar: 280e-6, startT: 235, outgassing: 0 });
    stuck.runYears(2e5);
    check('Hysteresis: 280 ppm cannot melt a snowball that already exists',
      stuck.world.diag.iceMean > 0.9, `${(stuck.world.diag.iceMean * 100).toFixed(0)}% ice`);

    // let volcanoes work and it should escape, on a geological timescale
    const thaw = new Simulation({ ...EARTH, co2Bar: 1e-6, startT: 235, outgassing: 1 });
    let tThaw = null, co2AtThaw = 0;
    while (thaw.world.time < 3e8) {
      if (thaw.world.diag.iceMean < 0.5) { tThaw = thaw.world.time; co2AtThaw = thaw.world.diag.pCO2; break; }
      thaw.runYears(2e4);
    }
    check('Volcanic CO₂ eventually breaks the snowball', tThaw !== null,
      tThaw ? `at ${(tThaw / 1e6).toFixed(1)} Myr with ${co2AtThaw.toFixed(3)} bar CO₂` : 'still frozen at 300 Myr');
    // A known gap, asserted at the model's own value so it still works as a
    // regression guard, with the literature number in the message so nobody
    // reads it as agreement. A semi-grey scheme has no atmospheric window --
    // every watt leaving the ground goes out through one optical depth -- so
    // piling on CO2 always works, and deglaciation comes ~30x too easily.
    //
    // This used to be invisible. Duration is threshold over outgassing flux, and
    // the outgassing constant had been set a hundred and thirty times below
    // Earth's measured degassing rate, which put the *duration* back into the
    // literature range and left the whole carbon cycle a hundred times too slow
    // as a side effect nothing was watching. Outgassing is on its measured value
    // now, so the error shows up in the duration below, where it can be seen.
    check('Deglaciation comes ~30× too easily (semi-grey, no window)',
      tThaw !== null && co2AtThaw > 4e-3 && co2AtThaw < 3e-2,
      `${(co2AtThaw * 1e3).toFixed(0)} mbar, where the snowball studies find 100–300`);
    check('…and so lasts ~0.2 Myr rather than the observed few Myr',
      tThaw !== null && tThaw > 5e4 && tThaw < 1e6,
      tThaw ? `${(tThaw / 1e6).toFixed(2)} Myr, short by exactly the factor the ` +
        `threshold above is low by (Marinoan 4–15, Sturtian ~56)` : 'n/a');
  }

  // ---- 5. dry planets have a wider habitable zone (Abe et al. 2011) ---------
  {
    // Where each kind of world tips over, found rather than assumed. Testing one
    // fixed insolation is fragile: it passed until a refit moved the dune edge
    // from 1.52 to 1.50 S⊕ and the chosen 1.5 landed exactly on it, which says
    // nothing about whether the physics is right.
    const edgeOf = (mk) => {
      let lo = 0.8, hi = 2.6;
      for (let i = 0; i < 8; i++) {
        const m = (lo + hi) / 2;
        if (settle(mk(m), 1e6).world.diag.Tmean > 400) hi = m; else lo = m;
      }
      return (lo + hi) / 2;
    };
    const wetEdge = edgeOf((S) => ({ ...EARTH, insolation: S }));
    const dryEdge = edgeOf((S) => ({ ...EARTH, insolation: S, water: 0.03, landFraction: 0.98 }));
    check('An ocean world runs away at 1.2–1.4 S⊕ (Kopparapu 2013)',
      wetEdge > 1.15 && wetEdge < 1.45, `${wetEdge.toFixed(2)} S⊕`);
    check('…and a dune world survives markedly closer in (Abe 2011)',
      dryEdge > wetEdge + 0.15, `${dryEdge.toFixed(2)} S⊕, ${(dryEdge - wetEdge).toFixed(2)} further in`);

    // Below both edges, the dry world's unsaturated air keeps its water.
    const S = Math.min(wetEdge, dryEdge) - 0.06;
    const lossOf = (w) => (w.escape.water * 1e9) / w.diag.d.eoColumn;
    const wet = settle({ ...EARTH, insolation: S }, 1e6).world;
    const dry = settle({ ...EARTH, insolation: S, water: 0.03, landFraction: 0.98 }, 1e6).world;
    check('…and a dry stratosphere throttles water loss',
      lossOf(dry) < 0.35 * lossOf(wet),
      `at ${S.toFixed(2)} S⊕: ${lossOf(dry).toExponential(1)} against ${lossOf(wet).toExponential(1)} EO/Gyr`);
  }

  // ---- 6. tidally locked worlds -------------------------------------------
  {
    const eye = settle(PRESETS.eyeball.params, 1e6);
    const id = classify(eye.world).id;
    check('A tidally locked ocean world makes an eyeball / lobster state',
      id === 'eyeball' || id === 'lobster', classify(eye.world).name);
    const T = eye.world.T;
    check('…with the substellar point far warmer than the antistellar',
      T[NBANDS - 1] - T[0] > 15, `${(T[NBANDS - 1] - T[0]).toFixed(0)} K contrast`);
  }

  // ---- 7. frame-rate independence -----------------------------------------
  {
    const mk = () => { const s = new Simulation({ ...EARTH, insolation: 1.2, co2Bar: 0.01 }); s.rate = 5e4; return s; };
    const a = mk(), b = mk(), c = mk();
    for (let i = 0; i < 900; i++) a.advance(1 / 90);      // 90 fps
    for (let i = 0; i < 150; i++) b.advance(1 / 15);      // 15 fps
    // ugly real-world frame pacing, including a stall, same total elapsed time
    let acc = 0, seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    while (acc < 10) { const dt = Math.min(0.005 + rnd() * 0.09, 10 - acc); c.advance(dt); acc += dt; }

    let dAB = 0, dAC = 0;
    for (let i = 0; i < NBANDS; i++) {
      dAB = Math.max(dAB, Math.abs(a.world.T[i] - b.world.T[i]));
      dAC = Math.max(dAC, Math.abs(a.world.T[i] - c.world.T[i]));
    }
    check('90 fps and 15 fps trace the identical trajectory',
      dAB < 0.1, `max ΔT = ${dAB.toExponential(2)} K over ${a.world.time.toFixed(0)} sim-yr`);
    check('Irregular frame pacing changes nothing',
      dAC < 0.1, `max ΔT = ${dAC.toExponential(2)} K`);
    // Any credit too small to pay for a whole step is carried, not lost, so the
    // three runs can differ by up to one step's worth of unspent time.
    const spread = Math.max(a.world.time, b.world.time, c.world.time)
                 - Math.min(a.world.time, b.world.time, c.world.time);
    check('All three advanced the same simulated time (to within one step)',
      spread < 0.01 * a.world.time,
      `${a.world.time.toFixed(0)} / ${b.world.time.toFixed(0)} / ${c.world.time.toFixed(0)} yr`);
  }

  // ---- 7b. land and ocean coverage follow the water ------------------------
  {
    const REF = 2.744751e6;   // one Earth ocean as a column, kg/m²
    const overflow = floodedFraction(12 * REF, 1, REF);
    check('Twelve Earth oceans overtop even maximal basin geometry',
      overflow > 0.999,
      `${(overflow * 100).toFixed(2)}% of the surface flooded`);

    let worstCal = 0;
    for (const L of [0, 0.1, 0.3, 0.5, 0.7, 0.8]) {
      worstCal = Math.max(worstCal, Math.abs(floodedFraction(REF, L, REF) - (1 - L)));
    }
    check('One Earth ocean follows the basin calibration while its depth is physical',
      worstCal < 1e-12, `worst error ${worstCal.toExponential(1)}`);

    const finiteAtOne = floodedFraction(REF, 1, REF);
    const finiteExpected = REF / (1000 * MAX_BASIN_DEPTH);
    check('Maximal high ground still has finite-depth basins',
      Math.abs(finiteAtOne - finiteExpected) < 1e-12,
      `1 EO floods ${(finiteAtOne * 100).toFixed(2)}% at the ${MAX_BASIN_DEPTH / 1000} km depth bound`);

    const duneBefore = 0.02 * Math.pow(0.03, 0.25);
    const duneAfter = floodedFraction(0.03 * REF, 0.98, REF);
    check('The finite-depth bound leaves Dune World coverage unchanged',
      Math.abs(duneAfter - duneBefore) < 1e-12,
      `${(duneAfter * 100).toFixed(2)}% flooded`);

    let mono = true, bounded = true;
    for (const L of [0, 0.3, 0.8, 0.98, 1]) {
      let prev = -1;
      for (let i = 0; i <= 4000; i++) {
        const f = floodedFraction((i / 200) * REF, L, REF);
        if (f < prev - 1e-15) mono = false;
        if (f < 0 || f > 1) bounded = false;
        prev = f;
      }
    }
    check('Flooded fraction rises with water and never leaves [0, 1]',
      mono && bounded, 'swept 0–20 Earth oceans across five basin geometries');

    let worstInverse = 0;
    for (const L of [0, 0.3, 0.8, 0.98, 1]) {
      for (const f of [1e-4, 0.01, 0.1, 0.5, 0.99, 1]) {
        const water = waterForFlooded(f, L, REF);
        worstInverse = Math.max(worstInverse,
          Math.abs(floodedFraction(water, L, REF) - f));
      }
    }
    check('Water-for-coverage remains the inverse on every depth branch',
      worstInverse < 1e-10, `worst error ${worstInverse.toExponential(1)}`);

    // Boiling a world dry must uncover its seafloor.
    const boil = new Simulation({ ...EARTH, insolation: 2.6, xuvFraction: 1e-3 });
    let landPeak = 0;
    while (boil.world.time < 3e9) {
      landPeak = Math.max(landPeak, boil.world.diag.landFrac);
      if (landPeak > 0.999) break;
      boil.runYears(Math.max(10, boil.world.time * 0.05));
    }
    check('Boiling the ocean drives land coverage to 100%',
      landPeak > 0.999, `reached ${(landPeak * 100).toFixed(1)}% land`);
    check('…and vapour in the air no longer counts as sea',
      boil.world.diag.flooded < 0.01 && boil.world.water.vapour + boil.world.water.lost > 0.5,
      `${(boil.world.diag.flooded * 100).toFixed(2)}% ocean with ${boil.world.water.vapour.toFixed(2)} EO aloft`);

    // Freezing must not: sea ice floats, so the basins stay covered.
    const froze = new Simulation({ ...EARTH, co2Bar: 1e-6, startT: 235, outgassing: 0 });
    froze.runYears(2e5);
    const fd = froze.world.diag;
    check('A frozen ocean still fills its basin',
      fd.flooded > 0.6 && fd.seaIceFrac > 0.6,
      `${(fd.flooded * 100).toFixed(0)}% flooded, ${(fd.seaIceFrac * 100).toFixed(0)}% sea ice`);
    check('…while its continents stay largely bare, the water cycle having stopped',
      fd.landIceFrac < 0.2 && fd.landFrac > 0.25,
      `${(fd.landIceFrac * 100).toFixed(0)}% of the surface is land ice`);
  }

  // ---- 7c. phase limits and honest labelling -------------------------------
  {
    const earthNow = settle(EARTH, 2e7);
    check('Earth reaches ~1013 mbar of surface pressure',
      Math.abs(earthNow.world.diag.pTotMean * 1000 - 1013) < 40,
      `${(earthNow.world.diag.pTotMean * 1000).toFixed(0)} mbar`);

    // Below the triple point (611.7 Pa) liquid water cannot exist at all.
    // Volcanoes off. With outgassing on its measured value the carbon cycle is a
    // hundred times faster than it used to be, and a live volcano rebuilds enough
    // CO2 in two hundred thousand years to carry this world back over the triple
    // point -- a real answer, but to a different question than this one.
    const thin = settle({ ...EARTH, n2Bar: 2e-3, o2Bar: 0, biosphere: 0, co2Bar: 1e-5, water: 0.3, insolation: 1.0, outgassing: 0 }, 2e5);
    check('No liquid water below the triple point',
      thin.world.diag.pSurfPa < 611.7 && thin.world.diag.openOcean < 1e-6,
      `${thin.world.diag.pSurfPa.toFixed(0)} Pa, open water ${(thin.world.diag.openOcean * 100).toFixed(2)}%`);
    // Deliberately the same air as `thin`, so the only thing that differs is the
    // starlight and the vapour it raises. At 5e-4 bar the pair sat on the triple
    // point itself and the answer depended on the integrator's step sequence.
    const justAbove = settle({ ...EARTH, n2Bar: 2e-3, o2Bar: 0, biosphere: 0, co2Bar: 1e-5, water: 0.3, insolation: 1.3, outgassing: 0 }, 2e5);
    check('…but liquid returns once the pressure clears it',
      justAbove.world.diag.pSurfPa > 611.7 && justAbove.world.diag.openOcean > 0.05,
      `${justAbove.world.diag.pSurfPa.toFixed(0)} Pa, open water ${(justAbove.world.diag.openOcean * 100).toFixed(0)}%`);

    // A collapsed atmosphere is escapable: enough outgassing thickens the air,
    // warms the poles past the CO2 frost point and puts it back (Forget et al.).
    // Mars-like insolation, which is where the Forget result applies. At 0.15 S⊕
    // the planet is so cold that CO2 really does hit its frost point and collapse
    // however hard the volcanoes work -- correct physics, but not a test of this
    // claim.
    const cold = { ...EARTH, insolation: 0.30, water: 0.05, landFraction: 0.9, co2Bar: 0.01 };
    const quiet = settle({ ...cold, outgassing: 0.1 }, 2e7);
    const busy = settle({ ...cold, outgassing: 1000 }, 2e7);
    check('CO₂ does not freeze out regardless of volcanism — outgassing can win',
      busy.world.diag.pCO2 > 20 * quiet.world.diag.pCO2 && busy.world.diag.Tmean > quiet.world.diag.Tmean + 50,
      `${quiet.world.diag.pCO2.toFixed(3)} bar / ${quiet.world.diag.Tmean.toFixed(0)} K  →  ` +
      `${busy.world.diag.pCO2.toFixed(2)} bar / ${busy.world.diag.Tmean.toFixed(0)} K`);

    // A wet runaway must actually settle. Relative humidity used to be driven by
    // how much open sea was left, while how much open sea was left was driven by
    // relative humidity: once the ocean was in the air the two chased each other
    // between 43% flooded and bone dry on alternating steps, a period-two
    // flip-flop worth +-16 W/m^2 that never converged. The physics was wrong --
    // a planet whose ocean has evaporated is not arid, its atmosphere is the
    // ocean -- and the step controller, seeing a climate lurching sixteen watts
    // a step, cut the step to tens of years and stayed there. A wet runaway ran
    // at a hundredth of the speed of every other state.
    {
      const run = settle({ ...EARTH, co2Bar: 1 }, 3e4);
      const wet = run.world;
      const seen = [];
      for (let i = 0; i < 12; i++) { run.stepOnce(200); seen.push(wet.diag.imbalance); }
      const swing = Math.max(...seen) - Math.min(...seen);
      check('A wet runaway settles instead of flip-flopping between wet and dry',
        swing < 1.0, `energy balance varies by ${swing.toFixed(2)} W/m² over twelve steps`);

      let least = Infinity;
      for (let i = 0; i < 40; i++) { run.stepOnce(Math.min(maxStep(wet), 5e6)); least = Math.min(least, maxStep(wet)); }
      check('...so the clock can still run fast inside one',
        least > 1e4, `smallest step ${least.toExponential(1)} yr`);
    }

    // A stable climate mode near a tipping point must not be turned into an
    // alternating numerical mode by a long backward-Euler step. Early Venus
    // approaches its moist-greenhouse transition with a positive-definite
    // coupled Jacobian, yet the old radiative-mean gate forced raw steps that
    // reversed the temperature tendency almost every time. It took thousands
    // of solves to make one kelvin of net progress while every individual move
    // was only hundredths of a kelvin.
    {
      const venus = new Simulation({ ...PRESETS.earlyVenus.params });
      venus.runYears(2.145e9, 5e6);
      const vw = venus.world, t0 = vw.time;
      let reversals = 0, previous = 0, T0 = vw.diag.Tmean;
      for (let i = 0; i < 1000; i++) {
        venus.stepOnce(Math.min(maxStep(vw), 5e6));
        const direction = Math.sign(vw.diag.Tmean - T0);
        if (direction && previous && direction !== previous) reversals++;
        if (direction) previous = direction;
        T0 = vw.diag.Tmean;
      }
      const advanced = vw.time - t0;
      check('A stable climate transition advances instead of chattering',
        reversals < 100 && advanced > 5e6,
        `${reversals} reversals in 1000 steps, ${advanced.toExponential(1)} yr advanced`);
    }

    // ...and so must a tidally locked world that is not doing anything.
    //
    // FAILING, and left failing deliberately. What follows is the whole of an
    // attempt on it, so that the next one starts where this stopped instead of
    // rediscovering the same four dead ends.
    //
    // THE CRAWL. The night side of a locked planet is frozen for ever and sea
    // ice insulates the water beneath it, so those bands run on land's heat
    // capacity -- about 1.1e7 J/m^2/K, shed in under two months. A band a fifth
    // of a kelvin from its equilibrium reports four and a half kelvin a year,
    // and the accuracy bound, which reads the rate and not the distance, cut
    // the step to half a year for it. What came out was a period-twelve limit
    // cycle in the *solver* on a planet standing still: five steps of two to
    // five years, one quasi-static stride of about a thousand, the stride
    // nudging the night side two tenths of a kelvin, then five more small steps
    // walking it back. Two hundred and forty years a step against Earth's
    // hundred and seventy thousand.
    //
    // WHY THE OBVIOUS FIX IS RIGHT, AND STILL NO GOOD. maxStep divides the
    // distance-from-equilibrium by the RADIATIVE damping alone. A band is also
    // held by transport from its neighbours, and on a locked world -- thick air,
    // no rotation to speak of -- D is 2.63 against Earth's 0.44 and the edge
    // conductances run 45 to 423 W/m^2/K, up to 180x the 2.4 of radiation.
    // Every band sits within a seventh of a kelvin of where it is going and the
    // estimate called the substellar band 118 K away: wrong by three orders of
    // magnitude, in the direction that makes the clock crawl. Using the solver's
    // own diagonal instead -- max(k, -0.4*wsum - 0.05) + wsum -- is correct on
    // its face and takes this world to 5e9 simulated years a second.
    //
    // It also takes the volcanism ladder off a cliff: 2.8x, 3.5x and 8x Earth's
    // outgassing all land in a 531 C steam greenhouse that a two-thousand-year
    // cap does not find. tools/convergence.mjs is what measures this, and its
    // criterion is the grid-refinement one -- do the three FINEST caps agree --
    // because judging the full spread calls a world unconverged for a wobble at
    // a five-million-year cap and hides the failures that are hundreds of
    // kelvin wide.
    //
    // WHAT IS ACTUALLY UNDERNEATH IT. Water vapour is the strongest and fastest
    // greenhouse reservoir in the model and it is the only one with no bound at
    // all -- the column is diagnostic, set by saturation, so it was never
    // treated as a reservoir that could outrun a step. It moves anyway:
    // Clausius-Clapeyron is about seven percent per kelvin near 288 K, so the
    // 2.5 K the accuracy bound allows is an eighteen percent swing in it, taken
    // with the radiative transfer treating it as fixed throughout. At eight
    // times Earth's volcanism the anoxic transition was being crossed in steps
    // that moved the temperature 5.2 K when the bound had called them 2.5, with
    // the vapour column moving 27% at a time -- and, once the accuracy bound was
    // relaxed, 9.8 K and 85% in single five-million-year strides.
    //
    // A bound on it (a tenth of the column per step, weighted by the column that
    // is really there, and only where the air is saturated -- where every drop
    // is already airborne the column is mass-limited and cannot respond at all,
    // the same distinction radiativeDamping draws) restores convergence
    // completely: 0.01 K across the whole ladder, better than this model has
    // ever measured. It costs a factor of 35. The knife-edge is between a
    // coefficient of 0.3, which converges, and 1.0, which does not.
    //
    // THE RESULT, WHICH IS THE PART WORTH KEEPING. Measured from t = 0, the way
    // a player meets it, the SHIPPED code runs this world at 1.31e7 simulated
    // years a second and every fixed version of it at 3.7e5. The crawl is load
    // bearing. It is not protecting nothing -- it is holding the step short
    // enough that an unbounded water-vapour column cannot outrun it, and every
    // way found to remove the crawl costs more than the crawl does. Two traps
    // on the way, both worth naming: gating the quasi-static shortcut on how
    // much ice there is (rather than whether the edge is moving) keeps it
    // permanently off on a locked world, whose night side is permanently
    // frozen; and the early return when `worst` is zero jumps the queue past
    // every reservoir bound below it, which is worth 522 K on its own and makes
    // every other bound look as though it does nothing.
    //
    // So: the thing to fix first is that water vapour is unbounded. The speed
    // is downstream of it and is not buyable on its own.
    {
      // EXPECTED FAILURE. The coupled equilibrium check below is deliberately
      // conservative enough to keep the volcanism ladder and the night-side
      // cold trap on their converged branches. It improves the original crawl,
      // but does not yet buy the unsafe diagonal shortcut's multi-kyr stride.
      // Keep this red until that remaining performance gap is closed without
      // changing either trajectory.
      const locked = settle({ ...EARTH, mass: 1.3, landFraction: 0.25, water: 0.412506,
        insolation: 1.122, xuvFraction: 5e-4, rotationHours: 264, tidallyLocked: true,
        n2Bar: 0, o2Bar: 0.224973, co2Bar: 0.0476703, ch4Bar: 1.23e-7, startT: 270 }, 1.4e6);
      const lw = locked.world;
      const t0 = lw.time;
      for (let i = 0; i < 240; i++) locked.stepOnce(Math.min(maxStep(lw), 5e6));
      const per = (lw.time - t0) / 240;
      check('A settled tidally locked world does not crawl',
        per > 5e3, `${per.toExponential(1)} yr per step`);
    }

    // A hot dry world must not be called frozen.
    const baked = settle({ ...EARTH, tidallyLocked: true, rotationHours: 2000, insolation: 1.6,
                           water: 0.005, landFraction: 0.9, n2Bar: 0.3 }, 1e6);
    check('A hot waterless world is not labelled frozen',
      baked.world.diag.Tmean > 350 && classify(baked.world).id !== 'frozen',
      `${(baked.world.diag.Tmean - 273.15).toFixed(0)} °C → ${classify(baked.world).name}`);
  }

  // ---- 7d. saves that leave this browser -----------------------------------
  // The address bar already carries one world and still does; this is the other
  // thing, which is a whole set at once and somewhere that is not localStorage
  // -- a place saves go to die whenever a browser clears site data.
  {
    const world = (n) => ({ v: 1, at: 0, name: n, params: { ...EARTH }, seed: 1,
      time: 1e6, T: [288], water: { ocean: 1 } });

    // Round trip, which is the whole contract.
    const doc = buildSaveFile([1, 2, 3, 4, 5].map((i) => ({ slot: i, ...world(`W${i}`) })), 0);
    const back = parseSaveFile(JSON.stringify(doc));
    check('A file of saves reads back as the worlds that went into it',
      back && back.length === SLOTS && back[3].name === 'W4' && back[0].params.co2Bar === EARTH.co2Bar,
      `${back ? back.length : 0} worlds, names ${back ? back.map((w) => w.name).join(' ') : '—'}`);

    // Importing is a MERGE. This is the rule that stops someone else's file
    // taking your saves with it, and it is the one worth pinning hardest.
    {
      const occupied = new Set([4, 5]);          // you already have two worlds
      const file = [1, 2, 3].map((i) => ({ slot: i, ...world(`theirs${i}`) }));
      const { writes, skipped } = planImport(file, (i) => !occupied.has(i), SLOTS);
      const touched = writes.map((wr) => wr.slot).sort();
      check('Importing merges: slots the file does not name are left alone',
        skipped === 0 && touched.join() === '1,2,3',
        `wrote ${touched.join(', ')}; 4 and 5 untouched`);
    }

    // A world with no slot number takes the first free one, and two of them
    // cannot land on the same slot.
    {
      const occupied = new Set([1, 2]);
      const file = [world('a'), world('b'), world('c')];
      const { writes, skipped } = planImport(file, (i) => !occupied.has(i), SLOTS);
      check('\u2026and unnumbered worlds fill the free slots, one each',
        skipped === 0 && writes.map((wr) => wr.slot).join() === '3,4,5',
        `three unnumbered worlds landed in ${writes.map((wr) => wr.slot).join(', ')}`);
    }

    // And when there is nowhere left, it says so rather than overwriting.
    {
      const file = [world('a'), world('b')];
      const { writes, skipped } = planImport(file, () => false, SLOTS);
      check('\u2026and with every slot full it reports rather than overwrites',
        writes.length === 0 && skipped === 2,
        `${skipped} worlds had nowhere to go, nothing was overwritten`);
    }

    // Not everything with a .json on it is a save.
    check('Anything that is not a save file is refused',
      parseSaveFile('not json at all') === null
      && parseSaveFile('{"hello":"world"}') === null
      && parseSaveFile('[]') === null
      && parseSaveFile('[{"name":"no params here"}]') === null,
      'bad JSON, wrong shape, empty list and a world with no params all rejected');

    // Liberal in what it accepts, because people hand-edit these.
    check('\u2026but a bare array, or a single world on its own, still reads',
      parseSaveFile(JSON.stringify([world('solo')]))?.length === 1
      && parseSaveFile(JSON.stringify(world('alone')))?.length === 1,
      'array form and single-world form both parse');
  }

  // ---- 7e. standing in a world\u2019s own past -------------------------------
  // Dragging the temperature chart puts the simulation back into a state it was
  // actually in, so that a slider moved from there sends it somewhere else.
  //
  // The property that has to hold is that going back is EXACT: a world restored
  // to a moment and run on must arrive exactly where it would have arrived
  // without the detour. Anything less and the scrubber is quietly a different
  // simulation, and so is every save slot, since they share this snapshot.
  {
    const P = { ...EARTH, insolation: 0.94, outgassing: 1 };
    const state = (w) => [w.diag.Tmean, w.diag.pCO2, w.diag.iceMean, w.water.ocean,
                          w.carbonDeep, w.ch4, w.o2, w.iceSheet];

    const a = new Simulation({ ...P });
    a.runYears(3e5, 2e3);
    const snap = captureWorld(a.world);
    a.runYears(7e5, 2e3);
    const straight = state(a.world);

    const b = new Simulation({ ...P });
    applyWorld(b, snap, { ...snap.params });
    b.runYears(7e5, 2e3);
    const rewound = state(b.world);

    // Exactly equal, not nearly. The stepper is deterministic, so any drift at
    // all means the snapshot is missing something -- dropping carbonDeep alone
    // moves the mantle by 50 kg/m\u00b2 over this span, which is what this catches.
    check('A world put back into its own past arrives exactly where it would have',
      straight.every((v, i) => v === rewound[i]),
      `${straight.length} state variables identical after 700 kyr, ` +
      `${(a.world.diag.Tmean - 273.15).toFixed(4)} \u00b0C either way`);

    // And the point of it: the same moment, one thing changed, another fate.
    const c = new Simulation({ ...P });
    applyWorld(c, snap, { ...snap.params, insolation: 0.80 });
    c.runYears(7e5, 2e3);
    check('\u2026and one thing changed from there sends it somewhere else',
      c.world.diag.iceMean > 0.9 && a.world.diag.iceMean < 0.5,
      `from the same moment: 0.94 S\u2295 \u2192 ${(a.world.diag.Tmean - 273.15).toFixed(0)} \u00b0C ` +
      `and ${(a.world.diag.iceMean * 100).toFixed(0)}% ice, 0.80 S\u2295 \u2192 ` +
      `${(c.world.diag.Tmean - 273.15).toFixed(0)} \u00b0C and ` +
      `${(c.world.diag.iceMean * 100).toFixed(0)}% ice`);
  }

  // ---- 7f. which moment a click lands on ------------------------------------
  {
    const pts = [0, 10, 100, 1000, 10000].map((t) => ({ time: t }));
    check('Going back lands on the latest moment at or before the click',
      findRestore(pts, 500).time === 100 && findRestore(pts, 1000).time === 1000
      && findRestore(pts, 1e9).time === 10000,
      'a click between two points goes to the earlier one — a world can only be '
      + 'put back into a moment it was actually in');
    check('\u2026and clicking before the run began goes as far back as it goes',
      findRestore(pts, -5).time === 0 && findRestore([], 5) === null,
      'earliest point, and nothing at all on a world with no past yet');

    // Thinning, tested against the schedule the simulation really samples on --
    // t += max(1, t*0.02), so points are geometric in time. Testing it with
    // evenly spaced integers, which was the first attempt, hides the entire
    // problem: it is the interaction between geometric spacing and repeated
    // halving that opens the gaps.
    //
    // What matters is the worst gap as a share of the CHART, since that is what
    // a drag crosses. Two earlier versions of this left a gap of two thirds of
    // the width -- most of the run with nothing to land on.
    {
      let worst = 0, fewest = Infinity;
      for (const span of [1e6, 1e8, 2.2e9, 1e10]) {
        const ring = [];
        for (let t = 1; t < span; t += Math.max(1, t * 0.02)) {
          pushRestore(ring, { time: t }, RESTORE_CAP);
        }
        const L = ring.map((p) => Math.log10(p.time + 1));
        const axis = L[L.length - 1] - L[0];
        for (let i = 1; i < L.length; i++) worst = Math.max(worst, (L[i] - L[i - 1]) / axis);
        fewest = Math.min(fewest, ring.length);
      }
      check('Moments stay spread across the whole run, not bunched at one end',
        worst < 0.05 && fewest >= RESTORE_CAP / 2 - 1,
        `over runs of 1 Myr to 10 Gyr the widest gap is ${(worst * 100).toFixed(1)}% ` +
        `of the chart, with at least ${fewest} moments kept`);
    }

    const fut = [0, 10, 100, 1000].map((t) => ({ time: t }));
    truncateAfter(fut, 100);
    check('\u2026and changing something drops the future it is replacing',
      fut.length === 3 && fut[fut.length - 1].time === 100,
      'a world has one history, not a tree of them — save a slot to keep the other');
  }

  // ---- 8. the controls: typed values and slider round-trips ----------------
  {
    const by = (k) => SLIDERS.find((d) => d.key === k);
    const cases = [
      ['co2Bar', '420ppm', 280e-6, 420e-6], ['co2Bar', '420', 280e-6, 420e-6],
      ['co2Bar', '0.5 bar', 0.02, 0.5],     ['co2Bar', '1%', 280e-6, 0.01],
      ['n2Bar', '800 mbar', 0.79, 0.8],     ['n2Bar', '1 atm', 0.79, 1.01325],
      ['water', '0.5 EO', 1, 0.5],          ['water', 'none', 1, 0],
      ['landFraction', '30%', 0.3, 0.3],    ['landFraction', '45', 0.3, 0.45],
      ['rotationHours', '2 days', 24, 48],  ['rotationHours', '1 yr', 24, 8766],
      ['insolation', '1.5', 1, 1.5],        ['xuvFraction', '100x', 3.4e-6, 3.4e-4],
      ['obliquity', '23.5°', 23.5, 23.5],   ['outgassing', '3×', 1, 3],
    ];
    let bad = null;
    for (const [k, typed, cur, want] of cases) {
      const got = parseValue(by(k), typed, cur);
      if (got === null || Math.abs(got - want) > Math.abs(want) * 1e-6 + 1e-12) {
        bad = `${k} "${typed}" -> ${got}, wanted ${want}`; break;
      }
    }
    check('Typed values parse, with units and sensible defaults', !bad, bad || `${cases.length} forms`);
    check('Nonsense input is rejected rather than guessed at',
      parseValue(by('co2Bar'), 'garbage', 280e-6) === null, 'returns null');

    let worst = 0, worstKey = '';
    for (const d of SLIDERS) {
      for (const v of [d.zero ? 0 : d.min, d.min, (d.min + d.max) / 2, d.max]) {
        const back = fromSlider(d, toSlider(d, v));
        const err = Math.abs(back - v) / (Math.abs(v) || 1);
        if (err > worst) { worst = err; worstKey = d.key; }
      }
    }
    // Dragging to a value and typing the same value must give the same planet.
    // The slider has a thousand positions, so on a logarithmic control that is
    // half a percent a step: the position nearest "1.200 S⊕" really set 1.1975,
    // about a watt per square metre of starlight, which near a threshold
    // decides the outcome.
    let mismatch = null, checked = 0;
    for (const d of SLIDERS) {
      for (let pos = 0; pos <= 1000 && !mismatch; pos += 1) {
        const v = snapToDisplay(d, fromSlider(d, pos));
        const typed = parseValue(d, d.fmt(v), v);
        const rel = typed === null ? 1 : v === 0 ? Math.abs(typed) : Math.abs(typed - v) / Math.abs(v);
        checked++;
        if (rel > 1e-9) mismatch = `${d.key}: the slider reads "${d.fmt(v)}" but holds ${v}, while typing that gives ${typed}`;
      }
    }
    check('Dragging a slider to a value equals typing that value', !mismatch,
      mismatch || `${checked} slider positions`);

    // ...and so does every value in every preset, which is the general form of
    // the same bug and the one that was actually shipped. A preset that carries
    // a number its own slider cannot represent shows the wrong value the moment
    // it is loaded, and snaps the world somewhere else the first time anyone
    // touches that control. Pre-industrial Earth's 0.8 ppm of methane and the
    // Snowball's 10 ppm of CO2 were both doing this.
    {
      const bad = [];
      for (const [id, preset] of Object.entries(PRESETS)) {
        for (const d of SLIDERS) {
          const v = preset.params[d.key];
          if (typeof v !== 'number' || !isFinite(v)) continue;
          if (v < d.min || v > d.max) { bad.push(`${id}.${d.key}=${v} out of range`); continue; }
          const back = fromSlider(d, toSlider(d, v));
          const rel = v === 0 ? Math.abs(back) : Math.abs(back - v) / Math.abs(v);
          if (rel > 5e-3) bad.push(`${id}.${d.key} ${v} → ${back.toExponential(3)}`);
        }
      }
      check('\u2026and every value in every preset is one its slider can hold',
        bad.length === 0,
        bad.length ? bad.slice(0, 5).join(', ') + (bad.length > 5 ? ` (+${bad.length - 5})` : '')
          : `${Object.keys(PRESETS).length} presets across ${SLIDERS.length} controls`);
    }

    // No scenario may be won by doing nothing.
    //
    // Three of the eight were. "Break the Snowball" started with the volcanoes
    // already at Earth's rate, so it congratulated you 200 kyr in for touching
    // nothing; the Great Oxidation had exactly this bug before and has a
    // paragraph in scenarios.js about it; and "The Hot Ocean" was the opposite
    // failure -- unwinnable rather than free, because with its volcanoes dead it
    // stripped its own CO2 and was 90% ice inside eight hundred thousand years.
    //
    // A scenario is a question. If the answer is "wait", it is not one.
    //
    // Each is run to its own limit with nothing touched, applying its `evolve`
    // if it has one, because that is the part that is *supposed* to happen by
    // itself. Reaching `fail` is a fine outcome here -- several are designed to
    // kill you if ignored, which is the same statement.
    {
      const idle = [];
      for (const sc of SCENARIOS) {
        const sim = new Simulation({ ...sc.params });
        const w = sim.world;
        let g = 0, won = false;
        while (w.time < sc.limit && g++ < 3e5) {
          sim.stepOnce(Math.min(maxStep(w), 5e6, sc.limit - w.time));
          if (sc.evolve) w.params.biosphere = sc.evolve(w);
          if (sc.check(w)) { won = true; break; }
          if (sc.fail && sc.fail(w)) break;
        }
        if (won) idle.push(`${sc.id} at ${(w.time / 1e6).toFixed(1)} Myr`);
      }
      check('No scenario is won by doing nothing',
        idle.length === 0,
        idle.length ? `won unattended: ${idle.join(', ')}`
          : `${SCENARIOS.length} scenarios, every one needs an act`);
    }

    // Fast physics has to give the same planet, not merely a fast one.
    //
    // The switch stops re-deriving the radiative state in the middle of a step,
    // so every rate in the step is evaluated at the state it began in. That is a
    // real approximation and it moves the answers; what it must not do is move
    // them somewhere else entirely. A mode that ran a world into a different
    // climate would be worthless however fast it was, and "about the same, a bit
    // quicker" is the whole of what is being offered.
    //
    // Graded on the two things a player would actually notice: what the world is
    // called, and how warm it is. Five kelvin is generous against the hundreds
    // that separate the climates this model has, and tight enough that a mode
    // quietly walking a planet somewhere else could not hide in it.
    {
      const both = (id) => ['exact', 'fast'].map((m) => {
        const sim = new Simulation({ ...PRESETS[id].params });
        sim.world.fastPhysics = m === 'fast';
        let g = 0;
        while (sim.world.time < 2e7 && g++ < 2e5) {
          sim.stepOnce(Math.min(maxStep(sim.world), 5e6, 2e7 - sim.world.time));
        }
        return sim.world;
      });
      const bad = [];
      for (const id of ['earth', 'moon', 'earlyMoon', 'preindustrial', 'venus', 'mars', 'earlyEarth',
                        'earlyVenus', 'dryVenus', 'earlyMars', 'snowball', 'dune', 'eyeball',
                        'waterworld', 'titan', 'trappist1b', 'trappist1e',
                        'gj1132b', 'superEarth']) {
        const [a, b] = both(id);
        const dT = Math.abs(a.diag.Tmean - b.diag.Tmean);
        if (classify(a).id !== classify(b).id) {
          bad.push(`${id} ${classify(a).name} → ${classify(b).name}`);
        } else if (dT > 5) {
          bad.push(`${id} ${dT.toFixed(1)} K apart`);
        }
      }
      check('Fast physics lands on the same climate as exact physics',
        bad.length === 0,
        bad.length ? bad.join(', ')
          : '19 presets, same state and within 5 K after 20 Myr');
    }

    // Every stop has to be a value its own slider can actually hold.
    //
    // A stop is a button that writes a number straight into the params and then
    // asks the slider to show it. If that number is outside the slider's range,
    // or lands between two of its thousand positions, the handle goes somewhere
    // else and the button stops looking pressed the moment anything resyncs --
    // which is the one way this feature can be quietly wrong.
    {
      const bad = [];
      for (const d of SLIDERS) {
        for (const st of d.stops || []) {
          if (st.v < d.min || st.v > d.max) { bad.push(`${d.key}:${st.n} out of range`); continue; }
          const back = fromSlider(d, toSlider(d, st.v));
          const rel = st.v === 0 ? Math.abs(back) : Math.abs(back - st.v) / Math.abs(st.v);
          // The same 0.1% the highlight uses, so a stop that passes here is a
          // stop that stays lit.
          if (rel > 1e-3) bad.push(`${d.key}:${st.n} ${st.v} → ${back}`);
        }
      }
      const n = SLIDERS.reduce((a, d) => a + (d.stops ? d.stops.length : 0), 0);
      check('Every slider stop is a value its own slider can hold',
        bad.length === 0 && n > 20,
        bad.length ? bad.join(', ') : `${n} stops across ` +
          `${SLIDERS.filter((d) => d.stops).length} controls, all reachable`);
    }

    check('Every control survives a slider round-trip', worst < 3e-3,
      `worst ${(worst * 100).toFixed(3)}% on ${worstKey}`);
  }

  const summary = `${pass} passed, ${fail} failed`;
  console.log(`%c— ${summary} —`, `font-weight:bold;color:${fail ? '#ff6b57' : '#4ec98a'}`);
  return { pass, fail, log };
}

// node src/selftest.js
if (typeof window === 'undefined') {
  const r = run();
  if (typeof process !== 'undefined') process.exit(r.fail ? 1 : 0);
}
