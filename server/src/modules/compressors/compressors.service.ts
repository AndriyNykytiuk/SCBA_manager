import { pool } from '../../db/pool';
import { errors } from '../../shared/errors';
import {
  compressorCondition,
  round1,
  round2,
  type MaintenanceLevelRow,
} from '../../shared/status';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const COMPRESSOR_CARD_SELECT = `
  SELECT c.id, c.station_id, c.name, c.manufacturer, c.model,
         c.initial_engine_hours::float8      AS initial_engine_hours,
         to_char(c.initial_maintenance_at, 'YYYY-MM-DD') AS initial_maintenance_at,
         c.initial_maintenance_hours::float8 AS initial_maintenance_hours,
         c.notes, c.created_at, c.updated_at, c.archived_at,
         COALESCE(eh.engine_hours, c.initial_engine_hours)::float8 AS engine_hours,
         fs.id AS active_fill_session_id
    FROM compressor c
    LEFT JOIN v_compressor_engine_hours eh ON eh.compressor_id = c.id
    LEFT JOIN fill_session fs ON fs.compressor_id = c.id AND fs.ended_at IS NULL`;

/** Рівні ТО з v_compressor_maintenance_due (архівні компресори у VIEW відсутні → []). */
export async function fetchMaintenanceLevels(
  compressorIds: string[],
): Promise<Map<string, MaintenanceLevelRow[]>> {
  const map = new Map<string, MaintenanceLevelRow[]>();
  if (compressorIds.length === 0) return map;
  const { rows } = await pool.query(
    `SELECT compressor_id, level,
            engine_hours::float8 AS engine_hours,
            due_hours::float8    AS due_hours,
            to_char(due_date, 'YYYY-MM-DD') AS due_date,
            status
       FROM v_compressor_maintenance_due
      WHERE compressor_id = ANY($1)
      ORDER BY level`,
    [compressorIds],
  );
  for (const r of rows) {
    const list = map.get(r.compressor_id) ?? [];
    list.push({
      level: r.level,
      due_hours: r.due_hours,
      due_date: r.due_date,
      status: r.status,
      engine_hours: r.engine_hours,
    });
    map.set(r.compressor_id, list);
  }
  return map;
}

/** Передвибір у модалці «Провести ТО»: max(level) серед warning/overdue; null якщо все ok. */
export function suggestedLevel(levels: MaintenanceLevelRow[]): number | null {
  const bad = levels.filter((l) => l.status !== 'ok');
  if (bad.length === 0) return null;
  return Math.max(...bad.map((l) => l.level));
}

/** Найближче ТО (ProgressToMaintenance): найменше due_hours; при рівності — найвищий рівень. */
export function nextMaintenance(
  levels: MaintenanceLevelRow[],
): { level: number; due_hours: number } | null {
  if (levels.length === 0) return null;
  const best = levels.reduce((a, b) =>
    b.due_hours < a.due_hours || (b.due_hours === a.due_hours && b.level > a.level) ? b : a,
  );
  return { level: best.level, due_hours: round1(best.due_hours) };
}

export function serializeCompressor(row: any, levels: MaintenanceLevelRow[]) {
  return {
    id: row.id,
    station_id: row.station_id,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    initial_engine_hours: row.initial_engine_hours,
    initial_maintenance_at: row.initial_maintenance_at,
    initial_maintenance_hours: row.initial_maintenance_hours,
    engine_hours: round2(row.engine_hours),
    active_fill_session_id: row.active_fill_session_id ?? null,
    condition: compressorCondition(levels),
    maintenance: {
      suggested_level: suggestedLevel(levels),
      levels: levels.map((l) => ({
        level: l.level,
        due_hours: round1(l.due_hours),
        due_date: l.due_date,
        status: l.status,
      })),
      next: nextMaintenance(levels),
    },
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

export async function getCompressorRowOr404(id: string): Promise<any> {
  const { rows } = await pool.query(`${COMPRESSOR_CARD_SELECT} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw errors.notFound('Компресор не знайдено');
  return rows[0];
}

export async function getCompressorCard(id: string) {
  const row = await getCompressorRowOr404(id);
  const levels = (await fetchMaintenanceLevels([id])).get(id) ?? [];
  return serializeCompressor(row, levels);
}

/** «1 225.0» — мотогодини з пробілом-роздільником тисяч (тексти — тільки на бекенді). */
export function fmtHours(n: number): string {
  const [int, frac] = n.toFixed(1).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`;
}

/** Українська форма множини: pluralUk(3, 'апарат', 'апарати', 'апаратів') → 'апарати'. */
export function pluralUk(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Рядок стрічки історії: «Сесія 24 хв · 3 апарати · 180→300 бар». */
export function fillSessionSummary(input: {
  durationHours: number | null;
  apparatusCount: number;
  cylinderCount: number;
  pressureBeforeBar: number;
  pressureTargetBar: number;
}): string {
  const parts: string[] = [];
  parts.push(
    input.durationHours === null
      ? 'Сесія триває'
      : `Сесія ${Math.max(1, Math.round(input.durationHours * 60))} хв`,
  );
  if (input.apparatusCount > 0) {
    parts.push(
      `${input.apparatusCount} ${pluralUk(input.apparatusCount, 'апарат', 'апарати', 'апаратів')}`,
    );
  }
  if (input.cylinderCount > 0) {
    parts.push(
      `${input.cylinderCount} ${pluralUk(input.cylinderCount, 'балон', 'балони', 'балонів')}`,
    );
  }
  parts.push(`${input.pressureBeforeBar}→${input.pressureTargetBar} бар`);
  return parts.join(' · ');
}
