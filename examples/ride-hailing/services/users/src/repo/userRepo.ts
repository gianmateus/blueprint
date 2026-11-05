import { NotFound } from '@ride/shared';
import { db } from '../db';
export async function findUser(id: string) {
  const { rows } = await db.query('select * from users where id = $1', [id]);
  if (!rows[0]) throw new NotFound('User');
  return rows[0];
}
