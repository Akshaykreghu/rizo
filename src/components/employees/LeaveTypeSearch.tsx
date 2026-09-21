'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SetupOption } from '@/lib/setupOptions';

interface LeaveTypeSearchProps {
  value: string;
  onChange: (salaryHeadItemFkey: string) => void;
  types: SetupOption[];
  placeholder?: string;
  className?: string;
}

// Same search-box pattern as BranchSearch/EmployeeSearch, filtering an already-fetched list
// client-side (leave types are a small, static-per-request list, same precedent as branches).
export function LeaveTypeSearch({ value, onChange, types, placeholder, className }: LeaveTypeSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedLabel = value ? (types.find((t) => t.value === value)?.label ?? '') : 'All types';

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) => t.label.toLowerCase().includes(q));
  }, [types, query]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={open ? query : selectedLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Search leave type'}
        className={cn(
          'w-full h-11 pl-9 pr-3.5 border border-slate-200 rounded-lg text-sm text-[#0F172A] placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors duration-150',
          className
        )}
      />
      {open && (
        <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto scroll-fade">
          <button
            type="button"
            onMouseDown={() => { onChange(''); setOpen(false); }}
            className="flex items-center w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors duration-150 text-slate-500"
          >
            All types
          </button>
          {options.map((t) => (
            <button
              key={t.value}
              type="button"
              onMouseDown={() => { onChange(t.value); setOpen(false); }}
              className="flex items-center w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors duration-150 text-[#0F172A]"
            >
              {t.label}
            </button>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-400">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}
