-- Up Migration
-- Архів видалених записів (MVP): при DELETE /cylinders/:id, /backplates/:id повний знімок
-- запису + вся його історія (гідротести/установки/заправки) зберігається тут перед фізичним
-- видаленням з робочих таблиць. entity_id НЕ є FK — самого запису вже не існує.
CREATE TABLE deleted_entity_archive (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id  uuid NOT NULL REFERENCES station(id),
    entity_type text NOT NULL,   -- 'cylinder' | 'backplate'
    entity_id   uuid NOT NULL,
    label       text NOT NULL,   -- номер/назва для списку без розбору snapshot
    snapshot    jsonb NOT NULL,
    deleted_at  timestamptz NOT NULL DEFAULT now(),
    deleted_by  uuid NOT NULL REFERENCES app_user(id),
    CONSTRAINT chk_deleted_entity_type CHECK (entity_type IN ('cylinder', 'backplate'))
);

CREATE INDEX ix_deleted_entity_archive_station ON deleted_entity_archive (station_id, deleted_at DESC);
CREATE INDEX ix_deleted_entity_archive_type    ON deleted_entity_archive (entity_type, deleted_at DESC);

-- Down Migration
DROP TABLE deleted_entity_archive;
