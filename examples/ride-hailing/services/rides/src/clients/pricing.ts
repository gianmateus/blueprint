import { httpJson } from '@ride/shared';
import type { Point } from '../domain/matching';
export async function quote(from: Point, to: Point) {
  return httpJson<{ price: number }>(`${process.env.PRICING_URL}/quote`, { method: 'POST', body: JSON.stringify({ from, to }) });
}
