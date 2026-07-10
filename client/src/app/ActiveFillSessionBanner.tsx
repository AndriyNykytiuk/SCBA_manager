import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Fuel } from 'lucide-react';
import { useActiveFillSessions } from '../api/fillSessions';
import { elapsedSeconds, formatDurationSec } from '../lib/formatters';

/** Банер «Іде заправка · 00:41:12 · [Відкрити]» поверх усіх екранів (screens.md §6) */
export function ActiveFillSessionBanner() {
  const query = useActiveFillSessions(30_000);
  const location = useLocation();
  const [now, setNow] = useState(Date.now());

  const session = query.data?.data[0];

  useEffect(() => {
    if (!session) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [session]);

  if (!session) return null;
  if (location.pathname === `/fill-session/${session.id}`) return null;

  // Поправка на збитий годинник пристрою: різниця server_time ↔ клієнт
  const serverOffsetMs = query.data
    ? new Date(query.data.server_time).getTime() - (query.dataUpdatedAt || Date.now())
    : 0;

  return (
    <div className="banner banner--session banner--rounded" role="status">
      <Fuel size={20} aria-hidden="true" />
      Іде заправка · {session.compressor.name} ·{' '}
      <span className="tnum">
        {formatDurationSec(elapsedSeconds(session.started_at, now + serverOffsetMs))}
      </span>
      <Link to={`/fill-session/${session.id}`} className="btn btn--primary btn--sm">
        Відкрити
      </Link>
    </div>
  );
}
