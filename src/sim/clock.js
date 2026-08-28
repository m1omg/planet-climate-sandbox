import { createWorld, resetWorld, update, stepTemperature, maxStep } from '../physics/climate.js';
import { stepVolatiles } from '../physics/volatiles.js';
import { clamp } from '../physics/constants.js';
import { evolvedParams, brightnessAfter, radiogenic, EARTH_AGE, approach, walkRate }
  from '../physics/evolution.js';

// ---------------------------------------------------------------------------
// The clock. Physics advances on *simulated* time only.
//
// A frame hands the simulation however many simulated years elapsed; those
// years go into a credit account. Steps are then taken at a size chosen purely
// from the state of the planet (small while something is changing, up to
// millions of years while it is quiet), and a step is only taken when there is
// enough credit to pay for it in full. Because the step sequence never depends
// on where frame boundaries fell, 15 fps, 60 fps and a 500 ms stall all trace
// exactly the same trajectory.
// ---------------------------------------------------------------------------
export class Simulation {
  constructor(params) {
    this.world = createWorld(params);
    this.credit = 0;
    // A year a second. Fast enough to watch weather-scale change, slow enough
    // that the industrial CO2 the default world is emitting is legible as it
    // happens rather than being over before the first frame.
    this.rate = 1;            // simulated years per real second
    this.paused = false;
    this.maxStepsPerFrame = 4000;
    this.budgetMs = 12;       // hard wall-clock ceiling on physics per frame
    this.actualRate = 0;
    this.throttled = false;   // true when the budget, not the clock, is the limit
    this._acc = 0;
    this.onSample = null;
    this._nextSample = 0;
  }

  reset(params) {
    resetWorld(this.world, params);
    this.credit = 0;
    this._nextSample = 0;
    this.world.history.length = 0;
    this.sample();
  }

  setParams(patch) {
    const w = this.world;
    const p0 = { ...w.params };                 // where the controls were
    Object.assign(w.params, patch);
    // Moving a control that is currently evolving means "make it this NOW",
    // not "make it this at time zero". So the curve is re-based to pass through
    // the value just set at the age the world has actually reached; without
    // this the next step would recompute from t=0 and the drag would appear to
    // do nothing at all. Switching a mode on re-bases for the same reason, so
    // it starts from where the world already is instead of jumping.
    // Smoothing turns a change of starlight into a destination rather than a
    // jump. The control shows where the star is going; the star takes its time
    // getting there, which is what keeps it on a branch instead of across one.
    if (p0.smoothInsolation && 'insolation' in patch && w.time > 0) {
      w.insolationTarget = patch.insolation;
      // Fixed by the size of the move rather than by a fixed rate, so that a
      // walk from 1 to 100 S(+) takes the same twenty million years as one from
      // 1 to 1.5 rather than a hundred times longer. Recorded once, here: taking
      // it from the remaining distance every step would make the approach
      // asymptotic and it would never arrive.
      w.insolationRate = walkRate(p0.insolation, patch.insolation);
      w.params.insolation = p0.insolation;      // stay where we are; walk from here
    } else if ('insolation' in patch) {
      w.insolationTarget = null;
    }
    const touched = ['insolation', 'internalHeat', 'brightening', 'realisticGeology',
                     'startAge', 'xuvFraction', 'magneticField', 'outgassing',
                     'resurfacingAge', 'resurfacingBoost', 'resurfacingSpan'].some((k) => k in patch);
    if (touched) this.rebaseEvolution();
    update(w, 0);
  }

  // Make the evolution curves pass through the controls' present values at the
  // world's present age.
  rebaseEvolution() {
    const w = this.world, p = w.params;
    if (!w.evolve0) w.evolve0 = {};
    const gyr = Math.max(w.time, 0) / 1e9;
    if (p.brightening > 0) {
      const f = brightnessAfter(p.brightening, gyr);
      w.evolve0.insolation = f > 0 ? p.insolation / f : p.insolation;
    } else {
      w.evolve0.insolation = p.insolation;
    }
    if (p.realisticGeology) {
      const startAge = p.startAge ?? EARTH_AGE;
      const nowR = radiogenic(startAge + gyr), baseR = radiogenic(startAge);
      w.evolve0.internalHeat = nowR > 0 ? (p.internalHeat ?? 0) * baseR / nowR
                                        : (p.internalHeat ?? 0);
    } else {
      w.evolve0.internalHeat = p.internalHeat;
    }
    // The rest are along for the ride: they are only ever read from the base,
    // so re-basing them is just recording where the controls now stand.
    w.evolve0.xuvFraction = p.xuvFraction;
    w.evolve0.magneticField = p.magneticField;
    w.evolve0.outgassing = p.outgassing;
  }

  // realDt in seconds; returns simulated years actually advanced.
  advance(realDt) {
    if (this.paused) { this.actualRate = 0; return 0; }
    const dtReal = clamp(realDt, 0, 0.1);          // ignore huge stalls
    this.credit = Math.min(this.credit + dtReal * this.rate, this.rate * 4);
    return this.runCredit();
  }

