import { db } from './db';
// Monthly statement for a rider. TODO: parameterise this query.
export async function monthlyReport(riderId: string) {
  return db.raw(`select sum(amount) from ledger where rider_id = '${riderId}' group by month`);
}
