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
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-mono ml-1.5">env</span>
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
