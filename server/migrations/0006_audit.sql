-- Up Migration
-- db-schema.md §3.8 — audit_log (append-only; пишеться сервісом в одній транзакції з мутацією, S8)

CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    user_id     uuid NOT NULL REFERENCES app_user(id),
    station_id  uuid REFERENCES station(id),   -- NULL для глобальних дій (users, stations)
    entity_type text NOT NULL,                 -- 'cylinder' | 'backplate' | 'apparatus' | ...
    entity_id   uuid NOT NULL,
    action      audit_action NOT NULL,
    changes     jsonb,                         -- {"field": {"old": ..., "new": ...}}
    request_id  text                           -- кореляція з логами HTTP
);

CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_time   ON audit_log (occurred_at DESC);

-- Down Migration
DROP TABLE audit_log;
