import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import type { IntervalKey, IntervalSetting } from './types';

export function useIntervals() {
  return useQuery({
    queryKey: ['intervals'],
    queryFn: () => api<{ data: IntervalSetting[] }>('/intervals'),
  });
}

export function useUpdateIntervals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Record<IntervalKey, number>>) =>
      api<{ data: IntervalSetting[] }>('/intervals', { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intervals'] });
      // Інтервал впливає на статус/дати ВСІХ балонів, ложаментів і масок на всіх станціях.
      qc.invalidateQueries({ queryKey: ['cylinders'] });
      qc.invalidateQueries({ queryKey: ['cylinder'] });
      qc.invalidateQueries({ queryKey: ['backplates'] });
      qc.invalidateQueries({ queryKey: ['backplate'] });
      qc.invalidateQueries({ queryKey: ['masks'] });
      qc.invalidateQueries({ queryKey: ['mask'] });
      qc.invalidateQueries({ queryKey: ['apparatus'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
