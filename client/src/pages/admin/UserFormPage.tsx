// Admin: створення/редагування користувача + скидання пароля + деактивація (screens.md §7)
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useCreateUser, useResetPassword, useUpdateUser, useUser } from '../../api/users';
import { useStations } from '../../api/stations';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { Field, SelectInput, TextInput } from '../../components/Field';
import { SegmentControl } from '../../components/SegmentControl';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage, fieldErrors } from '../../api/http';
import { ROLE_LABEL } from './UsersPage';
import type { Role } from '../../api/types';

export function UserFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const toast = useToast();
  const existing = useUser(isEdit ? id : undefined);
  const stations = useStations();
  const createMut = useCreateUser();
  const updateMut = useUpdateUser(id ?? '');
  const resetMut = useResetPassword(id ?? '');

  const [fullName, setFullName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<Role | null>('duty');
  const [stationId, setStationId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  useEffect(() => {
    if (isEdit && existing.data) {
      const u = existing.data;
      setFullName(u.full_name);
      setLogin(u.login);
      setRole(u.role);
      setStationId(u.station?.id ?? '');
    }
  }, [isEdit, existing.data]);

  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  const u = existing.data;
  const isSelf = isEdit && me?.id === id;
  const activeStations = (stations.data?.data ?? []).filter((s) => !s.archived_at);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.full_name = 'Вкажіть ПІБ';
    if (!role) e.role = 'Оберіть роль';
    if (role !== 'admin' && !stationId) e.station_id = 'Оберіть станцію для майстра/чергового';
    if (!isEdit) {
      if (!login.trim()) e.login = 'Вкажіть логін';
      if (password.length < 8) e.password = 'Пароль — щонайменше 8 символів';
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
          full_name: fullName.trim(),
          role: role as Role,
          station_id: role === 'admin' ? null : stationId,
        },
        {
          onSuccess: () => {
            toast.show('Користувача оновлено');
            navigate('/admin/users');
          },
          onError,
        },
      );
    } else {
      createMut.mutate(
        {
          login: login.trim(),
          password,
          full_name: fullName.trim(),
          role: role as Role,
          station_id: role === 'admin' ? null : stationId,
        },
        {
          onSuccess: (created) => {
            toast.show(`Користувача ${created.full_name} створено`);
            navigate('/admin/users');
          },
          onError,
        },
      );
    }
  };

  const resetPassword = () => {
    if (newPassword.length < 8) {
      toast.show('Пароль — щонайменше 8 символів', 'error');
      return;
    }
    resetMut.mutate(newPassword, {
      onSuccess: () => {
        toast.show('Пароль скинуто. Всі сесії користувача завершено');
        setResetOpen(false);
        setNewPassword('');
      },
      onError: (err) => toast.show(errorMessage(err), 'error'),
    });
  };

  const toggleActive = () => {
    const next = !(u?.is_active ?? true);
    updateMut.mutate(
      { is_active: next },
      {
        onSuccess: () => {
          toast.show(next ? 'Користувача активовано' : 'Користувача деактивовано');
          setDeactivateOpen(false);
        },
        onError: (err) => {
          toast.show(errorMessage(err), 'error');
          setDeactivateOpen(false);
        },
      },
    );
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <div className="page">
      <Link to="/admin/users" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Користувачі
      </Link>
      <div className="page-header">
        <h1>{isEdit ? `Користувач: ${u?.full_name}` : 'Новий користувач'}</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        <Field label="ПІБ" required error={errors.full_name}>
          <TextInput
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            invalid={Boolean(errors.full_name)}
          />
        </Field>

        <Field label="Логін" required error={errors.login}>
          <TextInput
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            invalid={Boolean(errors.login)}
            disabled={isEdit}
            autoComplete="off"
          />
        </Field>

        {!isEdit && (
          <Field label="Пароль" required error={errors.password}>
            <span className="password-wrap">
              <TextInput
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={Boolean(errors.password)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Приховати пароль' : 'Показати пароль'}
              >
                {showPw ? <EyeOff size={24} /> : <Eye size={24} />}
              </button>
            </span>
          </Field>
        )}

        <Field
          label="Роль"
          required
          error={errors.role}
          hint={isSelf ? 'Це ваш обліковий запис — роль змінювати не варто' : undefined}
        >
          <SegmentControl<Role>
            options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({
              value: r,
              label: ROLE_LABEL[r],
              disabled: isSelf,
            }))}
            value={role}
            onChange={setRole}
            ariaLabel="Роль користувача"
          />
        </Field>

        <Field
          label="Станція"
          required={role !== 'admin'}
          error={errors.station_id}
          hint={role === 'admin' ? 'Admin — глобальний, без станції' : undefined}
        >
          <SelectInput
            value={role === 'admin' ? '' : stationId}
            onChange={(e) => setStationId(e.target.value)}
            disabled={role === 'admin'}
            invalid={Boolean(errors.station_id)}
          >
            <option value="">— оберіть станцію —</option>
            {activeStations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <div className="form__footer">
          <Button variant="secondary" onClick={() => navigate('/admin/users')}>
            Скасувати
          </Button>
          <Button type="submit" loading={pending}>
            Зберегти
          </Button>
        </div>
      </form>

      {isEdit && u && (
        <div className="btn-row">
          <Button variant="secondary" onClick={() => setResetOpen(true)}>
            Скинути пароль
          </Button>
          {u.is_active ? (
            <Button variant="danger" onClick={() => setDeactivateOpen(true)} disabled={isSelf}>
              Деактивувати
            </Button>
          ) : (
            <Button variant="secondary" loading={updateMut.isPending} onClick={toggleActive}>
              Активувати
            </Button>
          )}
        </div>
      )}

      {resetOpen && (
        <Modal
          title={`Скинути пароль: ${u?.full_name}`}
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetOpen(false)}>
                Скасувати
              </Button>
              <Button onClick={resetPassword} loading={resetMut.isPending} disabled={!newPassword}>
                Скинути пароль
              </Button>
            </>
          }
        >
          <Field label="Новий пароль" required hint="Щонайменше 8 символів; всі сесії користувача буде завершено">
            <TextInput
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </Field>
        </Modal>
      )}

      {deactivateOpen && u && (
        <ConfirmDialog
          title={`Деактивувати ${u.full_name}?`}
          confirmLabel="Деактивувати"
          danger
          loading={updateMut.isPending}
          onConfirm={toggleActive}
          onCancel={() => setDeactivateOpen(false)}
        >
          <p>Користувач не зможе увійти в систему. Історія його дій збережеться.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
