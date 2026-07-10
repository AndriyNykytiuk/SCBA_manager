import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Fuel, LogOut, Shield } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { StationSwitcherSheet } from './StationSwitcherSheet';

export function HeaderBar() {
  const { user, isAdmin, canEdit, activeStation, logoutUser } = useAuth();
  const [stationsOpen, setStationsOpen] = useState(false);

  return (
    <header className="header shell__header">
      <Link to="/" className="header__brand" aria-label="SCBA Manager — Головна">
        <Shield size={28} color="var(--color-brand)" aria-hidden="true" />
        <span>SCBA Manager</span>
      </Link>

      {isAdmin ? (
        <button
          type="button"
          className="header__station"
          onClick={() => setStationsOpen(true)}
          aria-label={`Станція: ${activeStation?.name ?? 'не обрано'}. Змінити`}
        >
          {activeStation?.name ?? 'Оберіть станцію'}
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      ) : (
        activeStation && <span className="header__station">{activeStation.name}</span>
      )}

      <div className="header__spacer" />

      {user?.role === 'duty' && <span className="header__role-badge">Перегляд</span>}

      {canEdit && (
        <Link to="/fill-session" className="btn btn--primary hide-mobile">
          <Fuel size={20} aria-hidden="true" />
          Заправка
        </Link>
      )}

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={logoutUser}
        aria-label={`Вийти (${user?.full_name ?? ''})`}
        title="Вийти"
      >
        <span className="hide-mobile">{user?.full_name}</span>
        <LogOut size={20} aria-hidden="true" />
      </button>

      {stationsOpen && <StationSwitcherSheet onClose={() => setStationsOpen(false)} />}
    </header>
  );
}
