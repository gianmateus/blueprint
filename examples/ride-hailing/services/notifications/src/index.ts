import { logger } from '@ride/shared';
import { sendPush } from './senders/push';
import { sendEmail } from './senders/email';
const broker = process.env.AMQP_URL;
export function onRideRequested(e: { riderId: string }) { sendPush(e.riderId, 'Your driver is on the way'); sendEmail(e.riderId, 'Ride confirmed'); }
logger.info('notifications consuming', { broker });
