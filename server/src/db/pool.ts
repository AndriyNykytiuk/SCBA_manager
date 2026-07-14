import { Pool } from 'pg';
import { config } from '../config';

// Supabase (та більшість керованих Postgres) вимагають SSL; сертифікат керованого
// провайдера не завжди в CA-бандлі Node, тому rejectUnauthorized:false — стандартна практика.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Неочікувана помилка pg-пула:', err);
});
