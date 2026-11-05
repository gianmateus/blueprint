import { logger } from '@ride/shared';
const broker = process.env.AMQP_URL;
export async function publish(topic: string, payload: unknown) { logger.info('publish', { broker, topic, payload }); }
