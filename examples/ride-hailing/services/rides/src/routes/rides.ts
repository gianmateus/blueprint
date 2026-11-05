import { requestRide } from '../domain/matching';
import { getRide } from '../repo';
export const rideRoutes = [
  { method: 'POST', path: '/rides', handler: (body: any) => requestRide(body.riderId, body.from, body.to) },
  { method: 'GET', path: '/rides/:id', handler: (id: string) => getRide(id) },
];
