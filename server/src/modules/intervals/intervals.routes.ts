import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { asyncHandler, parse } from '../../shared/http';

/**
 * Глобальні інтервали перевірок (гідротест балона за матеріалом, заміна редуктора,
 * перевірка мембрани) — єдине джерело правди для всіх станцій проекту. Керує лише admin;
 * зміна одразу перераховує статуси ВСІХ існуючих одиниць (views читають значення динамічно).
 */
export const intervalsRouter = Router();
intervalsRouter.use(authenticate);
intervalsRouter.use(requireRole('admin'));

const LABELS: Record<string, string> = {
  hydro_metal: 'Гідротест — метал',
  hydro_composite: 'Гідротест — композит',
  reducer: 'Заміна редуктора',
  membrane: 'Перевірка мембрани',
  mask_inhale_valve: 'Маска — заміна клапану вдиху',
  mask_voice_membrane: 'Маска — заміна переговорної мембрани',
  mask_inspection: 'Маска — технічний огляд',
};

const patchSchema = z
  .object({
    hydro_metal: z.number().int().positive().optional(),
    hydro_composite: z.number().int().positive().optional(),
    reducer: z.number().int().positive().optional(),
    membrane: z.number().int().positive().optional(),
    mask_inhale_valve: z.number().int().positive().optional(),
    mask_voice_membrane: z.number().int().positive().optional(),
    mask_inspection: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

intervalsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT key, months, updated_at FROM interval_setting ORDER BY key`,
    );
    res.json({
      data: rows.map((r) => ({
        key: r.key,
        label: LABELS[r.key] ?? r.key,
        months: r.months,
        updated_at: r.updated_at,
      })),
    });
  }),
);

intervalsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    for (const [key, months] of Object.entries(body)) {
      await pool.query(
        `UPDATE interval_setting SET months = $2, updated_at = now(), updated_by = $3 WHERE key = $1`,
        [key, months, req.user!.id],
      );
    }
    const { rows } = await pool.query(
      `SELECT key, months, updated_at FROM interval_setting ORDER BY key`,
    );
    res.json({
      data: rows.map((r) => ({
        key: r.key,
        label: LABELS[r.key] ?? r.key,
        months: r.months,
        updated_at: r.updated_at,
      })),
    });
  }),
);
