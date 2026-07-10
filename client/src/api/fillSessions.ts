import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type {
  ActiveFillSessions,
  FillSession,
  FillSessionCreateBody,
  FillSessionStopResponse,
} from './types';

/** ВП-6: активні сесії живуть на сервері — відновлення таймера після перезавантаження */
export function useActiveFillSessions(refetchIntervalMs: number | false = 30_000) {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['fill-sessions', 'active', stationKey],
    queryFn: () => api<ActiveFillSessions>('/fill-sessions/active', { query: stationParam }),
    enabled: stationReady,
    refetchInterval: refetchIntervalMs,
  });
}

export function useFillSession(id: string | undefined) {
  return useQuery({
    queryKey: ['fill-sessions', 'detail', id],
    queryFn: () => api<FillSession>(`/fill-sessions/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateFillSessions() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['fill-sessions'] });
    qc.invalidateQueries({ queryKey: ['compressors'] });
    qc.invalidateQueries({ queryKey: ['compressor'] });
    qc.invalidateQueries({ queryKey: ['compressor-history'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

/** «Старт» = створення + запуск однією атомарною операцією */
export function useStartFillSession() {
  const invalidate = useInvalidateFillSessions();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: FillSessionCreateBody) =>
      api<FillSession>('/fill-sessions', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

export function useStopFillSession() {
  const invalidate = useInvalidateFillSessions();
  return useMutation({
    mutationFn: (id: string) =>
      api<FillSessionStopResponse>(`/fill-sessions/${id}/stop`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
