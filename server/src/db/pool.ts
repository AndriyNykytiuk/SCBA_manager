import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.DATABASE_URL });

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Неочікувана помилка pg-пула:', err);
});
