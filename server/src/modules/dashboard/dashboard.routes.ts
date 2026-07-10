import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { resolveStationScope } from '../../middleware/stationScope';
import { asyncHandler, parse } from '../../shared/http';
import { getStationAlerts } from './alerts.service';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

const querySchema = z.object({
  status: z
    .string()
    .default('overdue,warning')
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(z.array(z.enum(['ok', 'warning', 'overdue'])).min(1)),
  station_id: z.string().uuid().optional(),
});

/** GET /dashboard/alerts — мейнборд: лічильники чипів + плоский список (api-contract.md §11). */
dashboardRouter.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const query = parse(querySchema, req.query);
    const stationId = resolveStationScope(req);
    const { counters, items } = await getStationAlerts(stationId);
    const wanted = new Set(query.status);
    res.json({
      counters,
      data: items
        .filter((i) => wanted.has(i.status))
        .map(({ sortKey: _sortKey, ...item }) => item),
    });
  }),
);
