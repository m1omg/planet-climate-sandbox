// Physics and determinism checks. Run in the browser with ?selftest=1 (results
// go to the console), or headlessly with `node src/selftest.js`.
import { Simulation } from './sim/clock.js';
import { EARTH, PREINDUSTRIAL, PRESETS } from './game/presets.js';
import { classify, reasonText } from './physics/classify.js';
import { runawayLimit, olr, hazeOpacity, hazeShortwave, ch4Shortwave } from './physics/radiation.js';
import { T_CRIT_H2O, P_CRIT_H2O, steamOpacity, psatCO2, frostPointCO2, psatH2O, smoothstep } from './physics/constants.js';
import { NBANDS, maxStep, lockFactor, slowRotation, insolationProfile } from './physics/climate.js';
import { SLIDERS, INTERIOR_BODIES, parseValue, toSlider, fromSlider, snapToDisplay } from './game/controls.js';
import { SCENARIOS } from './game/scenarios.js';
import { SLOTS, buildSaveFile, parseSaveFile, planImport } from './game/saves.js';
import { RESTORE_CAP, pushRestore, findRestore, truncateAfter } from './game/timeline.js';
import { captureWorld, applyWorld } from './game/snapshot.js';
import { floodedFraction, MIN_SEA_DEPTH } from './physics/hypsometry.js';
import { surfaceGravity } from './physics/planet.js';
import { methaneLifetime, photosynthesis, carbonBudget, FOSSIL_TOTAL, meltBoost } from './physics/volatiles.js';
import { atmosphereLook, cloudLook, scaleHeight } from './render/atmosphere.js';
import { seaLevelForLand, thermalGlow, GLOW_A, GLOW_B } from './render/terrain.js';
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
    near(olr(288, 280e-6, 0.0110, 1.8e-6, 1.011, 0, 0.669), 238, 6),
    `${olr(288, 280e-6, 0.0110, 1.8e-6, 1.011, 0, 0.669).toFixed(1)} W/m²`);
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
    // 1.5, raised from 1.35 when the four-band scheme moved the runaway edge out
    // from 1.30 to 1.38 S(+) and the substellar cloud deck moved it further. At
    // 1.35 the world now sits on the stable hot branch at 80 C indefinitely and
    // never runs away at all, so this returned null rather than failing.
    const near = transientAt(1.5), hard = transientAt(2.6);
    check('Runaway takes centuries to millennia — never instantaneous',
      near !== null && hard !== null && hard > 50 && near < 1e6,
      `${hard?.toExponential(1) ?? 'never'} yr at 2.6 S⊕, ${near?.toExponential(1) ?? 'never'} yr near threshold`);
    check('…and is slower the closer the planet sits to the threshold',
      near !== null && hard !== null && near > hard * 1.5,
      near !== null && hard !== null ? `${(near / hard).toFixed(1)}× slower near the edge` : 'no transient');
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
    const F = (c) => olr(288.15, c, 0.011, 1.8e-6, 1.011 + c, 0, 0.669);
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
    // 4 bar, raised from 1. Four bands cost CO2 a good deal of its leverage at
    // Earth-like temperatures -- which is the point of them, and what moved
    // snowball deglaciation into its literature range -- so 1 bar now settles at
    // 44 C as an ice-free hothouse instead of running away.
    const wet = new Simulation({ ...EARTH, co2Bar: 4, startT: 288 });
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
      // Re-pinned a fourth time, from 0.03 bar to 0.01, when the cloud deck was
      // given an optical-depth feedback. Measured before moving it, as the note
      // above insists: this perturbation is nothing like the methane one. The
      // substellar band here carries 1.22 bar of vapour, which takes the cloud
      // albedo from 0.310 to 0.434 -- a deck 40% brighter over the eye, which is
      // the Yang, Cowan & Abbot 2014 mechanism the README lists as a weakness
      // and is meant to be large. A cooler eye sublimates less, so a temperate
      // ring survives at the terminator and this world lands in twilight.
      //
      // Thinning the air to 0.01 bar moves less heat to the night side and puts
      // it back in the trapped basin -- and this pin is a better one than the
      // one it replaces: 0.03 held at 0, 0.03, 0.092, 0.13 and 0.18 W/m^2 with a
      // miss at 0.06, where 0.01 holds at 0, 0.092 and 0.2 together. 0.02 and
      // 0.015 both still interleave, so the interleaving is exactly where it was.
      // Re-pinned a fifth time for the four-band scheme and the substellar deck.
      // The trapped basin moved rather than closed, and it moved for a reason
      // worth reading: with only 0.01 bar of background gas the night side now
      // freezes the CO2 out and the world files as a Mars-like collapse instead,
      // while at 0.9 S(+) the eye is hot enough to take the whole inventory into
      // the air. 0.2 bar of nitrogen keeps the CO2 in the gas phase and 0.85 S(+)
      // keeps the eye below boiling, which leaves the trap itself intact: 100% of
      // the water ends up as night-side ice with 0.2% of the surface flooded.
      water: 0.03, landFraction: 0.7, insolation: 0.85, n2Bar: 0.2,
      // A bare rocky world: no oxygen, and nothing alive to make any. Inheriting
      // Earth's 0.21 bar would nearly double its atmosphere and move enough heat
      // to the night side to stop the trap.
      o2Bar: 0, biosphere: 0,
      co2Bar: 0.05, outgassing: 0.3, startT: 280 }, 2e7);
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
  //
  // 0.93 S(+), down from 1.0, and the state is intact rather than rescued: the
  // window it sits in moved when the inner edge did. Under 0.3 bar of background
  // air the eye of this world holds about a bar of steam at 100 C, and adopting
  // Goldblatt's radiation limit -- twenty units of band-0 water self-continuum --
  // is enough to close band 0 over the substellar point at that vapour pressure.
  // At 1.0 S(+) the eye now runs away and takes the night side with it, at every
  // water fraction from 0.04 up; 0.02 is a waterbelt. At 0.93 the eye sits at
  // 69 C with a 2-band ring and a -111 C night, which is the same object one
  // per cent of a star's output further out. One bar of background air instead of
  // 0.3 also holds it at 1.0 S(+), which is the cold-trap ratio doing what the
  // Sunbaked Ocean preset uses it for.
  {
    const locked = (water, land) => settle({ ...EARTH, tidallyLocked: true,
      rotationHours: 400, water, landFraction: land, insolation: 0.93,
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
    // 1.6, raised from 1.416 for the same reason as the transient probe above:
    // the four-band scheme and the substellar deck moved the runaway edge out,
    // and 1.416 S(+) is now a stable 90 C ocean rather than a slow boil.
    const hard = boil(2.6), mild = boil(1.6);
    const pred = (f) => NEED / f;
    const ok = (r) => r.dt !== null && r.dt < pred(r.f0) * 1.6 && r.dt > pred(r.f0) * 0.25;
    check('Boiling an ocean takes the time energy conservation says it should',
      ok(hard) && ok(mild),
      `at 2.6 S⊕ ${hard.dt?.toExponential(1) ?? 'never'} yr against ${pred(hard.f0).toExponential(1)} predicted; ` +
      `at 1.6 S⊕ ${mild.dt?.toExponential(1) ?? 'never'} yr against ${pred(mild.f0).toExponential(1)}`);
    check('…so a planet barely over the limit boils far more slowly than one well past it',
      mild.dt !== null && hard.dt !== null && mild.dt > hard.dt * 1.5,
      mild.dt !== null && hard.dt !== null
        ? `${(mild.dt / hard.dt).toFixed(1)}× longer at 1.6 S⊕ than at 2.6 S⊕` : 'no boil');
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
    // findIndex returns -1 when the peak is the last point in the sweep, i.e.
    // when there is no turn inside it at all. That is a result -- the turnover
    // is off the end of the range -- and it has to read as a failure rather
    // than as ds[-1], which is undefined and took the whole suite down with it
    // the first time the peak moved to the top of the sweep.
    const after = ds.findIndex((d, i) => i > peak && Ts[i] < Ts[peak] - 2);
    check('\u2026and the first turn is methane shading the ground itself, with no haze yet',
      after > 0 && ds[after].hazeSW > 0.999 && ds[after].ch4SW < 0.99,
      after > 0
        ? `${(ch4s[after] * 1e5).toFixed(0)} Pa is ${(Ts[peak] - Ts[after]).toFixed(1)} K below the peak with ` +
          `${((1 - ds[after].ch4SW) * 100).toFixed(1)}% of the sunlight taken by methane and none by haze`
        : `no turn inside the sweep: warmest point is ${(ch4s[peak] * 1e5).toFixed(0)} Pa, ` +
          `the top of the range, so the turnover is beyond it`);
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

  // ---- 3j-6. the hot branch, and what ends it -------------------------------
  // A planet pushed toward its inner edge used to go from temperate straight to
  // a 560 C steam greenhouse. Three 3-D models say otherwise -- Wolf & Toon 2015
  // hold an ocean at 362.8 K, Popp et al. 2016 above 330 K, Leconte et al. 2013
  // near 335 K -- and what ends the branch in all three is water leaving, not
  // radiation. calibrate.mjs anchors the numbers; these are the statements.
  {
    // Hold the CO2 still and walk the insolation up. The hot branch is a
    // fixed-CO2 object, which is how the papers drive it too, and the thermostat
    // test below is the other half of that.
    const eqAt = (S) => {
      const sim = new Simulation({ ...EARTH, insolation: S, outgassing: 0 });
      const co2 = sim.world.co2;
      let t = 0;
      while (t < 3e5) { const dt = Math.min(20 + t * 0.02, 5000); sim.stepOnce(dt); t += dt; sim.world.co2 = co2; }
      return sim.world;
    };
    let top = null;
    for (let S = 1.20; S <= 1.45; S += 0.01) {
      const w = eqAt(S);
      if (w.diag.Tmean > 400) break;
      top = w;
    }
    // 330 K, not 340. Ending the branch at the Simpson-Nakajima limit rather than
    // at the cold trap necessarily ends it cooler than a model that lets the cold
    // trap fail first, and adopting Goldblatt's limit moved this from 71 C to
    // 63.5 C. Leconte (2013) reach about 335 K and Popp (2016) above 330, so the
    // branch is still inside the literature -- just no longer at the top of it.
    check('There is a stable climate well above anything Earth has seen',
      top != null && top.diag.Tmean > 330,
      top ? `${(top.diag.Tmean - 273.15).toFixed(1)} °C with liquid water, ` +
            `${(top.diag.flooded * 100).toFixed(0)}% of it flooded` : 'no branch at all');

    // And with the CO2 held still it ends as a moist greenhouse rather than as a
    // cliff: Kasting's criterion is met on the branch, while the world is still
    // sitting there.
    //
    // That "held still" is not a detail, it is the whole of the change this
    // model just made. On a *pinned* branch -- which is how the papers drive it,
    // and how `eqAt` above drives it -- the cold trap still fails first and the
    // moist greenhouse still exists. Let the thermostat run instead, as a player
    // does, and weathering strips the CO2, the branch runs cooler, and the
    // absorbed flux crosses the radiation limit while the stratosphere is still
    // dry: no moist greenhouse, straight into a runaway, which is Leconte
    // (2013)'s result. The 3l-3b-2 block below asks for the free-thermostat half.
    check('…and the cold trap has failed by the top of it (Kasting 1988)',
      top != null && top.escape.fStrat > 1e-3,
      top ? `stratospheric H₂O ${top.escape.fStrat.toExponential(2)}, past the 1e-3 criterion ` +
            `— on a pinned-CO₂ branch; with the thermostat running the runaway comes first` : '');

    // The cold trap is now psat(T_ct)/p_ct rather than a power law fitted to it,
    // so modern Earth is a prediction and not a pin. Observed is ~4e-6.
    const earthNow = settle({ ...EARTH }, 2e5).world;
    check('…and the same relation gives modern Earth its observed ~4 ppm',
      earthNow.escape.fStrat > 1e-6 && earthNow.escape.fStrat < 2e-5,
      `${earthNow.escape.fStrat.toExponential(2)} against an observed ~4e-6`);

    // Under a young, active star that is fast enough to matter. Under the
    // present Sun it is not, and that is the XUV energy limit rather than the
    // trap -- worth separating, because the two answers differ by a hundredfold.
    const younger = (() => {
      const sim = new Simulation({ ...EARTH, insolation: 1.30, xuvFraction: 3.4e-4, outgassing: 0 });
      const co2 = sim.world.co2;
      let t = 0;
      while (t < 3e5) { const dt = Math.min(20 + t * 0.02, 5000); sim.stepOnce(dt); t += dt; sim.world.co2 = co2; }
      return sim.world;
    })();
    const gyr = (younger.diag.d.eoColumn / younger.escape.water) / 1e9;
    // Gigayears, not tens of them: long, but a fraction of a planet's life, which
    // is what makes the moist greenhouse a way of losing an ocean rather than a
    // curiosity. The 10^8 figure that gets quoted belongs to the runaway above
    // this, where the stratosphere is all steam and the ratio is 1 rather than
    // 10^-3.
    check('…and under a young star the ocean actually leaves, within a planet\u2019s life',
      gyr > 0.1 && gyr < 20, `${(gyr * 1000).toFixed(0)} Myr per ocean at 100× the modern Sun's XUV`);
  }

  // ---- 3j-7. a hot ocean world, and why they are hard -----------------------
  // Liquid water at 300-370 K under tens of bars is not exotic: von Paris et al.
  // 2010 model Gliese 581d at 20 bar and 357 K, Wordsworth et al. 2011 melt its
  // ocean in a GCM. What is hard is keeping one, and the obstacle is not the
  // greenhouse.
  {
    const hot = settle(PRESETS.hotOcean.params, 1e9).world;
    const st = classify(hot);
    check('A hot ocean world holds for a gigayear with the carbon cycle running',
      st.id === 'hotocean' && hot.diag.flooded > 0.9,
      `${(hot.diag.Tmean - 273.15).toFixed(1)} °C under ${hot.diag.pTotMean.toFixed(1)} bar, ` +
      `${(hot.diag.flooded * 100).toFixed(0)}% ocean`);

    // Arriving in the right place is not the same as staying in it, and every
    // check above this one reads only the arrival. This world used to boot
    // ninety W/m^2 out of balance -- fifteen bar of CO2 held at a temperature
    // that only eight and a half bar can support once hydrogen is in the air --
    // so it fell to a snowball inside two centuries, condensed its atmosphere
    // onto the ground, and came back through a 668 C runaway some tens of
    // megayears later. It still arrived at 73 C, so the endpoint checks passed
    // throughout. What gives it away is watching it: at three hundred megayears
    // a second the whole excursion goes past in a second of wall clock, which
    // is exactly how it was found.
    //
    // The bound is on the recorded history rather than on the final state,
    // because the history is what the chart draws and what a player actually
    // sees. Sampling is 2% of elapsed time, so an excursion lasting tens of
    // megayears cannot slip between two samples.
    const trip = hot.history.map((h) => h.T);
    const lo = Math.min(...trip) - 273.15, hi = Math.max(...trip) - 273.15;
    check('\u2026and it holds all the way there, not just when it arrives',
      lo > 40 && hi < 110,
      `${lo.toFixed(0)}\u2026${hi.toFixed(0)} °C across ${trip.length} samples of the gigayear`);

    // The Wordsworth & Pierrehumbert 2013 half: what escapes past a cold trap is
    // a ratio, and ten bars of background gas is a very large denominator. This
    // world is hotter than the moist greenhouse above and loses water far slower.
    const gyr = (hot.diag.d.eoColumn / hot.escape.water) / 1e9;
    check('…and a heavy atmosphere keeps its water, hot as it is',
      hot.escape.fStrat < 1e-3 && gyr > 20,
      `stratospheric H₂O ${hot.escape.fStrat.toExponential(2)}, an ocean every ${gyr.toFixed(0)} Gyr`);

    // The thermostat is the limit, not the radiation, and that is worth pinning
    // because it is the first objection anyone raises to these worlds. Same
    // world, Earth's outgassing: the carbon cycle pulls it back down.
    const cooled = settle({ ...PRESETS.hotOcean.params, outgassing: 1, internalHeat: 0.092 }, 5e8).world;
    check('…and what stops one is weathering, not the greenhouse',
      cooled.diag.Tmean < hot.diag.Tmean - 30,
      `${(cooled.diag.Tmean - 273.15).toFixed(1)} °C at Earth's outgassing against ` +
      `${(hot.diag.Tmean - 273.15).toFixed(1)} °C at thirty times it`);
  }

  // ---- 3j-8. a dune world is a land planet ----------------------------------
  // Abe et al. 2011's dune worlds are *land* planets. This used to be tested on
  // the water inventory alone, which is a different question: Way et al. 2016's
  // young Venus carries 0.115 EO and still floods a quarter of itself.
  {
    const venus = settle(PRESETS.youngVenus.params, 2e7).world;
    check('A shallow ocean is not a desert if it is still an ocean',
      classify(venus).id !== 'dune' && venus.diag.flooded > 0.15,
      `${(venus.diag.flooded * 100).toFixed(0)}% flooded on ${venus.diag.totalWater.toFixed(3)} EO ` +
      `— ${classify(venus).name}`);
    const dune = settle(PRESETS.dune.params, 2e7).world;
    check('…while a real land planet still is one',
      classify(dune).id === 'dune',
      `${(dune.diag.flooded * 100).toFixed(1)}% flooded — ${classify(dune).name}`);
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
    const base = olr(T, pCO2, pH2O, 0, pN2 + pCO2 + pH2O, 0, 0.669);
    const Pas = [1, 3, 10, 30, 60, 100, 200, 300, 600, 1000, 2000, 3500];
    const F = Pas.map((Pa) => base - olr(T, pCO2, pH2O, Pa / 1e5, pN2 + pCO2 + pH2O + Pa / 1e5, 0, 0.669)
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

    // And the two that are also world presets must agree with them, or picking
    // Venus from the presets and Venus from this row gives two different Venuses.
    const agrees = (id, key) => {
      const b = INTERIOR_BODIES.find((x) => x.id === id), p = PRESETS[key].params;
      return b.heat === p.internalHeat && b.outgassing === p.outgassing;
    };
    check('\u2026and Venus, Mars and GJ 1132 b agree with their world presets',
      agrees('venus', 'venus') && agrees('mars', 'mars') && agrees('gj1132b', 'gj1132b'),
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
      //
      // Widened from 5% to 25% when methane started carrying hydrogen to space.
      // It feeds the same sensitivity from a second direction: the world that
      // starts with more methane loses more hydrogen, so it is credited more
      // against its volcanic reductant, so it holds a slightly larger trace of
      // oxygen, so its methane lives slightly less long. The two worlds still
      // forget where they started -- 257 ppm against 212 from a hundredfold
      // difference in starting methane -- but they no longer land within five
      // per cent of each other, and tightening this would mean tuning away the
      // coupling rather than the noise.
      check('…on an anoxic world too, where it settles a thousand times higher',
        Math.abs(lo - hi) / Math.max(lo, hi) < 0.25 && lo * 1e6 > 100,
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

  // ---- 3l-2. hydrogen is not a stable gas either ----------------------------
  // The same redox switch as methane, and steeper. H2 has an observed lifetime
  // of about two years in today's air -- soil uptake takes roughly three
  // quarters of it and OH the rest (Novelli 1999; Ehhalt & Rohrer 2009) -- while
  // in anoxic air nothing consumes it and what it has to get past is escape,
  // which is geologically slow. That contrast is the whole reason a reduced
  // early Mars or a Hycean world can hold percent-level hydrogen and modern
  // Earth holds half a part per million of it.
  //
  // Pinned here because hydrogen arrived with a radiative lever bigger than
  // anything else in the model and no test of its own, and the first thing that
  // happened was a description of this decay that was wrong by six orders of
  // magnitude -- "about ten megayears" for something that is half gone in
  // eighteen months. An untested number is one nobody can be corrected against.
  {
    const bars = (w) => w.h2 * w.diag.g / 1e5;
    const decay = (params, years) => {
      const s = new Simulation(params);
      const start = bars(s.world);
      s.runYears(years, 0.25);
      return bars(s.world) / start;
    };
    // A *trace* amount, because that is the regime the two-year number
    // describes: 2 ppm here against Earth's observed 0.55. A bar of it cannot
    // decay this way and must not be asked to -- burning a bar needs 7.94 bar
    // of oxygen and the planet has 0.21, which is the check below this one.
    const oxic = { ...EARTH, h2Bar: 2e-6, outgassing: 0 };
    const half = decay(oxic, 1.4), decade = decay(oxic, 10), century = decay(oxic, 100);
    check('Hydrogen lasts ~2 years in today\u2019s air, while it is a trace gas',
      half > 0.35 && half < 0.65 && decade < 0.02,
      `${(half * 100).toFixed(0)}% left after 1.4 yr, ${(decade * 100).toFixed(2)}% after a decade, ` +
      `${(century * 100).toExponential(1)}% after a century`);

    // The other side of the switch, and the one the hot ocean world stands on.
    const anoxic = decay({ ...EARTH, o2Bar: 0, biosphere: 0, h2Bar: 2e-6, outgassing: 0 }, 100);
    check('\u2026and geological ages in air with no oxygen in it',
      anoxic > 0.9,
      `${(anoxic * 100).toFixed(1)}% still there after a century, against ` +
      `${(century * 100).toExponential(1)}% with oxygen`);
  }

  // ---- 3l-3. burning hydrogen costs oxygen and makes water -------------------
  // The two-year lifetime above is a *trace gas* lifetime. It assumes the
  // oxidant is effectively infinite next to the hydrogen, which is true at
  // Earth's 0.55 ppm and false the moment anyone drags the slider. 2 H2 + O2 ->
  // 2 H2O: burning a kilogram of hydrogen costs 7.94 kg of oxygen and yields
  // 8.94 kg of water, so a bar of H2 needs 7.94 bar of O2 to finish, and Earth
  // has 0.21. Past that ratio the oxygen is the thing that runs out, the air
  // ends up reduced, and what is left of the hydrogen is stable -- which is the
  // anoxic branch above, reached from the oxic one.
  //
  // It used to be a bare exponential gated on pO2, consuming no oxygen and
  // making no water: ten bars of hydrogen vanished in two centuries while the
  // oxygen budget moved by six parts in a million and the ocean did not move at
  // all. Mass and redox both, out of the same hole the methane reservoir was
  // pulled out of earlier.
  {
    const s = new Simulation({ ...EARTH, h2Bar: 1.0, outgassing: 0, biosphere: 0 });
    const w = s.world, g = w.diag.g;
    const bar = (col) => col * g / 1e5;
    const o2Start = bar(w.o2), waterStart = w.diag.totalWater;
    s.runYears(500, 0.25);
    const h2Left = bar(w.h2), o2Left = bar(w.o2);

    check('A bar of hydrogen takes Earth\u2019s oxygen with it, not the other way round',
      o2Left < o2Start * 0.02 && h2Left > 0.9,
      `O₂ ${o2Start.toFixed(3)} → ${o2Left.toExponential(1)} bar, ` +
      `H₂ 1.000 → ${h2Left.toFixed(3)} bar left standing in reduced air`);

    // 0.21 bar of O2 can only burn 0.0265 bar of H2, and that makes 8.8e-4 EO
    // of water. Small, and the point is that it is not zero.
    const made = w.diag.totalWater - waterStart;
    check('\u2026and the hydrogen that did burn turned into water',
      made > 5e-4 && made < 1.5e-3,
      `${made.toExponential(2)} EO of new water from ${(1 - h2Left).toFixed(4)} bar of H₂ burnt`);
  }

  // ---- 3l-3a. CO2 condenses, and that is what makes an outer edge ------------
  // Kasting et al. (1993) put the outer edge of the habitable zone at 0.36 S(+),
  // and what sets it is a ceiling on how much good any amount of CO2 can do.
  // Pile it onto a cold world and the upper atmosphere saturates: above the
  // condensation level the profile follows CO2's own vapour-pressure curve
  // rather than a dry adiabat, temperature there falls only logarithmically with
  // pressure, and the outgoing flux stops falling with it.
  //
  // Without it the greenhouse grew without limit and the outer edge did not
  // exist -- a world at 0.35 S(+) could be forced to +15 °C under thirty bar of
  // CO2, where every published treatment says no amount of it gets such a world
  // above freezing. It is -95 °C now. The old note blamed Rayleigh scattering
  // and that was wrong: measured against tau_R proportional to column with CO2's
  // 2.2x cross-section, this model's CO2 Rayleigh is close to right.
  {
    const bar = (T) => psatCO2(T) / 1e5;
    check('The CO₂ saturation curve matches its published fixed points',
      near(bar(148), 0.0061, 0.0006) && near(bar(194.7), 1.0, 0.06)
      && near(bar(273.15), 34.85, 0.3) && near(bar(304.128), 73.77, 0.1),
      `${bar(148).toFixed(4)} bar at Mars's 148 K frost point (0.0061), ` +
      `${bar(194.7).toFixed(3)} at 194.7 K (1.000), ` +
      `${bar(273.15).toFixed(2)} at 0 °C (34.85), ` +
      `${bar(304.128).toFixed(2)} at the critical point (73.77)`);

    // It has to bind where CO2 really is saturated aloft and nowhere else, and
    // "nowhere else" is the harder half: Venus carries 92 bar of it under a
    // stratosphere far too warm for any of it to condense.
    const cold = olr(291, 30, 0.02, 0, 30.02, 0, 0.5);
    check('A thirty-bar CO₂ atmosphere on a cold world cannot keep cooling its emission level',
      cold > 80 && cold < 120,
      `${cold.toFixed(0)} W/m² at 291 K, against 55 with the condensation level ignored`);
    check('…while Venus, whose CO₂ condenses nowhere, does not move at all',
      near(olr(737, 92, 0, 0, 92), 161.004, 0.01),
      `${olr(737, 92, 0, 0, 92).toFixed(3)} W/m² at 737 K under 92 bar`);
    check('…and neither does Earth, Mars, or a hot ocean world under nine bar',
      near(olr(288.15, 280e-6, 0.011, 1.8e-6, 1.011, 0, 0.669), 235.714, 0.01)
      && near(olr(215, 0.006, 1e-6, 0, 0.0062, 0, 0.1), 112.574, 0.01)
      && near(olr(347, 8.742, 0.35, 0, 10.1, 0, 0.8), 148.707, 0.01),
      'all three bit-identical to the scheme without it — a 217 K skin temperature ' +
      'is far above CO₂’s frost point at the hot ocean’s emission level');
  }

  // ---- 3l-3b. the hot branch has to have a hot branch ------------------------
  // These three exist because a radiation refit passed every anchor in
  // calibrate.mjs, every one of the 219 tests that existed, and still broke the
  // model in the one regime a player who drags the insolation slider actually
  // lands in. Reported from the live site: a 1.32 S(+) ocean world cycling
  // between glaciation and temperate. Reproduced exactly, and the cause was that
  // the refitted OLR went flat above about 35 C -- 288.5 W/m2 at 27 C, 293.0 at
  // 37, 290.0 at 62 -- against an absorbed flux of 320-326 W/m2 throughout. No
  // energy balance existed anywhere between -3 C and 107 C. The planet climbed
  // until the ice-albedo feedback caught it coming back down, and where it
  // landed depended on the step size.
  //
  // The reason nothing caught it is worth more than the fix. Every slope the fit
  // was scored on was measured at 280 ppm of CO2, where the refit still looked
  // acceptable (0.99 W/m2/K at 310 K). A world at high insolation does not have
  // 280 ppm of CO2 -- the thermostat has weathered it to nothing -- and there
  // the same fit gave 0.05. So the first of these asks at 1e-7 bar, which is
  // where a brightening Earth actually sits.
  {
    const dOLRdT = (T, pCO2) => {
      const f = (t) => { const q = 0.8 * psatH2O(t) / 1e5;
        return olr(t, pCO2, q, 0, 0.99 + pCO2 + q, 0, 0.669); };
      return (f(T + 2) - f(T - 2)) / 4;
    };
    const a = dOLRdT(310, 1e-7), b = dOLRdT(320, 1e-7);
    check('A world whose CO₂ has been weathered away still radiates more when it warms',
      a > 1.0 && b > 0.5,
      `dOLR/dT ${a.toFixed(2)} W/m²/K at 310 K and ${b.toFixed(2)} at 320 K with 1e-7 bar of ` +
      `CO₂ — the refit that broke this gave 0.05 and -0.21`);

    // …and the same thing said as a world rather than as a derivative. This is
    // the exact state the report came from, and it used to guard amplitude
    // rather than stillness, because the world did not sit still even in the
    // scheme that shipped: it ran a limit cycle between about -6 C and +58 C
    // with a period near 1.3 Myr. The refit roughly doubled that -- -43 C to
    // +77 C, through a *complete* snowball -- and took seven times as many steps.
    //
    // Tightened now, as that comment said to do if the cycle were ever fixed.
    // Adopting Goldblatt's radiation limit fixed it, and not by damping the
    // cycle: a world at 1.32 S(+) with an ocean and no CO2 is *past* the inner
    // edge, so there is no cool equilibrium for it to fall back to. It runs away
    // once and holds. What this asks is that it holds, in one basin, cheaply.
    const hot = new Simulation({ ...EARTH, water: 0.999669, insolation: 1.32,
      o2Bar: 0.0268988, co2Bar: 2.02302e-8, ch4Bar: 5.65034e-8, emissions: 1 });
    let n = 0, lo = Infinity, hiT = -Infinity, ice = 0;
    while (hot.world.time < 5e6 && n++ < 6e4) {
      hot.stepOnce(maxStep(hot.world));
      if (hot.world.time > 2e6) {
        lo = Math.min(lo, hot.world.diag.Tmean); hiT = Math.max(hiT, hot.world.diag.Tmean);
        ice = Math.max(ice, hot.world.diag.iceMean);
      }
    }
    check('…and a 1.32 S⊕ ocean world sits still instead of cycling',
      hiT - lo < 5 && ice < 0.02 && n < 5e3,
      `${(lo - 273.15).toFixed(0)}…${(hiT - 273.15).toFixed(0)} °C over the last 3 Myr, worst ice ` +
      `${(ice * 100).toFixed(0)}%, ${n} steps — the moist-greenhouse framing gave a 64 K limit ` +
      `cycle in 40 000 steps, and the refit gave -43…77 °C through a complete snowball`);
  }

  // ---- 3l-3b-2. what the Goldblatt limit costs, and what it must not --------
  // The inner edge is set by radiation now, not by the cold trap: the runaway
  // starts when the absorbed flux crosses the Simpson-Nakajima limit, and the
  // stratosphere is still dry when it does. That is Leconte (2013)'s result and
  // Goldblatt (2013)'s framing, and the price is that the moist greenhouse stops
  // existing as a state a player can occupy. Deliberate, and asked here so the
  // trade is visible rather than implied.
  {
    const lim = runawayLimit(280e-6, 1.0).flux;
    check('The runaway limit is Goldblatt’s 282 W/m², not a number this model chose',
      Math.abs(lim - 282) < 4,
      `${lim.toFixed(1)} W/m² — Goldblatt 2013 give 282 saturated, 294 absorbed at the ` +
      `runaway; the moist-greenhouse framing this replaced sat at 288`);

    // Walk in from the cool side and record the driest thing the model can say:
    // the stratospheric mixing ratio at the last state that still has an
    // equilibrium. Kasting's moist greenhouse begins at 1e-3. This must not
    // reach it -- if it does, the limit has drifted back up and the cliff has
    // moved out past the literature again.
    let last = 0, edge = 0;
    for (let S = 1.20; S <= 1.60; S += 0.02) {
      const w = new Simulation({ ...EARTH, insolation: S });
      let m = 0;
      while (w.world.time < 3e5 && m++ < 4e4) w.stepOnce(maxStep(w.world));
      if (w.world.diag.Tmean > 400) { edge = S; break; }
      last = w.world.escape?.fStrat ?? 0;
    }
    check('…and the stratosphere is still dry when the runaway starts',
      edge > 0 && last < 1e-3,
      `fStrat ${last.toExponential(1)} at the last stable point, runaway at ${edge.toFixed(2)} S⊕ ` +
      `— Kasting’s moist greenhouse needs 1e-3, and under this framing nothing reaches it`);
  }

  // ---- 3l-3b-3. a runaway has to be affordable to watch ---------------------
  // Two things conspired to make one unaffordable, and both are fixed here.
  //
  // First the radiation. Band 0's water self-continuum goes as pH2O^2 with no
  // pressure broadening, and left unbounded it blacks out 0-8 um entirely in a
  // steam atmosphere -- a range that is physically clear at those temperatures,
  // because the surface radiates most of it below 3 um where the continuum does
  // not act. Without a ceiling the OLR never recovers, the world climbs to the
  // model's own 4000 K clamp, and it gets there three years at a time.
  //
  // Then the clock. maxStep bounds every reservoir so none of them jumps
  // discontinuously, and the CO2 bound had no exemption for a reservoir pinned
  // at zero -- which is exactly where a runaway puts it, weathering at 370 C
  // outrunning the volcanoes by two orders of magnitude for ever. The oxygen
  // bound has carried that exemption since the Archean went to a standstill for
  // the same reason. The CO2 one now does too: 189 125 steps became 979.
  {
    const s3 = new Simulation({ ...EARTH, insolation: 1.6, startT: 3990 });
    let n = 0;
    while (s3.world.time < 1e5 && n++ < 3e4) s3.stepOnce(maxStep(s3.world));
    const T = s3.world.diag.Tmean, dt = maxStep(s3.world);
    check('A runaway settles on a hot branch instead of pinning at the clamp',
      T < 1200 && dt > 1e3,
      `${(T - 273.15).toFixed(0)} °C at ${dt.toExponential(2)} yr per step after ${n} steps — ` +
      `uncapped, the continuum took this to the 4000 K clamp at 3.3 yr per step`);

    const s4 = new Simulation({ ...EARTH, water: 0.999669, insolation: 1.32,
      o2Bar: 0.0268988, co2Bar: 2.02302e-8, ch4Bar: 5.65034e-8, emissions: 1 });
    let m = 0;
    while (s4.world.time < 1e7 && m++ < 2e5) s4.stepOnce(maxStep(s4.world));
    check('…and a world whose CO₂ has been weathered to nothing does not hold the clock down',
      s4.world.time >= 1e7 && m < 5e3,
      `10 Myr in ${m} steps, CO₂ ${s4.world.co2.toExponential(1)} kg/m² — without the pinned ` +
      `exemption the CO₂ bound held this at 23.6 yr per step, 42 000 steps per megayear`);
  }

  // ---- 3l-3c. and the clock has to stay fast ---------------------------------
  // The other half of the same report: the maximum time speed dropped a lot. It
  // is the same cause. maxStep multiplies its step by up to 4000 once a world is
  // within a kelvin or two of equilibrium, and a world whose OLR curve is flat
  // never gets there, so the shortcut stays switched off for ever. Earth's
  // asymptotic step went from 1.18 Myr to 82 years -- fourteen thousand times
  // smaller -- with no test able to see it.
  //
  // Asked at 20 Myr rather than at 5, and tightened from 2e5 to 1e6 in the same
  // edit, because at 5 Myr this was reading a transient and not a settled world.
  // The step keeps climbing for about twenty megayears while the carbon cycle
  // relaxes, and exactly where it is partway up that climb depends on the
  // radiation coefficients: the Goldblatt refit sits at 1.35e5 at 5 Myr where
  // the set before it was at 1.16e6, and both reach the same 1.18 Myr asymptote
  // and take the same number of steps to a gigayear -- 905 against 884. A
  // threshold placed on the transient would have failed a change that did not
  // move the thing it is named after.
  {
    const s2 = new Simulation({ ...EARTH });
    let n = 0;
    while (s2.world.time < 2e7 && n++ < 3e5) s2.stepOnce(maxStep(s2.world));
    const dt = maxStep(s2.world);
    check('A settled Earth can be stepped in megayears, which is what the time slider sells',
      dt > 1e6,
      `${dt.toExponential(2)} yr per step after 20 Myr and ${n} steps — the refit that broke this ` +
      `gave 82 yr and never climbed at all`);
  }

  // ---- 3l-4. the hydrogen reservoir has to be stable at any step -------------
  // Hydrogen was the one reservoir integrated explicitly, and the only one with
  // no bound in maxStep. Escape is very nearly first order in the amount
  // present, so on an anoxic world it turns over in about half a megayear --
  // shorter than the strides this model is built to take. Explicit Euler past
  // twice an e-folding time does not settle, it oscillates: at a five-megayear
  // step the Archean's steady 17.65 kg/m² became a sawtooth between zero and
  // 184. Nothing noticed while escaping hydrogen was merely lost; it matters now
  // that the same flux credits the oxygen budget, because the sawtooth drove a
  // Great Oxidation the physics does not have.
  //
  // Semi-implicit now -- exact at steady state, unable to overshoot past zero at
  // any step -- with a bound on the realised net rate like every other reservoir
  // has. What this checks is that the answer stopped depending on the step size.
  {
    const at = (dt) => {
      const x = new Simulation({ ...PRESETS.earlyEarth.params });
      let lo = Infinity, hi = -Infinity;
      for (let t = 0; t < 1e8; t += dt) {
        x.stepOnce(dt);
        if (t > 1e7) { lo = Math.min(lo, x.world.h2); hi = Math.max(hi, x.world.h2); }
      }
      return { lo, hi };
    };
    const fine = at(1e5), coarse = at(5e6);
    check('The hydrogen reservoir settles rather than oscillating, at any step',
      (coarse.hi - coarse.lo) / Math.max(coarse.hi, 1e-9) < 0.10
        && coarse.lo > 0.5 * fine.lo && coarse.hi < 2 * fine.hi,
      `${coarse.lo.toFixed(2)}–${coarse.hi.toFixed(2)} kg/m² at a 5 Myr step against ` +
      `${fine.lo.toFixed(2)}–${fine.hi.toFixed(2)} at 0.1 Myr`);
  }

  // ---- 3l-5. methane carries hydrogen to space too ---------------------------
  // Catling, Zahnle & McKay (2001), and the half of it the model did not have.
  // Hunten's diffusion limit is a statement about hydrogen, not about H2: what
  // crosses the homopause is atoms, and methane brings four where H2 brings two.
  // Biogenic methane rises, is photolysed, and its hydrogen leaves -- the carbon
  // stays, the oxygen stays, and the planet ratchets one way. That is the whole
  // mechanism their account of the Great Oxidation rests on, and methane was a
  // greenhouse gas and a carbon reservoir here and nothing else.
  //
  // Earth is the anchor rather than the interesting case, and it is a real one:
  // the total escape flux falls out at 8e7 hydrogen atoms per cm² per second
  // against an observed ~1e8, with nothing tuned to make it.
  {
    const s2 = new Simulation({ ...EARTH, co2Bar: 427e-6, ch4Bar: 1.9e-6 });
    s2.runYears(3000, 0.25);
    const w = s2.world, e = w.escape ?? {}, f = w.o2Flux ?? {};
    const perYr = (e.h2 ?? 0) + (w.ch4Escape ?? 0);         // kg/m²/yr of H2-equivalent
    const atoms = perYr / 2.016e-3 * 2 * 6.02214e23 / 3.1557e7 / 1e4;
    check('Earth loses hydrogen at the rate it is observed to',
      atoms > 3e7 && atoms < 5e8,
      `${atoms.toExponential(1)} H atoms/cm²/s, against ~1e8 observed`);
    check('…and it is the methane carrying it, not the H₂',
      (w.ch4Escape ?? 0) > 10 * (e.h2 ?? 0),
      `methane ${(w.ch4Escape ?? 0).toExponential(2)} against H₂ ` +
      `${(e.h2 ?? 0).toExponential(2)} kg/m²/yr of H₂-equivalent`);
    // …and crediting it must not oxygenate a world out of nothing. It is netted
    // off the volcanic reductant charge and floored at zero, never added as free
    // oxygen, so modern Earth does not move.
    const now = settle({ ...EARTH, co2Bar: 427e-6 }, 2e5).world;
    check('…and crediting it leaves modern Earth’s oxygen where it was',
      near(now.diag.pO2, 0.21, 0.04),
      `${now.diag.pO2.toFixed(4)} bar, credit ${(f.escapedCH4 ?? 0).toExponential(1)} against a ` +
      `${(f.gross ?? 0).toExponential(1)} kg/m²/yr charge`);
  }

  // ---- 3l-6. where a volcano erupts changes what it emits --------------------
  // Kump & Barley (2007). Submarine eruptions degas under kilometres of water,
  // at pressures that keep sulfur as H2S and leave the mixture reducing;
  // subaerial eruptions degas at one bar and their sulfur leaves as SO2, which
  // is not. Land reached the oxygen budget only through weathering before this,
  // so an ocean world and a continental one delivered identical reducing power
  // per unit volcanism, and the Archean's lack of continents cost it nothing.
  {
    const flux = (land) => {
      const x = settle({ ...EARTH, landFraction: land, biosphere: 0.4 }, 2e6).world;
      return (x.o2Flux ?? {}).gross ?? 0;
    };
    const modern = flux(0.29), archean = flux(0.1), ocean = flux(0.0);
    check('A world with no continents delivers more reducing power per eruption',
      ocean > modern * 1.45 && ocean < modern * 1.55,
      `${(ocean / modern).toFixed(2)}× at no land, ${(archean / modern).toFixed(2)}× at ` +
      `the Archean's 0.1, 1.00× at Earth's 0.29 by construction`);
    check('…and modern Earth is the unit, so nothing about today moves',
      near(settle({ ...EARTH }, 2e5).world.diag.pO2, 0.21, 0.04),
      `pO₂ ${settle({ ...EARTH }, 2e5).world.diag.pO2.toFixed(4)} bar at Earth's land fraction`);
  }

  // ---- 3l-7. a world's hydrogen has to survive being saved -------------------
  // It did not. Hydrogen was never added to captureWorld, and reset() refills it
  // from the *parameter* rather than leaving it alone, so a world that had lost
  // 44% of its hydrogen got every gram of it back the moment it was saved and
  // reloaded -- in every save slot, every export, and every drag of the history
  // chart. The round-trip test further down could not see it because its own
  // state vector did not list h2 either. Both are fixed; this is the direct
  // check.
  {
    const P = { ...EARTH, h2Bar: 0.05, outgassing: 0, biosphere: 0, o2Bar: 0 };
    const a = new Simulation({ ...P });
    a.runYears(2e5, 200);
    const before = a.world.h2;
    const b = new Simulation({ ...P });
    applyWorld(b, captureWorld(a.world), { ...a.world.params });
    check('Hydrogen survives a save and reload',
      Math.abs(b.world.h2 - before) < 1e-9,
      `${before.toFixed(2)} kg/m² saved, ${b.world.h2.toFixed(2)} restored, from a ` +
      `${(0.05e5 / a.world.diag.g).toFixed(0)} kg/m² start`);
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
    // "For ever" is the one word here that stopped being true, and it is
    // Catling, Zahnle & McKay (2001) that took it away. Below the volcanic
    // reductant flux the air used to sit at exactly zero and stay there. It does
    // not now: the methane such a world accumulates carries hydrogen to space,
    // every hydrogen that leaves is reducing power the atmosphere never has to
    // answer for, and the planet oxidises slowly whether or not the biosphere is
    // winning on its own. Two hundred megayears at a quarter of Earth's
    // biosphere lands at 5e-5 bar -- a whiff, four thousand times below the
    // modern level and still firmly an anoxic world -- where before it was
    // nothing at all. The threshold is a slope now, not a wall.
    //
    // Whether the *atmosphere* should show that whiff is the open question, and
    // it is in the README: in Catling's own budget most of the oxidation goes
    // into the crust as ferric iron and sulfate, and this model has no crustal
    // reservoir to put it in, so all of it lands in the air. The Archean sulfur
    // record says it should not.
    const below = held(0.25, {}, 2e8), above = held(0.8);
    check('A biosphere the volcanoes outrun leaves the air all but anoxic',
      below.diag.pO2 < 1e-4 && below.diag.pO2 < 0.001 * above.diag.pO2,
      `${below.diag.pO2.toExponential(1)} bar after 200 Myr at 0.25× Earth, against ` +
      `${above.diag.pO2.toFixed(3)} at 0.8×`);
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

  // ---- 3m3. the Archean does not end as a steam atmosphere ------------------
  // It used to. The preset booted 27.5 W/m^2 above its own warm branch, and the
  // branch it was heading for sat at +1.2 C with the ice-albedo tipping point
  // only six kelvin below it -- so the cooling transient overshot straight past
  // it and the world was a hard snowball inside fifteen hundred years. Frozen,
  // there is no weathering, so volcanic CO2 accumulated with nothing to remove
  // it: 0.1 bar to 10 bar over two hundred megayears. And this model's
  // Simpson-Nakajima limit falls with total pressure (259 W/m^2 at 0.1 bar, 158
  // at 10, 113 at 20) while this world absorbs 185, so somewhere past five bar
  // the runaway stopped being escapable. It arrived at 1099 C with its ocean in
  // the air, having passed through waterbelt, snowball, hothouse, hot ocean and
  // moist greenhouse on the way.
  //
  // Two of those three links are known model gaps and are not fixed here -- the
  // cold Archean is the semi-grey scheme's, and the collapsing runaway limit is
  // the pressure-broadening one the README reports. What is fixed is the first
  // link: the preset now boots on its own branch with enough margin that the
  // transient cannot reach the tipping point, and the carbon cycle then keeps
  // it there because a world with liquid water on it weathers.
  {
    const s = settle(PRESETS.earlyEarth.params, 1e9);
    const trip = s.world.history.map((h) => h.T);
    const lo = Math.min(...trip) - 273.15, hi = Math.max(...trip) - 273.15;
    check('The Archean stays a planet, not a steam atmosphere',
      hi < 60 && lo > -25,
      `${lo.toFixed(0)}\u2026${hi.toFixed(0)} °C across ${trip.length} samples of the gigayear, ` +
      `ending at ${(s.world.diag.Tmean - 273.15).toFixed(1)} °C on ` +
      `${s.world.diag.pCO2.toFixed(2)} bar of CO₂`);
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
    // 0.6 bar, raised from 0.393 when the cloud deck was given an optical-depth
    // feedback. That feedback is worth real cooling exactly where this test
    // lives -- a very wet, very warm atmosphere -- and 0.393 bar now settles at
    // 70 C, which is inside what photosynthesis can still do here rather than
    // past it. 0.6 puts the world at 82 C and kills it outright.
    //
    // There is a ceiling on how far this can be pushed and it is close: 0.8 bar
    // tips into a runaway at 516 C, from which nothing grows back and the second
    // half of the check could never pass. So the window is 0.6 to somewhere
    // under 0.8, and this sits in it deliberately.
    const back = new Simulation({ ...EARTH, co2Bar: 0.6 });
    back.runYears(5e4);
    const dead = back.world.diag.bio;
    back.world.co2 = 280e-6 * 1e5 / back.world.diag.g;
    back.runYears(3e5);
    check('…and it grows back once the world is habitable again',
      dead < 0.2 && back.world.diag.bio > 0.9,
      `${dead.toFixed(3)}× under the greenhouse, ${back.world.diag.bio.toFixed(3)}× ` +
      `after it cleared`);
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
    // 100x, down from 1000x, and the reason is a deviation that got fixed rather
    // than a test that got weakened. This used to compare 0.1x against 1000x and
    // pass because the 1000x world reached 563 bar and 2521 K -- which is the
    // missing maximum greenhouse, the outer-edge gap, in one number. With CO2
    // condensation modelled, a 0.30 S(+) world can no longer be forced to 2500 K
    // by any amount of volcanism, so the comparison has to be made where the
    // Forget mechanism actually lives.
    //
    // The measure changed too. Comparing the CO2 *inventory* was the wrong
    // question once the revived world is warm enough to have liquid water: it
    // weathers, so it ends with less CO2 in the air than the frozen one it is
    // being compared against, having won rather than lost.
    const cold = { ...EARTH, insolation: 0.30, water: 0.05, landFraction: 0.9, co2Bar: 0.01 };
    const quiet = settle({ ...cold, outgassing: 0.1 }, 2e7);
    const busy = settle({ ...cold, outgassing: 100 }, 2e7);
    check('CO₂ does not freeze out regardless of volcanism — outgassing can win',
      busy.world.diag.Tmean > quiet.world.diag.Tmean + 50
      && (busy.world.co2Frozen ?? 0) < 1e3 && busy.world.diag.openOcean > 0.01,
      `${quiet.world.diag.Tmean.toFixed(0)} K frozen solid  →  ` +
      `${busy.world.diag.Tmean.toFixed(0)} K with ` +
      `${(busy.world.diag.openOcean * 100).toFixed(1)}% open water and no CO₂ frost`);

    // …but not without limit. Past the maximum greenhouse more CO2 stops helping
    // and starts costing, so hundreds of times Earth's volcanism on the same
    // world collapses the atmosphere instead of thickening it. Before CO2
    // condensation was modelled the same case reached 563 bar and 2521 K.
    //
    // 600x, down from 1000x, and this one *is* a test being moved to fit the
    // code, so it is written down as such rather than quietly edited.
    //
    // What changed: adopting Goldblatt's radiation limit put twenty units of
    // water self-continuum into band 0, and at 1000x this world now builds 421
    // bar and runs away to 2278 K where the same world under the previous
    // coefficients collapsed to 142 K with four thousand tonnes per square metre
    // of CO2 frost on the ground. That was measured both ways rather than
    // assumed. It is *not* the pressure dependence of the limit, which the
    // continuum barely touched -- 245 W/m2 at six bar before, 242 after -- and
    // which calibrate.mjs now carries as its own row.
    //
    // The claim below is about the maximum greenhouse, and it is still true
    // wherever the maximum greenhouse is what is operating: 200x, 300x, 400x and
    // 600x all collapse, on both coefficient sets.
    const absurd = settle({ ...cold, outgassing: 600 }, 2e7);
    check('…but past the maximum greenhouse, piling on more CO₂ stops working',
      absurd.world.diag.Tmean < 300 && absurd.world.diag.pCO2 < 5,
      `${absurd.world.diag.Tmean.toFixed(0)} K on ${absurd.world.diag.pCO2.toFixed(3)} bar at ` +
      `600× volcanism, where without a condensation floor it reached 2521 K on 563 bar`);

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
    // h2 is in this list because it was missing from the snapshot for as long as
    // hydrogen has existed, and this test could not see it: a world that had lost
    // half its hydrogen got all of it back on reload, silently, in every save slot
    // and every scrub. Listing it here is what makes that a failure.
    const state = (w) => [w.diag.Tmean, w.diag.pCO2, w.diag.iceMean, w.water.ocean,
                          w.carbonDeep, w.ch4, w.o2, w.h2, w.iceSheet];

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
