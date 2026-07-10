import type { PoolClient } from 'pg';
import { pool } from './pool';

/**
 * withTransaction — усі мутації виконуються тут, разом із записом audit_log
 * у тій самій транзакції (інваріант S8, db-schema.md §5).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
