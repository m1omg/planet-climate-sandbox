import { createWorld, resetWorld, update, stepTemperature, maxStep, NBANDS, DX, X } from '../physics/climate.js';
import { stepVolatiles } from '../physics/volatiles.js';
import { clamp, smoothstep, YEAR } from '../physics/constants.js';
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
// How much the climate may change per wall-clock second while the auto-ease
// governor is on, as a FRACTION of the temperature rather than in kelvin.
//
// Kelvin per second was the obvious unit and it does not work, because the two
// events this exists for are not the same size. A snowball is a thirty-kelvin
// fall and a runaway greenhouse is a seven-hundred-kelvin climb, so any fixed
// number of degrees a second either flicks past the first or takes two minutes
// over the second. In log temperature they are 0.14 and 1.2 -- within a factor
// of nine of each other -- and 5%/s puts the glaciation in about three seconds
// and the runaway in about twenty-five.
const EASE_TARGET = 0.10;      // |d ln T| per wall-clock second

// Measured, because the number above is not the whole story. At ten Myr a
// second a runaway greenhouse goes from temperate to boiling in 0.05 s of wall
// clock with this off and 2.8 s with it on; a glaciation goes 0.02 s to 1.3 s.
// Both are rate-independent -- asking for a hundred Myr a second gives the same
// 2.8 s -- and a settled Earth is untouched, running its full hundred million
// years in six hundred frames with the governor armed.
//
// 2.8 s is a floor rather than the target, and lowering EASE_TARGET does not
// move it: maxStep has bounds of its own that a smaller requested step does not
// get under. Ninety times slower is the feature working; getting the last
// factor of nine means arguing with the step-size estimator, which is a
// different job than this one.

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
    // Auto-ease: hold the clock back through a tipping so it can be watched.
    this.autoEase = false;
    this.easeFactor = 1;      // what it is currently doing to the rate, for the UI
    this.easeRate = null;     // the rate it has settled on, null when not engaged
    this.easing = 0;          // 0 = free, 1 = fully held back; continuous, never a switch
    this.reach = 0;           // kelvin this climate can still move before it is at rest
    this.tau = Infinity;      // years it takes to get most of the way there
    this.span = 0;            // that reach as a fraction of the mean temperature, smoothed
    this.lnPerYear = 0;       // |d ln T| per simulated year the planet actually covered
    this.climateSpeed = 0;    // |d ln T| per wall-clock second, measured
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
                     'xuvDecay',
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
      const f = brightnessAfter(p, gyr);
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

  // Auto-ease: how far the world is allowed to move in one frame.
  //
  // A runaway greenhouse takes about a hundred thousand years and a glaciation
  // rather less. At the ten-Myr-a-second most of this game is played at, both
  // of them happen inside a single frame: the planet is temperate, and then it
  // is not, and the transition every one of these worlds is *about* is the one
  // thing the player never gets to see. So when this is on, the clock is held
  // to a fixed number of degrees per wall-clock second and the tipping plays
  // out over several of them.
  //
  // It is a governor on measured change, not a detector for two named events.
  // That is deliberate: it catches a runaway and a snowball, and it also
  // catches a CO2 collapse, a nightside freeze-out and anything else this model
  // can do that a list would have missed. A planet that is merely drifting
  // changes by microkelvins a year and never trips it.
  //
  // It has to act INSIDE the frame rather than by turning the rate down for the
  // next one. A runaway takes about five hundred simulated years; one frame at
  // ten Myr a second is a hundred and sixty thousand. By the time a controller
  // watching the last frame could react, there is nothing left to slow down --
  // measured, and it was three frames from temperate to boiling with the
  // feedback loop running. So the budget is spent step by step and the frame
  // simply stops when it runs out, which needs no prediction at all.
  // realDt in seconds; returns simulated years actually advanced.
  advance(realDt) {
    if (this.paused) { this.actualRate = 0; return 0; }
    const dtReal = clamp(realDt, 0, 0.1);          // ignore huge stalls
    const eff = this.governedRate();
    this.credit = Math.min(this.credit + dtReal * eff, eff * 2);
    return this.runCredit(eff, dtReal);
  }

  // The rate the governor is willing to run at, in simulated years per wall
  // second. Continuous in the state of the planet, so it cannot alternate.
  //
  // This is a rate limiter and not a per-frame allowance, which is the third
  // and last version of this thing. An allowance cuts the frame off the moment
  // it is spent, and a frame cut short advances a different amount from one run
  // full -- so the clock alternated between roughly half the rate and roughly
  // one and a half times it, on any world sitting near the target. Every
  // patch for that (hysteresis, a smooth dial, not banking the declined time)
  // narrowed the swing without removing its cause, because the cause is the cut
  // itself.
  //
  // What forced the cut was lag: at 10 Myr/s a frame is 160 000 years and a
  // whole runaway is 500, so a controller that waits to see how far the last
  // frame got has nothing left to slow down. That argument does not apply to a
  // controller that reads the planet's tendency *before* stepping it. maxStep
  // computes that tendency anyway; here it is called once on the current state,
  // which costs one extra evaluation per frame while the governor is on and
  // nothing at all while it is off.
  governedRate() {
    const w = this.world;
    if (!this.autoEase || !(w.diag.Tmean > 0)) {
      this.easing = 0; this.easeRate = null; this.easeFactor = 1;
      return this.rate;
    }
    maxStep(w, 2.5);                       // fills tendency and damping for free
    const sol = w._solve;
    const dT = sol && sol.tend && sol.tend.dT, k = sol && sol.k, C = w.diag.C;
    if (dT && k && C) {
      // How far this planet can actually go, and how long it takes to get
      // there. The tendency alone is the initial slope, and using it directly
      // held every world in the model to a few percent of its rate: a settled
      // Earth carries a perfectly ordinary instantaneous tendency and simply
      // does not go anywhere, because it is damped. What decides whether there
      // is anything to watch is the equilibrium offset, dT * C / k, and the
      // relaxation time C / k that governs how much of it is reached.
      // Damped by the same thing maxStep's own linearisation damps by:
      // radiation AND lateral transport. Radiation alone is not the planet's
      // restoring force -- on a tidally locked world transport is the larger
      // term by far, since it is what carries the day side's heat to the night
      // side -- and leaving it out made the reach fifteen times too large and
      // held TRAPPIST-1e to eight percent of a rate it did not need holding at.
      const D = sol.tend.D;
      let offset = 0, tauSum = 0, unbounded = false;
      for (let i = 0; i < NBANDS; i++) {
        const eL = -1 + DX * i, eR = -1 + DX * (i + 1);
        const wL = i === 0 ? 0 : D * (1 - eL * eL) / (DX * DX);
        const wR = i === NBANDS - 1 ? 0 : D * (1 - eR * eR) / (DX * DX);
        const wsum = wL + wR;
        const di = Math.max(k[i], -0.4 * wsum - 0.05) + wsum;
        if (!(di > 1e-12)) { unbounded = true; break; }
        offset += (C[i] * dT[i] / di) / NBANDS;    // signed: opposite bands cancel
        tauSum += (C[i] / di) / NBANDS;
      }
      // A non-positive damping is a planet with no equilibrium to relax to --
      // the runaway -- so the offset is unbounded and the whole rate is
      // available to be spent watching it.
      this.reach = unbounded ? Infinity : Math.abs(offset);
      this.tau = unbounded ? Infinity : tauSum / YEAR;   // years
    }
    // At R years per wall second, a relaxing planet covers
    //   reach * (1 - exp(-R / tau))
    // kelvin in one second of watching. Solve that for the R that covers
    // exactly the target, and take it if it is slower than what was asked for.
    // A world whose entire reach is below the target -- which is most of them,
    // most of the time -- has no solution and is never held back at all,
    // however fast the clock is set. That is the property every earlier version
    // of this got wrong in one direction or the other.
    // Smoothed, and this is not cosmetic. On a tidally locked world the bands
    // are not moving together: a night side still falling while a day side has
    // settled means the NET mean tendency passes through zero, so the reach
    // computed from it collapses to nothing and comes back a frame later. The
    // governor let go and grabbed on 163 times in 240 frames on TRAPPIST-1e.
    // Instant to rise and slow to fall, so a transition is still caught on the
    // frame it starts while a zero crossing underneath it is simply ridden over.
    const raw = w.diag.Tmean > 0 ? (this.reach ?? 0) / w.diag.Tmean : 0;
    this.span = raw > this.span ? raw : this.span + 0.06 * (raw - this.span);
    const span = this.span;
    // Two ways a planet can be worth slowing down for, and they need separate
    // answers because one of them is invisible to the other.
    //
    // A world relaxing toward a fixed point covers `span` and stops, so what it
    // shows in one second of watching is span*(1 - exp(-R/tau)) and a world
    // whose whole span is under the target is never held back however fast the
    // clock runs. That is the glaciation, and it is most of the model.
    //
    // A runaway is not that. Its fixed point runs away in front of it -- water
    // vapour moves the equilibrium as fast as the surface chases it -- so the
    // instantaneous offset stays small while the planet travels two hundred
    // kelvin. Reach alone says there is nothing to see and lets it past at full
    // speed, which is exactly what it did. The driven case has to be measured
    // instead of predicted, and measuring it is safe here in a way it was not
    // before: this is a rate limiter now, so the frames it measures are all
    // being run at about the same size and the reading has a fixed point rather
    // than an oscillation.
    let eff = this.rate;
    if (span > EASE_TARGET && this.tau < Infinity) {
      const r = -this.tau * Math.log(1 - EASE_TARGET / span);
      if (r > 0 && isFinite(r)) eff = Math.min(eff, r);
    } else if (this.tau === Infinity && span > 0) {
      eff = Math.min(eff, EASE_TARGET / Math.max(this.lnPerYear, 1e-30));
    }
    if (this.lnPerYear > 0) eff = Math.min(eff, EASE_TARGET / this.lnPerYear);
    // Slow the clock, never stop it -- but an ABSOLUTE floor, not a fraction of
    // the rate that was asked for. A proportional one silently undid the whole
    // governor at speed: at 10 Myr/s a floor of rate*1e-4 is a thousand years a
    // second, and the limiter had asked for less than one. The runaway went by
    // in a third of a second with the ease on and every dial reading as though
    // it were engaged.
    eff = Math.max(eff, 1e-6);
    this.easing = this.rate > 0 ? clamp(1 - eff / this.rate, 0, 1) : 0;
    this.easeRate = eff < this.rate ? eff : null;
    this.easeFactor = this.rate > 0 ? Math.min(1, eff / this.rate) : 1;
    return eff;
  }

  runCredit(rate = this.rate, dtReal = 0) {
    const w = this.world;
    const deadline = performance.now() + this.budgetMs;
    let advanced = 0, steps = 0;
    const T0 = w.diag.Tmean;
    // A backstop for the first frame of a transition, and only that.
    //
    // The rate limiter above cannot catch an onset, because it reads the frame
    // before: at 10 Myr/s a frame is 160 000 years and a whole runaway is 500,
    // so the first frame goes from temperate to boiling before anything has
    // been measured. Cutting the frame off is the only thing that can stop
    // that, and cutting frames is what made every earlier version alternate --
    // a cut frame advances a different amount from a full one.
    //
    // Thirty times the budget is the reconciliation, and the margin is wide on
    // purpose. An onset overshoots by four orders of magnitude, so a wide guard
    // still stops it dead; ordinary drift on a world merely getting on with its
    // life overshoots by two or three, and a tight guard chopped those frames
    // too -- an Archean at 10 Myr/s ran at a fifth of its rate for no reason but
    // this. What must never happen is this firing twice in a row on the same
    // world, because that is a cut frame every frame, which is the alternation
    // the rate limiter exists to remove.
    const guard = this.autoEase && dtReal > 0 ? 30 * EASE_TARGET * dtReal : Infinity;
    this.throttled = false;
    while (steps < this.maxStepsPerFrame) {
      const room = Math.min(maxStep(w, 2.5), rate * 0.3, 5e6);
      // Spend what is in hand rather than refusing to move until a whole step
      // is affordable. Whenever the solver would allow a step larger than one
      // frame's credit -- most of a calm world's life -- the frame used to take
      // no step at all and bank instead, so the clock ran in bursts with dead
      // frames between them at every rate, governor or no governor: 76% of
      // frames advancing nothing, in runs of up to nine. A dt below maxStep is
      // the accurate direction, and it honours the rate exactly rather than on
      // average.
      const dt = Math.min(room, this.credit);
      // Below a thousandth of what the solver would allow, a step is not worth
      // its own overhead; bank it and let the next frame afford more.
      if (!(dt > 0) || dt < room * 1e-3) break;
      // Never blow the frame budget, however stiff the planet has become. A
      // difficult transition makes the simulated clock run slow; it must never
      // make the interface stop responding.
      if ((steps & 7) === 0 && performance.now() > deadline) { this.throttled = true; break; }
      this.credit -= dt;
      this.stepOnce(dt);
      advanced += dt;
      steps++;
      if (guard < Infinity && T0 > 0 && w.diag.Tmean > 0
        && Math.abs(Math.log(w.diag.Tmean / T0)) >= guard) break;
    }
    // Unspent credit is capped so a long stall cannot bank a huge jump.
    this.credit = Math.min(this.credit, rate * 2);
    // How fast the climate appeared to move, per wall-clock second, at the rate
    // this frame actually ran at.
    if (dtReal > 0 && T0 > 0 && w.diag.Tmean > 0) {
      this.climateSpeed = Math.abs(Math.log(w.diag.Tmean / T0)) / dtReal;
    }
    // What the planet actually covered, per simulated year. This is the driven
    // term: it sees a runaway that the linearised reach cannot. Instant to rise
    // so the second frame of a transition is already held back, slow to fall so
    // coming out of one is a glide rather than a step.
    if (this.autoEase && advanced > 0 && T0 > 0 && w.diag.Tmean > 0) {
      const perYear = Math.abs(Math.log(w.diag.Tmean / T0)) / advanced;
      this.lnPerYear = perYear > this.lnPerYear
        ? perYear : this.lnPerYear + 0.05 * (perYear - this.lnPerYear);
    }
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
        / brightnessAfter(w.params, Math.max(w.time, 0) / 1e9);
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
