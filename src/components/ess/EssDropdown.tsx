'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface EssDropdownOption {
  value: string;
  label: string;
}

const BRAND = '#1E516E';

// ESS-themed counterpart to components/ui/SearchableSelect.tsx — same behavior (search-filtered
// popup instead of the browser's own <select> rendering, useful once an option list is long enough
// that scanning it plainly gets slow), but styled with the ESS page's own CSS vars (var(--bg-card)
// etc., defined in ess-legacy.css) so it respects the ESS light/dark toggle instead of the admin
// dashboard's hardcoded Tailwind colors.
export function EssDropdown({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  style,
  buttonStyle,
  clearable = true,
}: {
  value: string;
  onChange: (value: string) => void;
  options: EssDropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Overrides for the trigger button (e.g. to match a form's own input size, or a dark banner). */
  buttonStyle?: React.CSSProperties;
  /** False hides the blank "placeholder" choice — for fields that must always hold a value. */
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: 0, ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 8,
          background: disabled ? 'var(--bg-page)' : 'var(--bg-page)', color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: 13, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box',
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ flexShrink: 0, color: buttonStyle?.color ?? 'var(--text-muted)', fontSize: 10, opacity: buttonStyle?.color ? 0.7 : 1 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 50, marginTop: 4, width: '100%', minWidth: '100%',
            background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 10,
            boxShadow: '0 8px 30px rgba(0,0,0,0.18)', overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔍</span>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }}
            />
          </div>
          <ul style={{ maxHeight: 224, overflowY: 'auto', listStyle: 'none', margin: 0, padding: '4px 0' }}>
            {clearable && <li>
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 13, border: 'none', cursor: 'pointer',
                  background: !value ? `${BRAND}18` : 'transparent', color: !value ? BRAND : 'var(--text-muted)', fontWeight: !value ? 700 : 400,
                }}
              >
                {placeholder}
              </button>
            </li>}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                  title={o.label}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 13, border: 'none', cursor: 'pointer',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    background: o.value === value ? `${BRAND}18` : 'transparent', color: o.value === value ? BRAND : 'var(--text-primary)', fontWeight: o.value === value ? 700 : 400,
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
