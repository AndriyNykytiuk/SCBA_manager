import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Backpack } from 'lucide-react';
import {
  useBackplate,
  useBulkCreateBackplates,
  useCreateBackplate,
  useUpdateBackplate,
} from '../../api/backplates';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { DateInput, Field, TextArea, TextInput } from '../../components/Field';
import { ListRow } from '../../components/ListRow';
import { NumberStepper } from '../../components/NumberStepper';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage, fieldErrors } from '../../api/http';
import type { Backplate } from '../../api/types';

export function BackplateFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const existing = useBackplate(isEdit ? id : undefined);
  const createMut = useCreateBackplate();
  const bulkCreateMut = useBulkCreateBackplates();
  const updateMut = useUpdateBackplate(id ?? '');

  const [createdBatch, setCreatedBatch] = useState<Backplate[] | null>(null);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [lungValveNumber, setLungValveNumber] = useState('');
  const [membraneReplacedAt, setMembraneReplacedAt] = useState('');
  const [gaugeNumber, setGaugeNumber] = useState('');
  const [commissionedAt, setCommissionedAt] = useState('');
  const [reducerReplacedAt, setReducerReplacedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEdit && existing.data) {
      const b = existing.data;
      setName(b.name);
      setManufacturer(b.manufacturer ?? '');
      setModel(b.model ?? '');
      setSerial(b.serial_number ?? '');
      setLungValveNumber(b.lung_valve_number ?? '');
      setMembraneReplacedAt(b.membrane_replaced_at ?? '');
      setGaugeNumber(b.gauge_number ?? '');
      setCommissionedAt(b.commissioned_at ?? '');
      setReducerReplacedAt(b.reducer_last_replaced_at ?? '');
      setNotes(b.notes ?? '');
    }
  }, [isEdit, existing.data]);

  if (!canEdit) return <Navigate to="/backplates" replace />;
  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  if (createdBatch) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Створено {createdBatch.length} ложаментів</h1>
        </div>
        <p className="field__hint">
          Назви згенеровано автоматично — відкрийте будь-який ложамент, щоб змінити назву чи інші поля.
        </p>
        <div className="list">
          {createdBatch.map((b) => (
            <ListRow key={b.id} icon={<Backpack size={24} />} title={b.name} to={`/backplates/${b.id}/edit`} />
          ))}
        </div>
        <div className="form__footer">
          <Button
            variant="secondary"
            onClick={() => {
              setCreatedBatch(null);
              setName('');
            }}
          >
            Створити ще
          </Button>
          <Button onClick={() => navigate('/backplates')}>Готово</Button>
        </div>
      </div>
    );
  }

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Вкажіть назву/номер (напр. bS-4343234)';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const body = {
      name: name.trim(),
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serial_number: serial.trim() || null,
      lung_valve_number: lungValveNumber.trim() || null,
      membrane_replaced_at: membraneReplacedAt || null,
      gauge_number: gaugeNumber.trim() || null,
      commissioned_at: commissionedAt || null,
      reducer_last_replaced_at: reducerReplacedAt || null,
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
    } else if (quantity && quantity > 1) {
      bulkCreateMut.mutate(
        { ...body, quantity },
        {
          onSuccess: (res) => {
            toast.show(`Створено ${res.data.length} ложаментів`);
            setCreatedBatch(res.data);
          },
          onError,
        },
      );
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

  const pending = createMut.isPending || updateMut.isPending || bulkCreateMut.isPending;
  const previewNames =
    !isEdit && quantity && quantity > 1 && name.trim()
      ? Array.from({ length: Math.min(quantity, 5) }, (_, i) => `${name.trim()}-${i + 1}`)
      : [];

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
        {!isEdit && (
          <Field
            label="Кількість"
            hint={
              previewNames.length > 0 ? (
                <>
                  Назви: <strong>{previewNames.join(', ')}</strong>
                  {quantity! > 5 ? `… (${quantity} шт)` : ''}
                </>
              ) : (
                'Створити декілька однакових ложаментів одразу (назви — з суфіксом -1, -2…)'
              )
            }
          >
            <NumberStepper value={quantity} onChange={setQuantity} step={1} min={1} max={50} ariaLabel="Кількість" />
          </Field>
        )}

        <Field
          label={quantity && quantity > 1 ? 'Базова назва / номер' : 'Назва / номер'}
          required
          error={errors.name}
          hint="Формат на кшталт bS-4343234"
        >
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

        <Field label="Номер легеневого автомату">
          <TextInput value={lungValveNumber} onChange={(e) => setLungValveNumber(e.target.value)} />
        </Field>

        <Field label="Дата заміни мембрани">
          <DateInput value={membraneReplacedAt} onChange={(e) => setMembraneReplacedAt(e.target.value)} />
        </Field>

        <Field label="Номер манометру">
          <TextInput value={gaugeNumber} onChange={(e) => setGaugeNumber(e.target.value)} />
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
