-- Up Migration
-- Ложамент: заміна мембрани — дата фіксується майстром/адміном (як редуктор), а ІНТЕРВАЛ
-- перевірки задає ЛИШЕ адмін (перевірка ролі — на бекенді, у PATCH/POST-роутах, а не тут).
-- Статус ложамента/апарата тепер враховує ГІРШИЙ з двох компонентів (редуктор, мембрана) —
-- той самий принцип, що вже застосований для балона (гідротест vs строк служби).
ALTER TABLE backplate ADD COLUMN membrane_replaced_at date;
ALTER TABLE backplate ADD COLUMN membrane_interval_months integer;
ALTER TABLE backplate ADD CONSTRAINT chk_backplate_membrane_interval
    CHECK (membrane_interval_months IS NULL OR membrane_interval_months > 0);

-- CREATE OR REPLACE (не DROP): backplate_id/next_reducer_replacement_at/status лишаються на
-- тих самих позиціях (Postgres дозволяє лише ДОДАВАТИ колонки в кінець) — v_apparatus_status,
-- що JOIN-иться на цей VIEW, не потребує перестворення.
CREATE OR REPLACE VIEW v_backplate_status AS
SELECT
  x.backplate_id,
  x.next_reducer_replacement_at,
  CASE
    WHEN x.reducer_status = 'overdue' OR x.membrane_status = 'overdue' THEN 'overdue'
    WHEN x.reducer_status = 'warning' OR x.membrane_status = 'warning' THEN 'warning'
    ELSE 'ok'
  END AS status,
  x.next_membrane_replacement_at
FROM (
  SELECT
    b.id AS backplate_id,
    (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
       + make_interval(months => b.reducer_interval_months))::date AS next_reducer_replacement_at,
    (COALESCE(b.membrane_replaced_at, b.commissioned_at)
       + make_interval(months => b.membrane_interval_months))::date AS next_membrane_replacement_at,
    CASE
      WHEN b.reducer_interval_months IS NULL
           OR COALESCE(b.reducer_last_replaced_at, b.commissioned_at) IS NULL THEN 'ok'
      WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
            + make_interval(months => b.reducer_interval_months))::date < current_date THEN 'overdue'
      WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
            + make_interval(months => b.reducer_interval_months))::date <= current_date + 60 THEN 'warning'
      ELSE 'ok'
    END AS reducer_status,
    CASE
      WHEN b.membrane_interval_months IS NULL
           OR COALESCE(b.membrane_replaced_at, b.commissioned_at) IS NULL THEN 'ok'
      WHEN (COALESCE(b.membrane_replaced_at, b.commissioned_at)
            + make_interval(months => b.membrane_interval_months))::date < current_date THEN 'overdue'
      WHEN (COALESCE(b.membrane_replaced_at, b.commissioned_at)
            + make_interval(months => b.membrane_interval_months))::date <= current_date + 60 THEN 'warning'
      ELSE 'ok'
    END AS membrane_status
  FROM backplate b
  WHERE b.archived_at IS NULL
) x;

-- Down Migration
CREATE OR REPLACE VIEW v_backplate_status AS
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

ALTER TABLE backplate DROP CONSTRAINT chk_backplate_membrane_interval;
ALTER TABLE backplate DROP COLUMN membrane_interval_months;
ALTER TABLE backplate DROP COLUMN membrane_replaced_at;
