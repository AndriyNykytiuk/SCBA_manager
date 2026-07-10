-- Up Migration
-- db-schema.md §3.4–3.5 — backplate, cylinder, hydro_test

CREATE TABLE backplate (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id                uuid NOT NULL REFERENCES station(id),
    name                      text NOT NULL,        -- "bS-4343234"; ідентифікатор апарата, кодується у QR
    manufacturer              text,
    model                     text,
    serial_number             text,
    commissioned_at           date,                 -- дата введення в експлуатацію
    reducer_last_replaced_at  date,                 -- остання заміна редуктора
    reducer_interval_months   integer,              -- ручний інтервал (майстер), у місяцях
    notes                     text,
    status                    backplate_status NOT NULL DEFAULT 'free',
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    archived_at               timestamptz,
    UNIQUE (id, station_id),
    CONSTRAINT chk_backplate_reducer_interval
        CHECK (reducer_interval_months IS NULL OR reducer_interval_months > 0),
    -- «списаний» ⇔ заархівований (архівація замість видалення)
    CONSTRAINT chk_backplate_decommissioned
        CHECK ((status = 'decommissioned') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX ux_backplate_name_active
    ON backplate (station_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX ix_backplate_station ON backplate (station_id);

CREATE TABLE cylinder (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id               uuid NOT NULL REFERENCES station(id),
    number                   text NOT NULL,
    volume_l                 numeric(3,1) NOT NULL,
    material                 cylinder_material NOT NULL,
    working_pressure_bar     integer NOT NULL,
    manufacturer             text,
    manufactured_at          date NOT NULL,
    end_of_life_at           date NOT NULL,          -- кінець строку служби
    hydro_interval_months    integer NOT NULL,       -- вводить майстер; різний для metal/composite
    next_hydro_test_override date,                   -- ручне коригування авторозрахунку (NULL = авто)
    notes                    text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    archived_at              timestamptz,
    UNIQUE (id, station_id),
    -- довідник об'ємів MVP; розширення значень — окремою міграцією
    CONSTRAINT chk_cylinder_volume   CHECK (volume_l IN (6.0, 6.8, 7.0)),
    CONSTRAINT chk_cylinder_pressure CHECK (working_pressure_bar BETWEEN 1 AND 450),
    CONSTRAINT chk_cylinder_eol      CHECK (end_of_life_at > manufactured_at),
    CONSTRAINT chk_cylinder_interval CHECK (hydro_interval_months > 0)
);

CREATE UNIQUE INDEX ux_cylinder_number_active
    ON cylinder (station_id, lower(number)) WHERE archived_at IS NULL;
CREATE INDEX ix_cylinder_station ON cylinder (station_id);

-- Історія гідротестів (append-only). Перший «останній гідротест» при заведенні
-- балона теж пишеться сюди звичайним рядком.
CREATE TABLE hydro_test (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cylinder_id  uuid NOT NULL REFERENCES cylinder(id),
    tested_at    date NOT NULL,
    performed_by uuid REFERENCES app_user(id),   -- NULL, якщо тест робила зовнішня лабораторія
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NOT NULL REFERENCES app_user(id),
    CONSTRAINT chk_hydro_test_date CHECK (tested_at <= current_date)
);

CREATE INDEX ix_hydro_test_cylinder ON hydro_test (cylinder_id, tested_at DESC);

-- Down Migration
DROP TABLE hydro_test;
DROP TABLE cylinder;
DROP TABLE backplate;
