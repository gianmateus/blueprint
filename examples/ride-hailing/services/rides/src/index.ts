import { logger } from '@ride/shared';
import { rideRoutes } from './routes/rides';
logger.info('rides service on :4002', { routes: rideRoutes.length });
