// Екран таймера активної сесії + підсумок після «Стоп» (screens.md §6)
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleCheck, ChevronDown, ChevronUp, Cylinder as CylinderIcon, Package } from 'lucide-react';
import { useActiveFillSessions, useFillSession, useStopFillSession } from '../../api/fillSessions';
import { useCompressor } from '../../api/compressors';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { BigActionButton } from '../../components/BigActionButton';
import { ListRow } from '../../components/ListRow';
import { ProgressToMaintenance } from '../../components/ProgressToMaintenance';
import { ErrorState, SkeletonRows } from '../../components/states';
import {
  elapsedSeconds,
  formatDurationHours,
  formatDurationSec,
  formatEngineHours,
  formatTime,
} from '../../lib/formatters';
import { errorMessage } from '../../api/http';
import { useToast } from '../../components/Toast';
import type { FillSession, FillSessionItem } from '../../api/types';

function ItemsList({ items }: { items: FillSessionItem[] }) {
  return (
    <div className="list">
      {items.map((it) => (
        <ListRow
          key={`${it.type}-${it.id}`}
          icon={it.type === 'apparatus' ? <Package size={24} /> : <CylinderIcon size={24} />}
          title={it.type === 'cylinder' ? `${it.name} (окремий балон)` : it.name}
          to={it.type === 'apparatus' ? `/apparatus/${it.id}` : `/cylinders/${it.id}`}
        />
      ))}
    </div>
  );
}

function itemCounts(session: FillSession): string {
  const apparatus = session.items.filter((i) => i.type === 'apparatus').length;
  const cylinders = session.items.filter((i) => i.type === 'cylinder').length;
  return `Апаратів: ${apparatus}${cylinders > 0 ? ` · +${cylinders} бал.` : ''}`;
}

export function SessionTimerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const query = useFillSession(id);
  const active = useActiveFillSessions(30_000);
  const stopMut = useStopFillSession();
  const compressorQuery = useCompressor(query.data?.compressor.id);

  const [now, setNow] = useState(Date.now());
  const [listOpen, setListOpen] = useState(false);

  const session = query.data;
  const ended = Boolean(session?.ended_at) || stopMut.isSuccess;

  useEffect(() => {
    if (!session || ended) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [session, ended]);

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !session) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  // ===== Підсумок після Стопу =====
  if (ended) {
    const stop = stopMut.data;
    const durationHours = stop?.duration_hours ?? session.duration_hours;
    const compressor = compressorQuery.data;
    return (
      <div className="page">
        <div className="page-header">
          <h1>
            <CircleCheck
              size={28}
              color="var(--status-ok-accent)"
              aria-hidden="true"
              style={{ verticalAlign: '-5px' }}
            />{' '}
            Заправку завершено
          </h1>
        </div>

        <div className="card">
          <div className="card__title">{session.compressor.name}</div>
          <dl className="kv">
            <dt>Тривалість</dt>
            <dd className="tnum">{formatDurationHours(durationHours)}</dd>
          </dl>
          <dl className="kv">
            <dt>До наробітку</dt>
            <dd className="tnum">
              {durationHours !== null && durationHours !== undefined
                ? `+${formatEngineHours(durationHours)} мг`
                : '—'}
            </dd>
          </dl>
          <dl className="kv">
            <dt>Тиски</dt>
            <dd className="tnum">
              {session.pressure_before_bar} → {session.pressure_target_bar} бар
            </dd>
          </dl>
          {compressor && <ProgressToMaintenance compressor={compressor} />}
        </div>

        <div className="card">
          <div className="card__title">Заправлено ({session.items.length})</div>
          <ItemsList items={session.items} />
        </div>

        <div className="btn-row">
          <Button variant="secondary" onClick={() => navigate('/')}>
            Готово
          </Button>
          {canEdit && (
            <Button
              onClick={() =>
                navigate('/fill-session', { state: { compressorId: session.compressor.id } })
              }
            >
              Нова сесія
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ===== Таймер активної сесії =====
  // Поправка на збитий годинник пристрою — server_time з /fill-sessions/active
  const serverOffsetMs = active.data
    ? new Date(active.data.server_time).getTime() - (active.dataUpdatedAt || Date.now())
    : 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Іде заправка · {session.compressor.name}</h1>
      </div>

      <div className="timer-display" role="timer" aria-label="Час заправки">
        {formatDurationSec(elapsedSeconds(session.started_at, now + serverOffsetMs))}
      </div>
      <div className="timer-sub">почато о {formatTime(session.started_at)}</div>

      <div className="timer-kpis">
        <span className="kpi tnum">
          {session.pressure_before_bar} → {session.pressure_target_bar} бар
        </span>
        <span className="kpi tnum">{itemCounts(session)}</span>
      </div>

      <Button variant="ghost" onClick={() => setListOpen((v) => !v)}>
        {listOpen ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
        {listOpen ? 'Сховати список' : 'Показати список'}
      </Button>
      {listOpen && <ItemsList items={session.items} />}

      {canEdit ? (
        <>
          <BigActionButton
            variant="stop"
            label="СТОП (утримуйте)"
            hold
            loading={stopMut.isPending}
            onAction={() =>
              stopMut.mutate(session.id, {
                onError: (err) =>
                  toast.show(`Сесію не збережено: ${errorMessage(err)}. Спробуйте ще раз`, 'error'),
              })
            }
          />
          {stopMut.isError && (
            <Button variant="secondary" block onClick={() => stopMut.mutate(session.id)}>
              Повторити
            </Button>
          )}
        </>
      ) : (
        <p className="field__hint" style={{ textAlign: 'center' }}>
          Зупинити сесію може майстер: {session.performed_by.full_name}
        </p>
      )}
    </div>
  );
}
