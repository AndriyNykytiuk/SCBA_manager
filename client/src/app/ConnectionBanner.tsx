import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';

/** Липкий банер при втраті мережі (design-system.md §6.13) */
export function ConnectionBanner() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null;

  return (
    <div className="banner banner--warning banner--rounded" role="alert">
      <TriangleAlert size={20} aria-hidden="true" />
      Немає з’єднання — дані можуть бути неактуальні
    </div>
  );
}
