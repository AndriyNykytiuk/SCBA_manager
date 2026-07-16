import { NavLink } from 'react-router-dom';
import PumpFlow from '../../../img/Frame_1.svg';
import Logament from '../../../img/Framelogament.svg';
import Archive1 from '../../../img/FrameArchive.svg';
import Compressor from '../../../img/FrameCompressor.svg';
import Baloon from '../../../img/FrameBalonSCBA.svg';
import scba from '../../../img/FrameAparatus.svg';
import {
  Archive,
  Backpack,
  Building2,
  Clock,
  Cog,
  Cylinder,
  Fuel,
  Home,
  Package,
  Users,
  VenetianMask,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useAlertCounters } from '../api/dashboard';

export function SideNav() {
  const { isAdmin, canEdit } = useAuth();
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
      {canEdit && (
        <NavLink to="/fill-session" className={cls} title="Заправка">
          <img src={PumpFlow} width={44} height={44} alt="" aria-hidden="true" />
          <span className="sidenav__label">Заправка</span>
        </NavLink>
      )}
      <NavLink to="/backplates" className={cls} title="Ложаменти">
        <img src={Logament} width={44} height={44} alt="" aria-hidden="true" />
        <span className="sidenav__label">Ложаменти</span>
      </NavLink>
      <NavLink to="/cylinders" className={cls} title="Балони">
        <img src={Baloon} width={44} height={44} alt="" aria-hidden="true" />
        <span className="sidenav__label">Балони</span>
      </NavLink>
      <NavLink to="/masks" className={cls} title="Маски">
        <VenetianMask size={24} aria-hidden="true" />
        <span className="sidenav__label">Маски</span>
      </NavLink>
      <NavLink to="/apparatus" className={cls} title="Апарати">
        <img src={scba} width={44} height={44} alt="" aria-hidden="true" />
        <span className="sidenav__label">Апарати</span>
      </NavLink>
      <NavLink to="/compressors" className={cls} title="Компресори">
        <img src={Compressor} width={44} height={44} alt="" aria-hidden="true" />
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
      {isAdmin && (
        <NavLink to="/admin/intervals" className={cls} title="Інтервали випробувань">
          <Clock size={24} aria-hidden="true" />
          <span className="sidenav__label">Інтервали випробувань</span>
        </NavLink>
      )}
      {canEdit && (
        <NavLink to="/archive" className={cls} title="Архів">
          <img src={Archive1} width={44} height={44} alt="" aria-hidden="true" />
          <span className="sidenav__label">Архів</span>
        </NavLink>
      )}
      <div className="sidenav__footer">v0.1</div>
    </nav>
  );
}
