import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { errors } from '../../shared/errors';
import { asyncHandler, parse } from '../../shared/http';
import { listEnvelope, listQuerySchema, offsetOf, parseSort } from '../../shared/pagination';
import { revokeAllUserTokens } from '../auth/auth.service';
import { diffChanges, writeAudit } from '../audit/audit.service';

export const usersRouter = Router();
usersRouter.use(authenticate, requireRole('admin')); // §12: тільки admin

const roleSchema = z.enum(['admin', 'master', 'duty']);

const createSchema = z
  .object({
    login: z.string().trim().min(3).max(64),
    password: z.string().min(8, 'Пароль має містити щонайменше 8 символів'),
    full_name: z.string().trim().min(1),
    role: roleSchema,
    station_id: z.string().uuid().nullish(),
  })
  .superRefine((v, ctx) => {
    // CHECK chk_user_station_scope: admin ⇔ без станції
    if ((v.role === 'admin') !== (v.station_id == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['station_id'],
        message:
          v.role === 'admin'
            ? 'Для admin station_id має бути null'
            : 'Для master/duty station_id обовʼязковий',
      });
    }
  });

const patchSchema = z
  .object({
    full_name: z.string().trim().min(1).optional(),
    role: roleSchema.optional(),
    station_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

const listSchema = listQuerySchema.extend({
  role: roleSchema.optional(),
  is_active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

interface UserRow {
  id: string;
  login: string;
  full_name: string;
  role: 'admin' | 'master' | 'duty';
  station_id: string | null;
  station_name: string | null;
  is_active: boolean;
  created_at: Date;
  archived_at: Date | null;
}

function serialize(row: UserRow) {
  return {
    id: row.id,
    login: row.login,
    full_name: row.full_name,
    role: row.role,
    station: row.station_id ? { id: row.station_id, name: row.station_name ?? '' } : null,
    is_active: row.is_active,
    created_at: row.created_at,
    archived_at: row.archived_at,
  };
}

const BASE_SELECT = `
  SELECT u.id, u.login, u.full_name, u.role, u.station_id, u.is_active,
         u.created_at, u.archived_at, s.name AS station_name
    FROM app_user u LEFT JOIN station s ON s.id = u.station_id`;

async function getUserOr404(id: string): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(`${BASE_SELECT} WHERE u.id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Користувача не знайдено');
  return rows[0];
}

async function assertLoginFree(login: string, excludeId?: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM app_user
      WHERE login = $1 AND archived_at IS NULL
        AND id <> COALESCE($2, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [login, excludeId ?? null],
  );
  if (rows[0]) throw errors.duplicateName(`Логін «${login}» вже зайнятий`);
}

async function assertStationExists(stationId: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM station WHERE id = $1 AND archived_at IS NULL`,
    [stationId],
  );
  if (!rows[0]) {
    throw errors.validation('Станцію не знайдено', [{ field: 'station_id', rule: 'not_found' }]);
  }
}

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const orderBy = parseSort(
      q.sort,
      { full_name: 'u.full_name', login: 'u.login', created_at: 'u.created_at' },
      'u.full_name ASC',
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (!q.include_archived) where.push('u.archived_at IS NULL');
    if (q.role) {
      params.push(q.role);
      where.push(`u.role = $${params.length}`);
    }
    if (q.station_id) {
      params.push(q.station_id);
      where.push(`u.station_id = $${params.length}`);
    }
    if (q.is_active !== undefined) {
      params.push(q.is_active);
      where.push(`u.is_active = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(u.full_name ILIKE $${params.length} OR u.login::text ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await pool.query(
      `SELECT count(*)::int AS n FROM app_user u ${whereSql}`,
      params,
    );
    const { rows } = await pool.query<UserRow>(
      `${BASE_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`,
      params,
    );
    res.json(listEnvelope(rows.map(serialize), { page: q.page, limit: q.limit, total: total.rows[0].n }));
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    await assertLoginFree(body.login);
    if (body.station_id) await assertStationExists(body.station_id);
    const passwordHash = await bcrypt.hash(body.password, config.BCRYPT_ROUNDS);
    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO app_user (login, password_hash, full_name, role, station_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [body.login, passwordHash, body.full_name, body.role, body.station_id ?? null],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: body.station_id ?? null,
        entityType: 'app_user',
        entityId: rows[0].id,
        action: 'create',
        changes: { login: { old: null, new: body.login }, role: { old: null, new: body.role } },
        requestId: req.requestId,
      });
      return rows[0];
    });
    res.status(201).json(serialize(await getUserOr404(user.id)));
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(serialize(await getUserOr404(req.params.id)));
  }),
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getUserOr404(req.params.id);

    const nextRole = body.role ?? before.role;
    const nextStation = body.station_id !== undefined ? body.station_id : before.station_id;
    if ((nextRole === 'admin') !== (nextStation == null)) {
      throw errors.validation('Комбінація role/station_id некоректна (admin ⇔ без станції)', [
        { field: 'station_id', rule: 'chk_user_station_scope' },
      ]);
    }
    if (nextStation && nextStation !== before.station_id) await assertStationExists(nextStation);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE app_user
            SET full_name = COALESCE($2, full_name),
                role = $3, station_id = $4,
                is_active = COALESCE($5, is_active),
                updated_at = now()
          WHERE id = $1 RETURNING id, full_name, role, station_id, is_active`,
        [before.id, body.full_name ?? null, nextRole, nextStation, body.is_active ?? null],
      );
      if (body.is_active === false) await revokeAllUserTokens(client, before.id);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: nextStation,
        entityType: 'app_user',
        entityId: before.id,
        action: 'update',
        changes: diffChanges(
          { full_name: before.full_name, role: before.role, station_id: before.station_id, is_active: before.is_active },
          rows[0],
        ),
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getUserOr404(before.id)));
  }),
);

usersRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ new_password: z.string().min(8) }), req.body);
    const user = await getUserOr404(req.params.id);
    const passwordHash = await bcrypt.hash(body.new_password, config.BCRYPT_ROUNDS);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE app_user SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [user.id, passwordHash],
      );
      await revokeAllUserTokens(client, user.id);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: user.station_id,
        entityType: 'app_user',
        entityId: user.id,
        action: 'update',
        changes: { password: { old: '***', new: '***' } },
        requestId: req.requestId,
      });
    });
    res.status(204).end();
  }),
);

usersRouter.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const user = await getUserOr404(req.params.id);
    if (user.archived_at) throw errors.conflict('Користувача вже заархівовано');
    if (user.id === req.user!.id) throw errors.conflict('Не можна заархівувати власний обліковий запис');
    await withTransaction(async (client) => {
      await client.query(`UPDATE app_user SET archived_at = now(), updated_at = now() WHERE id = $1`, [user.id]);
      await revokeAllUserTokens(client, user.id);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: user.station_id,
        entityType: 'app_user',
        entityId: user.id,
        action: 'archive',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getUserOr404(user.id)));
  }),
);

usersRouter.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const user = await getUserOr404(req.params.id);
    if (!user.archived_at) throw errors.conflict('Користувач не заархівований');
    await assertLoginFree(user.login, user.id);
    await withTransaction(async (client) => {
      await client.query(`UPDATE app_user SET archived_at = NULL, updated_at = now() WHERE id = $1`, [user.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: user.station_id,
        entityType: 'app_user',
        entityId: user.id,
        action: 'restore',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getUserOr404(user.id)));
  }),
);
