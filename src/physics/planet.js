import { M_EARTH, R_EARTH, G_GRAV, EO_COLUMN, clamp } from './constants.js';

// Rocky mass-radius relation (Seager/Zeng-like): R ~ M^0.27 for silicate worlds.
export function radiusFromMass(massEarths) {
  return R_EARTH * Math.pow(massEarths, 0.27);
}

export function surfaceGravity(massEarths) {
  const R = radiusFromMass(massEarths);
  return G_GRAV * massEarths * M_EARTH / (R * R);
}

export function escapeVelocity(massEarths) {
  const R = radiusFromMass(massEarths);
  return Math.sqrt(2 * G_GRAV * massEarths * M_EARTH / R);
}

// Bigger planets keep their internal heat longer and outgas more per unit area.
export function outgassingScale(massEarths) {
  return clamp(Math.pow(massEarths, 0.7), 0.05, 6);
}

// How volcanically active this world is, relative to Earth at 1x.
//
// Melt production per unit area, NOT the CO2 that rides up with it. A mantle
// whose carbon is exhausted still erupts; it erupts volatile-poor lava. Tying
// the picture to the CO2 delivery would switch the volcanoes off on a world
// whose interior is still molten, which is neither what the model believes nor
// what Io looks like.
//
// And deliberately WITHOUT outgassingScale, which the carbon source does use.
// That factor is about how much volatile a bigger planet delivers per square
// metre; it is not about how much lava is on the ground. Including it read Io
// as a quarter of Earth's volcanism -- m^0.7 on 0.015 masses is 0.056, enough
// to bury a 4.7x heat flux -- which is exactly backwards for the most
// volcanically active body known. What the eye sees is melt vigour, and that is
// the heat coming out per unit area and the mantle's own activity, both of
// which are already here.
export const EARTH_INTERNAL_FLUX = 0.092;   // W/m^2
export function volcanicActivity(p) {
  const heat = Math.max(p.internalHeat ?? EARTH_INTERNAL_FLUX, 0);
  const melt = clamp(Math.sqrt(heat / EARTH_INTERNAL_FLUX), 0, 100);
  return Math.max(p.outgassing ?? 0, 0) * melt;
}

// Derived geometry / bookkeeping for a parameter set.
export function derive(params) {
  const g = surfaceGravity(params.mass);
  const R = radiusFromMass(params.mass);
  return {
    g, R,
    area: 4 * Math.PI * R * R,
    vesc: escapeVelocity(params.mass),
    // A column in kg/m^2 becomes this many bar of pressure
    colToBar: g / 1e5,
    barToCol: 1e5 / g,
    eoColumn: EO_COLUMN * (R_EARTH * R_EARTH) / (R * R), // 1 EO of water spread thinner on a bigger world
  };
}
