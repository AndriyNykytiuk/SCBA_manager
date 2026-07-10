import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type { ListResponse, Station } from './types';

export interface StationBody {
  name: string;
  address?: string | null;
}

/** Список станцій — лише admin (перемикач у хедері + адмінка) */
export function useStations() {
  const { isAdmin, status } = useAuth();
  return useQuery({
    queryKey: ['stations'],
    queryFn: () => api<ListResponse<Station>>('/stations', { query: { limit: 100 } }),
    enabled: status === 'authed' && isAdmin,
  });
}

export function useStation(id: string | undefined) {
  return useQuery({
    queryKey: ['station', id],
    queryFn: () => api<Station>(`/stations/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateStations() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['stations'] });
    qc.invalidateQueries({ queryKey: ['station'] });
  };
}

export function useCreateStation() {
  const invalidate = useInvalidateStations();
  return useMutation({
    mutationFn: (body: StationBody) => api<Station>('/stations', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateStation(id: string) {
  const invalidate = useInvalidateStations();
  return useMutation({
    mutationFn: (body: StationBody) => api<Station>(`/stations/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useArchiveStation(id: string) {
  const invalidate = useInvalidateStations();
  return useMutation({
    mutationFn: () => api<Station>(`/stations/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRestoreStation(id: string) {
  const invalidate = useInvalidateStations();
  return useMutation({
    mutationFn: () => api<Station>(`/stations/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
