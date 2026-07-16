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
import { writeArchiveEntry } from '../archive/archive.service';

export const backplatesRouter = Router();
backplatesRouter.use(authenticate);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Очікується дата YYYY-MM-DD');

const backplateBaseFields = {
  name: z.string().trim().min(1),
  manufacturer: z.string().trim().min(1).nullish(),
  model: z.string().trim().min(1).nullish(),
  serial_number: z.string().trim().min(1).nullish(),
  lung_valve_number: z.string().trim().min(1).nullish(),
  gauge_number: z.string().trim().min(1).nullish(),
  commissioned_at: dateStr.nullish(),
  reducer_last_replaced_at: dateStr.nullish(),
  membrane_replaced_at: dateStr.nullish(),
  notes: z.string().trim().min(1).nullish(),
  station_id: z.string().uuid().optional(), // admin
};

const createSchema = z.object(backplateBaseFields);

/** Масове створення: name — базова назва, реальні назви — <база>-1..<база>-N. */
const bulkCreateSchema = z.object({ ...backplateBaseFields, quantity: z.number().int().min(2).max(50) });

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    manufacturer: z.string().trim().min(1).nullable().optional(),
    model: z.string().trim().min(1).nullable().optional(),
    serial_number: z.string().trim().min(1).nullable().optional(),
    lung_valve_number: z.string().trim().min(1).nullable().optional(),
    gauge_number: z.string().trim().min(1).nullable().optional(),
    commissioned_at: dateStr.nullable().optional(),
    reducer_last_replaced_at: dateStr.nullable().optional(),
    membrane_replaced_at: dateStr.nullable().optional(),
    notes: z.string().trim().min(1).nullable().optional(),
    status: z.enum(['free', 'in_repair']).optional(), // decommissioned — лише через /archive
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

const listSchema = listQuerySchema.extend({
  backplate_status: z.enum(['in_apparatus', 'free', 'in_repair', 'decommissioned']).optional(),
});

