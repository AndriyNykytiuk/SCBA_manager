import { useState } from 'react';
import { Link } from 'react-router-dom';
import Scba_logo from '../../../img/generatedartwork_1.svg'
import { ChevronDown, LogOut, Menu, Shield } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { StationSwitcherSheet } from './StationSwitcherSheet';
import { MobileNavSheet } from './MobileNavSheet';

export function HeaderBar() {
  const { user, isAdmin, activeStation, logoutUser } = useAuth();
  const [stationsOpen, setStationsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="header shell__header">
      <Link to="/" className="header__brand" aria-label="SCBA Manager — Головна">
        <img src={Scba_logo} width={90} height={90} alt="" aria-hidden="true" />
        <span>SCBA Manager</span>
      </Link>

      <div className="header__spacer" />

      {user?.role === 'duty' && <span className="header__role-badge">Перегляд</span>}

      {isAdmin ? (
        <button
          type="button"
          className="header__station hide-mobile"
          onClick={() => setStationsOpen(true)}
          aria-label={`Станція: ${activeStation?.name ?? 'не обрано'}. Змінити`}
        >
          {activeStation?.name ?? 'Оберіть станцію'}
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      ) : (
        activeStation && <span className="header__station hide-mobile">{activeStation.name}</span>
      )}

      <button
        type="button"
        className="btn btn--ghost btn--sm hide-mobile"
        onClick={logoutUser}
        aria-label={`Вийти (${user?.full_name ?? ''})`}
        title="Вийти"
      >
        <span className="hide-mobile">{user?.full_name}</span>
        <LogOut size={20} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="btn btn--ghost btn--sm show-mobile"
        onClick={() => setNavOpen(true)}
        aria-label="Меню"
      >
        <Menu size={24} aria-hidden="true" />
      </button>

      {stationsOpen && <StationSwitcherSheet onClose={() => setStationsOpen(false)} />}
      {navOpen && <MobileNavSheet onClose={() => setNavOpen(false)} />}
    </header>
  );
}
