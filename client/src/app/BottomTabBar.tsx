import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Cylinder, Fuel, Home, Menu, Package } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useAlertCounters } from '../api/dashboard';
import { MoreSheet } from './MoreSheet';

export function BottomTabBar() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const counters = useAlertCounters();
  const overdue = counters.data?.overdue ?? 0;
  const [moreOpen, setMoreOpen] = useState(false);

  const cls = ({ isActive }: { isActive: boolean }) => `tabbar__item${isActive ? ' active' : ''}`;

  return (
    <nav className="tabbar" aria-label="Нижня навігація">
      <NavLink to="/" end className={cls}>
        <Home size={24} aria-hidden="true" />
        Головна
        {overdue > 0 && (
          <span className="tabbar__count" aria-label={`Прострочено: ${overdue}`}>
            {overdue}
          </span>
        )}
      </NavLink>
      <NavLink to="/apparatus" className={cls}>
        <Package size={24} aria-hidden="true" />
        Апарати
      </NavLink>
      {canEdit && (
        <button
          type="button"
          className="tabbar__cta"
          onClick={() => navigate('/fill-session')}
          aria-label="Заправка"
        >
          <span className="tabbar__cta-circle">
            <Fuel size={26} aria-hidden="true" />
            ЗАПРАВКА
          </span>
        </button>
      )}
      <NavLink to="/cylinders" className={cls}>
        <Cylinder size={24} aria-hidden="true" />
        Балони
      </NavLink>
      <button type="button" className="tabbar__item" onClick={() => setMoreOpen(true)}>
        <Menu size={24} aria-hidden="true" />
        Ще
      </button>
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}
    </nav>
  );
}
