import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  Backpack,
  Building2,
  Clock,
  Cog,
  Cylinder,
  Fuel,
  Home,
  LogOut,
  Package,
  Users,
  VenetianMask,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { ListRow } from '../components/ListRow';
import { useAuth } from '../auth/AuthContext';
import { useAlertCounters } from '../api/dashboard';
import { StationSwitcherSheet } from './StationSwitcherSheet';

/** Мобільне меню (бургер): повний список навігації — заміна лівого SideNav на <768px */
export function MobileNavSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { isAdmin, canEdit, logoutUser, user } = useAuth();
  const counters = useAlertCounters();
  const overdue = counters.data?.overdue ?? 0;
  const [stationsOpen, setStationsOpen] = useState(false);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  if (stationsOpen) {
    return (
      <StationSwitcherSheet
        onClose={() => {
          setStationsOpen(false);
          onClose();
        }}
      />
    );
  }

  return (
    <Modal title="Меню" onClose={onClose}>
      <div className="list more-list">
        <ListRow
          icon={<Home size={24} />}
          title="Головна"
          onClick={() => go('/')}
          badge={overdue > 0 ? <span className="sidenav__count">{overdue}</span> : undefined}
        />
        {canEdit && (
          <ListRow
            icon={<Fuel size={24} />}
            title="Заправка"
            onClick={() => go('/fill-session')}
          />
        )}
        <ListRow icon={<Backpack size={24} />} title="Ложаменти" onClick={() => go('/backplates')} />
        <ListRow icon={<Cylinder size={24} />} title="Балони" onClick={() => go('/cylinders')} />
        <ListRow icon={<VenetianMask size={24} />} title="Маски" onClick={() => go('/masks')} />
        <ListRow icon={<Package size={24} />} title="Апарати" onClick={() => go('/apparatus')} />
        <ListRow icon={<Cog size={24} />} title="Компресори" onClick={() => go('/compressors')} />
        {canEdit && (
          <ListRow icon={<Archive size={24} />} title="Архів" onClick={() => go('/archive')} />
        )}
        {isAdmin && (
          <ListRow icon={<Users size={24} />} title="Користувачі" onClick={() => go('/admin/users')} />
        )}
        {isAdmin && (
          <ListRow icon={<Building2 size={24} />} title="Станції" onClick={() => go('/admin/stations')} />
        )}
        {isAdmin && (
          <ListRow
            icon={<Clock size={24} />}
            title="Інтервали випробувань"
            onClick={() => go('/admin/intervals')}
          />
        )}
        {isAdmin && (
          <ListRow
            icon={<Building2 size={24} />}
            title="Змінити станцію"
            onClick={() => setStationsOpen(true)}
          />
        )}
        <ListRow
          icon={<LogOut size={24} />}
          title="Вийти"
          meta={user?.full_name}
          onClick={() => {
            onClose();
            logoutUser();
          }}
        />
      </div>
    </Modal>
  );
}
