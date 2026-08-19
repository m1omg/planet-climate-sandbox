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
    this.maxStepsPerFrame = 240;
    this.actualRate = 0;
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
    let advanced = 0, steps = 0;
    while (steps < this.maxStepsPerFrame) {
      const dt = Math.min(maxStep(w), this.rate * 0.3, 5e6);
      if (this.credit < dt) break;
      this.credit -= dt;
      this.stepOnce(dt);
      advanced += dt;
      steps++;
    }
    this.actualRate = advanced;
    return advanced;
  }

  // Advance exactly `years` of simulated time, ignoring the wall clock.
  // Used by the self-tests and the "settle" button.
  runYears(years, stepCap = 2e6) {
    const w = this.world;
    let done = 0, guard = 0;
    while (done < years && guard++ < 400000) {
      const dt = Math.min(maxStep(w), years - done, stepCap);
      this.stepOnce(dt);
      done += dt;
    }
    return done;
  }

  stepOnce(dt) {
    const w = this.world;
    update(w, dt);
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
      ocean: w.water.ocean, iceW: w.water.ice, vap: w.water.vapour, lost: w.water.lost,
      alb: dg.absorbed / Math.max(1e-6, dg.S.reduce((a, b) => a + b, 0) / dg.S.length),
    });
    if (w.history.length > 4000) w.history.splice(0, 2000);
    if (this.onSample) this.onSample(w);
  }
}
