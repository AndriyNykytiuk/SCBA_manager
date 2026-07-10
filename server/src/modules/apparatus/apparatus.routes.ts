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
import { writeAudit } from '../audit/audit.service';
import {
  APPARATUS_CARD_SELECT,
  fetchApparatusCylinders,
  getApparatusCard,
  getApparatusRowOr404,
  installCylinder,
  serializeApparatus,
} from './apparatus.service';

export const apparatusRouter = Router();
apparatusRouter.use(authenticate);

const createSchema = z.object({
  backplate_id: z.string().uuid(),
  cylinders: z
    .array(z.object({ cylinder_id: z.string().uuid(), position: z.union([z.literal(1), z.literal(2)]) }))
    .max(2)
    .default([])
    .refine((arr) => new Set(arr.map((c) => c.position)).size === arr.length, {
      message: 'Позиції балонів мають бути різними',
    })
    .refine((arr) => new Set(arr.map((c) => c.cylinder_id)).size === arr.length, {
      message: 'Балони в апараті мають бути різними',
    }),
  storage_location_id: z.string().uuid().nullish(),
  notes: z.string().trim().min(1).nullish(),
});

const patchSchema = z
  .object({
    storage_location_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

const installSchema = z.object({
  cylinder_id: z.string().uuid(),
  position: z.union([z.literal(1), z.literal(2)]),
});

const listSchema = listQuerySchema.extend({
  assembled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  storage_location_id: z.string().uuid().optional(),
  backplate_name: z.string().trim().min(1).optional(), // точний збіг — резолв QR-скану
});

async function checkStorageLocation(stationId: string, id: string) {
  const { rows } = await pool.query(`SELECT station_id, archived_at FROM storage_location WHERE id = $1`, [id]);
  if (!rows[0] || rows[0].station_id !== stationId) {
    throw errors.validation('Місце зберігання не знайдено на цій станції', [
      { field: 'storage_location_id', rule: 'not_found' },
    ]);
  }
  if (rows[0].archived_at) {
    throw new AppError(409, 'COMPONENT_ARCHIVED', 'Місце зберігання заархівоване');
  }
}

apparatusRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const stationId = resolveStationScope(req);
    const orderBy = parseSort(
      q.sort,
      { name: 'bp.name', created_at: 'a.created_at' },
      'bp.name ASC',
    );
    const where: string[] = ['a.station_id = $1'];
    const params: unknown[] = [stationId];
    if (!q.include_archived) where.push('a.archived_at IS NULL');
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`bp.name ILIKE $${params.length}`);
    }
    if (q.backplate_name) {
      params.push(q.backplate_name);
      where.push(`lower(bp.name) = lower($${params.length})`);
    }
    if (q.storage_location_id) {
      params.push(q.storage_location_id);
      where.push(`a.storage_location_id = $${params.length}`);
    }
    if (q.assembled !== undefined) {
      where.push(
        q.assembled
          ? `COALESCE(vas.cylinders_installed, 0) > 0`
          : `COALESCE(vas.cylinders_installed, 0) = 0`,
      );
    }
    if (q.status) {
      params.push(q.status);
      where.push(`COALESCE(vas.status, 'ok') = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n
         FROM apparatus a
         JOIN backplate bp ON bp.id = a.backplate_id
         LEFT JOIN v_apparatus_status vas ON vas.apparatus_id = a.id
        ${whereSql}`,
      params,
    );
    const { rows } = await pool.query(
      `${APPARATUS_CARD_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    const cylinderMap = await fetchApparatusCylinders(rows.map((r) => r.id));
    res.json(
      listEnvelope(
        rows.map((r) => serializeApparatus(r, cylinderMap.get(r.id) ?? [])),
        { page: q.page, limit: q.limit, total: total.rows[0].n },
      ),
    );
  }),
);

/** Зібрати апарат: ложамент + 0–2 балони (S1–S3; збірка з overdue-балоном дозволена, API-2). */
apparatusRouter.post(
  '/',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);

    // станція визначається ложаментом; для master перевіряємо скоуп
    const bpRes = await pool.query(
      `SELECT b.id, b.station_id, b.name, b.archived_at, b.status,
              a.id AS live_apparatus_id
         FROM backplate b
         LEFT JOIN apparatus a ON a.backplate_id = b.id AND a.archived_at IS NULL
        WHERE b.id = $1`,
      [body.backplate_id],
    );
    const bp = bpRes.rows[0];
    if (!bp) {
      throw errors.validation('Ложамент не знайдено', [{ field: 'backplate_id', rule: 'not_found' }]);
    }
    assertRecordInScope(req.user!, bp.station_id);
    const stationId = resolveWriteStation(req, bp.station_id);
    if (bp.archived_at) throw new AppError(409, 'COMPONENT_ARCHIVED', `Ложамент ${bp.name} списано`);
    if (bp.live_apparatus_id) {
      throw new AppError(
        409,
        'BACKPLATE_ALREADY_IN_APPARATUS',
        `Ложамент ${bp.name} вже використовується в апараті`,
      );
    }
    if (body.storage_location_id) await checkStorageLocation(stationId, body.storage_location_id);

    const apparatusId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO apparatus (station_id, backplate_id, storage_location_id, notes)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [stationId, bp.id, body.storage_location_id ?? null, body.notes ?? null],
      );
      const id = rows[0].id as string;
      // S3: синхронізація операційного статусу ложамента в одній транзакції
      await client.query(`UPDATE backplate SET status = 'in_apparatus', updated_at = now() WHERE id = $1`, [bp.id]);
      for (const c of body.cylinders) {
        await installCylinder(client, {
          apparatusId: id,
          apparatusStationId: stationId,
          apparatusName: bp.name,
          cylinderId: c.cylinder_id,
          position: c.position,
          userId: req.user!.id,
        });
      }
      await writeAudit(client, {
        userId: req.user!.id,
        stationId,
        entityType: 'apparatus',
        entityId: id,
        action: 'create',
        changes: {
          backplate: { old: null, new: bp.name },
          cylinders: { old: null, new: body.cylinders },
        },
        requestId: req.requestId,
      });
      return id;
    });
    res.status(201).json(await getApparatusCard(apparatusId));
  }),
);

apparatusRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, row.station_id);
    res.json(await getApparatusCard(row.id));
  }),
);

apparatusRouter.patch(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Апарат заархівовано — спершу відновіть його');
    if (body.storage_location_id) await checkStorageLocation(before.station_id, body.storage_location_id);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE apparatus
            SET storage_location_id = CASE WHEN $3 THEN $2 ELSE storage_location_id END,
                notes = CASE WHEN $5 THEN $4 ELSE notes END,
                updated_at = now()
          WHERE id = $1`,
        [
          before.id,
          body.storage_location_id ?? null,
          body.storage_location_id !== undefined,
          body.notes ?? null,
          body.notes !== undefined,
        ],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'apparatus',
        entityId: before.id,
        action: 'update',
        changes: {
          ...(body.storage_location_id !== undefined
            ? { storage_location_id: { old: before.sl_id, new: body.storage_location_id } }
            : {}),
          ...(body.notes !== undefined ? { notes: { old: before.notes, new: body.notes } } : {}),
        },
        requestId: req.requestId,
      });
    });
    res.json(await getApparatusCard(before.id));
  }),
);

