import { logger } from '@ride/shared';
import { charge } from './ledger';
import { subscribe } from './events/subscriber';
import { registerRoutes } from './http';
subscribe('ride.completed', (e: any) => charge(e.riderId, e.price));
registerRoutes({ get: () => undefined });
logger.info('payments service on :4003');
