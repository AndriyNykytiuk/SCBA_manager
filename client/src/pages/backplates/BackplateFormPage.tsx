import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useBackplate, useCreateBackplate, useUpdateBackplate } from '../../api/backplates';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { DateInput, Field, TextArea, TextInput } from '../../components/Field';
import { NumberStepper } from '../../components/NumberStepper';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage, fieldErrors } from '../../api/http';
import { addMonths, formatDate } from '../../lib/formatters';

export function BackplateFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const existing = useBackplate(isEdit ? id : undefined);
  const createMut = useCreateBackplate();
  const updateMut = useUpdateBackplate(id ?? '');

  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [commissionedAt, setCommissionedAt] = useState('');
  const [reducerReplacedAt, setReducerReplacedAt] = useState('');
  const [intervalMonths, setIntervalMonths] = useState<number | null>(12);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEdit && existing.data) {
      const b = existing.data;
      setName(b.name);
      setManufacturer(b.manufacturer ?? '');
      setModel(b.model ?? '');
      setSerial(b.serial_number ?? '');
      setCommissionedAt(b.commissioned_at ?? '');
      setReducerReplacedAt(b.reducer_last_replaced_at ?? '');
      setIntervalMonths(b.reducer_interval_months);
      setNotes(b.notes ?? '');
    }
  }, [isEdit, existing.data]);

  if (!canEdit) return <Navigate to="/backplates" replace />;
  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  const preview =
    reducerReplacedAt && intervalMonths ? addMonths(reducerReplacedAt, intervalMonths) : '';

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Вкажіть назву/номер (напр. bS-4343234)';
    if (!intervalMonths || intervalMonths <= 0) {
      e.reducer_interval_months = 'Інтервал має бути > 0';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const body = {
      name: name.trim(),
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serial_number: serial.trim() || null,
      commissioned_at: commissionedAt || null,
      reducer_last_replaced_at: reducerReplacedAt || null,
      reducer_interval_months: intervalMonths ?? 0,
      notes: notes.trim() || null,
    };

    const onError = (err: unknown) => {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.show(errorMessage(err), 'error');
    };

    if (isEdit && id) {
      updateMut.mutate(body, {
        onSuccess: () => {
          toast.show('Ложамент оновлено');
          navigate(`/backplates/${id}`);
        },
        onError,
      });
    } else {
      createMut.mutate(body, {
        onSuccess: (b) => {
          toast.show(`Ложамент ${b.name} створено`);
          navigate(`/backplates/${b.id}`);
        },
        onError,
      });
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <div className="page">
      <Link to={isEdit ? `/backplates/${id}` : '/backplates'} className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        {isEdit ? existing.data?.name : 'Ложаменти'}
      </Link>
      <div className="page-header">
        <h1>{isEdit ? 'Редагувати ложамент' : 'Новий ложамент'}</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        <Field label="Назва / номер" required error={errors.name} hint="Формат на кшталт bS-4343234">
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

        <Field label="Серійний номер">
          <TextInput value={serial} onChange={(e) => setSerial(e.target.value)} />
        </Field>

        <Field label="Дата введення в експлуатацію">
          <DateInput value={commissionedAt} onChange={(e) => setCommissionedAt(e.target.value)} />
        </Field>

        <Field label="Дата останньої заміни редуктора">
          <DateInput
            value={reducerReplacedAt}
            onChange={(e) => setReducerReplacedAt(e.target.value)}
          />
        </Field>

        <Field
          label="Інтервал заміни редуктора, місяців"
          required
          error={errors.reducer_interval_months}
          hint={
            preview ? (
              <>
                Наступна заміна: <strong>{formatDate(preview)}</strong>
              </>
            ) : undefined
          }
        >
          <NumberStepper
            value={intervalMonths}
            onChange={setIntervalMonths}
            step={1}
            min={0}
            ariaLabel="Інтервал заміни редуктора"
            invalid={Boolean(errors.reducer_interval_months)}
          />
        </Field>

        <Field label="Примітки">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>

        <div className="form__footer">
          <Button
            variant="secondary"
            onClick={() => navigate(isEdit ? `/backplates/${id}` : '/backplates')}
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
