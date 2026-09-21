// Temperatures the model actually resolves, not the visible cloud-top colour.
// A buried pool has one top temperature, so no fictitious latitude range is
// attached to it. Fully supercritical water has no liquid surface to report.
export function surfaceTemperature(dg) {
  if (dg.lidded) {
    const cp=dg.coldPool;
    if (cp && cp.liquidDepth>cp.superDepth && Number.isFinite(dg.coldT))
      return {surfaceT:dg.coldT,surfaceMin:dg.coldT,surfaceMax:dg.coldT,surfaceKind:'buried ocean'};
    return {surfaceT:null,surfaceMin:null,surfaceMax:null,surfaceKind:'no liquid surface'};
  }
  return {surfaceT:dg.Tmean,surfaceMin:dg.Tmin,surfaceMax:dg.Tmax,surfaceKind:'surface'};
}
