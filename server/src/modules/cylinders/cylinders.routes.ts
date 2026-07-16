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
import { cylinderCondition } from '../../shared/status';
import { diffChanges, writeAudit } from '../audit/audit.service';
import { writeArchiveEntry } from '../archive/archive.service';

export const cylindersRouter = Router();
cylindersRouter.use(authenticate);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Очікується дата YYYY-MM-DD');
const todayIso = () => new Date().toISOString().slice(0, 10);

const cylinderBaseFields = {
  number: z.string().trim().min(1),
  volume_l: z.union([z.literal(6), z.literal(6.8), z.literal(7)]),
  material: z.enum(['metal', 'composite']),
  working_pressure_bar: z.number().int().min(1).max(450),
  manufacturer: z.string().trim().min(1).nullish(),
  manufactured_at: dateStr,
  end_of_life_at: dateStr,
  last_hydro_test_at: dateStr, // обовʼязково → перший рядок hydro_test (схема §3.5)
  notes: z.string().trim().min(1).nullish(),
  station_id: z.string().uuid().optional(), // admin
};

function refineCylinderDates(
  v: { end_of_life_at: string; manufactured_at: string; last_hydro_test_at: string },
  ctx: z.RefinementCtx,
): void {
  if (v.end_of_life_at <= v.manufactured_at) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_of_life_at'],
      message: 'Кінець строку служби має бути пізніше дати виготовлення',
    });
  }
  if (v.last_hydro_test_at > todayIso()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['last_hydro_test_at'],
      message: 'Дата гідротесту не може бути в майбутньому',
    });
  }
}

const createSchema = z.object(cylinderBaseFields).superRefine(refineCylinderDates);

/** Масове створення: number — базовий номер, реальні номери — <база>-1..<база>-N. */
const bulkCreateSchema = z
  .object({ ...cylinderBaseFields, quantity: z.number().int().min(2).max(50) })
  .superRefine(refineCylinderDates);

