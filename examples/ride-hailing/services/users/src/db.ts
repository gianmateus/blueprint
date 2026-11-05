import { loadConfig } from '@ride/shared';
const { DATABASE_URL } = loadConfig(['DATABASE_URL']);
export const db = { query: async (sql: string, params: unknown[] = []) => ({ sql, params, url: DATABASE_URL, rows: [] as any[] }) };
