import { nearestDriver, type Point } from './matching';
export function estimateArrival(a: Point, b: Point) {
  return Math.round(Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111 * 2);
}
export function etaForPickup(p: Point) {
  const d = nearestDriver(p);
  return d ? estimateArrival(d.at, p) : null;
}
