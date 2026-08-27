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
