import { useMemo, useState } from 'react';
import { Archive as ArchiveIcon, Backpack, Cylinder as CylinderIcon, VenetianMask } from 'lucide-react';
import { useArchiveList } from '../../api/archive';
import type { ArchiveListFilters } from '../../api/archive';
import { ListRow } from '../../components/ListRow';
import { FilterChips } from '../../components/FilterChips';
import { SearchInput } from '../../components/SearchInput';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import { formatDateTime } from '../../lib/formatters';

const CHIPS = [
  { key: 'all', label: 'Всі' },
  { key: 'cylinder', label: 'Балони' },
  { key: 'backplate', label: 'Ложаменти' },
  { key: 'mask', label: 'Маски' },
];

function chipToFilters(chip: string): ArchiveListFilters {
  if (chip === 'cylinder' || chip === 'backplate' || chip === 'mask') return { entity_type: chip };
  return {};
}

export function ArchiveListPage() {
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const filters = useMemo(() => ({ ...chipToFilters(chip), q: q.trim() || undefined }), [chip, q]);
  const query = useArchiveList(filters);

  const items = query.data?.data ?? [];
  const hasFilter = chip !== 'all' || q.trim() !== '';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Архів видалених{query.data ? ` (${query.data.meta.total})` : ''}</h1>
      </div>
      <p className="field__hint">
        Тут зберігається повна історія балонів, ложаментів і масок, видалених з активного обліку.
      </p>

      <SearchInput value={q} onChange={setQ} placeholder="Пошук за номером чи назвою" />
      <FilterChips options={CHIPS} active={chip} onChange={setChip} />

      {query.isLoading && <SkeletonRows />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<ArchiveIcon size={48} />}
          title={hasFilter ? 'Нічого не знайдено за фільтром' : 'Архів поки порожній'}
        />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="list">
          {items.map((entry) => (
            <ListRow
              key={entry.id}
              icon={
                entry.entity_type === 'cylinder' ? (
                  <CylinderIcon size={24} />
                ) : entry.entity_type === 'mask' ? (
                  <VenetianMask size={24} />
                ) : (
                  <Backpack size={24} />
                )
              }
              title={entry.label}
              meta={`Видалено ${formatDateTime(entry.deleted_at)} · ${entry.deleted_by?.full_name ?? '—'}`}
              to={`/archive/${entry.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
