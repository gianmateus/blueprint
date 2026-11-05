import { loadConfig } from '@ride/shared';
const { DATABASE_URL } = loadConfig(['DATABASE_URL']);
export const db = {
  insert: async (table: string, row: unknown) => ({ table, row, url: DATABASE_URL }),
  raw: async (sql: string) => ({ sql, url: DATABASE_URL, rows: [] as unknown[] }),
};
