import { AppError } from './errors';
export function loadConfig<K extends string>(keys: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = process.env[k];
    if (!v) throw new AppError(`Missing env ${k}`);
    out[k] = v;
  }
  return out;
}
