import { logger } from '@ride/shared';
export function subscribe(topic: string, fn: (e: unknown) => void) {
  logger.info('subscribed', { topic, broker: process.env.AMQP_URL });
  return fn;
}
