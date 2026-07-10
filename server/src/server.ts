import { app } from './app';
import { config } from './config';
import { pool } from './db/pool';

const server = app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SCBA Manager API → http://localhost:${config.PORT}/api/v1 (${config.NODE_ENV})`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`${signal}: зупиняю сервер…`);
  server.close(() => {
    pool
      .end()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
