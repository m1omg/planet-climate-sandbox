import { createWorld, resetWorld, update, stepTemperature, maxStep } from '../physics/climate.js';
import { stepVolatiles } from '../physics/volatiles.js';
import { clamp } from '../physics/constants.js';

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
    this.rate = 1e3;          // simulated years per real second
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
    Object.assign(this.world.params, patch);
    update(this.world, 0);
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
    update(w, dt);
    stepVolatiles(w, dt);
    w.time += dt;
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
