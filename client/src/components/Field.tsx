import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { CircleAlert } from 'lucide-react';

export interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}

/** Обгортка поля: label зверху, помилка з іконкою під полем (не лише колір) */
export function Field({ label, required, error, hint, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
      {error && (
        <span className="field__error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          {error}
        </span>
      )}
      {!error && hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function TextInput({ invalid, className, ...rest }: TextInputProps) {
  return <input className={`input${invalid ? ' input--error' : ''} ${className ?? ''}`} {...rest} />;
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function TextArea({ invalid, className, ...rest }: TextAreaProps) {
  return (
    <textarea className={`input${invalid ? ' input--error' : ''} ${className ?? ''}`} {...rest} />
  );
}

interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function SelectInput({ invalid, className, children, ...rest }: SelectInputProps) {
  return (
    <select className={`input${invalid ? ' input--error' : ''} ${className ?? ''}`} {...rest}>
      {children}
    </select>
  );
}

interface DateInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** Нативний date-picker + ручне введення */
export function DateInput({ invalid, className, ...rest }: DateInputProps) {
  return (
    <input
      type="date"
      className={`input${invalid ? ' input--error' : ''} ${className ?? ''}`}
      {...rest}
    />
  );
}
