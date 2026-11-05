import { httpJson, AppError } from '@ride/shared';
type Handler = (req: { headers: Record<string, string> }) => Promise<unknown>;
export function authenticate(next: Handler): Handler {
  return async (req) => {
    const token = req.headers.authorization;
    if (!token) throw new AppError('Unauthorized', 401);
    await httpJson(`${process.env.USERS_URL}/verify`, { method: 'POST', body: JSON.stringify({ token }) });
    return next(req);
  };
}
