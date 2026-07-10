import { NavLink } from 'react-router-dom';
import { Backpack, Building2, Cog, Cylinder, Home, Package, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useAlertCounters } from '../api/dashboard';

export function SideNav() {
  const { isAdmin } = useAuth();
  const counters = useAlertCounters();
  const overdue = counters.data?.overdue ?? 0;

  const cls = ({ isActive }: { isActive: boolean }) =>
    `sidenav__item${isActive ? ' active' : ''}`;

  return (
    <nav className="sidenav shell__sidenav" aria-label="Основна навігація">
      <NavLink to="/" end className={cls} title="Головна">
        <Home size={24} aria-hidden="true" />
        <span className="sidenav__label">Головна</span>
        {overdue > 0 && (
          <span className="sidenav__count" aria-label={`Прострочено: ${overdue}`}>
            {overdue}
          </span>
        )}
      </NavLink>
      <NavLink to="/backplates" className={cls} title="Ложаменти">
        <Backpack size={24} aria-hidden="true" />
        <span className="sidenav__label">Ложаменти</span>
      </NavLink>
      <NavLink to="/cylinders" className={cls} title="Балони">
        <Cylinder size={24} aria-hidden="true" />
        <span className="sidenav__label">Балони</span>
      </NavLink>
      <NavLink to="/apparatus" className={cls} title="Апарати">
        <Package size={24} aria-hidden="true" />
        <span className="sidenav__label">Апарати</span>
      </NavLink>
      <NavLink to="/compressors" className={cls} title="Компресори">
        <Cog size={24} aria-hidden="true" />
        <span className="sidenav__label">Компресори</span>
      </NavLink>
      {isAdmin && (
        <NavLink to="/admin/users" className={cls} title="Користувачі">
          <Users size={24} aria-hidden="true" />
          <span className="sidenav__label">Користувачі</span>
        </NavLink>
      )}
      {isAdmin && (
        <NavLink to="/admin/stations" className={cls} title="Станції">
          <Building2 size={24} aria-hidden="true" />
          <span className="sidenav__label">Станції</span>
        </NavLink>
      )}
      <div className="sidenav__footer">v0.1</div>
    </nav>
  );
}
