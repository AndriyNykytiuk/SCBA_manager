-- Up Migration
-- db-schema.md §3.1–3.3 — station, app_user, refresh_token, storage_location

CREATE TABLE station (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    address     text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE UNIQUE INDEX ux_station_name_active
    ON station (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE app_user (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id    uuid REFERENCES station(id),
    role          user_role NOT NULL,
    login         citext NOT NULL,
    password_hash text NOT NULL,                  -- bcrypt
    full_name     text NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,  -- деактивація доступу (≠ архівація)
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    archived_at   timestamptz,
    -- admin — глобальний (без станції), master/duty — завжди зі станцією
    CONSTRAINT chk_user_station_scope
        CHECK ((role = 'admin') = (station_id IS NULL))
);

CREATE UNIQUE INDEX ux_app_user_login_active
    ON app_user (login) WHERE archived_at IS NULL;
CREATE INDEX ix_app_user_station ON app_user (station_id);

CREATE TABLE refresh_token (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES app_user(id),
    token_hash  text NOT NULL UNIQUE,          -- sha256 від токена; сирий токен не зберігаємо
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,                   -- logout / ротація
    replaced_by uuid REFERENCES refresh_token(id)  -- ланцюжок ротації
);

CREATE INDEX ix_refresh_token_user ON refresh_token (user_id) WHERE revoked_at IS NULL;

CREATE TABLE storage_location (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id  uuid NOT NULL REFERENCES station(id),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    UNIQUE (id, station_id)                    -- для композитного FK з apparatus
);

CREATE UNIQUE INDEX ux_storage_location_name_active
    ON storage_location (station_id, lower(name)) WHERE archived_at IS NULL;

-- Down Migration
DROP TABLE storage_location;
DROP TABLE refresh_token;
DROP TABLE app_user;
DROP TABLE station;
