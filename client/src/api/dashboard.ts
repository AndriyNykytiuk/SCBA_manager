import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type { ConditionStatus, DashboardAlerts } from './types';

export function useDashboardAlerts(statuses: ConditionStatus[]) {
  const { stationParam, stationKey, stationReady } = useAuth();
  const status = [...statuses].sort().join(',');
  return useQuery({
    queryKey: ['dashboard', stationKey, status],
    queryFn: () => api<DashboardAlerts>('/dashboard/alerts', { query: { ...stationParam, status } }),
    enabled: stationReady && statuses.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Лічильники для цятки в навігації (окремий легкий доступ до того ж кеша) */
export function useAlertCounters() {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['dashboard', stationKey, 'overdue,warning'],
    queryFn: () =>
      api<DashboardAlerts>('/dashboard/alerts', {
        query: { ...stationParam, status: 'overdue,warning' },
      }),
    enabled: stationReady,
    staleTime: 30_000,
    select: (d) => d.counters,
  });
}
