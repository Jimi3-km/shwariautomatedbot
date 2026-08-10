import React, {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'solid' | 'accent' | 'outline' | 'subtle' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = 'subtle', size = 'md', loading = false, icon, children, className = '', disabled, ...rest
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${size} btn-${variant} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
interface FieldWrapProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, required, children, htmlFor }: FieldWrapProps) {
  return (
    <div>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => <input ref={ref} className={`field ${className}`} {...rest} />
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...rest }, ref) => <textarea ref={ref} className={`field ${className}`} {...rest} />
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export function Select({ options, placeholder, className = '', ...rest }: SelectProps) {
  return (
    <div style={{ position: 'relative' }}>
      <select className={`field ${className}`} {...rest}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span aria-hidden style={{
        position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
        pointerEvents: 'none', color: 'var(--text-3)', fontSize: 10,
      }}>▼</span>
    </div>
  );
}

export function Checkbox({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 13.5 }}>
      <input id={id} type="checkbox" style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} {...rest} />
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
export type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

export function Pill({ tone = 'neutral', dot, children }: { tone?: PillTone; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={`pill pill-${tone}`}>
      {dot && <span className="pill-dot" />}
      {children}
    </span>
  );
}

export function Card({ children, className = '', padded = true, ...rest }: {
  children: React.ReactNode; className?: string; padded?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${padded ? 'p-4' : ''} ${className}`} {...rest}>{children}</div>;
}

export function Avatar({ name, seed, size = 32 }: { name?: string | null; seed?: string | null; size?: number }) {
  const label = (name ?? '').trim();
  const parts = label.split(/\s+/).filter(Boolean);
  const text = parts.length ? (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase() : '?';
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];
  const key = seed ?? label ?? '';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%', background: palette[h % palette.length],
        color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 600, flexShrink: 0,
      }}
    >
      {text}
    </span>
  );
}

export function Tabs({ tabs, active, onChange }: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id} role="tab" aria-selected={active === t.id}
          className="tab" onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span style={{ marginLeft: 6, color: 'var(--text-3)' }}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function FilterChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" className="chip" aria-pressed={active} onClick={onClick}>{children}</button>
  );
}

// ---------------------------------------------------------------------------
// State screens
// ---------------------------------------------------------------------------
export function LoadingState({ label = 'Loading…', rows }: { label?: string; rows?: number }) {
  if (rows) {
    return (
      <div className="space-y-2 p-1" aria-busy="true" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 48 }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16" aria-busy="true">
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
      <p style={{ color: 'var(--text-3)', fontSize: 13 }}>{label}</p>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: {
  icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div style={{ color: 'var(--text-4)', marginBottom: 12 }}>{icon}</div>}
      <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</h3>
      {body && <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 6, maxWidth: 380, lineHeight: 1.55 }}>{body}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <AlertCircle size={22} style={{ color: 'var(--danger)' }} />
      <h3 style={{ fontSize: 15, fontWeight: 600, marginTop: 10 }}>Something went wrong</h3>
      <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 6, maxWidth: 380 }}>{message}</p>
      {onRetry && <div style={{ marginTop: 16 }}><Button variant="outline" onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

/** Inline banner for errors that shouldn't replace a whole screen. */
export function InlineError({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 mx-5 my-3 px-3 py-2" style={{
      background: 'var(--danger-bg)', color: 'var(--danger)',
      borderRadius: 'var(--radius)', fontSize: 13,
    }}>
      <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1 }}>{message}</span>
      {onDismiss && <button onClick={onDismiss} aria-label="Dismiss"><X size={14} /></button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, onClose]);
}

export function Modal({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="overlay items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="modal" role="dialog" aria-modal="true" aria-label={title}
        style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--text-3)' }}><X size={17} /></button>
        </div>
        <div className="scroll-y px-5 py-4" style={{ flex: 1 }}>{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3.5" style={{ borderTop: '1px solid var(--border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: React.ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', tone = 'danger', onConfirm, onCancel, busy }: {
  open: boolean; title: string; body: string; confirmLabel?: string;
  tone?: 'danger' | 'accent'; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} width={420}
      footer={
        <>
          <Button variant="subtle" onClick={onCancel}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.6 }}>{body}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: ToastTone; message: string }

const ToastContext = createContext<{ push: (tone: ToastTone, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = ++seq.current;
    setItems((cur) => [...cur, { id, tone, message }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {items.length > 0 && createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast toast-${t.tone}`}>
              {t.tone === 'success' ? <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                : t.tone === 'error' ? <AlertCircle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                : <Info size={15} style={{ color: 'var(--info)', flexShrink: 0 }} />}
              <span style={{ flex: 1 }}>{t.message}</span>
              <button onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))} aria-label="Dismiss">
                <X size={13} style={{ color: 'var(--text-3)' }} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------
export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 2 }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, tone, hint }: {
  label: string; value: React.ReactNode; tone?: PillTone; hint?: string;
}) {
  const color = tone === 'success' ? 'var(--success)'
    : tone === 'warning' ? 'var(--warning)'
    : tone === 'danger' ? 'var(--danger)'
    : tone === 'info' ? 'var(--info)'
    : 'var(--text)';
  return (
    <div className="card p-3.5">
      <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color, letterSpacing: '-0.02em' }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** Horizontally scrollable wrapper so tables never break the page layout. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="card" style={{ overflowX: 'auto' }} data-scroll="x">
      {children}
    </div>
  );
}

export function Pagination({ offset, limit, total, onChange }: {
  offset: number; limit: number; total: number; onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between px-1 py-3" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
      <span>{from}–{to} of {total}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={to >= total} onClick={() => onChange(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  );
}
