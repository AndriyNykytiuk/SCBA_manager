import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiLogin, apiLogout, apiMe } from '../api/auth';
import {
  clearTokens,
  getRefreshToken,
  hasTokens,
  setTokens,
  UNAUTHORIZED_EVENT,
} from '../api/http';
import type { AuthUser, StationRef } from '../api/types';
import { useToast } from '../components/Toast';

type AuthStatus = 'loading' | 'authed' | 'anon';

interface AuthCtx {
  user: AuthUser | null;
  status: AuthStatus;
  isAdmin: boolean;
  /** master/admin можуть змінювати; duty — лише перегляд */
  canEdit: boolean;
  /** активна станція: для admin — обрана вручну, для інших — зі свого профілю */
  activeStation: StationRef | null;
  setActiveStation: (s: StationRef) => void;
  /** query-параметр station_id (лише для admin) для station-scoped запитів */
  stationParam: { station_id?: string };
  /** ключ станції для queryKey */
  stationKey: string;
  /** admin без обраної станції не може вантажити station-scoped дані */
  stationReady: boolean;
  loginUser: (login: string, password: string) => Promise<void>;
  logoutUser: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

const STATION_KEY = 'scba.active_station';

function readStoredStation(): StationRef | null {
  try {
    const raw = localStorage.getItem(STATION_KEY);
    return raw ? (JSON.parse(raw) as StationRef) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>(hasTokens() ? 'loading' : 'anon');
  const [activeStationState, setActiveStationState] = useState<StationRef | null>(readStoredStation);
  const toast = useToast();
  const queryClient = useQueryClient();
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  // Відновлення сесії на старті SPA
  useEffect(() => {
    if (!hasTokens()) return;
    let cancelled = false;
    apiMe()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          setStatus('authed');
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearTokens();
          setStatus('anon');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 401 після невдалого refresh → логін
  useEffect(() => {
    const onUnauthorized = () => {
      if (userRef.current) toast.show('Сесія завершена, увійдіть знову', 'error');
      setUser(null);
      setStatus('anon');
      queryClient.clear();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [toast, queryClient]);

  const loginUser = useCallback(
    async (login: string, password: string) => {
      const res = await apiLogin(login, password);
      setTokens(res.access_token, res.refresh_token);
      queryClient.clear();
      setUser(res.user);
      setStatus('authed');
    },
    [queryClient],
  );

  const logoutUser = useCallback(() => {
    const rt = getRefreshToken();
    if (rt) apiLogout(rt).catch(() => undefined);
    clearTokens();
    setUser(null);
    setStatus('anon');
    queryClient.clear();
  }, [queryClient]);

  const setActiveStation = useCallback(
    (s: StationRef) => {
      setActiveStationState(s);
      localStorage.setItem(STATION_KEY, JSON.stringify(s));
      queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const isAdmin = user?.role === 'admin';
  const canEdit = user?.role === 'admin' || user?.role === 'master';
  const activeStation = isAdmin ? activeStationState : (user?.station ?? null);
  const stationReady = status === 'authed' && (!isAdmin || activeStation !== null);

  const stationParam = useMemo<{ station_id?: string }>(
    () => (isAdmin && activeStation ? { station_id: activeStation.id } : {}),
    [isAdmin, activeStation],
  );

  const stationKey = isAdmin ? (activeStation?.id ?? 'no-station') : (user?.station?.id ?? 'own');

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      status,
      isAdmin,
      canEdit,
      activeStation,
      setActiveStation,
      stationParam,
      stationKey,
      stationReady,
      loginUser,
      logoutUser,
    }),
    [
      user,
      status,
      isAdmin,
      canEdit,
      activeStation,
      setActiveStation,
      stationParam,
      stationKey,
      stationReady,
      loginUser,
      logoutUser,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth використано поза AuthProvider');
  return ctx;
}
