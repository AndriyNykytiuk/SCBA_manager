import type { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { AppError, errors } from '../../shared/errors';
import {
  apparatusCondition,
  backplateCondition,
  cylinderCondition,
  type Condition,
} from '../../shared/status';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const APPARATUS_CARD_SELECT = `
  SELECT a.id, a.station_id, a.notes, a.created_at, a.updated_at, a.archived_at,
         bp.id AS bp_id, bp.name AS bp_name, bp.model AS bp_model,
         bps.status AS bp_condition_status,
         to_char(bps.next_reducer_replacement_at, 'YYYY-MM-DD') AS bp_next_at,
         (bps.next_reducer_replacement_at - current_date)::int  AS bp_days_left,
         COALESCE(vas.cylinders_installed, 0)::int AS cylinders_installed,
         vas.status AS condition_status,
         sl.id AS sl_id, sl.name AS sl_name
    FROM apparatus a
    JOIN backplate bp ON bp.id = a.backplate_id
    LEFT JOIN v_backplate_status bps ON bps.backplate_id = bp.id
    LEFT JOIN v_apparatus_status vas ON vas.apparatus_id = a.id
    LEFT JOIN storage_location sl ON sl.id = a.storage_location_id`;

export interface ApparatusCylinderRow {
  apparatus_id: string;
  position: number;
  installed_at: Date;
  id: string;
  number: string;
  volume_l: number;
  material: string;
  condition: Condition;
}

export async function fetchApparatusCylinders(
  apparatusIds: string[],
): Promise<Map<string, ApparatusCylinderRow[]>> {
  const map = new Map<string, ApparatusCylinderRow[]>();
  if (apparatusIds.length === 0) return map;
  const { rows } = await pool.query(
    `SELECT ac.apparatus_id, ac.position, ac.installed_at,
            cy.id, cy.number, cy.volume_l::float8 AS volume_l, cy.material,
            cs.status AS condition_status,
            to_char(cs.next_hydro_test_at, 'YYYY-MM-DD') AS next_hydro_test_at,
            (cs.next_hydro_test_at - current_date)::int  AS hydro_days_left,
            to_char(cy.end_of_life_at, 'YYYY-MM-DD')     AS end_of_life_at,
            (cy.end_of_life_at - current_date)::int      AS eol_days_left
       FROM apparatus_cylinder ac
       JOIN cylinder cy ON cy.id = ac.cylinder_id
       LEFT JOIN v_cylinder_status cs ON cs.cylinder_id = cy.id
      WHERE ac.apparatus_id = ANY($1) AND ac.removed_at IS NULL
      ORDER BY ac.position`,
    [apparatusIds],
  );
  for (const r of rows) {
    const list = map.get(r.apparatus_id) ?? [];
    list.push({
      apparatus_id: r.apparatus_id,
      position: r.position,
      installed_at: r.installed_at,
      id: r.id,
      number: r.number,
      volume_l: r.volume_l,
      material: r.material,
      condition: cylinderCondition({
        status: r.condition_status,
        nextHydroTestAt: r.next_hydro_test_at,
        hydroDaysLeft: r.hydro_days_left,
        endOfLifeAt: r.end_of_life_at,
        eolDaysLeft: r.eol_days_left,
      }),
    });
    map.set(r.apparatus_id, list);
  }
  return map;
}

export function serializeApparatus(row: any, cylinders: ApparatusCylinderRow[]) {
  const bpCondition = backplateCondition({
    status: row.bp_condition_status,
    nextReducerReplacementAt: row.bp_next_at,
    daysLeft: row.bp_days_left,
  });
  const condition = apparatusCondition({
    status: row.condition_status,
    backplate: bpCondition,
    cylinders: cylinders.map((c) => ({ number: c.number, condition: c.condition })),
  });
  return {
    id: row.id,
    station_id: row.station_id,
    name: row.bp_name, // ідентифікатор апарата = назва ложамента (U-1)
    backplate: {
      id: row.bp_id,
      name: row.bp_name,
      model: row.bp_model,
      condition: bpCondition,
    },
    cylinders: cylinders.map((c) => ({
      position: c.position,
      cylinder: {
        id: c.id,
        number: c.number,
        volume_l: c.volume_l,
        material: c.material,
        condition: c.condition,
      },
      installed_at: c.installed_at,
    })),
    cylinders_installed: row.cylinders_installed,
    condition,
    storage_location: row.sl_id ? { id: row.sl_id, name: row.sl_name } : null,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

export async function getApparatusRowOr404(id: string): Promise<any> {
  const { rows } = await pool.query(`${APPARATUS_CARD_SELECT} WHERE a.id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Апарат не знайдено');
  return rows[0];
}

export async function getApparatusCard(id: string) {
  const row = await getApparatusRowOr404(id);
  const cylinders = (await fetchApparatusCylinders([id])).get(id) ?? [];
  return serializeApparatus(row, cylinders);
}

/**
 * Установка балона на позицію (S1, S2 + унікальні індекси схеми).
 * Викликається всередині транзакції.
 */
export async function installCylinder(
  client: PoolClient,
  input: {
    apparatusId: string;
    apparatusStationId: string;
    apparatusName: string;
    cylinderId: string;
    position: number;
    userId: string;
  },
): Promise<void> {
  const { rows } = await client.query(
    `SELECT cy.id, cy.station_id, cy.number, cy.archived_at,
            ac.apparatus_id AS installed_in, bp.name AS installed_in_name
       FROM cylinder cy
       LEFT JOIN apparatus_cylinder ac ON ac.cylinder_id = cy.id AND ac.removed_at IS NULL
       LEFT JOIN apparatus a ON a.id = ac.apparatus_id
       LEFT JOIN backplate bp ON bp.id = a.backplate_id
      WHERE cy.id = $1
      FOR UPDATE OF cy`,
    [input.cylinderId],
  );
  const cy = rows[0];
  if (!cy) {
    throw errors.validation('Балон не знайдено', [{ field: 'cylinder_id', rule: 'not_found' }]);
  }
  if (cy.station_id !== input.apparatusStationId) {
    // S1: компонент іншої станції
    throw new AppError(409, 'STATION_MISMATCH', `Балон №${cy.number} належить іншій станції`);
  }
  if (cy.archived_at) {
    // S2
    throw new AppError(409, 'COMPONENT_ARCHIVED', `Балон №${cy.number} списано`);
  }
  if (cy.installed_in) {
    throw new AppError(
      409,
      'CYLINDER_ALREADY_INSTALLED',
      `Балон №${cy.number} вже встановлений в апараті ${cy.installed_in_name}`,
      [{ field: 'cylinder_id', rule: 'unique_current_installation' }],
    );
  }
  const occupied = await client.query(
    `SELECT 1 FROM apparatus_cylinder WHERE apparatus_id = $1 AND position = $2 AND removed_at IS NULL`,
    [input.apparatusId, input.position],
  );
  if (occupied.rows[0]) {
    throw new AppError(
      409,
      'POSITION_OCCUPIED',
      `Позиція ${input.position} в апараті ${input.apparatusName} вже зайнята`,
    );
  }
  await client.query(
    `INSERT INTO apparatus_cylinder (apparatus_id, cylinder_id, position, installed_by)
     VALUES ($1, $2, $3, $4)`,
    [input.apparatusId, input.cylinderId, input.position, input.userId],
  );
}
