import { logger } from '@ride/shared';
import { verifyToken } from './tokens';
import { findUser } from './repo/userRepo';
export async function handleVerify(token: string) {
  const { userId } = verifyToken(token);
  return findUser(userId);
}
logger.info('users service on :4001');