/** Встановити балон на позицію (заміна = remove + install). */
apparatusRouter.post(
  '/:id/cylinders',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(installSchema, req.body);
    const apparatus = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, apparatus.station_id);
    if (apparatus.archived_at) throw new AppError(409, 'COMPONENT_ARCHIVED', 'Апарат заархівовано');
    await withTransaction(async (client) => {
      await installCylinder(client, {
        apparatusId: apparatus.id,
        apparatusStationId: apparatus.station_id,
        apparatusName: apparatus.bp_name,
        cylinderId: body.cylinder_id,
        position: body.position,
        userId: req.user!.id,
      });
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: apparatus.station_id,
        entityType: 'apparatus',
        entityId: apparatus.id,
        action: 'update',
        changes: { cylinder_installed: { old: null, new: { cylinder_id: body.cylinder_id, position: body.position } } },
        requestId: req.requestId,
      });
    });
    res.status(201).json(await getApparatusCard(apparatus.id));
  }),
);

/** Зняти балон з позиції 1|2. */
apparatusRouter.post(
  '/:id/cylinders/:position/remove',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const position = Number(req.params.position);
    if (![1, 2].includes(position)) {
      throw errors.validation('Позиція має бути 1 або 2', [{ field: 'position', rule: 'invalid' }]);
    }
    const apparatus = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, apparatus.station_id);
    if (apparatus.archived_at) throw new AppError(409, 'COMPONENT_ARCHIVED', 'Апарат заархівовано');
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE apparatus_cylinder
            SET removed_at = now(), removed_by = $3
          WHERE apparatus_id = $1 AND position = $2 AND removed_at IS NULL
          RETURNING cylinder_id`,
        [apparatus.id, position, req.user!.id],
      );
      if (!rows[0]) throw errors.conflict(`Позиція ${position} апарата ${apparatus.bp_name} порожня`);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: apparatus.station_id,
        entityType: 'apparatus',
        entityId: apparatus.id,
        action: 'update',
        changes: { cylinder_removed: { old: { cylinder_id: rows[0].cylinder_id, position }, new: null } },
        requestId: req.requestId,
      });
    });
    res.json(await getApparatusCard(apparatus.id));
  }),
);

/** «Розібрати апарат»: зняти всі балони; апарат лишається живим («розібраним»). */
apparatusRouter.post(
  '/:id/disassemble',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const apparatus = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, apparatus.station_id);
    if (apparatus.archived_at) throw new AppError(409, 'COMPONENT_ARCHIVED', 'Апарат заархівовано');
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE apparatus_cylinder
            SET removed_at = now(), removed_by = $2
          WHERE apparatus_id = $1 AND removed_at IS NULL
          RETURNING cylinder_id, position`,
        [apparatus.id, req.user!.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: apparatus.station_id,
        entityType: 'apparatus',
        entityId: apparatus.id,
        action: 'update',
        changes: { disassembled: { old: rows, new: [] } },
        requestId: req.requestId,
      });
    });
    res.json(await getApparatusCard(apparatus.id));
  }),
);

