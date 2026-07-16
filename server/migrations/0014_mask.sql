-- Up Migration
-- Нова сутність: маска. Три незалежні компоненти техобслуговування (клапан вдиху,
-- переговорна мембрана, технічний огляд) — принцип статусу як у ложамента (гірший з
-- компонентів виграє). Інтервали — глобальні, admin-only (interval_setting), як і в
-- редуктора/мембрани ложамента.
CREATE TABLE mask (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id                 uuid NOT NULL REFERENCES station(id),
    number                     text NOT NULL,              -- номер маски
    model                      text,                       -- модель
    assigned_to                text,                       -- особа, за ким закріплена (вільний текст)
    inhale_valve_replaced_at   date,                       -- дата заміни клапану вдиху
    voice_membrane_replaced_at date,                       -- дата заміни переговорної мембрани
    inspection_at              date,                       -- дата технічного огляду
    notes                      text,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    archived_at                timestamptz,
    UNIQUE (id, station_id)
);

CREATE UNIQUE INDEX ux_mask_number_active ON mask (station_id, lower(number)) WHERE archived_at IS NULL;
CREATE INDEX ix_mask_station ON mask (station_id);

INSERT INTO interval_setting (key, months) VALUES
  ('mask_inhale_valve', 12),
  ('mask_voice_membrane', 12),
  ('mask_inspection', 12);

CREATE VIEW v_mask_status AS
SELECT
  x.mask_id,
  x.next_inhale_valve_at,
  x.next_voice_membrane_at,
  x.next_inspection_at,
  CASE
    WHEN x.iv_status = 'overdue' OR x.vm_status = 'overdue' OR x.ins_status = 'overdue' THEN 'overdue'
    WHEN x.iv_status = 'warning' OR x.vm_status = 'warning' OR x.ins_status = 'warning' THEN 'warning'
    ELSE 'ok'
  END AS status
FROM (
  SELECT
    m.id AS mask_id,
    (m.inhale_valve_replaced_at + make_interval(months => iv.months))::date   AS next_inhale_valve_at,
    (m.voice_membrane_replaced_at + make_interval(months => vm.months))::date AS next_voice_membrane_at,
    (m.inspection_at + make_interval(months => ins.months))::date             AS next_inspection_at,
    CASE
      WHEN m.inhale_valve_replaced_at IS NULL THEN 'ok'
      WHEN (m.inhale_valve_replaced_at + make_interval(months => iv.months))::date < current_date THEN 'overdue'
      WHEN (m.inhale_valve_replaced_at + make_interval(months => iv.months))::date <= current_date + 60 THEN 'warning'
      ELSE 'ok'
    END AS iv_status,
    CASE
      WHEN m.voice_membrane_replaced_at IS NULL THEN 'ok'
      WHEN (m.voice_membrane_replaced_at + make_interval(months => vm.months))::date < current_date THEN 'overdue'
      WHEN (m.voice_membrane_replaced_at + make_interval(months => vm.months))::date <= current_date + 60 THEN 'warning'
      ELSE 'ok'
    END AS vm_status,
    CASE
      WHEN m.inspection_at IS NULL THEN 'ok'
      WHEN (m.inspection_at + make_interval(months => ins.months))::date < current_date THEN 'overdue'
      WHEN (m.inspection_at + make_interval(months => ins.months))::date <= current_date + 60 THEN 'warning'
      ELSE 'ok'
    END AS ins_status
  FROM mask m
  CROSS JOIN (SELECT months FROM interval_setting WHERE key = 'mask_inhale_valve')   iv
  CROSS JOIN (SELECT months FROM interval_setting WHERE key = 'mask_voice_membrane') vm
  CROSS JOIN (SELECT months FROM interval_setting WHERE key = 'mask_inspection')     ins
  WHERE m.archived_at IS NULL
) x;

ALTER TABLE deleted_entity_archive DROP CONSTRAINT chk_deleted_entity_type;
ALTER TABLE deleted_entity_archive ADD CONSTRAINT chk_deleted_entity_type
    CHECK (entity_type IN ('cylinder', 'backplate', 'mask'));

-- Down Migration
ALTER TABLE deleted_entity_archive DROP CONSTRAINT chk_deleted_entity_type;
ALTER TABLE deleted_entity_archive ADD CONSTRAINT chk_deleted_entity_type
    CHECK (entity_type IN ('cylinder', 'backplate'));

DROP VIEW v_mask_status;
DELETE FROM interval_setting WHERE key IN ('mask_inhale_valve', 'mask_voice_membrane', 'mask_inspection');
DROP TABLE mask;
