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
import { errors } from '../../shared/errors';
import { asyncHandler, parse } from '../../shared/http';
import { listEnvelope, listQuerySchema, offsetOf, parseSort } from '../../shared/pagination';
import { maskCondition } from '../../shared/status';
import { diffChanges, writeAudit } from '../audit/audit.service';
import { writeArchiveEntry } from '../archive/archive.service';

export const masksRouter = Router();
masksRouter.use(authenticate);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Очікується дата YYYY-MM-DD');

const maskBaseFields = {
  number: z.string().trim().min(1),
  model: z.string().trim().min(1).nullish(),
  assigned_to: z.string().trim().min(1).nullish(),
  inhale_valve_replaced_at: dateStr.nullish(),
  voice_membrane_replaced_at: dateStr.nullish(),
  inspection_at: dateStr.nullish(),
  notes: z.string().trim().min(1).nullish(),
  station_id: z.string().uuid().optional(), // admin
};

const createSchema = z.object(maskBaseFields);

/** Масове створення: number — базовий номер, реальні номери — <база>-1..<база>-N. */
const bulkCreateSchema = z.object({ ...maskBaseFields, quantity: z.number().int().min(2).max(50) });

const patchSchema = z
  .object({
    number: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).nullable().optional(),
    assigned_to: z.string().trim().min(1).nullable().optional(),
    inhale_valve_replaced_at: dateStr.nullable().optional(),
    voice_membrane_replaced_at: dateStr.nullable().optional(),
    inspection_at: dateStr.nullable().optional(),
    notes: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

const listSchema = listQuerySchema.extend({
  assigned_to: z.string().trim().min(1).optional(),
});

const CARD_SELECT = `
  SELECT m.id, m.station_id, m.number, m.model, m.assigned_to,
         to_char(m.inhale_valve_replaced_at, 'YYYY-MM-DD')   AS inhale_valve_replaced_at,
         to_char(m.voice_membrane_replaced_at, 'YYYY-MM-DD') AS voice_membrane_replaced_at,
         to_char(m.inspection_at, 'YYYY-MM-DD')              AS inspection_at,
         m.notes, m.created_at, m.updated_at, m.archived_at,
         to_char(vs.next_inhale_valve_at, 'YYYY-MM-DD')   AS next_inhale_valve_at,
         (vs.next_inhale_valve_at - current_date)::int    AS inhale_valve_days_left,
         to_char(vs.next_voice_membrane_at, 'YYYY-MM-DD') AS next_voice_membrane_at,
         (vs.next_voice_membrane_at - current_date)::int  AS voice_membrane_days_left,
         to_char(vs.next_inspection_at, 'YYYY-MM-DD')     AS next_inspection_at,
         (vs.next_inspection_at - current_date)::int      AS inspection_days_left,
         vs.status AS condition_status
    FROM mask m
    LEFT JOIN v_mask_status vs ON vs.mask_id = m.id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(row: any) {
  return {
    id: row.id,
    station_id: row.station_id,
    number: row.number,
    model: row.model,
    assigned_to: row.assigned_to,
    inhale_valve_replaced_at: row.inhale_valve_replaced_at,
    next_inhale_valve_at: row.next_inhale_valve_at,
    voice_membrane_replaced_at: row.voice_membrane_replaced_at,
    next_voice_membrane_at: row.next_voice_membrane_at,
    inspection_at: row.inspection_at,
    next_inspection_at: row.next_inspection_at,
    condition: maskCondition({
      status: row.condition_status,
      nextInhaleValveAt: row.next_inhale_valve_at,
      inhaleValveDaysLeft: row.inhale_valve_days_left,
      nextVoiceMembraneAt: row.next_voice_membrane_at,
      voiceMembraneDaysLeft: row.voice_membrane_days_left,
      nextInspectionAt: row.next_inspection_at,
      inspectionDaysLeft: row.inspection_days_left,
    }),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCardOr404(id: string): Promise<any> {
  const { rows } = await pool.query(`${CARD_SELECT} WHERE m.id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Маску не знайдено');
  return rows[0];
}

async function assertNumberFree(stationId: string, number: string, excludeId?: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM mask
      WHERE station_id = $1 AND lower(number) = lower($2) AND archived_at IS NULL
        AND id <> COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [stationId, number, excludeId ?? null],
  );
  if (rows[0]) throw errors.duplicateName(`Маска «${number}» вже існує на цій станції`);
}