/** Історія замін балонів (append-only). */
apparatusRouter.get(
  '/:id/cylinder-history',
  asyncHandler(async (req, res) => {
    const apparatus = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, apparatus.station_id);
    const { rows } = await pool.query(
      `SELECT ac.id, ac.position, ac.installed_at, ac.removed_at,
              cy.id AS cylinder_id, cy.number,
              iu.id AS installed_by_id, iu.full_name AS installed_by_name,
              ru.id AS removed_by_id, ru.full_name AS removed_by_name
         FROM apparatus_cylinder ac
         JOIN cylinder cy ON cy.id = ac.cylinder_id
         JOIN app_user iu ON iu.id = ac.installed_by
         LEFT JOIN app_user ru ON ru.id = ac.removed_by
        WHERE ac.apparatus_id = $1
        ORDER BY ac.installed_at DESC`,
      [apparatus.id],
    );
    res.json(
      listEnvelope(
        rows.map((r) => ({
          id: r.id,
          cylinder: { id: r.cylinder_id, number: r.number },
          position: r.position,
          installed_at: r.installed_at,
          installed_by: { id: r.installed_by_id, full_name: r.installed_by_name },
          removed_at: r.removed_at,
          removed_by: r.removed_by_id ? { id: r.removed_by_id, full_name: r.removed_by_name } : null,
        })),
        { page: 1, limit: rows.length, total: rows.length },
      ),
    );
  }),
);

apparatusRouter.post(
  '/:id/archive',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const apparatus = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, apparatus.station_id);
    if (apparatus.archived_at) throw errors.conflict('Апарат вже заархівовано');
    if (apparatus.cylinders_installed > 0) {
      throw new AppError(
        409,
        'COMPONENT_IN_USE',
        'Перед архівацією апарата зніміть усі балони («Розібрати апарат»)',
      );
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE apparatus SET archived_at = now(), updated_at = now() WHERE id = $1`, [apparatus.id]);
      // S3: ложамент звільняється
      await client.query(`UPDATE backplate SET status = 'free', updated_at = now() WHERE id = $1`, [apparatus.bp_id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: apparatus.station_id,
        entityType: 'apparatus',
        entityId: apparatus.id,
        action: 'archive',
        requestId: req.requestId,
      });
    });
    res.json(await getApparatusCard(apparatus.id));
  }),
);

apparatusRouter.post(
  '/:id/restore',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const apparatus = await getApparatusRowOr404(req.params.id);
    assertRecordInScope(req.user!, apparatus.station_id);
    if (!apparatus.archived_at) throw errors.conflict('Апарат не заархівований');
    const bp = await pool.query(
      `SELECT b.archived_at, a.id AS live_apparatus_id
         FROM backplate b
         LEFT JOIN apparatus a ON a.backplate_id = b.id AND a.archived_at IS NULL
        WHERE b.id = $1`,
      [apparatus.bp_id],
    );
    if (bp.rows[0]?.archived_at) {
      throw new AppError(409, 'COMPONENT_ARCHIVED', `Ложамент ${apparatus.bp_name} списано`);
    }
    if (bp.rows[0]?.live_apparatus_id) {
      throw new AppError(
        409,
        'BACKPLATE_ALREADY_IN_APPARATUS',
        `Ложамент ${apparatus.bp_name} вже використовується в іншому апараті`,
      );
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE apparatus SET archived_at = NULL, updated_at = now() WHERE id = $1`, [apparatus.id]);
      await client.query(`UPDATE backplate SET status = 'in_apparatus', updated_at = now() WHERE id = $1`, [apparatus.bp_id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: apparatus.station_id,
        entityType: 'apparatus',
        entityId: apparatus.id,
        action: 'restore',
        requestId: req.requestId,
      });
    });
    res.json(await getApparatusCard(apparatus.id));
  }),
);
