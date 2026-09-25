'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

// A searchable dropdown that replaces the native <select> for long option lists (e.g. employee
// pickers): the browser's own <select> popup sizes itself to the widest option and can render far
// wider than the closed control, and offers no in-list filtering. This keeps the trigger and the
// popup at the same width (the popup is absolutely positioned under the trigger, not OS-rendered)
// and adds a search box that filters by label.
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select',
  className,
  buttonClassName,
  disabled,
  wrap = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  className?: string;
  // Overrides the trigger button's own padding/border/radius/focus-ring so it can be made to
  // match a specific form's plain-input styling exactly (twMerge resolves the conflicting
  // Tailwind utilities, so pass e.g. the same INPUT_CLASS used by that form's text inputs).
  buttonClassName?: string;
  disabled?: boolean;
  // Wrap long labels onto multiple lines (trigger and options) instead of truncating with "…".
  // Opt-in so existing pickers keep their single-line look.
  wrap?: boolean;
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
    <div ref={containerRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-left bg-white',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500',
          wrap ? 'items-start' : 'items-center',
          buttonClassName,
          // Always wins over buttonClassName (e.g. a form's own bg-white input styling) so a
          // disabled trigger never silently loses its greyed-out look.
          disabled && 'bg-gray-100 cursor-not-allowed'
        )}
      >
        <span className={cn(wrap ? 'min-w-0 break-words [overflow-wrap:anywhere]' : 'truncate', !selected && 'text-gray-400')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0', wrap && 'mt-px')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-100">
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-full text-sm focus:outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50',
                  !value ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'
                )}
              >
                {placeholder}
              </button>
            </li>
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50',
                    wrap ? 'break-words [overflow-wrap:anywhere]' : 'truncate',
                    o.value === value ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'
                  )}
                  title={o.label}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
