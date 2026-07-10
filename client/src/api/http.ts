// HTTP-клієнт: fetch + Bearer, 401 → refresh → повтор → інакше подія unauthorized
const API_BASE: string = import.meta.env.VITE_API_URL ?? '/api/v1';

const ACCESS_KEY = 'scba.access_token';
const REFRESH_KEY = 'scba.refresh_token';

export const UNAUTHORIZED_EVENT = 'scba:unauthorized';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function hasTokens(): boolean {
  return Boolean(getAccessToken() ?? getRefreshToken());
}

export interface FieldErrorDetail {
  field?: string;
  rule?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: FieldErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

function buildUrl(path: string, query?: QueryParams): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

interface RefreshResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = (await res.json()) as RefreshResponse;
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

/** Дедуплікація конкурентних refresh-запитів */
function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: QueryParams;
  /** false — для /auth/login та /auth/refresh */
  auth?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = options;

  const exec = (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getAccessToken();
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await exec();

  if (res.status === 401 && auth) {
    if (await tryRefresh()) {
      res = await exec();
    }
    if (res.status === 401) {
      clearTokens();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
  }

  if (res.status === 204) return undefined as T;

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // порожнє тіло
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: FieldErrorDetail[] } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'Не вдалося виконати запит',
      err?.details,
    );
  }

  return json as T;
}

/** details → мапа помилок полів форми */
export function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.details) {
    const out: Record<string, string> = {};
    for (const d of err.details) {
      if (d.field) out[d.field] = d.message ?? 'Невірне значення';
    }
    return out;
  }
  return {};
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Сталася невідома помилка';
}