const patchSchema = z
  .object({
    number: z.string().trim().min(1).optional(),
    volume_l: z.union([z.literal(6), z.literal(6.8), z.literal(7)]).optional(),
    material: z.enum(['metal', 'composite']).optional(),
    working_pressure_bar: z.number().int().min(1).max(450).optional(),
    manufacturer: z.string().trim().min(1).nullable().optional(),
    manufactured_at: dateStr.optional(),
    end_of_life_at: dateStr.optional(),
    notes: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Порожній PATCH' });

const overrideSchema = z.object({ date: dateStr.nullable() });

const hydroTestSchema = z.object({
  tested_at: dateStr.refine((d) => d <= todayIso(), {
    message: 'Дата гідротесту не може бути в майбутньому',
  }),
  performed_by: z.string().uuid().nullish(),
  notes: z.string().trim().min(1).nullish(),
});

const listSchema = listQuerySchema.extend({
  material: z.enum(['metal', 'composite']).optional(),
  volume_l: z.enum(['6', '6.8', '7']).optional(),
  installed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const CARD_SELECT = `
  SELECT cy.id, cy.station_id, cy.number, cy.volume_l::float8 AS volume_l, cy.material,
         cy.working_pressure_bar, cy.manufacturer,
         to_char(cy.manufactured_at, 'YYYY-MM-DD')           AS manufactured_at,
         to_char(cy.end_of_life_at, 'YYYY-MM-DD')            AS end_of_life_at,
         hi.months AS hydro_interval_months,
         to_char(cy.next_hydro_test_override, 'YYYY-MM-DD')  AS next_hydro_test_override,
         cy.notes, cy.created_at, cy.updated_at, cy.archived_at,
         to_char(cs.last_hydro_test_at, 'YYYY-MM-DD')        AS last_hydro_test_at,
         to_char(cs.next_hydro_test_at, 'YYYY-MM-DD')        AS next_hydro_test_at,
         (cs.next_hydro_test_at - current_date)::int         AS hydro_days_left,
         (cy.end_of_life_at - current_date)::int             AS eol_days_left,
         cs.status AS condition_status,
         ac.apparatus_id, ac.position, bp.name AS apparatus_name
    FROM cylinder cy
    JOIN interval_setting hi ON hi.key = 'hydro_' || cy.material
    LEFT JOIN v_cylinder_status cs ON cs.cylinder_id = cy.id
    LEFT JOIN apparatus_cylinder ac ON ac.cylinder_id = cy.id AND ac.removed_at IS NULL
    LEFT JOIN apparatus a ON a.id = ac.apparatus_id AND a.archived_at IS NULL
    LEFT JOIN backplate bp ON bp.id = a.backplate_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(row: any) {
  return {
    id: row.id,
    station_id: row.station_id,
    number: row.number,
    volume_l: row.volume_l,
    material: row.material,
    working_pressure_bar: row.working_pressure_bar,
    manufacturer: row.manufacturer,
    manufactured_at: row.manufactured_at,
    end_of_life_at: row.end_of_life_at,
    hydro_interval_months: row.hydro_interval_months,
    last_hydro_test_at: row.last_hydro_test_at,
    next_hydro_test_at: row.next_hydro_test_at,
    next_hydro_test_override: row.next_hydro_test_override,
    condition: cylinderCondition({
      status: row.condition_status,
      nextHydroTestAt: row.next_hydro_test_at,
      hydroDaysLeft: row.hydro_days_left,
      endOfLifeAt: row.end_of_life_at,
      eolDaysLeft: row.eol_days_left,
    }),
    installation: row.apparatus_id
      ? {
          apparatus_id: row.apparatus_id,
          apparatus_name: row.apparatus_name,
          position: row.position,
        }
      : null,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCardOr404(id: string): Promise<any> {
  const { rows } = await pool.query(`${CARD_SELECT} WHERE cy.id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Балон не знайдено');
  return rows[0];
}

/** Повний знімок балона + вся його історія — пишеться в архів перед фізичним DELETE. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDeleteSnapshot(cylinder: any) {
  const [hydroTests, installations, fillSessions] = await Promise.all([
    pool.query(
      `SELECT ht.id, to_char(ht.tested_at, 'YYYY-MM-DD') AS tested_at, ht.notes, ht.created_at,
              pu.id AS performed_by_id, pu.full_name AS performed_by_name
         FROM hydro_test ht
         LEFT JOIN app_user pu ON pu.id = ht.performed_by
        WHERE ht.cylinder_id = $1
        ORDER BY ht.tested_at DESC, ht.created_at DESC`,
      [cylinder.id],
    ),
    pool.query(
      `SELECT ac.id, ac.position, ac.installed_at, ac.removed_at,
              a.id AS apparatus_id, bp.name AS apparatus_name,
              iu.full_name AS installed_by_name, ru.full_name AS removed_by_name
         FROM apparatus_cylinder ac
         LEFT JOIN apparatus a ON a.id = ac.apparatus_id
         LEFT JOIN backplate bp ON bp.id = a.backplate_id
         LEFT JOIN app_user iu ON iu.id = ac.installed_by
         LEFT JOIN app_user ru ON ru.id = ac.removed_by
        WHERE ac.cylinder_id = $1
        ORDER BY ac.installed_at DESC`,
      [cylinder.id],
    ),
    pool.query(
      `SELECT fs.id AS session_id, fs.started_at, fs.ended_at,
              fs.pressure_before_bar, fs.pressure_target_bar, c.name AS compressor_name
         FROM fill_session_item fsi
         JOIN fill_session fs ON fs.id = fsi.fill_session_id
         JOIN compressor c ON c.id = fs.compressor_id
        WHERE fsi.cylinder_id = $1
        ORDER BY fs.started_at DESC`,
      [cylinder.id],
    ),
  ]);
  return {
    cylinder: serialize(cylinder),
    hydro_tests: hydroTests.rows.map((r) => ({
      id: r.id,
      tested_at: r.tested_at,
      notes: r.notes,
      created_at: r.created_at,
      performed_by: r.performed_by_id ? { id: r.performed_by_id, full_name: r.performed_by_name } : null,
    })),
    installations: installations.rows.map((r) => ({
      id: r.id,
      position: r.position,
      installed_at: r.installed_at,
      removed_at: r.removed_at,
      apparatus: r.apparatus_id ? { id: r.apparatus_id, name: r.apparatus_name } : null,
      installed_by: r.installed_by_name,
      removed_by: r.removed_by_name,
    })),
    fill_sessions: fillSessions.rows.map((r) => ({
      fill_session_id: r.session_id,
      started_at: r.started_at,
      ended_at: r.ended_at,
      pressure_before_bar: r.pressure_before_bar,
      pressure_target_bar: r.pressure_target_bar,
      compressor_name: r.compressor_name,
    })),
  };
}

async function assertNumberFree(stationId: string, number: string, excludeId?: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM cylinder
      WHERE station_id = $1 AND lower(number) = lower($2) AND archived_at IS NULL
        AND id <> COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [stationId, number, excludeId ?? null],
  );
  if (rows[0]) throw errors.duplicateName(`Балон №${number} вже існує на цій станції`);
}

cylindersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const stationId = resolveStationScope(req);
    const orderBy = parseSort(
      q.sort,
      {
        number: 'cy.number',
        created_at: 'cy.created_at',
        next_hydro_test_at: 'cs.next_hydro_test_at',
        end_of_life_at: 'cy.end_of_life_at',
      },
      'cy.number ASC',
    );
    const where: string[] = ['cy.station_id = $1'];
    const params: unknown[] = [stationId];
    if (!q.include_archived) where.push('cy.archived_at IS NULL');
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`cy.number ILIKE $${params.length}`);
    }
    if (q.material) {
      params.push(q.material);
      where.push(`cy.material = $${params.length}`);
    }
    if (q.volume_l) {
      params.push(q.volume_l);
      where.push(`cy.volume_l = $${params.length}::numeric`);
    }
    if (q.installed !== undefined) {
      where.push(q.installed ? 'ac.apparatus_id IS NOT NULL' : 'ac.apparatus_id IS NULL');
    }
    if (q.status) {
      params.push(q.status);
      where.push(`COALESCE(cs.status, 'ok') = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = await pool.query(
      `SELECT count(*)::int AS n
         FROM cylinder cy
         LEFT JOIN v_cylinder_status cs ON cs.cylinder_id = cy.id
         LEFT JOIN apparatus_cylinder ac ON ac.cylinder_id = cy.id AND ac.removed_at IS NULL
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

cylindersRouter.post(
  '/',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    await assertNumberFree(stationId, body.number);
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO cylinder (station_id, number, volume_l, material, working_pressure_bar,
                               manufacturer, manufactured_at, end_of_life_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          stationId,
          body.number,
          body.volume_l,
          body.material,
          body.working_pressure_bar,
          body.manufacturer ?? null,
          body.manufactured_at,
          body.end_of_life_at,
          body.notes ?? null,
        ],
      );
      const cylinderId = rows[0].id as string;
      // перший «останній гідротест» — звичайний рядок історії (схема §3.5)
      await client.query(
        `INSERT INTO hydro_test (cylinder_id, tested_at, performed_by, notes, created_by)
         VALUES ($1, $2, NULL, 'Внесено при заведенні балона', $3)`,
        [cylinderId, body.last_hydro_test_at, req.user!.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId,
        entityType: 'cylinder',
        entityId: cylinderId,
        action: 'create',
        changes: { number: { old: null, new: body.number } },
        requestId: req.requestId,
      });
      return cylinderId;
    });
    res.status(201).json(serialize(await getCardOr404(id)));
  }),
);

/** Масове створення: quantity балонів з номерами <база>-1..<база>-N, решта полів спільні. */
cylindersRouter.post(
  '/bulk',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(bulkCreateSchema, req.body);
    const stationId = resolveWriteStation(req, body.station_id ?? null);
    const numbers = Array.from({ length: body.quantity }, (_, i) => `${body.number}-${i + 1}`);
    const { rows: taken } = await pool.query(
      `SELECT number FROM cylinder
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
          `INSERT INTO cylinder (station_id, number, volume_l, material, working_pressure_bar,
                                 manufacturer, manufactured_at, end_of_life_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            stationId,
            number,
            body.volume_l,
            body.material,
            body.working_pressure_bar,
            body.manufacturer ?? null,
            body.manufactured_at,
            body.end_of_life_at,
            body.notes ?? null,
          ],
        );
        const cylinderId = rows[0].id as string;
        await client.query(
          `INSERT INTO hydro_test (cylinder_id, tested_at, performed_by, notes, created_by)
           VALUES ($1, $2, NULL, 'Внесено при заведенні балона', $3)`,
          [cylinderId, body.last_hydro_test_at, req.user!.id],
        );
        await writeAudit(client, {
          userId: req.user!.id,
          stationId,
          entityType: 'cylinder',
          entityId: cylinderId,
          action: 'create',
          changes: { number: { old: null, new: number } },
          requestId: req.requestId,
        });
        createdIds.push(cylinderId);
      }
      return createdIds;
    });
    const cards = await Promise.all(ids.map((cid) => getCardOr404(cid)));
    res.status(201).json(
      listEnvelope(cards.map(serialize), { page: 1, limit: ids.length, total: ids.length }),
    );
  }),
);

cylindersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, row.station_id);
    res.json(serialize(row));
  }),
);

cylindersRouter.patch(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(patchSchema, req.body);
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Балон списано — спершу відновіть його');
    if (body.number && body.number !== before.number) {
      await assertNumberFree(before.station_id, body.number, before.id);
    }
    const manufactured = body.manufactured_at ?? before.manufactured_at;
    const eol = body.end_of_life_at ?? before.end_of_life_at;
    if (eol <= manufactured) {
      throw errors.validation('Кінець строку служби має бути пізніше дати виготовлення', [
        { field: 'end_of_life_at', rule: 'chk_cylinder_eol' },
      ]);
    }
    const fields: Record<string, unknown> = {};
    for (const key of [
      'number',
      'volume_l',
      'material',
      'working_pressure_bar',
      'manufacturer',
      'manufactured_at',
      'end_of_life_at',
      'notes',
    ] as const) {
      if (body[key] !== undefined) fields[key] = body[key];
    }
    await withTransaction(async (client) => {
      const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE cylinder SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        [before.id, ...Object.values(fields)],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'cylinder',
        entityId: before.id,
        action: 'update',
        changes: diffChanges(before, fields),
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

/** Ручне коригування дати наступного гідротесту; {date: null} = повернути авторозрахунок. */
cylindersRouter.put(
  '/:id/next-hydro-test-override',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(overrideSchema, req.body);
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Балон списано');
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE cylinder SET next_hydro_test_override = $2, updated_at = now() WHERE id = $1`,
        [before.id, body.date],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'cylinder',
        entityId: before.id,
        action: 'update',
        changes: {
          next_hydro_test_override: { old: before.next_hydro_test_override, new: body.date },
        },
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

cylindersRouter.get(
  '/:id/hydro-tests',
  asyncHandler(async (req, res) => {
    const cylinder = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, cylinder.station_id);
    const { rows } = await pool.query(
      `SELECT ht.id, ht.cylinder_id, to_char(ht.tested_at, 'YYYY-MM-DD') AS tested_at,
              ht.notes, ht.created_at,
              pu.id AS performed_by_id, pu.full_name AS performed_by_name
         FROM hydro_test ht
         LEFT JOIN app_user pu ON pu.id = ht.performed_by
        WHERE ht.cylinder_id = $1
        ORDER BY ht.tested_at DESC, ht.created_at DESC`,
      [cylinder.id],
    );
    res.json(
      listEnvelope(
        rows.map((r) => ({
          id: r.id,
          cylinder_id: r.cylinder_id,
          tested_at: r.tested_at,
          performed_by: r.performed_by_id
            ? { id: r.performed_by_id, full_name: r.performed_by_name }
            : null,
          notes: r.notes,
          created_at: r.created_at,
        })),
        { page: 1, limit: rows.length, total: rows.length },
      ),
    );
  }),
);

/** «Зафіксувати гідротест» — append-only; скидає override (S7). */
cylindersRouter.post(
  '/:id/hydro-tests',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const body = parse(hydroTestSchema, req.body);
    const cylinder = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, cylinder.station_id);
    if (cylinder.archived_at) throw errors.conflict('Балон списано');
    // S7: новий тест не може бути давнішим за останній наявний
    if (cylinder.last_hydro_test_at && body.tested_at < cylinder.last_hydro_test_at) {
      throw new AppError(
        422,
        'HYDRO_TEST_DATE_REGRESSION',
        `Дата тесту не може бути ранішою за останній гідротест (${cylinder.last_hydro_test_at})`,
        [{ field: 'tested_at', rule: 'hydro_test_date_regression' }],
      );
    }
    if (body.performed_by) {
      const { rows } = await pool.query(
        `SELECT 1 FROM app_user WHERE id = $1 AND archived_at IS NULL`,
        [body.performed_by],
      );
      if (!rows[0]) {
        throw errors.validation('Виконавця не знайдено', [{ field: 'performed_by', rule: 'not_found' }]);
      }
    }
    const testId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO hydro_test (cylinder_id, tested_at, performed_by, notes, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [cylinder.id, body.tested_at, body.performed_by ?? null, body.notes ?? null, req.user!.id],
      );
      // S7: після нового тесту override скидається — авторозрахунок «оживає»
      await client.query(
        `UPDATE cylinder SET next_hydro_test_override = NULL, updated_at = now() WHERE id = $1`,
        [cylinder.id],
      );
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: cylinder.station_id,
        entityType: 'hydro_test',
        entityId: rows[0].id,
        action: 'create',
        changes: { cylinder_id: { old: null, new: cylinder.id }, tested_at: { old: null, new: body.tested_at } },
        requestId: req.requestId,
      });
      return rows[0].id as string;
    });
    const { rows } = await pool.query(
      `SELECT ht.id, ht.cylinder_id, to_char(ht.tested_at, 'YYYY-MM-DD') AS tested_at,
              ht.notes, ht.created_at, pu.id AS performed_by_id, pu.full_name AS performed_by_name
         FROM hydro_test ht LEFT JOIN app_user pu ON pu.id = ht.performed_by
        WHERE ht.id = $1`,
      [testId],
    );
    const t = rows[0];
    const updated = serialize(await getCardOr404(cylinder.id));
    res.status(201).json({
      id: t.id,
      cylinder_id: t.cylinder_id,
      tested_at: t.tested_at,
      performed_by: t.performed_by_id ? { id: t.performed_by_id, full_name: t.performed_by_name } : null,
      notes: t.notes,
      created_at: t.created_at,
      cylinder: { next_hydro_test_at: updated.next_hydro_test_at, condition: updated.condition },
    });
  }),
);

cylindersRouter.post(
  '/:id/archive',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (before.archived_at) throw errors.conflict('Балон вже списано');
    // S4: балон в апараті — спершу зняти
    if (before.apparatus_id) {
      throw new AppError(
        409,
        'COMPONENT_IN_USE',
        `Балон №${before.number} стоїть в апараті ${before.apparatus_name} — спочатку зніміть його`,
      );
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE cylinder SET archived_at = now(), updated_at = now() WHERE id = $1`, [before.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'cylinder',
        entityId: before.id,
        action: 'archive',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

cylindersRouter.post(
  '/:id/restore',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at) throw errors.conflict('Балон не списаний');
    await assertNumberFree(before.station_id, before.number, before.id);
    await withTransaction(async (client) => {
      await client.query(`UPDATE cylinder SET archived_at = NULL, updated_at = now() WHERE id = $1`, [before.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'cylinder',
        entityId: before.id,
        action: 'restore',
        requestId: req.requestId,
      });
    });
    res.json(serialize(await getCardOr404(before.id)));
  }),
);

/**
 * Справжнє видалення з бази (MVP). Перед видаленням повний знімок балона + його історії
 * (гідротести, установки, участь у заправках) пишеться в deleted_entity_archive (GET /archive).
 * - Не списаний балон: дозволено лише без історії використання (інакше — спершу /archive).
 * - Списаний балон: дозволено завжди; власна історія видаляється з робочих таблиць (лишається
 *   в архіві). Апарати/компресори, до яких він мав стосунок, залишаються — губиться лише
 *   цей конкретний рядок їхньої історії.
 */
cylindersRouter.delete(
  '/:id',
  requireRole('master', 'admin'),
  asyncHandler(async (req, res) => {
    const before = await getCardOr404(req.params.id);
    assertRecordInScope(req.user!, before.station_id);
    if (!before.archived_at) {
      const { rows } = await pool.query(
        `SELECT
           EXISTS (SELECT 1 FROM apparatus_cylinder WHERE cylinder_id = $1) AS in_apparatus,
           EXISTS (SELECT 1 FROM fill_session_item WHERE cylinder_id = $1)  AS in_fill_session`,
        [before.id],
      );
      if (rows[0].in_apparatus || rows[0].in_fill_session) {
        throw errors.conflict(
          `Балон №${before.number} має історію використання — спершу спишіть його`,
        );
      }
    }
    const snapshot = await buildDeleteSnapshot(before);
    await withTransaction(async (client) => {
      await writeArchiveEntry(client, {
        stationId: before.station_id,
        entityType: 'cylinder',
        entityId: before.id,
        label: `№${before.number}`,
        snapshot,
        deletedBy: req.user!.id,
      });
      await client.query(`DELETE FROM fill_session_item WHERE cylinder_id = $1`, [before.id]);
      await client.query(`DELETE FROM apparatus_cylinder WHERE cylinder_id = $1`, [before.id]);
      await client.query(`DELETE FROM hydro_test WHERE cylinder_id = $1`, [before.id]);
      await client.query(`DELETE FROM cylinder WHERE id = $1`, [before.id]);
      await writeAudit(client, {
        userId: req.user!.id,
        stationId: before.station_id,
        entityType: 'cylinder',
        entityId: before.id,
        action: 'delete',
        changes: { number: { old: before.number, new: null } },
        requestId: req.requestId,
      });
    });
    res.status(204).end();
  }),
);
