-- Up Migration
-- db-schema.md §3.7 — compressor, fill_session, fill_session_item, compressor_maintenance

CREATE TABLE compressor (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id                uuid NOT NULL REFERENCES station(id),
    name                      text NOT NULL,          -- ідентифікація у списках/сесіях заправки
    manufacturer              text,
    model                     text,
    -- стартові дані при заведенні (вимога 3.4):
    initial_engine_hours      numeric(10,2) NOT NULL DEFAULT 0,  -- лічильник на момент створення
    initial_maintenance_at    date,                   -- дата останнього ТО до появи в системі
    initial_maintenance_hours numeric(10,2),          -- наробіток на момент того ТО
    notes                     text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    archived_at               timestamptz,
    UNIQUE (id, station_id),
    CONSTRAINT chk_compressor_hours CHECK (initial_engine_hours >= 0),
    CONSTRAINT chk_compressor_init_maint CHECK (
        initial_maintenance_hours IS NULL
        OR initial_maintenance_hours BETWEEN 0 AND initial_engine_hours
    )
);

CREATE UNIQUE INDEX ux_compressor_name_active
    ON compressor (station_id, lower(name)) WHERE archived_at IS NULL;

-- Сесія заправки: тиски вводяться ОДИН раз на сесію (групу апаратів/балонів).
-- Активна сесія: ended_at IS NULL. Забутий «Стоп» — без автокорекції (MVP).
CREATE TABLE fill_session (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id          uuid NOT NULL,
    compressor_id       uuid NOT NULL,
    pressure_before_bar integer NOT NULL,
    pressure_target_bar integer NOT NULL,
    started_at          timestamptz NOT NULL DEFAULT now(),
    ended_at            timestamptz,
    performed_by        uuid NOT NULL REFERENCES app_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- тривалість у мотогодинах — рахує БД, нікому не довіряємо
    duration_hours numeric(10,4) GENERATED ALWAYS AS (
        CASE WHEN ended_at IS NULL THEN NULL
             ELSE EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600.0
        END
    ) STORED,
    FOREIGN KEY (compressor_id, station_id) REFERENCES compressor (id, station_id),
    CONSTRAINT chk_fs_pressures CHECK (
        pressure_before_bar >= 0
        AND pressure_target_bar > pressure_before_bar
        AND pressure_target_bar <= 450
    ),
    CONSTRAINT chk_fs_period CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- один компресор — одна активна сесія
CREATE UNIQUE INDEX ux_fill_session_active
    ON fill_session (compressor_id) WHERE ended_at IS NULL;
CREATE INDEX ix_fill_session_compressor ON fill_session (compressor_id, started_at DESC);

-- Позиції сесії: апарат АБО окремий балон поза апаратом (U-5) — рівно одне з двох.
CREATE TABLE fill_session_item (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fill_session_id uuid NOT NULL REFERENCES fill_session(id),
    apparatus_id    uuid REFERENCES apparatus(id),
    cylinder_id     uuid REFERENCES cylinder(id),
    CONSTRAINT chk_fsi_target CHECK (num_nonnulls(apparatus_id, cylinder_id) = 1),
    CONSTRAINT ux_fsi_apparatus UNIQUE (fill_session_id, apparatus_id),
    CONSTRAINT ux_fsi_cylinder  UNIQUE (fill_session_id, cylinder_id)
);

CREATE INDEX ix_fsi_session ON fill_session_item (fill_session_id);

-- Подія «Провести ТО» (append-only історія).
CREATE TABLE compressor_maintenance (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    compressor_id  uuid NOT NULL REFERENCES compressor(id),
    level          smallint NOT NULL,           -- 25|125|500|1000|2000 мотогодин
    performed_at   date NOT NULL DEFAULT current_date,
    engine_hours_at numeric(10,2) NOT NULL,     -- наробіток на момент ТО (фіксує бекенд)
    performed_by   uuid NOT NULL REFERENCES app_user(id),
    notes          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_cm_level CHECK (level IN (25, 125, 500, 1000, 2000)),
    CONSTRAINT chk_cm_hours CHECK (engine_hours_at >= 0)
);

CREATE INDEX ix_cm_compressor ON compressor_maintenance (compressor_id, performed_at DESC);

-- Down Migration
DROP TABLE compressor_maintenance;
DROP TABLE fill_session_item;
DROP TABLE fill_session;
DROP TABLE compressor;
