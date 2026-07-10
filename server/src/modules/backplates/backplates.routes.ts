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
import { backplateCondition } from '../../shared/status';
import { diffChanges, writeAudit } from '../audit/audit.service';

export const backplatesRouter = Router();
backplatesRouter.use(authenticate);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Очікується дата YYYY-MM-DD');

const createSchema = z.object({
  name: z.string().trim().min(1),
  manufacturer: z.string().trim().min(1).nullish(),
  model: z.string().trim().min(1).nullish(),
  serial_number: z.string().trim().min(1).nullish(),
  commissioned_at: dateStr.nullish(),
  reducer_last_replaced_at: dateStr.nullish(),
  reducer_interval_months: z.number().int().positive().nullish(),
  notes: z.string().trim().min(1).nullish(),
  station_id: z.string().uuid().optional(), // admin
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    manufacturer: z.string().trim().min(1).nullable().optional(),
    model: z.string().trim().min(1).nullable().optional(),
    serial_number: z.string().trim().min(1).nullable().optional(),
    commissioned_at: dateStr.nullable().optional(),
    reducer_last_replaced_at: dateStr.nullable().optional(),
    reducer_interval_months: z.number().int().positive().nullable().optional(),
    notes: z.string().trim().min(1).nullable().optional(),
    status: z.enum(['free', 'in_repair']).optional(), // decommissioned — лише через /archive
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

const listSchema = listQuerySchema.extend({
  backplate_status: z.enum(['in_apparatus', 'free', 'in_repair', 'decommissioned']).optional(),
});

const CARD_SELECT = `
  SELECT b.id, b.station_id, b.name, b.manufacturer, b.model, b.serial_number,
         to_char(b.commissioned_at, 'YYYY-MM-DD')          AS commissioned_at,
         to_char(b.reducer_last_replaced_at, 'YYYY-MM-DD') AS reducer_last_replaced_at,
         b.reducer_interval_months, b.notes, b.status,
         b.created_at, b.updated_at, b.archived_at,
         to_char(bps.next_reducer_replacement_at, 'YYYY-MM-DD') AS next_reducer_replacement_at,
         (bps.next_reducer_replacement_at - current_date)::int  AS reducer_days_left,
         bps.status AS condition_status,
         a.id AS apparatus_id
    FROM backplate b
    LEFT JOIN v_backplate_status bps ON bps.backplate_id = b.id
    LEFT JOIN apparatus a ON a.backplate_id = b.id AND a.archived_at IS NULL`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(row: any) {
  return {
    id: row.id,
    station_id: row.station_id,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    serial_number: row.serial_number,
    commissioned_at: row.commissioned_at,
    reducer_last_replaced_at: row.reducer_last_replaced_at,
    reducer_interval_months: row.reducer_interval_months,
    next_reducer_replacement_at: row.next_reducer_replacement_at,
    status: row.status,
    condition: backplateCondition({
      status: row.condition_status,
      nextReducerReplacementAt: row.next_reducer_replacement_at,
      daysLeft: row.reducer_days_left,
    }),
    apparatus: row.apparatus_id ? { id: row.apparatus_id, name: row.name } : null,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCardOr404(id: string): Promise<any> {
  const { rows } = await pool.query(`${CARD_SELECT} WHERE b.id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Ложамент не знайдено');
  return rows[0];
}

async function assertNameFree(stationId: string, name: string, excludeId?: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM backplate
      WHERE station_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL
        AND id <> COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [stationId, name, excludeId ?? null],
  );
  if (rows[0]) throw errors.duplicateName(`Ложамент «${name}» вже існує на цій станції`);
}

backplatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const stationId = resolveStationScope(req);
    const orderBy = parseSort(
      q.sort,
      {
        name: 'b.name',
        created_at: 'b.created_at',
        next_reducer_replacement_at: 'bps.next_reducer_replacement_at',
      },
      'b.name ASC',
    );
    const where: string[] = ['b.station_id = $1'];
    const params: unknown[] = [stationId];
    if (!q.include_archived) where.push('b.archived_at IS NULL');
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(b.name ILIKE $${params.length} OR b.serial_number ILIKE $${params.length})`);
    }
    if (q.backplate_status) {
      params.push(q.backplate_status);
      where.push(`b.status = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`COALESCE(bps.status, 'ok') = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n
         FROM backplate b LEFT JOIN v_backplate_status bps ON bps.backplate_id = b.id
        ${whereSql}`,
      params,
    );
    const { rows } = await pool.query(
      `${CARD_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    res.json(listEnvelope(rows.map(serialize), { page: q.page, limit: q.limit, total: total.rows[0].n }));
  }),
);

backplatesRouter.post(
  '/',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    await assertNameFree(stationId, body.name);
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO backplate (station_id, name, manufacturer, model, serial_number,
                                commissioned_at, reducer_last_replaced_at, reducer_interval_months, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          stationId,
          body.name,
          body.manufacturer ?? null,
          body.model ?? null,
          body.serial_number ?? null,
          body.commissioned_at ?? null,
          body.reducer_last_replaced_at ?? null,
          body.reducer_interval_months ?? null,
          body.notes ?? null,
        ],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId,
        entityType: 'backplate',
        entityId: rows[0].id,
        action: 'create',
        changes: { name: { old: null, new: body.name } },
        requestId: req.requestId,
      });
      return rows[0].id as string;
    });
    res.status(201).json(serialize(await getCardOr404(id)));
  }),
);

backplatesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, row.station_id);
    res.json(serialize(row));
  }),
);

backplatesRouter.patch(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Ложамент списано — спершу відновіть його');
    if (body.name && body.name !== before.name) {
      await assertNameFree(before.station_id, body.name, before.id);
    }
    // S3/S4: операційний статус вручну — тільки коли ложамент НЕ в живому апараті
    if (body.status && before.apparatus_id) {
      throw new AppError(
        409,
        'COMPONENT_IN_USE',
        `Ложамент стоїть в апараті ${before.name} — спочатку розберіть апарат`,
      );
    }

    const fields: Record<string, unknown> = {};
    for (const key of [
      'name',
      'manufacturer',
      'model',
      'serial_number',
      'commissioned_at',
      'reducer_last_replaced_at',
      'reducer_interval_months',
      'notes',
      'status',
    ] as const) {
      if (body[key] !== undefined) fields[key] = body[key];
    }
    await withTransaction(async (client) => {
      const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE backplate SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        [before.id, ...Object.values(fields)],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'backplate',
        entityId: before.id,
        action: 'update',
        changes: diffChanges(before, fields),
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

backplatesRouter.post(
  '/:id/archive',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Ложамент вже списано');
    // S4: не можна списати ложамент, що стоїть у живому апараті
    if (before.apparatus_id) {
      throw new AppError(
        409,
        'COMPONENT_IN_USE',
        `Ложамент стоїть в апараті ${before.name} — спочатку розберіть апарат`,
      );
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE backplate SET status = 'decommissioned', archived_at = now(), updated_at = now() WHERE id = $1`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'backplate',
        entityId: before.id,
        action: 'archive',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

backplatesRouter.post(
  '/:id/restore',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at) throw errors.conflict('Ложамент не списаний');
    await assertNameFree(before.station_id, before.name, before.id);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE backplate SET status = 'free', archived_at = NULL, updated_at = now() WHERE id = $1`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'backplate',
        entityId: before.id,
        action: 'restore',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);
