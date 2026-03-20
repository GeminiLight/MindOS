'use client';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{children}</p>;
}

export function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-foreground font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${className}`}
    />
  );
}

export function Select({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${className}`}
    />
  );
}

export function EnvBadge({ overridden }: { overridden: boolean }) {
  if (!overridden) return null;
  return (
    <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-mono ml-1.5">env</span>
  );
}

/**
 * 🟢 MINOR #6: Toggle component with aria accessibility
 * @param {boolean} checked - Toggle state
 * @param {function} onChange - Called when toggle state changes (if no onClick provided)
 * @param {string} size - 'sm' (h-4 w-7) or 'md' (h-5 w-9)
 * @param {boolean} disabled - Disable toggle
 * @param {string} title - Tooltip text
 * @param {function} onClick - Custom click handler (takes priority over onChange). Call onChange directly if needed.
 *
 * Usage:
 * - Basic: `<Toggle checked={x} onChange={setX} />`
 * - With custom handler: `<Toggle checked={x} onClick={(e) => { e.stopPropagation(); await save(); }} />`
 * - In lists: Use `onClick` to prevent event bubbling; manually call `onChange` for state sync
 */
export function Toggle({ checked, onChange, size = 'md', disabled, title, onClick }: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onClick ?? (() => onChange?.(!checked))}
      className={`relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
        sm ? 'h-4 w-7' : 'h-5 w-9'
      } ${checked ? 'bg-amber-500' : 'bg-muted'}`}
    >
      <span
        className={`pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform ${
          sm ? 'h-3 w-3' : 'h-4 w-4'
        } ${checked ? (sm ? 'translate-x-3' : 'translate-x-4') : 'translate-x-0'}`}
      />
    </button>
  );
}

export function ApiKeyInput({ value, onChange, placeholder, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const isMasked = value === '***set***';
  return (
    <input
      type="password"
      value={isMasked ? '••••••••••••••••' : value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder ?? 'sk-...'}
      disabled={disabled}
      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      onFocus={() => { if (isMasked) onChange(''); }}
    />
  );
}

/**
 * 💡 SUGGESTION #10: Unified primary button primitive for amber actions
 * Replaces inline `style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}` pattern
 */
export function PrimaryButton({ children, disabled, onClick, type = 'button', className = '', ...props }: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
      {...props}
    >
      {children}
    </button>
  );
}
