import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { assertRecordInScope, resolveStationScope } from '../../middleware/stationScope';
import { AppError, errors } from '../../shared/errors';
import { asyncHandler, parse } from '../../shared/http';
import { listEnvelope, listQuerySchema, offsetOf, parseSort } from '../../shared/pagination';
import { compressorCondition, round2 } from '../../shared/status';
import { writeAudit } from '../audit/audit.service';
import {
  fetchMaintenanceLevels,
  getCompressorRowOr404,
  nextMaintenance,
} from '../compressors/compressors.service';
import {
  SESSION_SELECT,
  addApparatusItem,
  addCylinderItem,
  fetchSessionItems,
  getSessionCard,
  getSessionRowOr404,
  serializeSession,
} from './fillSessions.service';

export const fillSessionsRouter = Router();
fillSessionsRouter.use(authenticate);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Очікується дата YYYY-MM-DD');

const createSchema = z
  .object({
    compressor_id: z.string().uuid(),
    pressure_before_bar: z.number().int().min(0),
    pressure_target_bar: z.number().int().positive().max(450),
    items: z
      .array(
        z
          .object({
            apparatus_id: z.string().uuid().optional(),
            cylinder_id: z.string().uuid().optional(),
          })
          .refine((v) => (v.apparatus_id ? 1 : 0) + (v.cylinder_id ? 1 : 0) === 1, {
            message: 'Елемент сесії — апарат АБО окремий балон (рівно одне з двох)',
          }),
      )
      .min(1, 'Додайте хоча б один апарат або балон'),
  })
  .superRefine((v, ctx) => {
    if (v.pressure_target_bar <= v.pressure_before_bar) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pressure_target_bar'],
        message: 'Цільовий тиск має бути більшим за тиск до заправки',
      });
    }
    const apparatusIds = v.items.map((i) => i.apparatus_id).filter(Boolean);
    if (new Set(apparatusIds).size !== apparatusIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Апарати в сесії мають бути різними',
      });
    }
    const cylinderIds = v.items.map((i) => i.cylinder_id).filter(Boolean);
    if (new Set(cylinderIds).size !== cylinderIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Балони в сесії мають бути різними',
      });
    }
  });

const listSchema = listQuerySchema.extend({
  compressor_id: z.string().uuid().optional(),
  performed_by: z.string().uuid().optional(),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
});

