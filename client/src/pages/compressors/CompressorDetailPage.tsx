import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cog, Fuel, Wrench } from 'lucide-react';
import {
  useArchiveCompressor,
  useCompressor,
  useCompressorHistory,
  useRestoreCompressor,
} from '../../api/compressors';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FilterChips } from '../../components/FilterChips';
import { HistoryTimeline } from '../../components/HistoryTimeline';
import { ProgressToMaintenance } from '../../components/ProgressToMaintenance';
import { ErrorState, SkeletonRows } from '../../components/states';
import { MaintenanceDialog } from './MaintenanceDialog';
import { compressorBadge, conditionToUi } from '../../lib/status';
import { formatDate, formatDateTime, formatEngineHours } from '../../lib/formatters';
import { errorMessage } from '../../api/http';
import { useToast } from '../../components/Toast';
import type { CompressorHistoryType, MaintenanceLevelDue } from '../../api/types';

const HISTORY_CHIPS = [
  { key: 'all', label: 'Все' },
  { key: 'maintenance', label: 'ТО' },
  { key: 'fill_session', label: 'Заправки' },
];

/** Текст due для рівня ТО: «через N мг» / «+N мг понад» / «до дд.мм.рррр» */
function levelDueText(l: MaintenanceLevelDue, engineHours: number): string {
  const parts: string[] = [];
  if (l.due_hours !== null) {
    const remaining = l.due_hours - engineHours;
    parts.push(
      remaining >= 0
        ? `через ${formatEngineHours(remaining)} мг`
        : `прострочено на ${formatEngineHours(-remaining)} мг`,
    );
  }
  if (l.due_date) parts.push(`до ${formatDate(l.due_date)}`);
  return parts.join(' · ') || '—';
}

export function CompressorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const query = useCompressor(id);
  const [historyType, setHistoryType] = useState<CompressorHistoryType>('all');
  const history = useCompressorHistory(id, historyType);
  const archiveMut = useArchiveCompressor(id ?? '');
  const restoreMut = useRestoreCompressor(id ?? '');

  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  const c = query.data;
  const badge = compressorBadge(c);
  const archived = Boolean(c.archived_at);
  const hasActiveSession = Boolean(c.active_fill_session_id);

  return (
    <div className="page">
      <Link to="/compressors" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Компресори
      </Link>

      <div className="detail-head">
        <span className="detail-head__title">
          <Cog size={28} aria-hidden="true" />
          {c.name}
        </span>
        <StatusBadge status={badge.status} label={badge.label} size="md" />
      </div>

      <div className="card">
        <div className="card__title">Наробіток</div>
        <div className="kpi">{formatEngineHours(c.engine_hours)} мг</div>
        <ProgressToMaintenance compressor={c} />
        {c.maintenance.levels.length > 0 && (
          <>
            <div className="card__title" style={{ marginTop: 'var(--space-4)' }}>
              Наступні ТО
            </div>
            {c.maintenance.levels.map((l) => (
              <dl className="kv" key={l.level}>
                <dt>ТО-{l.level}</dt>
                <dd>
                  {l.status === 'ok' ? (
                    <span className="tnum">{levelDueText(l, c.engine_hours)}</span>
                  ) : (
                    <StatusBadge
                      status={conditionToUi(l.status)}
                      label={levelDueText(l, c.engine_hours)}
                    />
                  )}
                </dd>
              </dl>
            ))}
          </>
        )}
        {canEdit && !archived && (
          <div className="btn-row">
            <Button onClick={() => setMaintenanceOpen(true)}>
              <Wrench size={20} aria-hidden="true" />
              Провести ТО
            </Button>
            {hasActiveSession ? (
              <Link to={`/fill-session/${c.active_fill_session_id}`} className="btn btn--secondary">
                <Fuel size={20} aria-hidden="true" />
                Іде заправка — відкрити
              </Link>
            ) : (
              <Button
                variant="secondary"
                onClick={() => navigate('/fill-session', { state: { compressorId: c.id } })}
              >
                <Fuel size={20} aria-hidden="true" />
                Заправка
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__title">Дані</div>
        <dl className="kv">
          <dt>Виробник / модель</dt>
          <dd>{[c.manufacturer, c.model].filter(Boolean).join(' ') || '—'}</dd>
        </dl>
        {c.notes && (
          <dl className="kv">
            <dt>Примітки</dt>
            <dd>{c.notes}</dd>
          </dl>
        )}
      </div>

      <div className="card">
        <div className="card__title">Історія</div>
        <FilterChips
          options={HISTORY_CHIPS}
          active={historyType}
          onChange={(key) => setHistoryType(key as CompressorHistoryType)}
        />
        <HistoryTimeline
          loading={history.isLoading}
          emptyText="Подій поки немає"
          items={history.data?.data.map((e) => ({
            id: `${e.type}-${e.id}`,
            date: formatDateTime(e.occurred_at),
            icon: e.type === 'fill_session' ? <Fuel size={20} /> : <Wrench size={20} />,
            title: e.summary,
            details: e.performed_by?.full_name,
          }))}
        />
      </div>

      {canEdit && (
        <div className="btn-row">
          {!archived && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/compressors/${c.id}/edit`)}>
                Редагувати
              </Button>
              <Button variant="danger" onClick={() => setArchiveOpen(true)}>
                Списати
              </Button>
            </>
          )}
          {archived && (
            <Button
              variant="secondary"
              loading={restoreMut.isPending}
              onClick={() =>
                restoreMut.mutate(undefined, {
                  onSuccess: () => toast.show(`Компресор ${c.name} відновлено`),
                  onError: (err) => toast.show(errorMessage(err), 'error'),
                })
              }
            >
              Відновити
            </Button>
          )}
        </div>
      )}

      {maintenanceOpen && (
        <MaintenanceDialog compressor={c} onClose={() => setMaintenanceOpen(false)} />
      )}

      {archiveOpen && (
        <ConfirmDialog
          title={`Списати компресор ${c.name}?`}
          confirmLabel="Списати"
          danger
          loading={archiveMut.isPending}
          onConfirm={() =>
            archiveMut.mutate(undefined, {
              onSuccess: () => {
                toast.show(`Компресор ${c.name} списано`);
                setArchiveOpen(false);
              },
              onError: (err) => {
                toast.show(errorMessage(err), 'error');
                setArchiveOpen(false);
              },
            })
          }
          onCancel={() => setArchiveOpen(false)}
        >
          <p>Компресор буде переміщено в архів зі збереженням історії ТО та заправок.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