const CARD_SELECT = `
  SELECT b.id, b.station_id, b.name, b.manufacturer, b.model, b.serial_number,
         b.lung_valve_number, b.gauge_number,
         to_char(b.commissioned_at, 'YYYY-MM-DD')          AS commissioned_at,
         to_char(b.reducer_last_replaced_at, 'YYYY-MM-DD') AS reducer_last_replaced_at,
         ri.months AS reducer_interval_months,
         to_char(b.membrane_replaced_at, 'YYYY-MM-DD')     AS membrane_replaced_at,
         mi.months AS membrane_interval_months, b.notes, b.status,
         b.created_at, b.updated_at, b.archived_at,
         to_char(bps.next_reducer_replacement_at, 'YYYY-MM-DD') AS next_reducer_replacement_at,
         (bps.next_reducer_replacement_at - current_date)::int  AS reducer_days_left,
         to_char(bps.next_membrane_replacement_at, 'YYYY-MM-DD') AS next_membrane_replacement_at,
         (bps.next_membrane_replacement_at - current_date)::int  AS membrane_days_left,
         bps.status AS condition_status,
         a.id AS apparatus_id
    FROM backplate b
    JOIN interval_setting ri ON ri.key = 'reducer'
    JOIN interval_setting mi ON mi.key = 'membrane'
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
    lung_valve_number: row.lung_valve_number,
    gauge_number: row.gauge_number,
    commissioned_at: row.commissioned_at,
    reducer_last_replaced_at: row.reducer_last_replaced_at,
    reducer_interval_months: row.reducer_interval_months,
    next_reducer_replacement_at: row.next_reducer_replacement_at,
    membrane_replaced_at: row.membrane_replaced_at,
    membrane_interval_months: row.membrane_interval_months,
    next_membrane_replacement_at: row.next_membrane_replacement_at,
    status: row.status,
    condition: backplateCondition({
      status: row.condition_status,
      nextReducerReplacementAt: row.next_reducer_replacement_at,
      reducerDaysLeft: row.reducer_days_left,
      nextMembraneReplacementAt: row.next_membrane_replacement_at,
      membraneDaysLeft: row.membrane_days_left,
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

/**
 * Повний знімок ложамента + всіх апаратів, що на ньому коли-небудь базувались (кожен з їхньою
 * власною історією складу балонів і участі в заправках) — пишеться в архів перед фізичним DELETE.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDeleteSnapshot(backplate: any) {
  const apps = await pool.query(
    `SELECT a.id, a.notes, a.created_at, a.updated_at, a.archived_at,
            sl.name AS storage_location_name
       FROM apparatus a
       LEFT JOIN storage_location sl ON sl.id = a.storage_location_id
      WHERE a.backplate_id = $1
      ORDER BY a.created_at DESC`,
    [backplate.id],
  );
  const appIds: string[] = apps.rows.map((a) => a.id);
  const installsByApp = new Map<string, unknown[]>();
  const sessionsByApp = new Map<string, unknown[]>();
  if (appIds.length > 0) {
    const installs = await pool.query(
      `SELECT ac.apparatus_id, ac.id, ac.position, ac.installed_at, ac.removed_at,
              cy.id AS cylinder_id, cy.number AS cylinder_number,
              iu.full_name AS installed_by_name, ru.full_name AS removed_by_name
         FROM apparatus_cylinder ac
         LEFT JOIN cylinder cy ON cy.id = ac.cylinder_id
         LEFT JOIN app_user iu ON iu.id = ac.installed_by
         LEFT JOIN app_user ru ON ru.id = ac.removed_by
        WHERE ac.apparatus_id = ANY($1)
        ORDER BY ac.installed_at DESC`,
      [appIds],
    );
    for (const r of installs.rows) {
      const list = installsByApp.get(r.apparatus_id) ?? [];
      list.push({
        id: r.id,
        position: r.position,
        installed_at: r.installed_at,
        removed_at: r.removed_at,
        cylinder: r.cylinder_id ? { id: r.cylinder_id, number: r.cylinder_number } : null,
        installed_by: r.installed_by_name,
        removed_by: r.removed_by_name,
      });
      installsByApp.set(r.apparatus_id, list);
    }
    const sessions = await pool.query(
      `SELECT fsi.apparatus_id, fs.id AS session_id, fs.started_at, fs.ended_at,
              fs.pressure_before_bar, fs.pressure_target_bar, c.name AS compressor_name
         FROM fill_session_item fsi
         JOIN fill_session fs ON fs.id = fsi.fill_session_id
         JOIN compressor c ON c.id = fs.compressor_id
        WHERE fsi.apparatus_id = ANY($1)
        ORDER BY fs.started_at DESC`,
      [appIds],
    );
    for (const r of sessions.rows) {
      const list = sessionsByApp.get(r.apparatus_id) ?? [];
      list.push({
        fill_session_id: r.session_id,
        started_at: r.started_at,
        ended_at: r.ended_at,
        pressure_before_bar: r.pressure_before_bar,
        pressure_target_bar: r.pressure_target_bar,
        compressor_name: r.compressor_name,
      });
      sessionsByApp.set(r.apparatus_id, list);
    }
  }
  return {
    backplate: serialize(backplate),
    apparatuses: apps.rows.map((a) => ({
      id: a.id,
      storage_location: a.storage_location_name,
      notes: a.notes,
      created_at: a.created_at,
      archived_at: a.archived_at,
      cylinder_installations: installsByApp.get(a.id) ?? [],
      fill_sessions: sessionsByApp.get(a.id) ?? [],
    })),
  };
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
                                lung_valve_number, gauge_number,
                                commissioned_at, reducer_last_replaced_at, membrane_replaced_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          stationId,
          body.name,
          body.manufacturer ?? null,
          body.model ?? null,
          body.serial_number ?? null,
          body.lung_valve_number ?? null,
          body.gauge_number ?? null,
          body.commissioned_at ?? null,
          body.reducer_last_replaced_at ?? null,
          body.membrane_replaced_at ?? null,
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

/** Масове створення: quantity ложаментів з назвами <база>-1..<база>-N, решта полів спільні. */
backplatesRouter.post(
  '/bulk',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(bulkCreateSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    const names = Array.from({ length: body.quantity }, (_, i) => `${body.name}-${i + 1}`);
    const { rows: taken } = await pool.query(
      `SELECT name FROM backplate
        WHERE station_id = $1 AND lower(name) = ANY($2::text[]) AND archived_at IS NULL`,
      [stationId, names.map((n) => n.toLowerCase())],
    );
    if (taken.length > 0) {
      throw errors.duplicateName(
        `Назви вже зайняті: ${taken.map((r) => r.name).join(', ')} — змініть базову назву`,
      );
    }
    const ids = await withTransaction(async (client) => {
      const createdIds: string[] = [];
      for (const name of names) {
        const { rows } = await client.query(
          `INSERT INTO backplate (station_id, name, manufacturer, model, serial_number,
                                  lung_valve_number, gauge_number,
                                  commissioned_at, reducer_last_replaced_at, membrane_replaced_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            stationId,
            name,
            body.manufacturer ?? null,
            body.model ?? null,
            body.serial_number ?? null,
            body.lung_valve_number ?? null,
            body.gauge_number ?? null,
            body.commissioned_at ?? null,
            body.reducer_last_replaced_at ?? null,
            body.membrane_replaced_at ?? null,
            body.notes ?? null,
          ],
        );
        const backplateId = rows[0].id as string;
        await writeAudit(client, {
          userId: req.user!.id,
          stationId,
          entityType: 'backplate',
          entityId: backplateId,
          action: 'create',
          changes: { name: { old: null, new: name } },
          requestId: req.requestId,
        });
        createdIds.push(backplateId);
      }
      return createdIds;
    });
    const cards = await Promise.all(ids.map((bid) => getCardOr404(bid)));
    res.status(201).json(
      listEnvelope(cards.map(serialize), { page: 1, limit: ids.length, total: ids.length }),
    );
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
      'lung_valve_number',
      'gauge_number',
      'commissioned_at',
      'reducer_last_replaced_at',
      'membrane_replaced_at',
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

