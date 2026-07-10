import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { errors } from '../../shared/errors';
import { asyncHandler, parse } from '../../shared/http';
import { listEnvelope, listQuerySchema, offsetOf, parseSort } from '../../shared/pagination';
import { diffChanges, writeAudit } from '../audit/audit.service';
import { getStationCounters } from '../dashboard/alerts.service';

export const stationsRouter = Router();
stationsRouter.use(authenticate, requireRole('admin')); // §12: тільки admin

const createSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1).nullish(),
});
const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

function serialize(row: {
  id: string;
  name: string;
  address: string | null;
  created_at: Date;
  archived_at: Date | null;
}) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    created_at: row.created_at,
    archived_at: row.archived_at,
  };
}

async function getStationOr404(id: string) {
  const { rows } = await pool.query(`SELECT * FROM station WHERE id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Станцію не знайдено');
  return rows[0];
}

async function assertNameFree(name: string, excludeId?: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM station WHERE lower(name) = lower($1) AND archived_at IS NULL AND id <> COALESCE($2, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [name, excludeId ?? null],
  );
  if (rows[0]) throw errors.duplicateName(`Станція з назвою «${name}» вже існує`);
}

stationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listQuerySchema, req.query);
    const orderBy = parseSort(q.sort, { name: 'name', created_at: 'created_at' }, 'name ASC');
    const where: string[] = [];
    const params: unknown[] = [];
    if (!q.include_archived) where.push('archived_at IS NULL');
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`name ILIKE $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await pool.query(`SELECT count(*)::int AS n FROM station ${whereSql}`, params);
    const { rows } = await pool.query(
      `SELECT * FROM station ${whereSql} ORDER BY ${orderBy} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    const data = await Promise.all(
      rows.map(async (row) => ({
        ...serialize(row),
        alert_counters: row.archived_at ? { overdue: 0, warning: 0 } : await getStationCounters(row.id),
      })),
    );
    res.json(listEnvelope(data, { page: q.page, limit: q.limit, total: total.rows[0].n }));
  }),
);

stationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    await assertNameFree(body.name);
    const station = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO station (name, address) VALUES ($1, $2) RETURNING *`,
        [body.name, body.address ?? null],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: rows[0].id,
        entityType: 'station',
        entityId: rows[0].id,
        action: 'create',
        changes: { name: { old: null, new: body.name } },
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.status(201).json(serialize(station));
  }),
);

stationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const station = await getStationOr404(req.params.id);
    res.json({
      ...serialize(station),
      alert_counters: station.archived_at
        ? { overdue: 0, warning: 0 }
        : await getStationCounters(station.id),
    });
  }),
);

stationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getStationOr404(req.params.id);
    if (body.name && body.name !== before.name) await assertNameFree(body.name, before.id);
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE station SET name = COALESCE($2, name),
                            address = CASE WHEN $4 THEN $3 ELSE address END
          WHERE id = $1 RETURNING *`,
        [before.id, body.name ?? null, body.address ?? null, body.address !== undefined],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.id,
        entityType: 'station',
        entityId: before.id,
        action: 'update',
        changes: diffChanges(before, rows[0]),
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.json(serialize(updated));
  }),
);

stationsRouter.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const before = await getStationOr404(req.params.id);
    if (before.archived_at) throw errors.conflict('Станцію вже заархівовано');
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE station SET archived_at = now() WHERE id = $1 RETURNING *`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.id,
        entityType: 'station',
        entityId: before.id,
        action: 'archive',
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.json(serialize(updated));
  }),
);

stationsRouter.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const before = await getStationOr404(req.params.id);
    if (!before.archived_at) throw errors.conflict('Станція не заархівована');
    await assertNameFree(before.name, before.id);
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE station SET archived_at = NULL WHERE id = $1 RETURNING *`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.id,
        entityType: 'station',
        entityId: before.id,
        action: 'restore',
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.json(serialize(updated));
  }),
);
