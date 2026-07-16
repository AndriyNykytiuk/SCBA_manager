import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, MessageSquare, VenetianMask, Wind } from 'lucide-react';
import {
  useArchiveMask,
  useDeleteMask,
  useMask,
  useRestoreMask,
  useUpdateMask,
} from '../../api/masks';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { DateInput, Field } from '../../components/Field';
import { ErrorState, SkeletonRows } from '../../components/states';
import { maskBadge } from '../../lib/status';
import { addMonths, formatDate, todayISO } from '../../lib/formatters';
import { errorMessage } from '../../api/http';
import { useToast } from '../../components/Toast';
import { useIntervals } from '../../api/intervals';

type ReplaceTarget = 'inhale_valve_replaced_at' | 'voice_membrane_replaced_at' | 'inspection_at';

const TARGET_LABEL: Record<ReplaceTarget, string> = {
  inhale_valve_replaced_at: 'заміну клапану вдиху',
  voice_membrane_replaced_at: 'заміну переговорної мембрани',
  inspection_at: 'технічний огляд',
};

const TARGET_INTERVAL_KEY: Record<ReplaceTarget, string> = {
  inhale_valve_replaced_at: 'mask_inhale_valve',
  voice_membrane_replaced_at: 'mask_voice_membrane',
  inspection_at: 'mask_inspection',
};

export function MaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const query = useMask(id);
  const intervals = useIntervals();
  const updateMut = useUpdateMask(id ?? '');
  const archiveMut = useArchiveMask(id ?? '');
  const restoreMut = useRestoreMask(id ?? '');
  const deleteMut = useDeleteMask(id ?? '');

  const [target, setTarget] = useState<ReplaceTarget | null>(null);
  const [date, setDate] = useState(todayISO());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  const m = query.data;
  const badge = maskBadge(m);
  const archived = Boolean(m.archived_at);
  const intervalMonths = target
    ? intervals.data?.data.find((i) => i.key === TARGET_INTERVAL_KEY[target])?.months
    : undefined;

  const save = () => {
    if (!target) return;
    updateMut.mutate(
      { [target]: date },
      {
        onSuccess: () => {
          toast.show(`Зафіксовано ${TARGET_LABEL[target]}`);
          setTarget(null);
        },
        onError: (err) => toast.show(errorMessage(err), 'error'),
      },
    );
  };

  const doDelete = () => {
    deleteMut.mutate(undefined, {
      onSuccess: () => {
        toast.show(`Маску №${m.number} видалено`);
        navigate('/masks');
      },
      onError: (err) => {
        toast.show(errorMessage(err), 'error');
        setDeleteOpen(false);
      },
    });
  };

  return (
    <div className="page">
      <Link to="/masks" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Маски
      </Link>

      <div className="detail-head">
        <span className="detail-head__title">
          <VenetianMask size={28} aria-hidden="true" />
          №{m.number}
        </span>
        <StatusBadge status={badge.status} label={badge.label} size="md" />
      </div>

      <div className="card">
        <div className="card__title">Дані</div>
        <dl className="kv">
          <dt>Модель</dt>
          <dd>{m.model ?? '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Закріплена особа</dt>
          <dd>{m.assigned_to ?? '—'}</dd>
        </dl>
        {m.notes && (
          <dl className="kv">
            <dt>Примітки</dt>
            <dd>{m.notes}</dd>
          </dl>
        )}
      </div>

      <div className="card">
        <div className="card__title">
          <Wind size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Клапан вдиху
        </div>
        <dl className="kv">
          <dt>Остання заміна</dt>
          <dd className="tnum">{formatDate(m.inhale_valve_replaced_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Наступна заміна</dt>
          <dd className="tnum">{formatDate(m.next_inhale_valve_at)}</dd>
        </dl>
        {canEdit && !archived && (
          <Button
            onClick={() => {
              setDate(todayISO());
              setTarget('inhale_valve_replaced_at');
            }}
          >
            Зафіксувати заміну
          </Button>
        )}
      </div>

      <div className="card">
        <div className="card__title">
          <MessageSquare size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Переговорна мембрана
        </div>
        <dl className="kv">
          <dt>Остання заміна</dt>
          <dd className="tnum">{formatDate(m.voice_membrane_replaced_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Наступна заміна</dt>
          <dd className="tnum">{formatDate(m.next_voice_membrane_at)}</dd>
        </dl>
        {canEdit && !archived && (
          <Button
            onClick={() => {
              setDate(todayISO());
              setTarget('voice_membrane_replaced_at');
            }}
          >
            Зафіксувати заміну
          </Button>
        )}
      </div>

      <div className="card">
        <div className="card__title">
          <Eye size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Технічний огляд
        </div>
        <dl className="kv">
          <dt>Останній огляд</dt>
          <dd className="tnum">{formatDate(m.inspection_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Наступний огляд</dt>
          <dd className="tnum">{formatDate(m.next_inspection_at)}</dd>
        </dl>
        {canEdit && !archived && (
          <Button
            onClick={() => {
              setDate(todayISO());
              setTarget('inspection_at');
            }}
          >
            Зафіксувати огляд
          </Button>
        )}
      </div>

      {canEdit && (
        <div className="btn-row">
          {!archived && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/masks/${m.id}/edit`)}>
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
                  onSuccess: () => toast.show(`Маску №${m.number} відновлено`),
                  onError: (err) => toast.show(errorMessage(err), 'error'),
                })
              }
            >
              Відновити
            </Button>
          )}
          {(archived || !m.assigned_to) && (
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Видалити
            </Button>
          )}
        </div>
      )}

      {target && (
        <Modal
          title={`Зафіксувати ${TARGET_LABEL[target]}`}
          onClose={() => setTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setTarget(null)}>
                Скасувати
              </Button>
              <Button onClick={save} loading={updateMut.isPending} disabled={!date}>
                Зберегти
              </Button>
            </>
          }
        >
          <Field
            label="Дата"
            required
            hint={
              date && intervalMonths ? (
                <>
                  Наступний строк: <strong>{formatDate(addMonths(date, intervalMonths))}</strong>
                </>
              ) : undefined
            }
          >
            <DateInput value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </Modal>
      )}

      {archiveOpen && (
        <ConfirmDialog
          title={`Списати маску №${m.number}?`}
          confirmLabel="Списати"
          danger
          loading={archiveMut.isPending}
          onConfirm={() =>
            archiveMut.mutate(undefined, {
              onSuccess: () => {
                toast.show(`Маску №${m.number} списано`);
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
          <p>Маска буде переміщена в архів зі збереженням історії.</p>
        </ConfirmDialog>
      )}

      {deleteOpen && (
        <ConfirmDialog
          title={`Видалити маску №${m.number}?`}
          confirmLabel="Видалити назавжди"
          danger
          loading={deleteMut.isPending}
          onConfirm={doDelete}
          onCancel={() => setDeleteOpen(false)}
        >
          <p>Запис буде видалено з бази без можливості відновлення.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