/** «Старт»: створення + запуск однією атомарною операцією (драфта в БД немає). */
fillSessionsRouter.post(
  '/',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const compressor = await pool.query(
      `SELECT id, station_id, name, archived_at FROM compressor WHERE id = $1`,
      [body.compressor_id],
    );
    const comp = compressor.rows[0];
    if (!comp) {
      throw errors.validation('Компресор не знайдено', [
        { field: 'compressor_id', rule: 'not_found' },
      ]);
    }
    assertRecordInScope(req.user!, comp.station_id);
    if (comp.archived_at) {
      throw new AppError(409, 'COMPONENT_ARCHIVED', `Компресор ${comp.name} списано`);
    }
    const sessionId = await withTransaction(async (client) => {
      // серіалізуємо конкурентні «Старт» по одному компресору
      await client.query(`SELECT 1 FROM compressor WHERE id = $1 FOR UPDATE`, [comp.id]);
      const active = await client.query(
        `SELECT 1 FROM fill_session WHERE compressor_id = $1 AND ended_at IS NULL`,
        [comp.id],
      );
      if (active.rows[0]) {
        throw new AppError(
          409,
          'FILL_SESSION_ALREADY_ACTIVE',
          `Компресор ${comp.name} вже має активну сесію заправки`,
        );
      }
      const { rows } = await client.query(
        `INSERT INTO fill_session (station_id, compressor_id, pressure_before_bar, pressure_target_bar, performed_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [comp.station_id, comp.id, body.pressure_before_bar, body.pressure_target_bar, req.user!.id],
      );
      const id = rows[0].id as string;
      for (const item of body.items) {
        if (item.apparatus_id) {
          await addApparatusItem(client, {
            sessionId: id,
            stationId: comp.station_id,
            apparatusId: item.apparatus_id,
          });
        } else {
          await addCylinderItem(client, {
            sessionId: id,
            stationId: comp.station_id,
            cylinderId: item.cylinder_id!,
          });
        }
      }
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: comp.station_id,
        entityType: 'fill_session',
        entityId: id,
        action: 'create',
        changes: {
          compressor: { old: null, new: comp.name },
          pressure: {
            old: null,
            new: `${body.pressure_before_bar}→${body.pressure_target_bar} бар`,
          },
          items: { old: null, new: body.items },
        },
        requestId: req.requestId,
      });
      return id;
    });
    res.status(201).json(await getSessionCard(sessionId));
  }),
);

/** Активні сесії станції (ВП-6): відновлення таймера; server_time — захист від збитого годинника. */
fillSessionsRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const stationId = resolveStationScope(req);
    const { rows } = await pool.query(
      `${SESSION_SELECT} WHERE fs.station_id = $1 AND fs.ended_at IS NULL ORDER BY fs.started_at`,
      [stationId],
    );
    const itemMap = await fetchSessionItems(rows.map((r) => r.id));
    res.json({
      server_time: new Date().toISOString(),
      data: rows.map((r) => serializeSession(r, itemMap.get(r.id) ?? [])),
    });
  }),
);

/** Історія сесій станції. */
fillSessionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const stationId = resolveStationScope(req);
    const orderBy = parseSort(q.sort, { started_at: 'fs.started_at' }, 'fs.started_at DESC');
    const where: string[] = ['fs.station_id = $1'];
    const params: unknown[] = [stationId];
    if (q.compressor_id) {
      params.push(q.compressor_id);
      where.push(`fs.compressor_id = $${params.length}`);
    }
    if (q.performed_by) {
      params.push(q.performed_by);
      where.push(`fs.performed_by = $${params.length}`);
    }
    if (q.date_from) {
      params.push(q.date_from);
      where.push(`fs.started_at >= $${params.length}::date`);
    }
    if (q.date_to) {
      params.push(q.date_to);
      where.push(`fs.started_at < ($${params.length}::date + 1)`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n FROM fill_session fs ${whereSql}`,
      params,
    );
    const { rows } = await pool.query(
      `${SESSION_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    const itemMap = await fetchSessionItems(rows.map((r) => r.id));
    res.json(
      listEnvelope(
        rows.map((r) => serializeSession(r, itemMap.get(r.id) ?? [])),
        { page: q.page, limit: q.limit, total: total.rows[0].n },
      ),
    );
  }),
);

fillSessionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getSessionRowOr404(req.params.id);
    assertRecordInScope(req.user!, row.station_id);
    res.json(await getSessionCard(row.id));
  }),
);

/** «Стоп» (S5): автор, майстер цієї станції або admin; мотогодини перераховуються одразу. */
fillSessionsRouter.post(
  '/:id/stop',
  asyncHandler(async (req, res) => {
    const session = await getSessionRowOr404(req.params.id);
    assertRecordInScope(req.user!, session.station_id);
    const u = req.user!;
    const allowed =
      u.role === 'admin' ||
      (u.role === 'master' && u.stationId === session.station_id) ||
      u.id === session.performed_by_id;
    if (!allowed) {
      throw new AppError(
        403,
        'FILL_SESSION_FORBIDDEN',
        'Зупинити сесію може її автор, майстер цієї станції або адміністратор',
      );
    }
    if (session.ended_at) throw errors.conflict('Сесію вже зупинено');
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE fill_session SET ended_at = now()
          WHERE id = $1 AND ended_at IS NULL
          RETURNING ended_at`,
        [session.id],
      );
      if (!rows[0]) throw errors.conflict('Сесію вже зупинено');
      await writeAudit(client, {
        userId: u.id,
        stationId: session.station_id,
        entityType: 'fill_session',
        entityId: session.id,
        action: 'update',
        changes: { ended_at: { old: null, new: rows[0].ended_at } },
        requestId: req.requestId,
      });
    });
    const fresh = await getSessionRowOr404(session.id);
    const compRow = await getCompressorRowOr404(session.compressor_id);
    const levels =
      (await fetchMaintenanceLevels([session.compressor_id])).get(session.compressor_id) ?? [];
    res.json({
      id: fresh.id,
      ended_at: fresh.ended_at,
      duration_hours: fresh.duration_hours,
      compressor: {
        id: compRow.id,
        engine_hours: round2(compRow.engine_hours), // вже перераховано (S5)
        condition: compressorCondition(levels),
        maintenance: { next: nextMaintenance(levels) },
      },
    });
  }),
);
