import { logger } from '@ride/shared';
export const sendEmail = (userId: string, subject: string) => logger.info('email', { userId, subject });
