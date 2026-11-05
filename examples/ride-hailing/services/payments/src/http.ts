import { monthlyReport } from './reports';
type App = { get: (path: string, h: (req: any, res: any) => unknown) => void };
export function registerRoutes(app: App) {
  app.get('/reports/:riderId', async (req, res) => res.json(await monthlyReport(req.params.riderId)));
}
