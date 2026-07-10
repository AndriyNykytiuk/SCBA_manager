import { pool } from '../../db/pool';
import {
  apparatusCondition,
  backplateCondition,
  compressorCondition,
  cylinderCondition,
  round1,
  worstStatus,
  type Condition,
  type ConditionStatus,
  type MaintenanceLevelRow,
} from '../../shared/status';

export interface AlertItem {
  entity_type: 'apparatus' | 'cylinder' | 'backplate' | 'compressor';
  entity_id: string;
  title: string;
  subtitle: string;
  status: ConditionStatus;
  reason: string | null;
  due_at: string | null;
  overdue_days?: number;
  days_left?: number;
  due_hours?: number;
  overdue_hours?: number;
  /** внутрішній ключ сортування (не серіалізується) */
  sortKey?: number;
}

export interface StationAlerts {
  counters: { overdue: number; warning: number; ok: number };
  items: AlertItem[];
}

const MATERIAL_UA: Record<string, string> = { metal: 'метал', composite: 'композит' };

/** Усі елементи «потребує уваги» станції + лічильники (джерела — VIEW зі схеми §4). */
export async function getStationAlerts(stationId: string): Promise<StationAlerts> {
  const counters = { overdue: 0, warning: 0, ok: 0 };
  const items: AlertItem[] = [];

  const count = (s: ConditionStatus) => {
    counters[s] += 1;
  };

  // --- Балони ---
  const cylinders = await pool.query(
    `SELECT cy.id, cy.number, cy.volume_l::float8 AS volume_l, cy.material,
            cs.status,
            to_char(cs.next_hydro_test_at, 'YYYY-MM-DD') AS next_hydro_test_at,
            (cs.next_hydro_test_at - current_date)::int  AS hydro_days_left,
            to_char(cy.end_of_life_at, 'YYYY-MM-DD')     AS end_of_life_at,
            (cy.end_of_life_at - current_date)::int      AS eol_days_left,
            bp.name AS apparatus_name
       FROM cylinder cy
       JOIN v_cylinder_status cs ON cs.cylinder_id = cy.id
       LEFT JOIN apparatus_cylinder ac ON ac.cylinder_id = cy.id AND ac.removed_at IS NULL
       LEFT JOIN apparatus a ON a.id = ac.apparatus_id AND a.archived_at IS NULL
       LEFT JOIN backplate bp ON bp.id = a.backplate_id
      WHERE cy.station_id = $1`,
    [stationId],
  );
  for (const r of cylinders.rows) {
    const cond = cylinderCondition({
      status: r.status,
      nextHydroTestAt: r.next_hydro_test_at,
      hydroDaysLeft: r.hydro_days_left,
      endOfLifeAt: r.end_of_life_at,
      eolDaysLeft: r.eol_days_left,
    });
    count(cond.status);
    if (cond.status === 'ok') continue;
    const where = r.apparatus_name ? `в апараті ${r.apparatus_name}` : 'вільний';
    const daysLeft = Math.min(
      r.hydro_days_left ?? Number.MAX_SAFE_INTEGER,
      r.eol_days_left ?? Number.MAX_SAFE_INTEGER,
    );
    items.push({
      entity_type: 'cylinder',
      entity_id: r.id,
      title: `№${r.number}`,
      subtitle: `балон ${r.volume_l} л ${MATERIAL_UA[r.material] ?? r.material} · ${where}`,
      status: cond.status,
      reason: cond.reason,
      due_at: cond.due_at,
      ...(cond.status === 'overdue' ? { overdue_days: Math.abs(daysLeft) } : { days_left: daysLeft }),
      sortKey: daysLeft,
    });
  }

  // --- Ложаменти ---
  const backplates = await pool.query(
    `SELECT b.id, b.name, bps.status,
            to_char(bps.next_reducer_replacement_at, 'YYYY-MM-DD') AS next_at,
            (bps.next_reducer_replacement_at - current_date)::int  AS days_left,
            (a.id IS NOT NULL) AS in_apparatus
       FROM backplate b
       JOIN v_backplate_status bps ON bps.backplate_id = b.id
       LEFT JOIN apparatus a ON a.backplate_id = b.id AND a.archived_at IS NULL
      WHERE b.station_id = $1`,
    [stationId],
  );
  for (const r of backplates.rows) {
    const cond = backplateCondition({
      status: r.status,
      nextReducerReplacementAt: r.next_at,
      daysLeft: r.days_left,
    });
    count(cond.status);
    if (cond.status === 'ok') continue;
    const where = r.in_apparatus ? `в апараті ${r.name}` : 'вільний';
    items.push({
      entity_type: 'backplate',
      entity_id: r.id,
      title: r.name,
      subtitle: `ложамент · ${where}`,
      status: cond.status,
      reason:
        cond.status === 'overdue'
          ? `Редуктор прострочено ${Math.abs(r.days_left)} дн`
          : `Редуктор через ${r.days_left} дн`,
      due_at: cond.due_at,
      ...(cond.status === 'overdue'
        ? { overdue_days: Math.abs(r.days_left) }
        : { days_left: r.days_left }),
      sortKey: r.days_left,
    });
  }

  // --- Апарати (агрегат компонентів) ---
  const apparatus = await pool.query(
    `SELECT a.id, bp.name, vas.status, sl.name AS location_name,
            bps.status AS bp_status,
            to_char(bps.next_reducer_replacement_at, 'YYYY-MM-DD') AS bp_next_at,
            (bps.next_reducer_replacement_at - current_date)::int  AS bp_days_left
       FROM apparatus a
       JOIN backplate bp ON bp.id = a.backplate_id
       JOIN v_apparatus_status vas ON vas.apparatus_id = a.id
       JOIN v_backplate_status bps ON bps.backplate_id = bp.id
       LEFT JOIN storage_location sl ON sl.id = a.storage_location_id
      WHERE a.station_id = $1`,
    [stationId],
  );
  const apparatusCylinders = await pool.query(
    `SELECT ac.apparatus_id, cy.number, cs.status,
            to_char(cs.next_hydro_test_at, 'YYYY-MM-DD') AS next_hydro_test_at,
            (cs.next_hydro_test_at - current_date)::int  AS hydro_days_left,
            to_char(cy.end_of_life_at, 'YYYY-MM-DD')     AS end_of_life_at,
            (cy.end_of_life_at - current_date)::int      AS eol_days_left
       FROM apparatus_cylinder ac
       JOIN apparatus a ON a.id = ac.apparatus_id AND a.archived_at IS NULL
       JOIN cylinder cy ON cy.id = ac.cylinder_id
       LEFT JOIN v_cylinder_status cs ON cs.cylinder_id = cy.id
      WHERE a.station_id = $1 AND ac.removed_at IS NULL`,
    [stationId],
  );
  const byApparatus = new Map<string, Array<{ number: string; condition: Condition; daysLeft: number }>>();
  for (const r of apparatusCylinders.rows) {
    const cond = cylinderCondition({
      status: r.status,
      nextHydroTestAt: r.next_hydro_test_at,
      hydroDaysLeft: r.hydro_days_left,
      endOfLifeAt: r.end_of_life_at,
      eolDaysLeft: r.eol_days_left,
    });
    const list = byApparatus.get(r.apparatus_id) ?? [];
    list.push({
      number: r.number,
      condition: cond,
      daysLeft: Math.min(r.hydro_days_left ?? Number.MAX_SAFE_INTEGER, r.eol_days_left ?? Number.MAX_SAFE_INTEGER),
    });
    byApparatus.set(r.apparatus_id, list);
  }
  for (const r of apparatus.rows) {
    const comps = byApparatus.get(r.id) ?? [];
    const bpCond = backplateCondition({
      status: r.bp_status,
      nextReducerReplacementAt: r.bp_next_at,
      daysLeft: r.bp_days_left,
    });
    const cond = apparatusCondition({ status: r.status, backplate: bpCond, cylinders: comps });
    count(cond.status);
    if (cond.status === 'ok') continue;
    const daysCandidates = comps
      .filter((c) => c.condition.status === cond.status)
      .map((c) => c.daysLeft);
    if (bpCond.status === cond.status && r.bp_days_left !== null) daysCandidates.push(r.bp_days_left);
    const daysLeft = daysCandidates.length ? Math.min(...daysCandidates) : 0;
    items.push({
      entity_type: 'apparatus',
      entity_id: r.id,
      title: r.name,
      subtitle: r.location_name ? `апарат · ${r.location_name}` : 'апарат',
      status: cond.status,
      reason: cond.reason,
      due_at: cond.due_at,
      ...(cond.status === 'overdue' ? { overdue_days: Math.abs(daysLeft) } : { days_left: daysLeft }),
      sortKey: daysLeft,
    });
  }

  // --- Компресори (найгірший рівень ТО) ---
  const compressors = await pool.query(
    `SELECT c.id, c.name, d.level, d.engine_hours::float8 AS engine_hours,
            d.due_hours::float8 AS due_hours,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date, d.status
       FROM compressor c
       JOIN v_compressor_maintenance_due d ON d.compressor_id = c.id
      WHERE c.station_id = $1
      ORDER BY c.id, d.level`,
    [stationId],
  );
  const byCompressor = new Map<string, { name: string; levels: MaintenanceLevelRow[] }>();
  for (const r of compressors.rows) {
    const entry: { name: string; levels: MaintenanceLevelRow[] } =
      byCompressor.get(r.id) ?? { name: r.name, levels: [] };
    entry.levels.push({
      level: r.level,
      due_hours: r.due_hours,
      due_date: r.due_date,
      status: r.status,
      engine_hours: r.engine_hours,
    });
    byCompressor.set(r.id, entry);
  }
  for (const [id, entry] of byCompressor) {
    const cond = compressorCondition(entry.levels);
    count(cond.status);
    if (cond.status === 'ok') continue;
    const culprit = entry.levels
      .filter((l) => l.status === cond.status)
      .reduce((a, b) => (b.level > a.level ? b : a));
    const hoursDelta = round1(culprit.due_hours - culprit.engine_hours);
    items.push({
      entity_type: 'compressor',
      entity_id: id,
      title: entry.name,
      subtitle: 'компресор',
      status: cond.status,
      reason: cond.reason,
      due_at: culprit.due_date,
      due_hours: culprit.due_hours,
      ...(cond.status === 'overdue'
        ? { overdue_hours: Math.abs(hoursDelta) }
        : {}),
      sortKey: hoursDelta, // мг ≈ «днів» для впорядкування в межах групи
    });
  }

  // Сортування: overdue → warning; усередині — найпростроченіше/найближче вгорі
  items.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'overdue' ? -1 : 1;
    return (a.sortKey ?? 0) - (b.sortKey ?? 0);
  });

  return { counters, items };
}

/** Лічильники для перемикача станцій (GET /stations). */
export async function getStationCounters(
  stationId: string,
): Promise<{ overdue: number; warning: number }> {
  const { counters } = await getStationAlerts(stationId);
  return { overdue: counters.overdue, warning: counters.warning };
}

export { worstStatus };
