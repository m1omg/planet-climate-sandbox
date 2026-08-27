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
    // A year a second. Fast enough to watch weather-scale change, slow enough
    // that the industrial CO2 the default world is emitting is legible as it
    // happens rather than being over before the first frame.
    this.rate = 1;            // simulated years per real second
    this.paused = false;
    this.maxStepsPerFrame = 4000;
    this.budgetMs = 12;       // hard wall-clock ceiling on physics per frame
    // What a frame has actually been costing lately, in seconds. Both limits
    // below are shares of a frame rather than absolutes, and on a slow machine
    // the frame is not a sixtieth of a second. See advance().
    this.frameCost = 0;
    // Optional per-step hook for anything that moves a control on simulated
    // time. See stepOnce().
    this.drive = null;
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
    // How long a frame has really been taking. Both of the limits that follow
    // used to be absolutes tuned for a machine drawing sixty frames a second,
    // and on a machine drawing eight they were the reason the clock ran at a
    // fraction of the rate the slider claimed:
    //
    //   * credit was clamped at 0.1 s a frame, so anything under ten frames a
    //     second was paid for a tenth of a second however long the frame had
    //     actually taken -- at 5 fps that is half the clock thrown away, and
    //     silently, because the throttle flag reports the *physics* budget;
    //   * the physics budget was a flat 12 ms, which is a fifth of a 60 fps
    //     frame and six per cent of a 5 fps one. The slower the machine, the
    //     smaller the share of it the simulation was allowed to use.
    //
    // Both are shares of the observed frame now. A steady low frame rate keeps
    // its time and gets a proportionate slice to work in; a real stall -- a
    // backgrounded tab, a long GC pause -- is still cut off, because one long
    // frame barely moves the average and the ceilings are clamped anyway.
    const seen = clamp(realDt, 0, 1);
    this.frameCost = this.frameCost > 0
      ? this.frameCost + (seen - this.frameCost) * 0.1
      : seen;
    const dtReal = clamp(realDt, 0, clamp(this.frameCost * 3, 0.1, 1));
    this.credit = Math.min(this.credit + dtReal * this.rate, this.rate * 4);
    return this.runCredit();
  }

  // A quarter of the frame, never less than the 12 ms this was fixed at and
  // never more than 60. Responsiveness is a *share* of the frame: taking 50 ms
  // out of a 200 ms frame leaves exactly as much room to draw and handle input
  // as taking 12 out of 16 does.
  frameBudgetMs() {
    return clamp(this.frameCost * 250, this.budgetMs, 60);
  }

  runCredit() {
    const w = this.world;
    const deadline = performance.now() + this.frameBudgetMs();
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
    // Anything driving a control off simulated time runs here, on the clock it
    // claims to run on. A scenario's evolve() used to be applied from the
    // readout instead, ten times a real second -- which is ten times a second
    // whether that second is a year of simulated time or three hundred
    // megayears. At the top of the rate slider it was a 29 Myr staircase on a
    // curve with a 30 Myr e-folding: the Great Oxidation's biosphere jumped a
    // third of its whole range in one go, oxygen went with it, the methane
    // greenhouse vanished in a single step and the planet snowballed. That is
    // what "Huronian still runawaying" was.
    //
    // Placed after the clock advances and before the last update(), so the
    // diagnostics the next step reads are built with the new value and it costs
    // nothing: there is no extra update() call here.
    if (this.drive) this.drive(w);
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
