// Physics and determinism checks. Run in the browser with ?selftest=1 (results
// go to the console), or headlessly with `node src/selftest.js`.
import { Simulation } from './sim/clock.js';
import { EARTH, PREINDUSTRIAL, PRESETS } from './game/presets.js';
import { classify } from './physics/classify.js';
import { runawayLimit, olr, hazeOpacity, hazeShortwave } from './physics/radiation.js';
import { T_CRIT_H2O, P_CRIT_H2O, steamOpacity } from './physics/constants.js';
import { NBANDS, maxStep } from './physics/climate.js';
import { SLIDERS, parseValue, toSlider, fromSlider, snapToDisplay } from './game/controls.js';
import { floodedFraction, MIN_SEA_DEPTH } from './physics/hypsometry.js';
import { atmosphereLook, scaleHeight } from './render/atmosphere.js';

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
      now.diag.Tmean - pre.diag.Tmean > 1.3 && now.diag.Tmean - pre.diag.Tmean < 2.3,
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
    const locked = settle({ ...EARTH, tidallyLocked: true, rotationHours: 240,
      water: 0.05, landFraction: 0.5, insolation: 1.0, n2Bar: 0.3,
      co2Bar: 1e-3, outgassing: 0.3, startT: 280 }, 2e7);
    const w = locked.world, st = classify(w);
    check('A locked world with a modest ocean traps it all on the night side',
      st.id === 'trapped', `${st.name}, ${(w.water.landIce / w.diag.totalWater * 100).toFixed(0)}% of the water as night-side ice`);
    check('…while keeping the water it started with, just not as liquid',
      w.diag.totalWater > 0.04 && w.water.ocean / w.diag.totalWater < 0.05,
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
      n2Bar: 0.3, co2Bar: 3e-4, outgassing: 0.3, startT: 300 }, 2e7);

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
    const titan = settle(PRESETS.titan.params, 2e7);
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

    // The Archean thermostat: methane warms until the haze it makes shades the
    // ground, and then more methane *cools* the planet.
    const arch = (ch4) => {
      const x = new Simulation({ ...PRESETS.earlyEarth.params, ch4Bar: ch4, outgassing: 0 });
      const c = x.world.co2;
      let n = 0;
      while (x.world.time < 3e5 && n++ < 3e4) { x.stepOnce(Math.min(maxStep(x.world), 2e3)); x.world.co2 = c; }
      return x.world.diag.Tmean;
    };
    const warm = arch(6e-3), hazy = arch(1e-2);
    check('Archean methane warms until its own haze shades the ground, then cools',
      hazy < warm - 5, `${(warm - 273.15).toFixed(1)} °C at 6 mbar CH₄ → ${(hazy - 273.15).toFixed(1)} °C at 10 mbar`);
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
    // The semi-grey CO2 opacity is stronger at intermediate pressure than the
    // line-by-line models, so escape comes at a few mbar rather than the
    // 0.1-0.3 bar those studies find. The behaviour is right -- hysteresis,
    // multi-Myr duration, unopposed build-up -- but the threshold sits low.
    // Recorded here as the model's own number rather than tuned to match.
    check('Deglaciation needs CO₂ to build up well past the starting value',
      tThaw !== null && co2AtThaw > 3e-4 && co2AtThaw < 0.6, `${co2AtThaw.toFixed(4)} bar`);
    check('Snowball lasts 1–100 Myr (lit. Marinoan 4–15, Sturtian ~56)',
      tThaw !== null && tThaw > 1e6 && tThaw < 1e8, tThaw ? `${(tThaw / 1e6).toFixed(1)} Myr` : 'n/a');
  }

  // ---- 5. dry planets have a wider habitable zone (Abe et al. 2011) ---------
  {
    const S = 1.5;
    const wet = settle({ ...EARTH, insolation: S }, 1e6);
    const dry = settle({ ...EARTH, insolation: S, water: 0.03, landFraction: 0.98 }, 1e6);
    const lossOf = (s) => (s.world.escape.water * 1e9) / s.world.diag.d.eoColumn;
    check('At 1.5 S⊕ an ocean world has run away',
      wet.world.diag.Tmean > 400, `${wet.world.diag.Tmean.toFixed(0)} K, ${classify(wet.world).name}`);
    check('…but a dune world at the same flux stays habitable (Abe 2011)',
      classify(dry.world).habitable && dry.world.diag.Tmean < 330,
      `${dry.world.diag.Tmean.toFixed(0)} K, ${classify(dry.world).name}`);
    check('…and its dry stratosphere throttles water loss by orders of magnitude',
      lossOf(dry) < 0.1 * lossOf(wet),
      `${lossOf(dry).toFixed(4)} vs ${lossOf(wet).toFixed(4)} EO/Gyr`);
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
    let worstCal = 0;
    for (const L of [0, 0.1, 0.3, 0.5, 0.7, 0.95, 1]) {
      worstCal = Math.max(worstCal, Math.abs(floodedFraction(REF, L, REF) - (1 - L)));
    }
    check('One Earth ocean floods exactly the basin geometry (calibration)',
      worstCal < 1e-12, `worst error ${worstCal.toExponential(1)}`);

    let mono = true, bounded = true, prev = -1;
    for (let i = 0; i <= 4000; i++) {
      const f = floodedFraction((i / 200) * REF, 0.3, REF);
      if (f < prev - 1e-15) mono = false;
      if (f < 0 || f > 1) bounded = false;
      prev = f;
    }
    check('Flooded fraction rises with water and never leaves [0, 1]',
      mono && bounded, 'swept 0–20 Earth oceans');

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
    const thin = settle({ ...EARTH, n2Bar: 2e-3, co2Bar: 1e-5, water: 0.3, insolation: 1.0 }, 2e5);
    check('No liquid water below the triple point',
      thin.world.diag.pSurfPa < 611.7 && thin.world.diag.openOcean < 1e-6,
      `${thin.world.diag.pSurfPa.toFixed(0)} Pa, open water ${(thin.world.diag.openOcean * 100).toFixed(2)}%`);
    const justAbove = settle({ ...EARTH, n2Bar: 5e-4, co2Bar: 1e-6, water: 0.3, insolation: 1.3 }, 2e5);
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

    // A hot dry world must not be called frozen.
    const baked = settle({ ...EARTH, tidallyLocked: true, rotationHours: 2000, insolation: 1.6,
                           water: 0.005, landFraction: 0.9, n2Bar: 0.3 }, 1e6);
    check('A hot waterless world is not labelled frozen',
      baked.world.diag.Tmean > 350 && classify(baked.world).id !== 'frozen',
      `${(baked.world.diag.Tmean - 273.15).toFixed(0)} °C → ${classify(baked.world).name}`);
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