  runCredit() {
    const w = this.world;
    const deadline = performance.now() + this.budgetMs;
    let advanced = 0, steps = 0;
    this.throttled = false;
    while (steps < this.maxStepsPerFrame) {
      const dt = Math.min(maxStep(w), this.rate * 0.3, 5e6);
      if (this.credit < dt) break;
      // Never blow the frame budget, however stiff the planet has become. A
      // difficult transition makes the simulated clock run slow; it must never
      // make the interface stop responding.
      if ((steps & 7) === 0 && performance.now() > deadline) { this.throttled = true; break; }
      this.credit -= dt;
      this.stepOnce(dt);
      advanced += dt;
      steps++;
    }
    // Unspent credit is capped so a long stall cannot bank a huge jump.
    this.credit = Math.min(this.credit, this.rate * 2);
    this.actualRate = advanced;
    return advanced;
  }

  // Advance exactly `years` of simulated time, ignoring the wall clock.
  // Used by the self-tests. `budgetMs` bounds how long it may block for.
  runYears(years, stepCap = 2e6, budgetMs = Infinity) {
    const w = this.world;
    const deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs;
    let done = 0, guard = 0;
    while (done < years && guard++ < 400000) {
      const dt = Math.min(maxStep(w), years - done, stepCap);
      this.stepOnce(dt);
      done += dt;
      if (deadline !== Infinity && (guard & 15) === 0 && performance.now() > deadline) break;
    }
    return done;
  }

  stepOnce(dt) {
    const w = this.world;
    // The world is left fully updated by whatever ran last -- reset, a
    // parameter change, or the previous step -- so re-deriving it here would
    // simply repeat work. Radiative transfer over eighteen bands is the
    // expensive part of a step, and this saves a third of it.
    w.dtPrev = dt;          // the step actually taken, for the size controller
    stepTemperature(w, dt);
    // Refresh the diagnostics before the reservoirs read them, so that
    // weathering, escape and the water partition see the temperature the step
    // just produced rather than the one it started from.
    //
    // Fast mode skips this, and the trade is a coherent one rather than a
    // corner cut: it makes every rate in the step be evaluated at the state the
    // step began in, which is a consistent explicit scheme, where the default
    // is a mixed one that costs a whole extra radiative transfer over eighteen
    // bands. The error it admits is bounded by the same thing everything else
    // here is bounded by -- maxStep will not let a band move more than about
    // two and a half kelvin in a step, so that is how stale the reservoirs' view
    // of the temperature can be.
    if (!w.fastPhysics) update(w, dt);
    stepVolatiles(w, dt);
    w.time += dt;
    // The star and the interior are functions of the world's age, so they are
    // set from the age it has just reached rather than integrated alongside it.
    const ev = evolvedParams(w.params, w.evolve0, w.time);
    if (ev.insolation !== undefined) w.params.insolation = ev.insolation;
    if (ev.internalHeat !== undefined) w.params.internalHeat = ev.internalHeat;
    if (ev.xuvFraction !== undefined) w.params.xuvFraction = ev.xuvFraction;
    if (ev.magneticField !== undefined) w.params.magneticField = ev.magneticField;
    if (ev.outgassing !== undefined) w.params.outgassing = ev.outgassing;
    // ...and then walk towards whatever the controls were last set to, if the
    // world is being asked to change smoothly. This runs after the evolution
    // above so that a brightening star and a hand on the slider compose:
    // the walk is towards the target, from wherever the star has got to.
    if (w.insolationTarget != null) {
      const next = approach(w.params.insolation, w.insolationTarget, dt, w.insolationRate);
      if (next === w.insolationTarget) { w.insolationTarget = null; w.insolationRate = undefined; }
      w.params.insolation = next;
      if (w.evolve0) w.evolve0.insolation = w.params.insolation
        / brightnessAfter(w.params.brightening ?? 0, Math.max(w.time, 0) / 1e9);
    }
    update(w, dt);

    if (w.time >= this._nextSample) {
      this.sample();
      this._nextSample = w.time + Math.max(1, w.time * 0.02);
    }
  }

  sample() {
    const w = this.world, dg = w.diag;
    w.history.push({
      t: w.time, T: dg.Tmean, Tmax: dg.Tmax, Tmin: dg.Tmin,
      ice: dg.iceMean, pCO2: dg.pCO2, pH2O: dg.pTotMean - dg.pN2 - dg.pCO2,
      ocean: w.water.ocean, seaIce: w.water.seaIce, landIce: w.water.landIce,
      // The airborne water, split where the critical point has been crossed.
      // One fluid physically; two very different things to look at.
      vap: w.water.vapour * (1 - (dg.superFrac || 0)),
      sup: w.water.vapour * (dg.superFrac || 0),
      lost: w.water.lost,
      flooded: dg.flooded, landFrac: dg.landFrac,
      alb: dg.absorbed / Math.max(1e-6, dg.S.reduce((a, b) => a + b, 0) / dg.S.length),
    });
    if (w.history.length > 4000) w.history.splice(0, 2000);
    if (this.onSample) this.onSample(w);
  }
}
