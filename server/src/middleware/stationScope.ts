import type { Request } from 'express';
import { errors } from '../shared/errors';
import type { AuthUser } from './auth';

/**
 * Станційний скоупінг (api-contract.md §1.2):
 * - master/duty: станція завжди з токена; явний station_id, що не збігається → 403;
 * - admin: у списках/дашборді ЗОБОВʼЯЗАНИЙ передати ?station_id → інакше 422.
 */
export function resolveStationScope(req: Request): string {
  const user = req.user as AuthUser;
  const q = req.query.station_id;
  const queryStationId = typeof q === 'string' && q.length > 0 ? q : undefined;

  if (user.role === 'admin') {
    if (!queryStationId) {
      throw errors.validation('Для admin параметр station_id обовʼязковий', [
        { field: 'station_id', rule: 'required_for_admin' },
      ]);
    }
    return queryStationId;
  }
  if (queryStationId && queryStationId !== user.stationId) {
    throw errors.stationScopeViolation();
  }
  return user.stationId as string;
}

/**
 * station_id для мутацій-створень: master — своя станція; admin — з body.station_id
 * або з query (?station_id).
 */
export function resolveWriteStation(req: Request, bodyStationId?: string | null): string {
  const user = req.user as AuthUser;
  if (user.role === 'admin') {
    const q = req.query.station_id;
    const fromQuery = typeof q === 'string' && q.length > 0 ? q : undefined;
    const stationId = bodyStationId ?? fromQuery;
    if (!stationId) {
      throw errors.validation('Для admin потрібен station_id (у тілі або query)', [
        { field: 'station_id', rule: 'required_for_admin' },
      ]);
    }
    return stationId;
  }
  if (bodyStationId && bodyStationId !== user.stationId) {
    throw errors.stationScopeViolation();
  }
  return user.stationId as string;
}

/**
 * Доступ до конкретного запису: master/duty бачать тільки свою станцію;
 * чужий запис → 404 NOT_FOUND (існування не розкриваємо).
 */
export function assertRecordInScope(user: AuthUser, recordStationId: string): void {
  if (user.role !== 'admin' && user.stationId !== recordStationId) {
    throw errors.notFound();
  }
}
