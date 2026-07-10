import { createHash, randomBytes } from 'node:crypto';

/** Opaque refresh-токен: 256 біт; у БД зберігається лише sha256-hash. */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
