import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { assertRecordInScope, resolveStationScope } from '../../middleware/stationScope';
import { errors } from '../../shared/errors';
import { asyncHandler, parse } from '../../shared/http';
import { listEnvelope, offsetOf } from '../../shared/pagination';

/**
 * Архів видалених балонів/ложаментів (MVP, read-only). Записи створюються сервісами
 * cylinders/backplates при DELETE — тут лише перегляд. master/admin, станційний скоупінг.
 */
export const archiveRouter = Router();
archiveRouter.use(authenticate);
archiveRouter.use(requireRole('master', 'admin'));

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).optional(),
  entity_type: z.enum(['cylinder', 'backplate']).optional(),
});

archiveRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const stationId = resolveStationScope(req);
    const where = ['a.station_id = $1'];
    const params: unknown[] = [stationId];
    if (q.entity_type) {
      params.push(q.entity_type);
      where.push(`a.entity_type = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`a.label ILIKE $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n FROM deleted_entity_archive a ${whereSql}`,
      params,
    );
    const { rows } = await pool.query(
      `SELECT a.id, a.station_id, a.entity_type, a.entity_id, a.label, a.deleted_at, a.deleted_by,
              u.full_name AS deleted_by_name
         FROM deleted_entity_archive a
         LEFT JOIN app_user u ON u.id = a.deleted_by
         ${whereSql}
        ORDER BY a.deleted_at DESC
        LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    res.json(
      listEnvelope(
        rows.map((r) => ({
          id: r.id,
          station_id: r.station_id,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          label: r.label,
          deleted_at: r.deleted_at,
          deleted_by: r.deleted_by ? { id: r.deleted_by, full_name: r.deleted_by_name } : null,
        })),
        { page: q.page, limit: q.limit, total: total.rows[0].n },
      ),
    );
  }),
);

archiveRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT a.id, a.station_id, a.entity_type, a.entity_id, a.label, a.snapshot,
              a.deleted_at, a.deleted_by, u.full_name AS deleted_by_name
         FROM deleted_entity_archive a
         LEFT JOIN app_user u ON u.id = a.deleted_by
        WHERE a.id = $1`,
      [req.params.id],
    );
    const row = rows[0];
    if (!row) throw errors.notFound('Запис архіву не знайдено');
    assertRecordInScope(req.user!, row.station_id);
    res.json({
      id: row.id,
      station_id: row.station_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      label: row.label,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by ? { id: row.deleted_by, full_name: row.deleted_by_name } : null,
      snapshot: row.snapshot,
    });
  }),
);
