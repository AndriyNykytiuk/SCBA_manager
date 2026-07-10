import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { pool } from '../db/pool';
import { errors } from '../shared/errors';
import { asyncHandler } from '../shared/http';

export type Role = 'admin' | 'master' | 'duty';

export interface AuthUser {
  id: string;
  login: string;
  fullName: string;
  role: Role;
  stationId: string | null;
  stationName: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

interface AccessTokenPayload {
  sub: string;
  role: Role;
  station_id: string | null;
}

export function signAccessToken(user: { id: string; role: Role; stationId: string | null }): string {
  const payload: Omit<AccessTokenPayload, 'sub'> = {
    role: user.role,
    station_id: user.stationId,
  };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_ACCESS_TTL_SECONDS,
  });
}

/**
 * Перевірка Bearer JWT + актуального стану користувача в БД
 * (деактивація/архівація/зміна ролі діють одразу, не чекаючи протухання токена).
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) throw errors.unauthenticated();
  const token = header.slice('Bearer '.length);

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as unknown as AccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw errors.tokenExpired();
    throw errors.unauthenticated();
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.login, u.full_name, u.role, u.station_id, u.is_active, s.name AS station_name
       FROM app_user u
       LEFT JOIN station s ON s.id = u.station_id
      WHERE u.id = $1 AND u.archived_at IS NULL`,
    [payload.sub],
  );
  const row = rows[0];
  if (!row) throw errors.unauthenticated();
  if (!row.is_active) throw errors.userDeactivated();

  req.user = {
    id: row.id,
    login: row.login,
    fullName: row.full_name,
    role: row.role,
    stationId: row.station_id,
    stationName: row.station_name,
  };
  next();
});
