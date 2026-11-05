import { AppError } from './errors';
export async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new AppError(`Upstream ${url} answered ${res.status}`, 502);
  return res.json() as Promise<T>;
}
