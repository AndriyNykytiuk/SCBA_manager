import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { config } from '../../config';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { signAccessToken, type Role } from '../../middleware/auth';
import { errors } from '../../shared/errors';
import { generateRefreshToken, hashRefreshToken } from './tokens';

export interface PublicUser {
  id: string;
  login: string;
  full_name: string;
  role: Role;
  station: { id: string; name: string } | null;
}

interface UserRow {
  id: string;
  login: string;
  password_hash: string;
  full_name: string;
  role: Role;
  station_id: string | null;
  station_name: string | null;
  is_active: boolean;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    login: row.login,
    full_name: row.full_name,
    role: row.role,
    station: row.station_id ? { id: row.station_id, name: row.station_name ?? '' } : null,
  };
}

async function findUserById(client: PoolClient, id: string): Promise<UserRow | undefined> {
  const { rows } = await client.query<UserRow>(
    `SELECT u.id, u.login, u.password_hash, u.full_name, u.role, u.station_id, u.is_active,
            s.name AS station_name
       FROM app_user u LEFT JOIN station s ON s.id = u.station_id
      WHERE u.id = $1 AND u.archived_at IS NULL`,
    [id],
  );
  return rows[0];
}

async function issueRefreshToken(
  client: PoolClient,
  userId: string,
  replacesId?: string,
): Promise<{ raw: string; id: string }> {
  const { raw, hash } = generateRefreshToken();
  const { rows } = await client.query(
    `INSERT INTO refresh_token (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))
     RETURNING id`,
    [userId, hash, config.REFRESH_TOKEN_TTL_DAYS],
  );
  const id = rows[0].id as string;
  if (replacesId) {
    await client.query(
      `UPDATE refresh_token SET revoked_at = now(), replaced_by = $2 WHERE id = $1`,
      [replacesId, id],
    );
  }
  return { raw, id };
}

export async function login(loginName: string, password: string) {
  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.login, u.password_hash, u.full_name, u.role, u.station_id, u.is_active,
            s.name AS station_name
       FROM app_user u LEFT JOIN station s ON s.id = u.station_id
      WHERE u.login = $1 AND u.archived_at IS NULL`,
    [loginName],
  );
  const user = rows[0];
  // однакова відповідь для неіснуючого логіна і хибного пароля
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw errors.unauthenticated('Невірний логін або пароль');
  }
  if (!user.is_active) throw errors.userDeactivated();

  const refresh = await withTransaction((client) => issueRefreshToken(client, user.id));
  return {
    access_token: signAccessToken({ id: user.id, role: user.role, stationId: user.station_id }),
    expires_in: config.JWT_ACCESS_TTL_SECONDS,
    refresh_token: refresh.raw,
    user: toPublicUser(user),
  };
}

export async function refresh(rawToken: string) {
  return withTransaction(async (client) => {
    const hash = hashRefreshToken(rawToken);
    const { rows } = await client.query(
      `SELECT id, user_id, expires_at, revoked_at FROM refresh_token WHERE token_hash = $1 FOR UPDATE`,
      [hash],
    );
    const token = rows[0];
    if (!token) throw errors.refreshTokenInvalid();

    if (token.revoked_at) {
      // повторне використання ротованого токена → відкликаємо весь ланцюжок користувача
      await client.query(
        `UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [token.user_id],
      );
      throw errors.refreshTokenInvalid();
    }
    if (new Date(token.expires_at).getTime() <= Date.now()) throw errors.refreshTokenInvalid();

    const user = await findUserById(client, token.user_id);
    if (!user) throw errors.refreshTokenInvalid();
    if (!user.is_active) throw errors.userDeactivated();

    const next = await issueRefreshToken(client, user.id, token.id);
    return {
      access_token: signAccessToken({ id: user.id, role: user.role, stationId: user.station_id }),
      expires_in: config.JWT_ACCESS_TTL_SECONDS,
      refresh_token: next.raw,
    };
  });
}

export async function logout(rawToken: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_token SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashRefreshToken(rawToken)],
  );
}

/** Відкликання всіх refresh-токенів користувача (деактивація / reset-password). */
export async function revokeAllUserTokens(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
