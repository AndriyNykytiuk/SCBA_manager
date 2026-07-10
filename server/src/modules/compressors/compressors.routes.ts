import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import {
  assertRecordInScope,
  resolveStationScope,
  resolveWriteStation,
} from '../../middleware/stationScope';
import { AppError, errors } from '../../shared/errors';
import { asyncHandler, parse } from '../../shared/http';
import { listEnvelope, listQuerySchema, offsetOf, parseSort } from '../../shared/pagination';
import { compressorCondition, round2 } from '../../shared/status';
import { diffChanges, writeAudit } from '../audit/audit.service';
import {
  COMPRESSOR_CARD_SELECT,
  fetchMaintenanceLevels,
  fillSessionSummary,
  fmtHours,
  getCompressorCard,
  getCompressorRowOr404,
  nextMaintenance,
  serializeCompressor,
  suggestedLevel,
} from './compressors.service';

export const compressorsRouter = Router();
compressorsRouter.use(authenticate);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Очікується дата YYYY-MM-DD');
const todayIso = () => new Date().toISOString().slice(0, 10);

const levelSchema = z.union([
  z.literal(25),
  z.literal(125),
  z.literal(500),
  z.literal(1000),
  z.literal(2000),
]);

const createSchema = z
  .object({
    name: z.string().trim().min(1),
    manufacturer: z.string().trim().min(1).nullish(),
    model: z.string().trim().min(1).nullish(),
    initial_engine_hours: z.number().min(0).default(0),
    initial_maintenance_at: dateStr.nullish(),
    initial_maintenance_hours: z.number().min(0).nullish(),
    notes: z.string().trim().min(1).nullish(),
    station_id: z.string().uuid().optional(), // admin
  })
  .superRefine((v, ctx) => {
    if (
      v.initial_maintenance_hours != null &&
      v.initial_maintenance_hours > v.initial_engine_hours
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['initial_maintenance_hours'],
        message: 'Наробіток на момент останнього ТО не може перевищувати поточний лічильник',
      });
    }
    if (v.initial_maintenance_at && v.initial_maintenance_at > todayIso()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['initial_maintenance_at'],
        message: 'Дата останнього ТО не може бути в майбутньому',
      });
    }
  });

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    manufacturer: z.string().trim().min(1).nullable().optional(),
    model: z.string().trim().min(1).nullable().optional(),
    notes: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

const maintenanceSchema = z.object({
  level: levelSchema,
  performed_at: dateStr
    .default(todayIso)
    .refine((d) => d <= todayIso(), { message: 'Дата ТО не може бути в майбутньому' }),
  engine_hours_at: z.number().min(0).optional(), // дефолт — поточний наробіток (з VIEW)
  notes: z.string().trim().min(1).nullish(),
});

const historyTypeSchema = z.object({
  type: z.enum(['all', 'maintenance', 'fill_session']).default('all'),
});

