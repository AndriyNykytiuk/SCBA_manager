import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';

export interface BigActionButtonProps {
  variant: 'start' | 'stop';
  label: string;
  onAction: () => void;
  /** Стоп вимагає утримання 1с — захист від випадкового тапу рукавицею */
  hold?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

const HOLD_MS = 1000;

export function BigActionButton({
  variant,
  label,
  onAction,
  hold = false,
  loading = false,
  disabled = false,
}: BigActionButtonProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cancelHold = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  };

  useEffect(() => cancelHold, []);

  const Icon = variant === 'start' ? Play : Square;
  const blocked = disabled || loading;

  return (
    <button
      type="button"
      className={`big-action big-action--${variant}`}
      disabled={blocked}
      aria-label={hold ? `${label} (утримуйте 1 секунду)` : label}
      onClick={hold ? undefined : onAction}
      onPointerDown={
        hold
          ? () => {
              if (blocked) return;
              setHolding(true);
              timerRef.current = window.setTimeout(() => {
                cancelHold();
                onAction();
              }, HOLD_MS);
            }
          : undefined
      }
      onPointerUp={hold ? cancelHold : undefined}
      onPointerLeave={hold ? cancelHold : undefined}
      onPointerCancel={hold ? cancelHold : undefined}
    >
      <span
        className="big-action__hold"
        style={{
          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
          transition: holding ? `transform ${HOLD_MS}ms linear` : 'none',
        }}
        aria-hidden="true"
      />
      <span className="big-action__inner">
        {loading ? <span className="spinner" aria-hidden="true" /> : <Icon size={32} aria-hidden="true" />}
        {loading ? 'Зберігаю…' : label}
      </span>
    </button>
  );
}
