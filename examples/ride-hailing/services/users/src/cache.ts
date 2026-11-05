import { verifyToken } from './tokens';
const url = process.env.REDIS_URL;
const store = new Map<string, string>();
export const cache = { get: (k: string) => store.get(k), set: (k: string, v: string) => store.set(k, v), url };
export function refresh(token: string) { store.set(token, verifyToken(token).userId); }