/** Розрахований статус компресора (найгірший рівень ТО) — для фільтра ?status=. */
const STATUS_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN bool_or(d.status = 'overdue') THEN 'overdue'
               WHEN bool_or(d.status = 'warning') THEN 'warning'
               ELSE 'ok'
             END AS status
        FROM v_compressor_maintenance_due d
       WHERE d.compressor_id = c.id
    ) st ON true`;

async function assertNameFree(stationId: string, name: string, excludeId?: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM compressor
      WHERE station_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL
        AND id <> COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [stationId, name, excludeId ?? null],
  );
  if (rows[0]) throw errors.duplicateName(`Компресор «${name}» вже існує на цій станції`);
}

compressorsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listQuerySchema, req.query);
    const stationId = resolveStationScope(req);
    const orderBy = parseSort(
      q.sort,
      { name: 'c.name', created_at: 'c.created_at', engine_hours: 'engine_hours' },
      'c.name ASC',
    );
    const where: string[] = ['c.station_id = $1'];
    const params: unknown[] = [stationId];
    if (!q.include_archived) where.push('c.archived_at IS NULL');
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`c.name ILIKE $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`COALESCE(st.status, 'ok') = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n FROM compressor c ${STATUS_LATERAL} ${whereSql}`,
      params,
    );
    const { rows } = await pool.query(
      `${COMPRESSOR_CARD_SELECT} ${STATUS_LATERAL} ${whereSql}
        ORDER BY ${orderBy} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    const levelMap = await fetchMaintenanceLevels(rows.map((r) => r.id));
    res.json(
      listEnvelope(
        rows.map((r) => serializeCompressor(r, levelMap.get(r.id) ?? [])),
        { page: q.page, limit: q.limit, total: total.rows[0].n },
      ),
    );
  }),
);

compressorsRouter.post(
  '/',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    await assertNameFree(stationId, body.name);
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO compressor (station_id, name, manufacturer, model,
                                 initial_engine_hours, initial_maintenance_at, initial_maintenance_hours, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          stationId,
          body.name,
          body.manufacturer ?? null,
          body.model ?? null,
          body.initial_engine_hours,
          body.initial_maintenance_at ?? null,
          body.initial_maintenance_hours ?? null,
          body.notes ?? null,
        ],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId,
        entityType: 'compressor',
        entityId: rows[0].id,
        action: 'create',
        changes: { name: { old: null, new: body.name } },
        requestId: req.requestId,
      });
      return rows[0].id as string;
    });
    res.status(201).json(await getCompressorCard(id));
  }),
);

compressorsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getCompressorRowOr404(req.params.id);
    assertRecordInScope(req.user!, row.station_id);
    res.json(await getCompressorCard(row.id));
  }),
);

compressorsRouter.patch(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getCompressorRowOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Компресор списано — спершу відновіть його');
    if (body.name && body.name !== before.name) {
      await assertNameFree(before.station_id, body.name, before.id);
    }
    const fields: Record<string, unknown> = {};
    for (const key of ['name', 'manufacturer', 'model', 'notes'] as const) {
      if (body[key] !== undefined) fields[key] = body[key];
    }
    await withTransaction(async (client) => {
      const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE compressor SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        [before.id, ...Object.values(fields)],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'compressor',
        entityId: before.id,
        action: 'update',
        changes: diffChanges(before, fields),
        requestId: req.requestId,
      });
    });
    res.json(await getCompressorCard(before.id));
  }),
);

/** «Провести ТО» — подія в append-only історії; engine_hours_at за замовчуванням фіксує бекенд. */
compressorsRouter.post(
  '/:id/maintenance',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(maintenanceSchema, req.body);
    const compressor = await getCompressorRowOr404(req.params.id);
    assertRecordInScope(req.user!, compressor.station_id);
    if (compressor.archived_at) throw errors.conflict('Компресор списано');
    const currentHours = round2(compressor.engine_hours);
    if (body.engine_hours_at !== undefined && body.engine_hours_at > currentHours) {
      throw errors.validation(
        `Наробіток на момент ТО не може перевищувати поточний (${currentHours} мг)`,
        [{ field: 'engine_hours_at', rule: 'max_current_engine_hours' }],
      );
    }
    const engineHoursAt = round2(body.engine_hours_at ?? currentHours);
    const maintenanceId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO compressor_maintenance (compressor_id, level, performed_at, engine_hours_at, performed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [compressor.id, body.level, body.performed_at, engineHoursAt, req.user!.id, body.notes ?? null],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: compressor.station_id,
        entityType: 'compressor_maintenance',
        entityId: rows[0].id,
        action: 'create',
        changes: {
          compressor_id: { old: null, new: compressor.id },
          level: { old: null, new: body.level },
          engine_hours_at: { old: null, new: engineHoursAt },
        },
        requestId: req.requestId,
      });
      return rows[0].id as string;
    });
    const { rows } = await pool.query(
      `SELECT m.id, m.compressor_id, m.level,
              to_char(m.performed_at, 'YYYY-MM-DD') AS performed_at,
              m.engine_hours_at::float8 AS engine_hours_at, m.notes, m.created_at,
              u.id AS performed_by_id, u.full_name AS performed_by_name
         FROM compressor_maintenance m
         JOIN app_user u ON u.id = m.performed_by
        WHERE m.id = $1`,
      [maintenanceId],
    );
    const m = rows[0];
    const levels = (await fetchMaintenanceLevels([compressor.id])).get(compressor.id) ?? [];
    res.status(201).json({
      id: m.id,
      compressor_id: m.compressor_id,
      level: m.level,
      performed_at: m.performed_at,
      engine_hours_at: m.engine_hours_at,
      performed_by: { id: m.performed_by_id, full_name: m.performed_by_name },
      notes: m.notes,
      created_at: m.created_at,
      compressor: {
        condition: compressorCondition(levels),
        maintenance: { suggested_level: suggestedLevel(levels), next: nextMaintenance(levels) },
      },
    });
  }),
);

/** Історія ТО (append-only, найновіші вгорі). */
compressorsRouter.get(
  '/:id/maintenance',
  asyncHandler(async (req, res) => {
    const compressor = await getCompressorRowOr404(req.params.id);
    assertRecordInScope(req.user!, compressor.station_id);
    const { rows } = await pool.query(
      `SELECT m.id, m.compressor_id, m.level,
              to_char(m.performed_at, 'YYYY-MM-DD') AS performed_at,
              m.engine_hours_at::float8 AS engine_hours_at, m.notes, m.created_at,
              u.id AS performed_by_id, u.full_name AS performed_by_name
         FROM compressor_maintenance m
         JOIN app_user u ON u.id = m.performed_by
        WHERE m.compressor_id = $1
        ORDER BY m.performed_at DESC, m.created_at DESC`,
      [compressor.id],
    );
    res.json(
      listEnvelope(
        rows.map((r) => ({
          id: r.id,
          compressor_id: r.compressor_id,
          level: r.level,
          performed_at: r.performed_at,
          engine_hours_at: r.engine_hours_at,
          performed_by: { id: r.performed_by_id, full_name: r.performed_by_name },
          notes: r.notes,
          created_at: r.created_at,
        })),
        { page: 1, limit: rows.length, total: rows.length },
      ),
    );
  }),
);

/** Обʼєднана стрічка подій: ТО + сесії заправки (вкладки Все/ТО/Заправки). */
compressorsRouter.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const q = parse(historyTypeSchema, req.query);
    const compressor = await getCompressorRowOr404(req.params.id);
    assertRecordInScope(req.user!, compressor.station_id);

    interface HistoryEvent {
      type: 'maintenance' | 'fill_session';
      id: string;
      occurred_at: unknown;
      summary: string;
      performed_by: { id: string; full_name: string };
      sortKey: number;
      tieKey: number;
    }
    const events: HistoryEvent[] = [];

    if (q.type !== 'fill_session') {
      const { rows } = await pool.query(
        `SELECT m.id, to_char(m.performed_at, 'YYYY-MM-DD') AS occurred_at,
                m.level, m.engine_hours_at::float8 AS engine_hours_at, m.created_at,
                u.id AS user_id, u.full_name
           FROM compressor_maintenance m
           JOIN app_user u ON u.id = m.performed_by
          WHERE m.compressor_id = $1`,
        [compressor.id],
      );
      for (const r of rows) {
        events.push({
          type: 'maintenance',
          id: r.id,
          occurred_at: r.occurred_at,
          summary: `ТО-${r.level} · ${fmtHours(r.engine_hours_at)} мг`,
          performed_by: { id: r.user_id, full_name: r.full_name },
          sortKey: new Date(r.occurred_at).getTime(),
          tieKey: new Date(r.created_at).getTime(),
        });
      }
    }

    if (q.type !== 'maintenance') {
      const { rows } = await pool.query(
        `SELECT fs.id, fs.started_at, fs.ended_at, fs.duration_hours::float8 AS duration_hours,
                fs.pressure_before_bar, fs.pressure_target_bar,
                u.id AS user_id, u.full_name,
                (SELECT count(*)::int FROM fill_session_item i
                  WHERE i.fill_session_id = fs.id AND i.apparatus_id IS NOT NULL) AS apparatus_count,
                (SELECT count(*)::int FROM fill_session_item i
                  WHERE i.fill_session_id = fs.id AND i.cylinder_id IS NOT NULL) AS cylinder_count
           FROM fill_session fs
           JOIN app_user u ON u.id = fs.performed_by
          WHERE fs.compressor_id = $1`,
        [compressor.id],
      );
      for (const r of rows) {
        events.push({
          type: 'fill_session',
          id: r.id,
          occurred_at: r.started_at,
          summary: fillSessionSummary({
            durationHours: r.duration_hours,
            apparatusCount: r.apparatus_count,
            cylinderCount: r.cylinder_count,
            pressureBeforeBar: r.pressure_before_bar,
            pressureTargetBar: r.pressure_target_bar,
          }),
          performed_by: { id: r.user_id, full_name: r.full_name },
          sortKey: new Date(r.started_at).getTime(),
          tieKey: new Date(r.started_at).getTime(),
        });
      }
    }

    events.sort((a, b) => b.sortKey - a.sortKey || b.tieKey - a.tieKey);
    res.json(
      listEnvelope(
        events.map(({ sortKey: _s, tieKey: _t, ...e }) => e),
        { page: 1, limit: events.length, total: events.length },
      ),
    );
  }),
);

compressorsRouter.post(
  '/:id/archive',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCompressorRowOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Компресор вже списано');
    if (before.active_fill_session_id) {
      throw new AppError(
        409,
        'COMPONENT_IN_USE',
        `Компресор ${before.name} має активну сесію заправки — спочатку зупиніть її`,
      );
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE compressor SET archived_at = now(), updated_at = now() WHERE id = $1`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'compressor',
        entityId: before.id,
        action: 'archive',
        requestId: req.requestId,
      });
    });
    res.json(await getCompressorCard(before.id));
  }),
);

compressorsRouter.post(
  '/:id/restore',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCompressorRowOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at) throw errors.conflict('Компресор не списаний');
    await assertNameFree(before.station_id, before.name, before.id);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE compressor SET archived_at = NULL, updated_at = now() WHERE id = $1`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'compressor',
        entityId: before.id,
        action: 'restore',
        requestId: req.requestId,
      });
    });
    res.json(await getCompressorCard(before.id));
  }),
);
