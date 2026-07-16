-- Up Migration
-- Централізація інтервалів перевірок: замість поля на кожній одиниці — одна глобальна
-- таблиця, керована виключно адміном (GET/PATCH /intervals). Зміна значення відразу
-- перераховує статуси ВСІХ існуючих і майбутніх одиниць (views читають це значення
-- динамічно, а не копію на момент створення).
CREATE TABLE interval_setting (
    key        text PRIMARY KEY,   -- 'hydro_metal' | 'hydro_composite' | 'reducer' | 'membrane'
    months     integer NOT NULL CHECK (months > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES app_user(id)
);

INSERT INTO interval_setting (key, months) VALUES
  ('hydro_metal', 60),
  ('hydro_composite', 60),
  ('reducer', 12),
  ('membrane', 12);

-- 4.2 (перегляд): гідротест балона — інтервал за материалом з interval_setting замість
-- cylinder.hydro_interval_months.
CREATE OR REPLACE VIEW v_cylinder_status AS
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
JOIN interval_setting hi ON hi.key = 'hydro_' || cy.material
CROSS JOIN LATERAL (
    SELECT COALESCE(
             cy.next_hydro_test_override,
             (lt.tested_at + make_interval(months => hi.months))::date,
             (cy.manufactured_at + make_interval(months => hi.months))::date
           ) AS next_hydro_test_at
) nx
WHERE cy.archived_at IS NULL;

-- 4.3 (перегляд): редуктор/мембрана ложамента — інтервали з interval_setting замість
-- backplate.reducer_interval_months / membrane_interval_months.
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
       + make_interval(months => ri.months))::date AS next_reducer_replacement_at,
    (COALESCE(b.membrane_replaced_at, b.commissioned_at)
       + make_interval(months => mi.months))::date AS next_membrane_replacement_at,
    CASE
      WHEN COALESCE(b.reducer_last_replaced_at, b.commissioned_at) IS NULL THEN 'ok'
      WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
            + make_interval(months => ri.months))::date < current_date THEN 'overdue'
      WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
            + make_interval(months => ri.months))::date <= current_date + 60 THEN 'warning'
      ELSE 'ok'
    END AS reducer_status,
    CASE
      WHEN COALESCE(b.membrane_replaced_at, b.commissioned_at) IS NULL THEN 'ok'
      WHEN (COALESCE(b.membrane_replaced_at, b.commissioned_at)
            + make_interval(months => mi.months))::date < current_date THEN 'overdue'
      WHEN (COALESCE(b.membrane_replaced_at, b.commissioned_at)
            + make_interval(months => mi.months))::date <= current_date + 60 THEN 'warning'
      ELSE 'ok'
    END AS membrane_status
  FROM backplate b
  CROSS JOIN (SELECT months FROM interval_setting WHERE key = 'reducer')  ri
  CROSS JOIN (SELECT months FROM interval_setting WHERE key = 'membrane') mi
  WHERE b.archived_at IS NULL
) x;

ALTER TABLE cylinder DROP COLUMN hydro_interval_months;
ALTER TABLE backplate DROP COLUMN reducer_interval_months;
ALTER TABLE backplate DROP COLUMN membrane_interval_months;

-- Down Migration
ALTER TABLE cylinder ADD COLUMN hydro_interval_months integer;
ALTER TABLE backplate ADD COLUMN reducer_interval_months integer;
ALTER TABLE backplate ADD COLUMN membrane_interval_months integer;

UPDATE cylinder SET hydro_interval_months =
  (SELECT months FROM interval_setting WHERE key = 'hydro_' || cylinder.material);
UPDATE backplate SET reducer_interval_months = (SELECT months FROM interval_setting WHERE key = 'reducer');
UPDATE backplate SET membrane_interval_months = (SELECT months FROM interval_setting WHERE key = 'membrane');

ALTER TABLE cylinder ALTER COLUMN hydro_interval_months SET NOT NULL;
ALTER TABLE backplate ADD CONSTRAINT chk_backplate_membrane_interval
    CHECK (membrane_interval_months IS NULL OR membrane_interval_months > 0);

CREATE OR REPLACE VIEW v_cylinder_status AS
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

DROP TABLE interval_setting;