/** Повний знімок маски — пишеться в архів перед фізичним DELETE. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDeleteSnapshot(mask: any) {
  return { mask: serialize(mask) };
}

masksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const stationId = resolveStationScope(req);
    const orderBy = parseSort(
      q.sort,
      { number: 'm.number', created_at: 'm.created_at' },
      'm.number ASC',
    );
    const where: string[] = ['m.station_id = $1'];
    const params: unknown[] = [stationId];
    if (!q.include_archived) where.push('m.archived_at IS NULL');
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(m.number ILIKE $${params.length} OR m.model ILIKE $${params.length})`);
    }
    if (q.assigned_to) {
      params.push(`%${q.assigned_to}%`);
      where.push(`m.assigned_to ILIKE $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`COALESCE(vs.status, 'ok') = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n
         FROM mask m LEFT JOIN v_mask_status vs ON vs.mask_id = m.id
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

masksRouter.post(
  '/',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    await assertNumberFree(stationId, body.number);
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO mask (station_id, number, model, assigned_to,
                           inhale_valve_replaced_at, voice_membrane_replaced_at, inspection_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          stationId,
          body.number,
          body.model ?? null,
          body.assigned_to ?? null,
          body.inhale_valve_replaced_at ?? null,
          body.voice_membrane_replaced_at ?? null,
          body.inspection_at ?? null,
          body.notes ?? null,
        ],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId,
        entityType: 'mask',
        entityId: rows[0].id,
        action: 'create',
        changes: { number: { old: null, new: body.number } },
        requestId: req.requestId,
      });
      return rows[0].id as string;
    });
    res.status(201).json(serialize(await getCardOr404(id)));
  }),
);

/** Масове створення: quantity масок з номерами <база>-1..<база>-N, решта полів спільні. */
masksRouter.post(
  '/bulk',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(bulkCreateSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    const numbers = Array.from({ length: body.quantity }, (_, i) => `${body.number}-${i + 1}`);
    const { rows: taken } = await pool.query(
      `SELECT number FROM mask
        WHERE station_id = $1 AND lower(number) = ANY($2::text[]) AND archived_at IS NULL`,
      [stationId, numbers.map((n) => n.toLowerCase())],
    );
    if (taken.length > 0) {
      throw errors.duplicateName(
        `Номери вже зайняті: ${taken.map((r) => r.number).join(', ')} — змініть базовий номер`,
      );
    }
    const ids = await withTransaction(async (client) => {
      const createdIds: string[] = [];
      for (const number of numbers) {
        const { rows } = await client.query(
          `INSERT INTO mask (station_id, number, model, assigned_to,
                             inhale_valve_replaced_at, voice_membrane_replaced_at, inspection_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            stationId,
            number,
            body.model ?? null,
            body.assigned_to ?? null,
            body.inhale_valve_replaced_at ?? null,
            body.voice_membrane_replaced_at ?? null,
            body.inspection_at ?? null,
            body.notes ?? null,
          ],
        );
        const maskId = rows[0].id as string;
        await writeAudit(client, {
          userId: req.user!.id,
          stationId,
          entityType: 'mask',
          entityId: maskId,
          action: 'create',
          changes: { number: { old: null, new: number } },
          requestId: req.requestId,
        });
        createdIds.push(maskId);
      }
      return createdIds;
    });
    const cards = await Promise.all(ids.map((mid) => getCardOr404(mid)));
    res.status(201).json(
      listEnvelope(cards.map(serialize), { page: 1, limit: ids.length, total: ids.length }),
    );
  }),
);

masksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, row.station_id);
    res.json(serialize(row));
  }),
);

masksRouter.patch(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Маску списано — спершу відновіть її');
    if (body.number && body.number !== before.number) {
      await assertNumberFree(before.station_id, body.number, before.id);
    }

    const fields: Record<string, unknown> = {};
    for (const key of [
      'number',
      'model',
      'assigned_to',
      'inhale_valve_replaced_at',
      'voice_membrane_replaced_at',
      'inspection_at',
      'notes',
    ] as const) {
      if (body[key] !== undefined) fields[key] = body[key];
    }
    await withTransaction(async (client) => {
      const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE mask SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        [before.id, ...Object.values(fields)],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'mask',
        entityId: before.id,
        action: 'update',
        changes: diffChanges(before, fields),
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

masksRouter.post(
  '/:id/archive',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Маску вже списано');
    await withTransaction(async (client) => {
      await client.query(`UPDATE mask SET archived_at = now(), updated_at = now() WHERE id = $1`, [before.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'mask',
        entityId: before.id,
        action: 'archive',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

masksRouter.post(
  '/:id/restore',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at) throw errors.conflict('Маску не списано');
    await assertNumberFree(before.station_id, before.number, before.id);
    await withTransaction(async (client) => {
      await client.query(`UPDATE mask SET archived_at = NULL, updated_at = now() WHERE id = $1`, [before.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'mask',
        entityId: before.id,
        action: 'restore',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

/**
 * Справжнє видалення з бази (MVP). Перед видаленням повний знімок маски пишеться в
 * deleted_entity_archive (GET /archive).
 * - Не списана маска: дозволено лише якщо не закріплена за особою (інакше — спершу /archive
 *   або зніміть закріплення).
 * - Списана маска: дозволено завжди.
 */
masksRouter.delete(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at && before.assigned_to) {
      throw errors.conflict(
        `Маска ${before.number} закріплена за ${before.assigned_to} — спершу зніміть закріплення або спишіть маску`,
      );
    }
    const snapshot = buildDeleteSnapshot(before);
    await withTransaction(async (client) => {
      await writeArchiveEntry(client, {
        stationId: before.station_id,
        entityType: 'mask',
        entityId: before.id,
        label: before.number,
        snapshot,
        deletedBy: req.user!.id,
      });
      await client.query(`DELETE FROM mask WHERE id = $1`, [before.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'mask',
        entityId: before.id,
        action: 'delete',
        changes: { number: { old: before.number, new: null } },
        requestId: req.requestId,
      });
    });
    res.status(204).end();
  }),
);
