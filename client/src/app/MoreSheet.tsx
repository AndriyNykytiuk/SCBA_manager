import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Backpack, Building2, Cog, LogOut, Users } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ListRow } from '../components/ListRow';
import { useAuth } from '../auth/AuthContext';
import { StationSwitcherSheet } from './StationSwitcherSheet';

/** Мобільне меню «Ще»: Ложаменти, Компресори, (admin) Користувачі + станція, Вихід */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { isAdmin, logoutUser, user } = useAuth();
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
    <Modal title="Ще" onClose={onClose}>
      <div className="list more-list">
        <ListRow icon={<Backpack size={24} />} title="Ложаменти" onClick={() => go('/backplates')} />
        <ListRow icon={<Cog size={24} />} title="Компресори" onClick={() => go('/compressors')} />
        {isAdmin && (
          <ListRow icon={<Users size={24} />} title="Користувачі" onClick={() => go('/admin/users')} />
        )}
        {isAdmin && (
          <ListRow icon={<Building2 size={24} />} title="Станції" onClick={() => go('/admin/stations')} />
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
