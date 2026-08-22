// Physics and determinism checks. Run in the browser with ?selftest=1 (results
// go to the console), or headlessly with `node src/selftest.js`.
import { Simulation } from './sim/clock.js';
import { EARTH, PREINDUSTRIAL, PRESETS } from './game/presets.js';
import { classify } from './physics/classify.js';
import { runawayLimit, olr, hazeOpacity, hazeShortwave } from './physics/radiation.js';
import { T_CRIT_H2O, P_CRIT_H2O, steamOpacity } from './physics/constants.js';
import { NBANDS, maxStep } from './physics/climate.js';
import { SLIDERS, parseValue, toSlider, fromSlider, snapToDisplay } from './game/controls.js';
import { SCENARIOS } from './game/scenarios.js';
import { floodedFraction, MIN_SEA_DEPTH } from './physics/hypsometry.js';
import { surfaceGravity } from './physics/planet.js';
import { methaneLifetime, photosynthesis, carbonBudget, FOSSIL_TOTAL } from './physics/volatiles.js';
import { atmosphereLook, cloudLook, scaleHeight } from './render/atmosphere.js';
import { seaLevelForLand } from './render/terrain.js';
import { bakeTerrain } from './render/cpushade.js';

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
      water: 0.03, landFraction: 0.7, insolation: 0.9, n2Bar: 0.25,
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

    // The Archean thermostat: methane warms until the haze it makes shades the
    // ground, and then more methane *cools* the planet.
    const arch = (ch4) => {
      // biosphere off: with no volcanic reductants to outrun, even a small one
      // oxygenates the air and kills the methane, which is correct but is not
      // what this test is about.
      const x = new Simulation({ ...PRESETS.earlyEarth.params, ch4Bar: ch4, outgassing: 0, biosphere: 0 });
      const c = x.world.co2;
      let n = 0;
      while (x.world.time < 3e5 && n++ < 3e4) { x.stepOnce(Math.min(maxStep(x.world), 2e3)); x.world.co2 = c; }
      return x.world.diag.Tmean;
    };
    // Sweep it rather than testing two fixed amounts: where the turn falls
    // depends on the CO2 the world has, since the haze switches on at a *ratio*.
    const ch4s = [8e-3, 1.4e-2, 2e-2, 3e-2, 4e-2, 5.5e-2];
    const Ts = ch4s.map(arch);
    let peak = 0;
    for (let i = 1; i < Ts.length; i++) if (Ts[i] > Ts[peak]) peak = i;
    const fell = Ts[Ts.length - 1] < Ts[peak] - 0.5;
    check('Archean methane warms until its own haze shades the ground, then cools',
      peak < Ts.length - 1 && fell,
      `warmest at ${(ch4s[peak] * 1e3).toFixed(0)} mbar CH₄ (${(Ts[peak] - 273.15).toFixed(1)} °C), ` +
      `down to ${(Ts[Ts.length - 1] - 273.15).toFixed(1)} °C by ${(ch4s[ch4s.length - 1] * 1e3).toFixed(0)} mbar`);
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
      const ends = [0, 1.9e-6, 1e-4, 1e-2].map((ch4Bar) =>
        settle({ ...EARTH, ch4Bar }, 1e5).world.diag.pCH4 * 1e6);
      const spread = (Math.max(...ends) - Math.min(...ends)) / Math.max(...ends);
      check('Methane forgets what the slider was set to',
        spread < 0.01 && Math.abs(ends[0] - 0.80) < 0.1,
        `0, 1.9, 100 and 10 000 ppm all settle at ` +
        `${ends.map((e) => e.toFixed(2)).join(' / ')} ppm`);

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
    const locked = settle({ ...PRESETS.eyeball.params }, 2e7).world;
    check('…and only the lit side of a world that never turns',
      photosynthesis(locked) > 0.15 && photosynthesis(locked) < 0.55,
      `${(photosynthesis(locked) * 100).toFixed(0)}% of the surface, the rest in permanent night`);

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
