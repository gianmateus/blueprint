import { httpJson } from '@ride/shared';
export const paymentRoutes = () => [
  { method: 'POST', path: '/payments', handler: async (req: any) => httpJson(`${process.env.PAYMENTS_URL}/charge`, { method: 'POST', body: JSON.stringify(req.body) }) },
];
