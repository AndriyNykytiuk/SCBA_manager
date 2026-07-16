import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, VenetianMask } from 'lucide-react';
import { useMasks } from '../../api/masks';
import type { MaskListFilters } from '../../api/masks';
import { useAuth } from '../../auth/AuthContext';
import { ListRow } from '../../components/ListRow';
import { StatusBadge } from '../../components/StatusBadge';
import { FilterChips } from '../../components/FilterChips';
import { SearchInput } from '../../components/SearchInput';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import { maskBadge } from '../../lib/status';
import type { Mask } from '../../api/types';

const CHIPS = [
  { key: 'all', label: 'Всі' },
  { key: 'overdue', label: 'Прострочено' },
  { key: 'warning', label: 'Увага' },
  { key: 'archived', label: 'Списані' },
];

function chipToFilters(chip: string): MaskListFilters {
  switch (chip) {
    case 'overdue':
      return { status: 'overdue' };
    case 'warning':
      return { status: 'warning' };
    case 'archived':
      return { include_archived: true };
    default:
      return {};
  }
}

function maskMeta(m: Mask): string {
  const parts = [m.model, m.assigned_to ? `закріплена за ${m.assigned_to}` : 'не закріплена'].filter(
    Boolean,
  );
  return parts.join(' · ');
}

export function MaskListPage() {
  const { canEdit } = useAuth();
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const filters = useMemo(
    () => ({ ...chipToFilters(chip), q: q.trim() || undefined }),
    [chip, q],
  );
  const query = useMasks(filters);

  let items = query.data?.data ?? [];
  if (chip === 'archived') items = items.filter((m) => m.archived_at !== null);

  const hasFilter = chip !== 'all' || q.trim() !== '';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Маски{query.data ? ` (${query.data.meta.total})` : ''}</h1>
        {canEdit && (
          <Link to="/masks/new" className="btn btn--primary">
            <Plus size={20} aria-hidden="true" />
            Додати маску
          </Link>
        )}
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Пошук за номером/моделлю" />
      <FilterChips options={CHIPS} active={chip} onChange={setChip} />

      {query.isLoading && <SkeletonRows />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<VenetianMask size={48} />}
          title={hasFilter ? 'Нічого не знайдено за фільтром' : 'Масок поки немає'}
          action={
            hasFilter ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setChip('all');
                  setQ('');
                }}
              >
                Скинути фільтри
              </Button>
            ) : canEdit ? (
              <Link to="/masks/new" className="btn btn--primary">
                <Plus size={20} aria-hidden="true" />
                Додати маску
              </Link>
            ) : undefined
          }
        />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="list">
          {items.map((m) => {
            const badge = maskBadge(m);
            return (
              <ListRow
                key={m.id}
                status={badge.status}
                icon={<VenetianMask size={24} />}
                title={`№${m.number}`}
                meta={maskMeta(m)}
                badge={<StatusBadge status={badge.status} label={badge.label} />}
                strike={Boolean(m.archived_at)}
                to={`/masks/${m.id}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
