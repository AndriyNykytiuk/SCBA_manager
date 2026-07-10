// Форма збірки апарата — ключова форма (screens.md §5.4)
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Backpack, Cylinder as CylinderIcon, Plus, TriangleAlert } from 'lucide-react';
import { useApparatus, useCreateApparatus, useUpdateApparatus } from '../../api/apparatus';
import { useCreateStorageLocation, useStorageLocations } from '../../api/storageLocations';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { Field, SelectInput, TextArea, TextInput } from '../../components/Field';
import { ListRow } from '../../components/ListRow';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorState, SkeletonRows } from '../../components/states';
import { BackplatePicker, CylinderPicker } from './ComponentPicker';
import { backplateBadge, cylinderBadge } from '../../lib/status';
import { MATERIAL_LABEL } from '../../lib/formatters';
import { errorMessage, fieldErrors } from '../../api/http';
import { useToast } from '../../components/Toast';
import type { Backplate, Cylinder } from '../../api/types';

const MAX_CYLINDERS = 2;

export function ApparatusFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const existing = useApparatus(isEdit ? id : undefined);
  const locations = useStorageLocations();
  const createMut = useCreateApparatus();
  const updateMut = useUpdateApparatus(id ?? '');
  const createLocationMut = useCreateStorageLocation();

  const [backplate, setBackplate] = useState<Backplate | null>(null);
  const [cylinders, setCylinders] = useState<Cylinder[]>([]);
  const [storageLocationId, setStorageLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [backplateOpen, setBackplateOpen] = useState(false);
  const [cylinderOpen, setCylinderOpen] = useState(false);
  const [newLocationOpen, setNewLocationOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');

  useEffect(() => {
    if (isEdit && existing.data) {
      setStorageLocationId(existing.data.storage_location?.id ?? '');
      setNotes(existing.data.notes ?? '');
    }
  }, [isEdit, existing.data]);

  if (!canEdit) return <Navigate to="/apparatus" replace />;
  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  const hasOverdueCylinder = cylinders.some((c) => c.condition.status === 'overdue');

  const submit = (ev: FormEvent) => {
    ev.preventDefault();

    const onError = (err: unknown) => {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.show(errorMessage(err), 'error');
    };

    if (isEdit && id) {
      updateMut.mutate(
        { storage_location_id: storageLocationId || null, notes: notes.trim() || null },
        {
          onSuccess: () => {
            toast.show('Апарат оновлено');
            navigate(`/apparatus/${id}`);
          },
          onError,
        },
      );
      return;
    }

    const e: Record<string, string> = {};
    if (!backplate) e.backplate_id = 'Оберіть ложамент';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    createMut.mutate(
      {
        backplate_id: backplate!.id,
        cylinders: cylinders.map((c, i) => ({ cylinder_id: c.id, position: i + 1 })),
        storage_location_id: storageLocationId || null,
        notes: notes.trim() || null,
      },
      {
        onSuccess: (a) => {
          toast.show(`Апарат ${a.name} зібрано`);
          navigate(`/apparatus/${a.id}`);
        },
        onError,
      },
    );
  };

  const saveNewLocation = () => {
    const name = newLocationName.trim();
    if (!name) return;
    createLocationMut.mutate(name, {
      onSuccess: (loc) => {
        toast.show(`Місце «${loc.name}» додано`);
        setStorageLocationId(loc.id);
        setNewLocationOpen(false);
        setNewLocationName('');
      },
      onError: (err) => toast.show(errorMessage(err), 'error'),
    });
  };

  const pending = createMut.isPending || updateMut.isPending;
  const activeLocations = (locations.data?.data ?? []).filter((l) => !l.archived_at);

  return (
    <div className="page">
      <Link to={isEdit ? `/apparatus/${id}` : '/apparatus'} className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        {isEdit ? existing.data?.name : 'Апарати'}
      </Link>
      <div className="page-header">
        <h1>{isEdit ? `Редагувати апарат ${existing.data?.name}` : 'Новий апарат'}</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        {/* 1. Ложамент */}
        {isEdit && existing.data ? (
          <Field label="Ложамент" hint="Ложамент і балони змінюються з картки апарата">
            <ListRow
              icon={<Backpack size={24} />}
              title={existing.data.backplate.name}
              meta={existing.data.backplate.model ?? undefined}
            />
          </Field>
        ) : (
          <Field
            label="1. Ложамент"
            required
            error={errors.backplate_id}
            hint="Апарат отримає номер ложамента"
          >
            {backplate ? (
              <ListRow
                status={backplateBadge(backplate).status}
                icon={<Backpack size={24} />}
                title={backplate.name}
                meta={[backplate.manufacturer, backplate.model].filter(Boolean).join(' ') || undefined}
                badge={
                  <StatusBadge
                    status={backplateBadge(backplate).status}
                    label={backplateBadge(backplate).label}
                  />
                }
                onClick={() => setBackplateOpen(true)}
              />
            ) : (
              <Button variant="secondary" block onClick={() => setBackplateOpen(true)}>
                Обрати ложамент…
              </Button>
            )}
          </Field>
        )}

        {/* 2. Балони */}
        {!isEdit && (
          <Field
            label={`2. Балони (${cylinders.length} з ${MAX_CYLINDERS})`}
            hint="Без балонів апарат буде «розібраним»"
          >
            <div className="list">
              {cylinders.map((c) => {
                const badge = cylinderBadge(c);
                return (
                  <ListRow
                    key={c.id}
                    status={badge.status}
                    icon={<CylinderIcon size={24} />}
                    title={`№${c.number}`}
                    meta={`${c.volume_l} л ${MATERIAL_LABEL[c.material] ?? c.material} · ${c.working_pressure_bar} бар`}
                    badge={<StatusBadge status={badge.status} label={badge.label} />}
                    trailing={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setCylinders((prev) => prev.filter((x) => x.id !== c.id))
                        }
                      >
                        Прибрати
                      </Button>
                    }
                  />
                );
              })}
              {cylinders.length < MAX_CYLINDERS && (
                <Button variant="secondary" onClick={() => setCylinderOpen(true)}>
                  <Plus size={20} aria-hidden="true" />
                  Додати балон
                </Button>
              )}
            </div>
            {hasOverdueCylinder && (
              <span className="field__error" role="alert">
                <TriangleAlert size={18} aria-hidden="true" />
                Балон із простроченим гідротестом — апарат одразу стане несправним
              </span>
            )}
          </Field>
        )}

        {/* 3. Місце зберігання */}
        <Field label={isEdit ? 'Місце зберігання' : '3. Місце зберігання'}>
          <div className="btn-row">
            <SelectInput
              value={storageLocationId}
              onChange={(e) => setStorageLocationId(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">— не вказано —</option>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectInput>
            <Button variant="secondary" onClick={() => setNewLocationOpen(true)}>
              <Plus size={20} aria-hidden="true" />
              Нове місце
            </Button>
          </div>
        </Field>

        <Field label="Примітки">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>

        <div className="form__footer">
          <Button
            variant="secondary"
            onClick={() => navigate(isEdit ? `/apparatus/${id}` : '/apparatus')}
          >
            Скасувати
          </Button>
          <Button type="submit" loading={pending}>
            {isEdit ? 'Зберегти' : 'Створити'}
          </Button>
        </div>
      </form>

      {backplateOpen && (
        <BackplatePicker
          onSelect={(b) => {
            setBackplate(b);
            setBackplateOpen(false);
            setErrors((prev) => ({ ...prev, backplate_id: '' }));
          }}
          onClose={() => setBackplateOpen(false)}
        />
      )}

      {cylinderOpen && (
        <CylinderPicker
          excludeIds={cylinders.map((c) => c.id)}
          onSelect={(c) => {
            setCylinders((prev) =>
              prev.length < MAX_CYLINDERS && !prev.some((x) => x.id === c.id) ? [...prev, c] : prev,
            );
            setCylinderOpen(false);
          }}
          onClose={() => setCylinderOpen(false)}
        />
      )}

      {newLocationOpen && (
        <Modal
          title="Нове місце зберігання"
          onClose={() => setNewLocationOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setNewLocationOpen(false)}>
                Скасувати
              </Button>
              <Button
                onClick={saveNewLocation}
                loading={createLocationMut.isPending}
                disabled={!newLocationName.trim()}
              >
                Додати
              </Button>
            </>
          }
        >
          <Field label="Назва" required hint="Напр., «Шафа №3»">
            <TextInput
              value={newLocationName}
              onChange={(e) => setNewLocationName(e.target.value)}
              autoFocus
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}
