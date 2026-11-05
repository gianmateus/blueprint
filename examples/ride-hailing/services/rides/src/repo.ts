import { loadConfig, NotFound } from '@ride/shared';
const { DATABASE_URL } = loadConfig(['DATABASE_URL']);
const rides = new Map<string, any>();
export async function saveRide(r: any) { const id = String(rides.size + 1); rides.set(id, { id, ...r, db: DATABASE_URL }); return rides.get(id); }
export async function getRide(id: string) { const r = rides.get(id); if (!r) throw new NotFound('Ride'); return r; }
