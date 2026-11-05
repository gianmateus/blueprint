import { logger } from '@ride/shared';
export const sendPush = (userId: string, text: string) => logger.info('push', { userId, text });
