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
import { diffChanges, writeAudit } from '../audit/audit.service';

export const storageLocationsRouter = Router();
storageLocationsRouter.use(authenticate);

const createSchema = z.object({
  name: z.string().trim().min(1),
  station_id: z.string().uuid().optional(), // admin
});
const patchSchema = z.object({ name: z.string().trim().min(1) });

function serialize(row: { id: string; station_id: string; name: string; archived_at: Date | null }) {
  return { id: row.id, station_id: row.station_id, name: row.name, archived_at: row.archived_at };
}

async function getOr404(id: string) {
  const { rows } = await pool.query(`SELECT * FROM storage_location WHERE id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Місце зберігання не знайдено');
  return rows[0];
}

async function assertNameFree(stationId: string, name: string, excludeId?: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM storage_location
      WHERE station_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL
        AND id <> COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [stationId, name, excludeId ?? null],
  );
  if (rows[0]) throw errors.duplicateName(`Місце зберігання «${name}» вже існує`);
}

storageLocationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listQuerySchema, req.query);
    const stationId = resolveStationScope(req);
    const orderBy = parseSort(q.sort, { name: 'name', created_at: 'created_at' }, 'name ASC');
    const where: string[] = ['station_id = $1'];
    const params: unknown[] = [stationId];
    if (!q.include_archived) where.push('archived_at IS NULL');
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`name ILIKE $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n FROM storage_location ${whereSql}`,
      params,
    );
    const { rows } = await pool.query(
      `SELECT * FROM storage_location ${whereSql} ORDER BY ${orderBy} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    res.json(listEnvelope(rows.map(serialize), { page: q.page, limit: q.limit, total: total.rows[0].n }));
  }),
);

storageLocationsRouter.post(
  '/',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    await assertNameFree(stationId, body.name);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO storage_location (station_id, name) VALUES ($1, $2) RETURNING *`,
        [stationId, body.name],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId,
        entityType: 'storage_location',
        entityId: rows[0].id,
        action: 'create',
        changes: { name: { old: null, new: body.name } },
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.status(201).json(serialize(row));
  }),
);

storageLocationsRouter.patch(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    await assertNameFree(before.station_id, body.name, before.id);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE storage_location SET name = $2 WHERE id = $1 RETURNING *`,
        [before.id, body.name],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'storage_location',
        entityId: before.id,
        action: 'update',
        changes: diffChanges({ name: before.name }, { name: body.name }),
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.json(serialize(row));
  }),
);

storageLocationsRouter.post(
  '/:id/archive',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Місце зберігання вже заархівовано');
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE storage_location SET archived_at = now() WHERE id = $1 RETURNING *`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'storage_location',
        entityId: before.id,
        action: 'archive',
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.json(serialize(row));
  }),
);

storageLocationsRouter.post(
  '/:id/restore',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at) throw errors.conflict('Місце зберігання не заархівоване');
    await assertNameFree(before.station_id, before.name, before.id);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE storage_location SET archived_at = NULL WHERE id = $1 RETURNING *`,
        [before.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'storage_location',
        entityId: before.id,
        action: 'restore',
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.json(serialize(row));
  }),
);
