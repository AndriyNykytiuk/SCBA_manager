import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Backpack, Disc, Gauge } from 'lucide-react';
import {
  useArchiveBackplate,
  useBackplate,
  useDeleteBackplate,
  useRestoreBackplate,
  useUpdateBackplate,
} from '../../api/backplates';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { DateInput, Field } from '../../components/Field';
import { SegmentControl } from '../../components/SegmentControl';
import { ErrorState, SkeletonRows } from '../../components/states';
import { backplateBadge, BACKPLATE_STATUS_LABEL } from '../../lib/status';
import { addMonths, formatDate, todayISO } from '../../lib/formatters';
import { errorMessage } from '../../api/http';
import { useToast } from '../../components/Toast';

export function BackplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const query = useBackplate(id);
  const updateMut = useUpdateBackplate(id ?? '');
  const archiveMut = useArchiveBackplate(id ?? '');
  const restoreMut = useRestoreBackplate(id ?? '');
  const deleteMut = useDeleteBackplate(id ?? '');

  const [reducerOpen, setReducerOpen] = useState(false);
  const [reducerDate, setReducerDate] = useState(todayISO());
  const [membraneOpen, setMembraneOpen] = useState(false);
  const [membraneDate, setMembraneDate] = useState(todayISO());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  const b = query.data;
  const badge = backplateBadge(b);
  const archived = Boolean(b.archived_at);
  const inApparatus = b.status === 'in_apparatus';

  const saveReducer = () => {
    updateMut.mutate(
      { reducer_last_replaced_at: reducerDate },
      {
        onSuccess: () => {
          toast.show('Заміну редуктора зафіксовано');
          setReducerOpen(false);
        },
        onError: (err) => toast.show(errorMessage(err), 'error'),
      },
    );
  };

  const saveMembrane = () => {
    updateMut.mutate(
      { membrane_replaced_at: membraneDate },
      {
        onSuccess: () => {
          toast.show('Заміну мембрани зафіксовано');
          setMembraneOpen(false);
        },
        onError: (err) => toast.show(errorMessage(err), 'error'),
      },
    );
  };

  const doDelete = () => {
    deleteMut.mutate(undefined, {
      onSuccess: () => {
        toast.show(`Ложамент ${b.name} видалено`);
        navigate('/backplates');
      },
      onError: (err) => {
        toast.show(errorMessage(err), 'error');
        setDeleteOpen(false);
      },
    });
  };

  const changeStatus = (status: 'free' | 'in_repair') => {
    updateMut.mutate(
      { status },
      {
        onSuccess: () => toast.show('Статус оновлено'),
        onError: (err) => toast.show(errorMessage(err), 'error'),
      },
    );
  };

  return (
    <div className="page">
      <Link to="/backplates" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Ложаменти
      </Link>

      <div className="detail-head">
        <span className="detail-head__title">
          <Backpack size={28} aria-hidden="true" />
          {b.name}
        </span>
        <StatusBadge status={badge.status} label={badge.label} size="md" />
      </div>

      <div className="card">
        <div className="card__title">
          <Gauge size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Редуктор
        </div>
        <dl className="kv">
          <dt>Остання заміна</dt>
          <dd className="tnum">{formatDate(b.reducer_last_replaced_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Наступна заміна</dt>
          <dd className="tnum">{formatDate(b.next_reducer_replacement_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Інтервал</dt>
          <dd>{b.reducer_interval_months} міс</dd>
        </dl>
        {canEdit && !archived && (
          <Button
            onClick={() => {
              setReducerDate(todayISO());
              setReducerOpen(true);
            }}
          >
            Зафіксувати заміну редуктора
          </Button>
        )}
      </div>

      <div className="card">
        <div className="card__title">
          <Disc size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Мембрана
        </div>
        <dl className="kv">
          <dt>Остання заміна</dt>
          <dd className="tnum">{formatDate(b.membrane_replaced_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Наступна перевірка</dt>
          <dd className="tnum">{formatDate(b.next_membrane_replacement_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Інтервал</dt>
          <dd>{b.membrane_interval_months ? `${b.membrane_interval_months} міс` : 'не налаштовано'}</dd>
        </dl>
        {canEdit && !archived && (
          <Button
            onClick={() => {
              setMembraneDate(todayISO());
              setMembraneOpen(true);
            }}
          >
            Зафіксувати заміну мембрани
          </Button>
        )}
      </div>

      <div className="card">
        <div className="card__title">Дані</div>
        <dl className="kv">
          <dt>Виробник / модель</dt>
          <dd>{[b.manufacturer, b.model].filter(Boolean).join(' ') || '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Серійний номер</dt>
          <dd>{b.serial_number ?? '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Номер легеневого автомату</dt>
          <dd>{b.lung_valve_number ?? '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Номер манометру</dt>
          <dd>{b.gauge_number ?? '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Введено в експлуатацію</dt>
          <dd className="tnum">{formatDate(b.commissioned_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Статус</dt>
          <dd>
            {BACKPLATE_STATUS_LABEL[b.status]}
            {b.apparatus && inApparatus && (
              <>
                {' · '}
                <Link to={`/apparatus/${b.apparatus.id}`}>апарат {b.apparatus.name}</Link>
              </>
            )}
          </dd>
        </dl>
        {b.notes && (
          <dl className="kv">
            <dt>Примітки</dt>
            <dd>{b.notes}</dd>
          </dl>
        )}
        {canEdit && !archived && !inApparatus && (
          <Field label="Змінити статус">
            <SegmentControl<'free' | 'in_repair'>
              options={[
                { value: 'free', label: 'Вільний' },
                { value: 'in_repair', label: 'У ремонті' },
              ]}
              value={b.status === 'free' || b.status === 'in_repair' ? b.status : null}
              onChange={changeStatus}
              ariaLabel="Статус ложамента"
            />
          </Field>
        )}
        {canEdit && !archived && inApparatus && (
          <p className="field__hint">
            Ложамент стоїть в апараті {b.apparatus?.name}. Щоб змінити статус чи списати — спочатку
            розберіть апарат.
          </p>
        )}
      </div>

      {canEdit && (
        <div className="btn-row">
          {!archived && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/backplates/${b.id}/edit`)}>
                Редагувати
              </Button>
              <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={inApparatus}>
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
                  onSuccess: () => toast.show(`Ложамент ${b.name} відновлено`),
                  onError: (err) => toast.show(errorMessage(err), 'error'),
                })
              }
            >
              Відновити
            </Button>
          )}
          {!inApparatus && (
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Видалити
            </Button>
          )}
        </div>
      )}

      {reducerOpen && (
        <Modal
          title="Зафіксувати заміну редуктора"
          onClose={() => setReducerOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReducerOpen(false)}>
                Скасувати
              </Button>
              <Button onClick={saveReducer} loading={updateMut.isPending} disabled={!reducerDate}>
                Зберегти
              </Button>
            </>
          }
        >
          <Field
            label="Дата заміни"
            required
            hint={
              reducerDate ? (
                <>
                  Наступна заміна:{' '}
                  <strong>{formatDate(addMonths(reducerDate, b.reducer_interval_months))}</strong>
                </>
              ) : undefined
            }
          >
            <DateInput
              value={reducerDate}
              max={todayISO()}
              onChange={(e) => setReducerDate(e.target.value)}
            />
          </Field>
        </Modal>
      )}

      {membraneOpen && (
        <Modal
          title="Зафіксувати заміну мембрани"
          onClose={() => setMembraneOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setMembraneOpen(false)}>
                Скасувати
              </Button>
              <Button onClick={saveMembrane} loading={updateMut.isPending} disabled={!membraneDate}>
                Зберегти
              </Button>
            </>
          }
        >
          <Field
            label="Дата заміни"
            required
            hint={
              membraneDate && b.membrane_interval_months ? (
                <>
                  Наступна перевірка:{' '}
                  <strong>{formatDate(addMonths(membraneDate, b.membrane_interval_months))}</strong>
                </>
              ) : !b.membrane_interval_months ? (
                'Інтервал перевірки ще не налаштований адміністратором'
              ) : undefined
            }
          >
            <DateInput
              value={membraneDate}
              max={todayISO()}
              onChange={(e) => setMembraneDate(e.target.value)}
            />
          </Field>
        </Modal>
      )}

      {archiveOpen && (
        <ConfirmDialog
          title={`Списати ложамент ${b.name}?`}
          confirmLabel="Списати"
          danger
          loading={archiveMut.isPending}
          onConfirm={() =>
            archiveMut.mutate(undefined, {
              onSuccess: () => {
                toast.show(`Ложамент ${b.name} списано`);
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
          <p>Ложамент буде переміщено в архів зі збереженням історії.</p>
        </ConfirmDialog>
      )}

      {deleteOpen && (
        <ConfirmDialog
          title={`Видалити ложамент ${b.name}?`}
          confirmLabel="Видалити назавжди"
          danger
          loading={deleteMut.isPending}
          onConfirm={doDelete}
          onCancel={() => setDeleteOpen(false)}
        >
          <p>
            Запис буде видалено з бази без можливості відновлення
            {archived
              ? ' — разом з апаратами, що коли-небудь на ньому базувались, та їхньою історією (самі балони не постраждають).'
              : '. Дозволено лише для ложаментів без історії використання — якщо ложамент вже входив до складу апарата, спершу спишіть його.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
