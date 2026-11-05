import { estimateArrival } from './eta';
import { quote } from '../clients/pricing';
import { saveRide } from '../repo';
import { publish } from '../events/publisher';
import { getRider } from '../clients/users';
import { driversNear } from '../clients/geo';
export type Point = { lat: number; lng: number };
export const drivers: { id: string; at: Point }[] = [];
export function nearestDriver(p: Point) {
  return drivers.sort((a, b) => Math.hypot(a.at.lat - p.lat, a.at.lng - p.lng) - Math.hypot(b.at.lat - p.lat, b.at.lng - p.lng))[0];
}
export async function requestRide(riderId: string, from: Point, to: Point) {
  await getRider(riderId);
  await driversNear(from.lat, from.lng);
  const driver = nearestDriver(from);
  const price = await quote(from, to);
  const eta = estimateArrival(driver.at, from);
  const ride = await saveRide({ riderId, driverId: driver.id, price, eta });
  await publish('ride.requested', ride);
  return ride;
}
