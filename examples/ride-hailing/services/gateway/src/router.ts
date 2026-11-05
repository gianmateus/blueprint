import { ridesRoutes } from './routes/rides';
import { paymentRoutes } from './routes/payments';
import { authenticate } from './middleware/auth';
export function buildRouter() {
  const routes = [...ridesRoutes(), ...paymentRoutes()];
  return routes.map((r) => ({ ...r, handler: authenticate(r.handler) }));
}
