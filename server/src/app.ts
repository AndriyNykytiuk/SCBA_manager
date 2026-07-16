import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { apparatusRouter } from './modules/apparatus/apparatus.routes';
import { archiveRouter } from './modules/archive/archive.routes';
import { authRouter } from './modules/auth/auth.routes';
import { backplatesRouter } from './modules/backplates/backplates.routes';
import { compressorsRouter } from './modules/compressors/compressors.routes';
import { cylindersRouter } from './modules/cylinders/cylinders.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { fillSessionsRouter } from './modules/fillSessions/fillSessions.routes';
import { intervalsRouter } from './modules/intervals/intervals.routes';
import { masksRouter } from './modules/masks/masks.routes';
import { stationsRouter } from './modules/stations/stations.routes';
import { storageLocationsRouter } from './modules/storageLocations/storageLocations.routes';
import { usersRouter } from './modules/users/users.routes';

/**
 * Express-додаток: /api/v1 (api-contract.md §1.1).
 * Автентифікація — усередині кожного модуля (router.use(authenticate)),
 * бо /auth/login|refresh працюють без токена.
 */
export const app = express();
app.disable('x-powered-by');

// Продакшн: клієнт (Render Static Site) і сервер — різні origin. CLIENT_ORIGIN не задано →
// CORS не вмикається (локальний дев йде через vite same-origin proxy, йому це не потрібно).
if (config.CLIENT_ORIGIN) {
  const allowedOrigins = config.CLIENT_ORIGIN.split(',').map((o) => o.trim());
  app.use(cors({ origin: allowedOrigins }));
}

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use(express.json());
app.use(requestId);

const api = express.Router();
api.use('/auth', authRouter);
api.use('/stations', stationsRouter);
api.use('/users', usersRouter);
api.use('/storage-locations', storageLocationsRouter);
api.use('/backplates', backplatesRouter);
api.use('/masks', masksRouter);
api.use('/cylinders', cylindersRouter);
api.use('/apparatus', apparatusRouter);
api.use('/compressors', compressorsRouter);
api.use('/fill-sessions', fillSessionsRouter);
api.use('/dashboard', dashboardRouter);
api.use('/archive', archiveRouter);
api.use('/intervals', intervalsRouter);
app.use('/api/v1', api);

// 404 у форматі помилок контракту (§1.4) + errorHandler останнім
app.use(notFoundHandler);
app.use(errorHandler);
