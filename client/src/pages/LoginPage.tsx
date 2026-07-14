import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, OctagonAlert, Shield } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';
import { errorMessage } from '../api/http';

export function LoginPage() {
  const { loginUser, status } = useAuth();
  const navigate = useNavigate();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === 'authed') return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loginName.trim() || !password) {
      setError('Введіть логін і пароль');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await loginUser(loginName.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-card__logo">
          <Shield size={48} color="var(--color-accent)" aria-hidden="true" />
          <h1>SCBA Manager</h1>
          <p className="login-card__subtitle">Облік дихальних апаратів</p>
        </div>

        <Field label="Логін" required>
          <TextInput
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </Field>

        <Field label="Пароль" required>
          <span className="password-wrap">
            <TextInput
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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

        {error && (
          <div className="error-block" role="alert">
            <OctagonAlert size={20} aria-hidden="true" />
            {error}
          </div>
        )}

        <Button type="submit" loading={loading} block>
          {loading ? 'Вхожу…' : 'Увійти'}
        </Button>

        <p className="field__hint" style={{ textAlign: 'center' }}>
          Забули пароль? Зверніться до адміністратора
        </p>
      </form>
    </div>
  );
}
