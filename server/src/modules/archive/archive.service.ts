import type { PoolClient } from 'pg';

export type ArchiveEntityType = 'cylinder' | 'backplate' | 'mask';

export interface ArchiveEntry {
  stationId: string;
  entityType: ArchiveEntityType;
  entityId: string;
  label: string;
  snapshot: unknown;
  deletedBy: string;
}

/** Пишеться в тій самій транзакції, що й фізичне DELETE (перед ним) — снапшот замінює втрачені рядки. */
export async function writeArchiveEntry(client: PoolClient, entry: ArchiveEntry): Promise<void> {
  await client.query(
    `INSERT INTO deleted_entity_archive (station_id, entity_type, entity_id, label, snapshot, deleted_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.stationId,
      entry.entityType,
      entry.entityId,
      entry.label,
      JSON.stringify(entry.snapshot),
      entry.deletedBy,
    ],
  );
}
