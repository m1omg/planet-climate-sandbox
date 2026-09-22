import {P_CRIT_H2O} from './constants.js';
// Temperatures the model actually resolves, not the visible cloud-top colour.
// A buried pool has one top temperature, so no fictitious latitude range is
// attached to it. Fully supercritical water has no liquid surface to report.
export function surfaceTemperature(dg) {
  if (dg.lidded) {
    const cp=dg.coldPool;
    if (cp && cp.liquidDepth>cp.superDepth && Number.isFinite(dg.coldT))
      return {surfaceT:dg.coldT,surfaceMin:dg.coldT,surfaceMax:dg.coldT,surfaceKind:'buried ocean'};
    if ((dg.pTotMean ?? 0)*1e5>=P_CRIT_H2O)
      return {surfaceT:null,surfaceMin:null,surfaceMax:null,surfaceKind:'no liquid surface'};
  }
  return {surfaceT:dg.Tmean,surfaceMin:dg.Tmin,surfaceMax:dg.Tmax,surfaceKind:'surface'};
}

export function temperaturePoint(world) {
  const d=world.diag;
  return {t:world.time,T:d.Tmean,Tmin:d.Tmin,Tmax:d.Tmax,...surfaceTemperature(d)};
}

// A live endpoint also covers paused slider edits and the interval between
// stored samples. Drawing never mutates the saved timeline or its checkpoints.
// `keepFuture` is the history scrubber's drag: the world stands at an earlier
// time while the array still holds everything after it, and the chart dims
// that span to show what letting go would discard. Filtering it away here
// drew the dimming over an empty plot while the water chart, reading the raw
// array, still showed it -- two charts disagreeing about one drag.
export function temperatureHistory(world, keepFuture = false) {
  const live = temperaturePoint(world);
  const past = world.history.filter(p=>p.t<world.time);
  if (!keepFuture) return [...past, live];
  const future = world.history.filter(p=>p.t>world.time);
  return [...past, live, ...future];
}
