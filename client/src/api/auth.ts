import { api } from './http';
import type { AuthUser } from './types';

export interface LoginResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user: AuthUser;
}

export function apiLogin(login: string, password: string): Promise<LoginResponse> {
  return api<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { login, password },
    auth: false,
  });
}

export function apiLogout(refreshToken: string): Promise<void> {
  return api<void>('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

/** GET /auth/me — контракт каже «повертає user, як у login»; парсимо обидва варіанти конверта */
export async function apiMe(): Promise<AuthUser> {
  const data = await api<AuthUser | { user: AuthUser }>('/auth/me');
  if (typeof data === 'object' && data !== null && 'user' in data) {
    return (data as { user: AuthUser }).user;
  }
  return data as AuthUser;
}
