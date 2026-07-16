import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, VenetianMask } from 'lucide-react';
import { useBulkCreateMasks, useCreateMask, useMask, useUpdateMask } from '../../api/masks';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { DateInput, Field, TextArea, TextInput } from '../../components/Field';
import { ListRow } from '../../components/ListRow';
import { NumberStepper } from '../../components/NumberStepper';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage, fieldErrors } from '../../api/http';
import type { Mask } from '../../api/types';

export function MaskFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const existing = useMask(isEdit ? id : undefined);
  const createMut = useCreateMask();
  const bulkCreateMut = useBulkCreateMasks();
  const updateMut = useUpdateMask(id ?? '');

  const [createdBatch, setCreatedBatch] = useState<Mask[] | null>(null);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [number, setNumber] = useState('');
  const [model, setModel] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [inhaleValveReplacedAt, setInhaleValveReplacedAt] = useState('');
  const [voiceMembraneReplacedAt, setVoiceMembraneReplacedAt] = useState('');
  const [inspectionAt, setInspectionAt] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEdit && existing.data) {
      const m = existing.data;
      setNumber(m.number);
      setModel(m.model ?? '');
      setAssignedTo(m.assigned_to ?? '');
      setInhaleValveReplacedAt(m.inhale_valve_replaced_at ?? '');
      setVoiceMembraneReplacedAt(m.voice_membrane_replaced_at ?? '');
      setInspectionAt(m.inspection_at ?? '');
      setNotes(m.notes ?? '');
    }
  }, [isEdit, existing.data]);

  if (!canEdit) return <Navigate to="/masks" replace />;
  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  if (createdBatch) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Створено {createdBatch.length} масок</h1>
        </div>
        <p className="field__hint">
          Номери згенеровано автоматично — відкрийте будь-яку маску, щоб змінити номер чи інші поля.
        </p>
        <div className="list">
          {createdBatch.map((m) => (
            <ListRow key={m.id} icon={<VenetianMask size={24} />} title={`№${m.number}`} to={`/masks/${m.id}/edit`} />
          ))}
        </div>
        <div className="form__footer">
          <Button
            variant="secondary"
            onClick={() => {
              setCreatedBatch(null);
              setNumber('');
            }}
          >
            Створити ще
          </Button>
          <Button onClick={() => navigate('/masks')}>Готово</Button>
        </div>
      </div>
    );
  }

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!number.trim()) e.number = 'Вкажіть номер маски';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const body = {
      number: number.trim(),
      model: model.trim() || null,
      assigned_to: assignedTo.trim() || null,
      inhale_valve_replaced_at: inhaleValveReplacedAt || null,
      voice_membrane_replaced_at: voiceMembraneReplacedAt || null,
      inspection_at: inspectionAt || null,
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
          toast.show('Маску оновлено');
          navigate(`/masks/${id}`);
        },
        onError,
      });
    } else if (quantity && quantity > 1) {
      bulkCreateMut.mutate(
        { ...body, quantity },
        {
          onSuccess: (res) => {
            toast.show(`Створено ${res.data.length} масок`);
            setCreatedBatch(res.data);
          },
          onError,
        },
      );
    } else {
      createMut.mutate(body, {
        onSuccess: (m) => {
          toast.show(`Маску №${m.number} створено`);
          navigate(`/masks/${m.id}`);
        },
        onError,
      });
    }
  };

  const pending = createMut.isPending || updateMut.isPending || bulkCreateMut.isPending;
  const previewNumbers =
    !isEdit && quantity && quantity > 1 && number.trim()
      ? Array.from({ length: Math.min(quantity, 5) }, (_, i) => `${number.trim()}-${i + 1}`)
      : [];

  return (
    <div className="page">
      <Link to={isEdit ? `/masks/${id}` : '/masks'} className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        {isEdit ? `№${existing.data?.number}` : 'Маски'}
      </Link>
      <div className="page-header">
        <h1>{isEdit ? 'Редагувати маску' : 'Нова маска'}</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        {!isEdit && (
          <Field
            label="Кількість"
            hint={
              previewNumbers.length > 0 ? (
                <>
                  Номери: <strong>{previewNumbers.join(', ')}</strong>
                  {quantity! > 5 ? `… (${quantity} шт)` : ''}
                </>
              ) : (
                'Створити декілька однакових масок одразу (номери — з суфіксом -1, -2…)'
              )
            }
          >
            <NumberStepper value={quantity} onChange={setQuantity} step={1} min={1} max={50} ariaLabel="Кількість" />
          </Field>
        )}

        <Field
          label={quantity && quantity > 1 ? 'Базовий номер' : 'Номер маски'}
          required
          error={errors.number}
        >
          <TextInput
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            invalid={Boolean(errors.number)}
          />
        </Field>

        <Field label="Модель">
          <TextInput value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>

        <Field label="Закріплена особа" hint="Вільний текст — прізвище й ім'я вписується вручну">
          <TextInput value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
        </Field>

        <Field label="Дата заміни клапану вдиху">
          <DateInput value={inhaleValveReplacedAt} onChange={(e) => setInhaleValveReplacedAt(e.target.value)} />
        </Field>

        <Field label="Дата заміни переговорної мембрани">
          <DateInput value={voiceMembraneReplacedAt} onChange={(e) => setVoiceMembraneReplacedAt(e.target.value)} />
        </Field>

        <Field label="Дата технічного огляду">
          <DateInput value={inspectionAt} onChange={(e) => setInspectionAt(e.target.value)} />
        </Field>

        <Field label="Примітки">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>

        <div className="form__footer">
          <Button
            variant="secondary"
            onClick={() => navigate(isEdit ? `/masks/${id}` : '/masks')}
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
