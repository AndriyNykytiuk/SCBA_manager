import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type { ListResponse, StorageLocation } from './types';

export function useStorageLocations() {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['storage-locations', stationKey],
    queryFn: () =>
      api<ListResponse<StorageLocation>>('/storage-locations', {
        query: { limit: 100, ...stationParam },
      }),
    enabled: stationReady,
  });
}

export function useCreateStorageLocation() {
  const qc = useQueryClient();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (name: string) =>
      api<StorageLocation>('/storage-locations', {
        method: 'POST',
        body: { name, ...stationParam },
        query: stationParam,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-locations'] }),
  });
}
