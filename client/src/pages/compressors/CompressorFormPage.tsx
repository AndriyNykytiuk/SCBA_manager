// Компресор — створення (screens.md §5.5) / редагування (name, виробник, модель, примітки)
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useCompressor, useCreateCompressor, useUpdateCompressor } from '../../api/compressors';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { DateInput, Field, TextArea, TextInput } from '../../components/Field';
import { NumberStepper } from '../../components/NumberStepper';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage, fieldErrors } from '../../api/http';
import { todayISO } from '../../lib/formatters';

export function CompressorFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const existing = useCompressor(isEdit ? id : undefined);
  const createMut = useCreateCompressor();
  const updateMut = useUpdateCompressor(id ?? '');

  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [engineHours, setEngineHours] = useState<number | null>(0);
  const [maintenanceAt, setMaintenanceAt] = useState('');
  const [maintenanceHours, setMaintenanceHours] = useState<number | null>(0);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEdit && existing.data) {
      const c = existing.data;
      setName(c.name);
      setManufacturer(c.manufacturer ?? '');
      setModel(c.model ?? '');
      setNotes(c.notes ?? '');
    }
  }, [isEdit, existing.data]);

  if (!canEdit) return <Navigate to="/compressors" replace />;
  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Вкажіть назву/модель';
    if (!isEdit) {
      if (engineHours === null || engineHours < 0) {
        e.initial_engine_hours = 'Мотогодини мають бути ≥ 0';
      }
      if (!maintenanceAt) e.initial_maintenance_at = 'Вкажіть дату останнього ТО';
      else if (maintenanceAt > todayISO()) {
        e.initial_maintenance_at = 'Дата не може бути в майбутньому';
      }
      if (maintenanceHours === null || maintenanceHours < 0) {
        e.initial_maintenance_hours = 'Наробіток має бути ≥ 0';
      } else if (engineHours !== null && maintenanceHours > engineHours) {
        e.initial_maintenance_hours = 'Не більше поточних мотогодин';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    const onError = (err: unknown) => {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.show(errorMessage(err), 'error');
    };

    if (isEdit && id) {
      updateMut.mutate(
        {
          name: name.trim(),
          manufacturer: manufacturer.trim() || null,
          model: model.trim() || null,
          notes: notes.trim() || null,
        },
        {
          onSuccess: () => {
            toast.show('Компресор оновлено');
            navigate(`/compressors/${id}`);
          },
          onError,
        },
      );
    } else {
      createMut.mutate(
        {
          name: name.trim(),
          manufacturer: manufacturer.trim() || null,
          model: model.trim() || null,
          initial_engine_hours: engineHours ?? 0,
          initial_maintenance_at: maintenanceAt,
          initial_maintenance_hours: maintenanceHours ?? 0,
        },
        {
          onSuccess: (c) => {
            toast.show(`Компресор ${c.name} створено`);
            navigate(`/compressors/${c.id}`);
          },
          onError,
        },
      );
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <div className="page">
      <Link to={isEdit ? `/compressors/${id}` : '/compressors'} className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        {isEdit ? existing.data?.name : 'Компресори'}
      </Link>
      <div className="page-header">
        <h1>{isEdit ? 'Редагувати компресор' : 'Новий компресор'}</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        <Field label="Назва" required error={errors.name} hint="Напр., «Bauer K-14»">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(errors.name)}
          />
        </Field>

        <Field label="Виробник">
          <TextInput value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        </Field>

        <Field label="Модель">
          <TextInput value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>

        {!isEdit && (
          <>
            <Field label="Поточні мотогодини, мг" required error={errors.initial_engine_hours}>
              <NumberStepper
                value={engineHours}
                onChange={setEngineHours}
                step={0.1}
                min={0}
                allowDecimal
                ariaLabel="Поточні мотогодини"
                invalid={Boolean(errors.initial_engine_hours)}
              />
            </Field>

            <Field label="Дата останнього ТО" required error={errors.initial_maintenance_at}>
              <DateInput
                value={maintenanceAt}
                max={todayISO()}
                onChange={(e) => setMaintenanceAt(e.target.value)}
                invalid={Boolean(errors.initial_maintenance_at)}
              />
            </Field>

            <Field
              label="Наробіток на момент останнього ТО, мг"
              required
              error={errors.initial_maintenance_hours}
            >
              <NumberStepper
                value={maintenanceHours}
                onChange={setMaintenanceHours}
                step={0.1}
                min={0}
                allowDecimal
                ariaLabel="Наробіток на момент останнього ТО"
                invalid={Boolean(errors.initial_maintenance_hours)}
              />
            </Field>
          </>
        )}

        {isEdit && (
          <Field label="Примітки">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
        )}

        <div className="form__footer">
          <Button
            variant="secondary"
            onClick={() => navigate(isEdit ? `/compressors/${id}` : '/compressors')}
          >
            Скасувати
          </Button>
          <Button type="submit" loading={pending}>
            Зберегти
          </Button>
        </div>
      </form>
    </div>
  );
}
