import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Backpack, Plus } from 'lucide-react';
import { useBackplates } from '../../api/backplates';
import type { BackplateListFilters } from '../../api/backplates';
import { useAuth } from '../../auth/AuthContext';
import { ListRow } from '../../components/ListRow';
import { StatusBadge } from '../../components/StatusBadge';
import { FilterChips } from '../../components/FilterChips';
import { SearchInput } from '../../components/SearchInput';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import { backplateBadge, BACKPLATE_STATUS_LABEL } from '../../lib/status';
import type { Backplate } from '../../api/types';

const CHIPS = [
  { key: 'all', label: 'Всі' },
  { key: 'overdue', label: 'Прострочено' },
  { key: 'warning', label: 'Увага' },
  { key: 'in_apparatus', label: 'В апараті' },
  { key: 'free', label: 'Вільні' },
  { key: 'in_repair', label: 'У ремонті' },
  { key: 'archived', label: 'Списані' },
];

function chipToFilters(chip: string): BackplateListFilters {
  switch (chip) {
    case 'overdue':
      return { status: 'overdue' };
    case 'warning':
      return { status: 'warning' };
    case 'in_apparatus':
      return { backplate_status: 'in_apparatus' };
    case 'free':
      return { backplate_status: 'free' };
    case 'in_repair':
      return { backplate_status: 'in_repair' };
    case 'archived':
      return { include_archived: true };
    default:
      return {};
  }
}

function backplateMeta(b: Backplate): string {
  const parts = [
    [b.manufacturer, b.model].filter(Boolean).join(' ') || null,
    BACKPLATE_STATUS_LABEL[b.status],
    b.apparatus && b.status === 'in_apparatus' ? `апарат ${b.apparatus.name}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function BackplateListPage() {
  const { canEdit } = useAuth();
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const filters = useMemo(
    () => ({ ...chipToFilters(chip), q: q.trim() || undefined }),
    [chip, q],
  );
  const query = useBackplates(filters);

  let items = query.data?.data ?? [];
  if (chip === 'archived') items = items.filter((b) => b.archived_at !== null);

  const hasFilter = chip !== 'all' || q.trim() !== '';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Ложаменти{query.data ? ` (${query.data.meta.total})` : ''}</h1>
        {canEdit && (
          <Link to="/backplates/new" className="btn btn--primary">
            <Plus size={20} aria-hidden="true" />
            Додати ложамент
          </Link>
        )}
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Пошук за назвою/номером" />
      <FilterChips options={CHIPS} active={chip} onChange={setChip} />

      {query.isLoading && <SkeletonRows />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<Backpack size={48} />}
          title={hasFilter ? 'Нічого не знайдено за фільтром' : 'Ложаментів поки немає'}
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
              <Link to="/backplates/new" className="btn btn--primary">
                <Plus size={20} aria-hidden="true" />
                Додати ложамент
              </Link>
            ) : undefined
          }
        />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="list">
          {items.map((b) => {
            const badge = backplateBadge(b);
            return (
              <ListRow
                key={b.id}
                status={badge.status}
                icon={<Backpack size={24} />}
                title={b.name}
                meta={backplateMeta(b)}
                badge={<StatusBadge status={badge.status} label={badge.label} />}
                strike={Boolean(b.archived_at)}
                to={`/backplates/${b.id}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
