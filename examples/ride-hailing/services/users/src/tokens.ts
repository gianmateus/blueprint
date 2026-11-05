import { AppError } from '@ride/shared';
import { cache } from './cache';
export function verifyToken(token: string): { userId: string } {
  const cached = cache.get(token);
  if (cached) return { userId: cached };
  const [, payload] = token.split('.');
  if (!payload) throw new AppError('Invalid token', 401);
  return JSON.parse(Buffer.from(payload, 'base64').toString());
}
