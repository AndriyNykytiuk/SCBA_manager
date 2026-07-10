import { Link } from 'react-router-dom';
import { Cog, Plus } from 'lucide-react';
import { useCompressors } from '../../api/compressors';
import { useAuth } from '../../auth/AuthContext';
import { ListRow } from '../../components/ListRow';
import { StatusBadge } from '../../components/StatusBadge';
import { ProgressToMaintenance } from '../../components/ProgressToMaintenance';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import { compressorBadge } from '../../lib/status';
import { formatEngineHours } from '../../lib/formatters';

/** Компресорів зазвичай 1–3 — без пошуку, картки одразу з прогресом до ТО (screens.md §3) */
export function CompressorListPage() {
  const { canEdit } = useAuth();
  const query = useCompressors();

  const items = query.data?.data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Компресори{query.data ? ` (${query.data.meta.total})` : ''}</h1>
        {canEdit && (
          <Link to="/compressors/new" className="btn btn--primary">
            <Plus size={20} aria-hidden="true" />
            Додати компресор
          </Link>
        )}
      </div>

      {query.isLoading && <SkeletonRows count={3} />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<Cog size={48} />}
          title="Компресорів поки немає"
          action={
            canEdit ? (
              <Link to="/compressors/new" className="btn btn--primary">
                <Plus size={20} aria-hidden="true" />
                Додати компресор
              </Link>
            ) : undefined
          }
        />
      )}
      {query.isSuccess &&
        items.map((c) => {
          const badge = compressorBadge(c);
          return (
            <div className="card" key={c.id}>
              <ListRow
                status={badge.status}
                icon={<Cog size={24} />}
                title={c.name}
                meta={`Наробіток: ${formatEngineHours(c.engine_hours)} мг`}
                badge={<StatusBadge status={badge.status} label={badge.label} />}
                strike={Boolean(c.archived_at)}
                to={`/compressors/${c.id}`}
              />
              <ProgressToMaintenance compressor={c} />
            </div>
          );
        })}
    </div>
  );
}