/**
 * Справжнє видалення з бази (MVP). Перед видаленням повний знімок ложамента + всіх апаратів,
 * що на ньому базувались (з їхньою історією), пишеться в deleted_entity_archive (GET /archive).
 * - Не списаний ложамент: дозволено лише без історії використання (інакше — спершу /archive).
 * - Списаний ложамент: дозволено завжди; апарати, що коли-небудь на ньому базувались, видаляються
 *   з робочих таблиць разом з ним (лишаються в архіві) — самі балони не чіпаються, компресор
 *   і решта його сесій заправки теж лишаються недоторканими.
 */
backplatesRouter.delete(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at) {
      const { rows } = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM apparatus WHERE backplate_id = $1) AS in_apparatus`,
        [before.id],
      );
      if (rows[0].in_apparatus) {
        throw errors.conflict(
          `Ложамент ${before.name} має історію використання — спершу спишіть його`,
        );
      }
    }
    const snapshot = await buildDeleteSnapshot(before);
    await withTransaction(async (client) => {
      await writeArchiveEntry(client, {
        stationId: before.station_id,
        entityType: 'backplate',
        entityId: before.id,
        label: before.name,
        snapshot,
        deletedBy: req.user!.id,
      });
      const appIds = snapshot.apparatuses.map((a) => a.id as string);
      if (appIds.length > 0) {
        await client.query(`DELETE FROM fill_session_item WHERE apparatus_id = ANY($1)`, [appIds]);
        await client.query(`DELETE FROM apparatus_cylinder WHERE apparatus_id = ANY($1)`, [appIds]);
        await client.query(`DELETE FROM apparatus WHERE id = ANY($1)`, [appIds]);
      }
      await client.query(`DELETE FROM backplate WHERE id = $1`, [before.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'backplate',
        entityId: before.id,
        action: 'delete',
        changes: { name: { old: before.name, new: null } },
        requestId: req.requestId,
      });
    });
    res.status(204).end();
  }),
);
