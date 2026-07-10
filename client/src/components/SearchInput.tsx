import { Search } from 'lucide-react';

export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchInput({ value, onChange, placeholder, autoFocus }: SearchInputProps) {
  return (
    <div className="search-input">
      <Search size={20} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Пошук'}
        aria-label={placeholder ?? 'Пошук'}
        autoFocus={autoFocus}
      />
    </div>
  );
}
