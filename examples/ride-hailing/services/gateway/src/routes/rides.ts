import { httpJson } from '@ride/shared';
export const ridesRoutes = () => [
  { method: 'POST', path: '/rides', handler: async (req: any) => httpJson(`${process.env.RIDES_URL}/rides`, { method: 'POST', body: JSON.stringify(req.body) }) },
  { method: 'GET', path: '/rides/:id', handler: async (req: any) => httpJson(`${process.env.RIDES_URL}/rides/${req.params.id}`) },
];
