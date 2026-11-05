import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_KEY ?? 'sk_test_51FAKEdemoKEYforBlueprint00');
