import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cylinder as CylinderIcon, Plus } from 'lucide-react';
import { useCylinders } from '../../api/cylinders';
import type { CylinderListFilters } from '../../api/cylinders';
import { useAuth } from '../../auth/AuthContext';
import { ListRow } from '../../components/ListRow';
import { StatusBadge } from '../../components/StatusBadge';
import { FilterChips } from '../../components/FilterChips';
import { SearchInput } from '../../components/SearchInput';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import { cylinderBadge } from '../../lib/status';
import { MATERIAL_LABEL } from '../../lib/formatters';
import type { Cylinder } from '../../api/types';

const CHIPS = [
  { key: 'all', label: 'Всі' },
  { key: 'overdue', label: 'Прострочено' },
  { key: 'warning', label: 'Увага' },
  { key: 'installed', label: 'В апараті' },
  { key: 'free', label: 'Вільні' },
  { key: 'archived', label: 'Списані' },
];

function chipToFilters(chip: string): CylinderListFilters {
  switch (chip) {
    case 'overdue':
      return { status: 'overdue' };
    case 'warning':
      return { status: 'warning' };
    case 'installed':
      return { installed: true };
    case 'free':
      return { installed: false };
    case 'archived':
      return { include_archived: true };
    default:
      return {};
  }
}

function cylinderMeta(c: Cylinder): string {
  const parts = [
    `${c.volume_l} л ${MATERIAL_LABEL[c.material] ?? c.material}`,
    `${c.working_pressure_bar} бар`,
    c.installation ? `в апараті ${c.installation.apparatus_name}` : 'вільний',
  ];
  return parts.join(' · ');
}

export function CylinderListPage() {
  const { canEdit } = useAuth();
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const filters = useMemo(
    () => ({ ...chipToFilters(chip), q: q.trim() || undefined }),
    [chip, q],
  );
  const query = useCylinders(filters);

  let items = query.data?.data ?? [];
  if (chip === 'archived') items = items.filter((c) => c.archived_at !== null);

  const hasFilter = chip !== 'all' || q.trim() !== '';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Балони{query.data ? ` (${query.data.meta.total})` : ''}</h1>
        {canEdit && (
          <Link to="/cylinders/new" className="btn btn--primary">
            <Plus size={20} aria-hidden="true" />
            Додати балон
          </Link>
        )}
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Пошук за номером" />
      <FilterChips options={CHIPS} active={chip} onChange={setChip} />

      {query.isLoading && <SkeletonRows />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<CylinderIcon size={48} />}
          title={hasFilter ? 'Нічого не знайдено за фільтром' : 'Балонів поки немає'}
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
              <Link to="/cylinders/new" className="btn btn--primary">
                <Plus size={20} aria-hidden="true" />
                Додати балон
              </Link>
            ) : undefined
          }
        />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="list">
          {items.map((c) => {
            const badge = cylinderBadge(c);
            return (
              <ListRow
                key={c.id}
                status={badge.status}
                icon={<CylinderIcon size={24} />}
                title={`№${c.number}`}
                meta={cylinderMeta(c)}
                badge={<StatusBadge status={badge.status} label={badge.label} />}
                strike={Boolean(c.archived_at)}
                to={`/cylinders/${c.id}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
