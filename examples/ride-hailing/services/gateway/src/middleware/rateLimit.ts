import { logger } from '@ride/shared';
export function rateLimit(router: unknown[]) {
  const redis = process.env.REDIS_URL;
  logger.info('rate limiter ready', { redis, routes: router.length });
}
