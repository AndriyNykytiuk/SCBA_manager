import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { UiStatus } from '../lib/status';

export interface ListRowProps {
  /** статус для лівої смуги 6px; danger заливає весь рядок */
  status?: UiStatus;
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  strike?: boolean;
}

export function ListRow({
  status = 'neutral',
  icon,
  title,
  meta,
  badge,
  trailing,
  to,
  onClick,
  selected,
  disabled,
  strike,
}: ListRowProps) {
  const className = [
    'list-row',
    status === 'danger' ? 'list-row--danger' : '',
    (to || onClick) && !disabled ? 'list-row--clickable' : '',
    selected ? 'list-row--selected' : '',
    disabled ? 'list-row--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className={`list-row__bar list-row__bar--${status}`} aria-hidden="true" />
      {icon && <span className="list-row__icon">{icon}</span>}
      <span className="list-row__body">
        <span className="list-row__top">
          <span className={`list-row__title${strike ? ' list-row__title--strike' : ''}`}>
            {title}
          </span>
          {badge}
        </span>
        {meta && <span className="list-row__meta">{meta}</span>}
      </span>
      {trailing && (
        <span
          className="list-row__trailing"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {trailing}
        </span>
      )}
    </>
  );

  if (to && !disabled) {
    return (
      <Link className={className} to={to}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} disabled={disabled}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
