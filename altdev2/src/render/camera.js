import { clamp } from '../physics/constants.js';

export const PAN_SPEEDS = [0.5, 1, 2];
export const DEFAULT_PAN_SPEED = 1;

export function normalisedWheelPixels(deltaY, deltaMode = 0) {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
}

// Camera zoom is a distance multiplier: larger is farther away.
export function wheelZoomFactor(deltaY, deltaMode = 0) {
  const px = normalisedWheelPixels(deltaY, deltaMode);
  return Math.exp(clamp(px, -240, 240) * 0.0016);
}

export function panRadiansPerPixel(zoom, speed = DEFAULT_PAN_SPEED, minZoom = 0.42, maxZoom = 3) {
  return 0.0075 * clamp(zoom ?? 1, minZoom, maxZoom) * speed;
}
