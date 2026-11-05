import { logger } from '@ride/shared';
import { buildRouter } from './router';
import { rateLimit } from './middleware/rateLimit';
const router = buildRouter();
rateLimit(router);
logger.info('gateway listening on :8080');
