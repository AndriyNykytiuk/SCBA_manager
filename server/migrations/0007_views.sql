-- Up Migration
-- db-schema.md §4 — розрахунок статусів і термінів (усе на боці БД/бекенда)

-- 4.1 Наробіток компресора: initial + сума завершених сесій
CREATE VIEW v_compressor_engine_hours AS
SELECT c.id AS compressor_id,
       c.initial_engine_hours
         + COALESCE(SUM(fs.duration_hours) FILTER (WHERE fs.ended_at IS NOT NULL), 0)
         AS engine_hours
FROM compressor c
LEFT JOIN fill_session fs ON fs.compressor_id = c.id
GROUP BY c.id, c.initial_engine_hours;

-- 4.2 Статус балона.
-- Ефективна дата наступного гідротесту:
--   COALESCE(override, останній тест + інтервал, manufactured_at + інтервал)
-- (третій доданок — fallback DB-4: балон без жодного гідротесту).
CREATE VIEW v_cylinder_status AS
WITH last_test AS (
    SELECT DISTINCT ON (cylinder_id) cylinder_id, tested_at
    FROM hydro_test ORDER BY cylinder_id, tested_at DESC
)
SELECT cy.id AS cylinder_id,
       lt.tested_at AS last_hydro_test_at,
       nx.next_hydro_test_at,
       cy.end_of_life_at,
       CASE
         WHEN cy.end_of_life_at < current_date        THEN 'overdue'
         WHEN nx.next_hydro_test_at < current_date    THEN 'overdue'
         WHEN cy.end_of_life_at <= current_date + 30  THEN 'warning'
         WHEN nx.next_hydro_test_at <= current_date + 30 THEN 'warning'
         ELSE 'ok'
       END AS status
FROM cylinder cy
LEFT JOIN last_test lt ON lt.cylinder_id = cy.id
CROSS JOIN LATERAL (
    SELECT COALESCE(
             cy.next_hydro_test_override,
             (lt.tested_at + make_interval(months => cy.hydro_interval_months))::date,
             (cy.manufactured_at + make_interval(months => cy.hydro_interval_months))::date
           ) AS next_hydro_test_at
) nx
WHERE cy.archived_at IS NULL;

-- 4.3 Статус ложамента (редуктор). База: COALESCE(reducer_last_replaced_at, commissioned_at).
-- Поріг warning = 60 днів (DB-1).
CREATE VIEW v_backplate_status AS
SELECT b.id AS backplate_id,
       (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
          + make_interval(months => b.reducer_interval_months))::date
          AS next_reducer_replacement_at,
       CASE
         WHEN b.reducer_interval_months IS NULL
              OR COALESCE(b.reducer_last_replaced_at, b.commissioned_at) IS NULL THEN 'ok'
         WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
               + make_interval(months => b.reducer_interval_months))::date
              < current_date THEN 'overdue'
         WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
               + make_interval(months => b.reducer_interval_months))::date
              <= current_date + 60 THEN 'warning'
         ELSE 'ok'
       END AS status
FROM backplate b
WHERE b.archived_at IS NULL;

-- 4.4 Статус апарата: прострочений компонент → апарат несправний (overdue).
CREATE VIEW v_apparatus_status AS
SELECT a.id AS apparatus_id,
       COUNT(ac.id) AS cylinders_installed,          -- 0 = «розібраний»
       CASE
         WHEN bool_or(cs.status = 'overdue')
           OR bps.status = 'overdue'                       THEN 'overdue'
         WHEN bool_or(cs.status = 'warning')
           OR bps.status = 'warning'                       THEN 'warning'
         ELSE 'ok'
       END AS status
FROM apparatus a
JOIN v_backplate_status bps ON bps.backplate_id = a.backplate_id
LEFT JOIN apparatus_cylinder ac
       ON ac.apparatus_id = a.id AND ac.removed_at IS NULL
LEFT JOIN v_cylinder_status cs ON cs.cylinder_id = ac.cylinder_id
WHERE a.archived_at IS NULL
GROUP BY a.id, bps.status;

-- 4.5 Наступні ТО компресора (U-6): рівні незалежні; ТО вищого рівня «закриває» нижчі;
-- база без історії — initial_maintenance_hours/at; календар — тільки 1000 (1 р.) і 2000 (2 р.).
-- Пороги warning: 10% інтервалу рівня / 30 днів календарних (DB-2).
CREATE VIEW v_compressor_maintenance_due AS
WITH levels(level) AS (VALUES (25),(125),(500),(1000),(2000)),
     last_done AS (
       SELECT c.id AS compressor_id, l.level,
              GREATEST(
                COALESCE((SELECT max(cm.engine_hours_at) FROM compressor_maintenance cm
                          WHERE cm.compressor_id = c.id AND cm.level >= l.level),
                         c.initial_maintenance_hours, 0)
              ) AS last_hours,
              COALESCE((SELECT max(cm.performed_at) FROM compressor_maintenance cm
                        WHERE cm.compressor_id = c.id AND cm.level >= l.level),
                       c.initial_maintenance_at) AS last_date
       FROM compressor c CROSS JOIN levels l
       WHERE c.archived_at IS NULL
     )
SELECT ld.compressor_id,
       ld.level,
       eh.engine_hours,
       ld.last_hours + ld.level                    AS due_hours,
       CASE ld.level                               -- календарне due — тільки 1000/2000
         WHEN 1000 THEN ld.last_date + interval '1 year'
         WHEN 2000 THEN ld.last_date + interval '2 years'
         ELSE NULL
       END::date                                   AS due_date,
       CASE
         WHEN eh.engine_hours >= ld.last_hours + ld.level          THEN 'overdue'
         WHEN ld.level IN (1000, 2000) AND ld.last_date IS NOT NULL
              AND (ld.last_date + make_interval(
                     years => CASE ld.level WHEN 1000 THEN 1 ELSE 2 END))::date
                  < current_date                                    THEN 'overdue'
         WHEN eh.engine_hours >= ld.last_hours + ld.level * 0.9     THEN 'warning'
         WHEN ld.level IN (1000, 2000) AND ld.last_date IS NOT NULL
              AND (ld.last_date + make_interval(
                     years => CASE ld.level WHEN 1000 THEN 1 ELSE 2 END))::date
                  <= current_date + 30                              THEN 'warning'
         ELSE 'ok'
       END AS status
FROM last_done ld
JOIN v_compressor_engine_hours eh ON eh.compressor_id = ld.compressor_id;

-- Down Migration
DROP VIEW v_compressor_maintenance_due;
DROP VIEW v_apparatus_status;
DROP VIEW v_backplate_status;
DROP VIEW v_cylinder_status;
DROP VIEW v_compressor_engine_hours;
