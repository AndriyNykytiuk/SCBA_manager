import type { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { AppError, errors } from '../../shared/errors';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SESSION_SELECT = `
  SELECT fs.id, fs.station_id, fs.pressure_before_bar, fs.pressure_target_bar,
         fs.started_at, fs.ended_at, fs.duration_hours::float8 AS duration_hours,
         fs.compressor_id, c.name AS compressor_name,
         u.id AS performed_by_id, u.full_name AS performed_by_name
    FROM fill_session fs
    JOIN compressor c ON c.id = fs.compressor_id
    JOIN app_user u ON u.id = fs.performed_by`;

export interface FillSessionItem {
  type: 'apparatus' | 'cylinder';
  id: string;
  name: string;
}

export async function fetchSessionItems(
  sessionIds: string[],
): Promise<Map<string, FillSessionItem[]>> {
  const map = new Map<string, FillSessionItem[]>();
  if (sessionIds.length === 0) return map;
  const { rows } = await pool.query(
    `SELECT fsi.fill_session_id, fsi.apparatus_id, fsi.cylinder_id,
            bp.name AS apparatus_name, cy.number AS cylinder_number
       FROM fill_session_item fsi
       LEFT JOIN apparatus a ON a.id = fsi.apparatus_id
       LEFT JOIN backplate bp ON bp.id = a.backplate_id
       LEFT JOIN cylinder cy ON cy.id = fsi.cylinder_id
      WHERE fsi.fill_session_id = ANY($1)
      ORDER BY fsi.apparatus_id NULLS LAST, fsi.id`,
    [sessionIds],
  );
  for (const r of rows) {
    const list = map.get(r.fill_session_id) ?? [];
    list.push(
      r.apparatus_id
        ? { type: 'apparatus', id: r.apparatus_id, name: r.apparatus_name }
        : { type: 'cylinder', id: r.cylinder_id, name: `№${r.cylinder_number}` },
    );
    map.set(r.fill_session_id, list);
  }
  return map;
}

export function serializeSession(row: any, items: FillSessionItem[]) {
  return {
    id: row.id,
    station_id: row.station_id,
    compressor: { id: row.compressor_id, name: row.compressor_name },
    pressure_before_bar: row.pressure_before_bar,
    pressure_target_bar: row.pressure_target_bar,
    started_at: row.started_at,
    ended_at: row.ended_at,
    duration_hours: row.duration_hours,
    performed_by: { id: row.performed_by_id, full_name: row.performed_by_name },
    items,
  };
}

export async function getSessionRowOr404(id: string): Promise<any> {
  const { rows } = await pool.query(`${SESSION_SELECT} WHERE fs.id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Сесію заправки не знайдено');
  return rows[0];
}

export async function getSessionCard(id: string) {
  const row = await getSessionRowOr404(id);
  const items = (await fetchSessionItems([id])).get(id) ?? [];
  return serializeSession(row, items);
}

/**
 * Позиція «апарат» (S1, S2, S6: розібраний апарат заправляти нема чого).
 * Викликається всередині транзакції старту сесії.
 */
export async function addApparatusItem(
  client: PoolClient,
  input: { sessionId: string; stationId: string; apparatusId: string },
): Promise<void> {
  const { rows } = await client.query(
    `SELECT a.id, a.station_id, a.archived_at, bp.name,
            (SELECT count(*)::int FROM apparatus_cylinder ac
              WHERE ac.apparatus_id = a.id AND ac.removed_at IS NULL) AS cylinders_installed
       FROM apparatus a
       JOIN backplate bp ON bp.id = a.backplate_id
      WHERE a.id = $1`,
    [input.apparatusId],
  );
  const a = rows[0];
  if (!a) {
    throw errors.validation('Апарат не знайдено', [{ field: 'items', rule: 'not_found' }]);
  }
  if (a.station_id !== input.stationId) {
    // S1
    throw new AppError(409, 'STATION_MISMATCH', `Апарат ${a.name} належить іншій станції`);
  }
  if (a.archived_at) {
    // S2
    throw new AppError(409, 'COMPONENT_ARCHIVED', `Апарат ${a.name} заархівовано`);
  }
  if (a.cylinders_installed === 0) {
    // S6
    throw new AppError(
      409,
      'APPARATUS_EMPTY',
      `В апараті ${a.name} немає жодного встановленого балона`,
    );
  }
  await client.query(
    `INSERT INTO fill_session_item (fill_session_id, apparatus_id) VALUES ($1, $2)`,
    [input.sessionId, input.apparatusId],
  );
}

/**
 * Позиція «окремий балон поза апаратом» (U-5; S1, S2, S6).
 * Викликається всередині транзакції старту сесії.
 */
export async function addCylinderItem(
  client: PoolClient,
  input: { sessionId: string; stationId: string; cylinderId: string },
): Promise<void> {
  const { rows } = await client.query(
    `SELECT cy.id, cy.station_id, cy.number, cy.archived_at,
            ac.apparatus_id AS installed_in, bp.name AS installed_in_name
       FROM cylinder cy
       LEFT JOIN apparatus_cylinder ac ON ac.cylinder_id = cy.id AND ac.removed_at IS NULL
       LEFT JOIN apparatus a ON a.id = ac.apparatus_id
       LEFT JOIN backplate bp ON bp.id = a.backplate_id
      WHERE cy.id = $1`,
    [input.cylinderId],
  );
  const cy = rows[0];
  if (!cy) {
    throw errors.validation('Балон не знайдено', [{ field: 'items', rule: 'not_found' }]);
  }
  if (cy.station_id !== input.stationId) {
    // S1
    throw new AppError(409, 'STATION_MISMATCH', `Балон №${cy.number} належить іншій станції`);
  }
  if (cy.archived_at) {
    // S2
    throw new AppError(409, 'COMPONENT_ARCHIVED', `Балон №${cy.number} списано`);
  }
  if (cy.installed_in) {
    // S6: «окремий балон» насправді стоїть в апараті
    throw new AppError(
      409,
      'CYLINDER_NOT_FREE',
      `Балон №${cy.number} стоїть в апараті ${cy.installed_in_name} — додайте апарат замість балона`,
    );
  }
  await client.query(
    `INSERT INTO fill_session_item (fill_session_id, cylinder_id) VALUES ($1, $2)`,
    [input.sessionId, input.cylinderId],
  );
}
