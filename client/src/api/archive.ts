import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type { ArchiveDetail, ArchiveEntityType, ArchiveEntry, ListResponse } from './types';

export interface ArchiveListFilters {
  q?: string;
  entity_type?: ArchiveEntityType;
}

export function useArchiveList(filters: ArchiveListFilters = {}) {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['archive', stationKey, filters],
    queryFn: () =>
      api<ListResponse<ArchiveEntry>>('/archive', {
        query: { limit: 100, ...stationParam, ...filters },
      }),
    enabled: stationReady,
    placeholderData: keepPreviousData,
  });
}

export function useArchiveDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['archive-detail', id],
    queryFn: () => api<ArchiveDetail>(`/archive/${id}`),
    enabled: Boolean(id),
  });
}
