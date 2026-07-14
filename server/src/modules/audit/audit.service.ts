import type { PoolClient } from 'pg';

export type AuditAction = 'create' | 'update' | 'archive' | 'restore' | 'delete';

export interface AuditEntry {
  userId: string;
  stationId: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  changes?: Record<string, unknown> | null;
  requestId?: string | null;
}

/**
 * Запис аудиту — ЗАВЖДИ тим самим client-ом, що й мутація (одна транзакція, S8).
 */
export async function writeAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (user_id, station_id, entity_type, entity_id, action, changes, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId,
      entry.stationId,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.changes ? JSON.stringify(entry.changes) : null,
      entry.requestId ?? null,
    ],
  );
}

/** diff для audit_log.changes: {"field": {"old": ..., "new": ...}} */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of Object.keys(after)) {
    const oldV = before[key] ?? null;
    const newV = after[key] ?? null;
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) out[key] = { old: oldV, new: newV };
  }
  return out;
}
