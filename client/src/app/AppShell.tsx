import { Outlet } from 'react-router-dom';
import { HeaderBar } from './HeaderBar';
import { SideNav } from './SideNav';
import { ConnectionBanner } from './ConnectionBanner';
import { ActiveFillSessionBanner } from './ActiveFillSessionBanner';
import { StationPickInline } from './StationSwitcherSheet';
import { useAuth } from '../auth/AuthContext';

export function AppShell() {
  const { isAdmin, activeStation } = useAuth();
  const needStation = isAdmin && !activeStation;

  return (
    <div className="shell">
      <HeaderBar />
      <SideNav />
      <main className="shell__main">
        <ConnectionBanner />
        <ActiveFillSessionBanner />
        {needStation ? <StationPickInline /> : <Outlet />}
      </main>
    </div>
  );
}
