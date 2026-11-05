import { AppError } from '@ride/shared';
import { stripe } from './stripeClient';
import { db } from './db';
export async function charge(riderId: string, amount: number) {
  if (amount <= 0) throw new AppError('Invalid amount', 400);
  const intent = await stripe.paymentIntents.create({ amount, currency: 'eur', metadata: { riderId } });
  await db.insert('ledger', { riderId, amount, intent: intent.id });
  return intent;
}
