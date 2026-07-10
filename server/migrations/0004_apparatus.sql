-- Up Migration
-- db-schema.md §3.6 — apparatus, apparatus_cylinder

CREATE TABLE apparatus (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id          uuid NOT NULL REFERENCES station(id),
    backplate_id        uuid NOT NULL,
    storage_location_id uuid,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    archived_at         timestamptz,
    UNIQUE (id, station_id),
    -- композитні FK: компоненти гарантовано з тієї ж станції
    FOREIGN KEY (backplate_id, station_id)        REFERENCES backplate (id, station_id),
    FOREIGN KEY (storage_location_id, station_id) REFERENCES storage_location (id, station_id)
);

-- 1 ложамент = 1 живий апарат
CREATE UNIQUE INDEX ux_apparatus_backplate_active
    ON apparatus (backplate_id) WHERE archived_at IS NULL;
CREATE INDEX ix_apparatus_station ON apparatus (station_id);

-- Склад апарата + повна історія замін балонів.
-- Поточний склад: removed_at IS NULL. «Розібраний» апарат = 0 живих рядків (дозволено).
CREATE TABLE apparatus_cylinder (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    apparatus_id uuid NOT NULL REFERENCES apparatus(id),
    cylinder_id  uuid NOT NULL REFERENCES cylinder(id),
    position     smallint NOT NULL,             -- 1 або 2 (апарат = 1–2 балони)
    installed_at timestamptz NOT NULL DEFAULT now(),
    installed_by uuid NOT NULL REFERENCES app_user(id),
    removed_at   timestamptz,
    removed_by   uuid REFERENCES app_user(id),
    CONSTRAINT chk_ac_position CHECK (position IN (1, 2)),
    CONSTRAINT chk_ac_period   CHECK (removed_at IS NULL OR removed_at >= installed_at),
    CONSTRAINT chk_ac_removed_by
        CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

-- один балон — тільки в одному апараті (серед поточних установок)
CREATE UNIQUE INDEX ux_ac_cylinder_current
    ON apparatus_cylinder (cylinder_id) WHERE removed_at IS NULL;
-- у апараті не більше одного балона на позицію (⇒ максимум 2 балони)
CREATE UNIQUE INDEX ux_ac_position_current
    ON apparatus_cylinder (apparatus_id, position) WHERE removed_at IS NULL;
CREATE INDEX ix_ac_apparatus_history ON apparatus_cylinder (apparatus_id, installed_at DESC);

-- Down Migration
DROP TABLE apparatus_cylinder;
DROP TABLE apparatus;
