'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';

interface EmployeeOption {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  desig_name?: string | null;
  profile_pic?: string | null;
}

interface EmployeeSearchProps {
  value: string;
  onChange: (empPkey: string) => void;
  placeholder?: string;
  /** Shown as the closed-state label when value is empty, styled as a real selection (not the
   * muted placeholder hint) — e.g. "All employees" for a filter where empty means "no filter",
   * as opposed to other callers (e.g. Apply Leave) where empty means "nothing chosen yet". */
  emptyLabel?: string;
  /** Scopes search results to a branch (e.g. when paired with a Branch filter) — matches
   * /api/employees' own `branch` param. Omitted entirely, callers get all branches. */
  branch?: string;
  className?: string;
}

// Legacy records often have no last name (NULL) — never let it render as the text "null".
const fullName = (e: { first_name: string; last_name: string | null }) => `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
const personLabel = (e: { first_name: string; last_name: string | null; emp_id: string }) => `${fullName(e)} (${e.emp_id})`;

export function EmployeeSearch({ value, onChange, placeholder, emptyLabel, branch, className }: EmployeeSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  // Tracks which `value` the current `selectedLabel` was resolved for, so a value that
  // arrives already set (e.g. loaded from a saved record) gets its name looked up once,
  // without re-fetching after the user picks a new one from the dropdown (which sets the
  // label synchronously already).
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);

  const { data } = useQuery<{ data: EmployeeOption[] }>({
    queryKey: ['employees', 'search', query, branch],
    queryFn: () =>
      fetch(`/api/employees?search=${encodeURIComponent(query)}&pageSize=10&branch=${encodeURIComponent(branch ?? '')}`).then((r) => r.json()),
    enabled: query.length > 0,
  });

  const { data: resolvedEmp } = useQuery<{ employee: { first_name: string; last_name: string | null; emp_id: string } }>({
    queryKey: ['employees', 'byId', value],
    queryFn: () => fetch(`/api/employees/${value}`).then((r) => r.json()),
    enabled: !!value && resolvedFor !== value,
  });

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      setResolvedFor(null);
    } else if (resolvedEmp?.employee && resolvedFor !== value) {
      const emp = resolvedEmp.employee;
      setSelectedLabel(personLabel(emp));
      setResolvedFor(value);
    }
  }, [value, resolvedEmp, resolvedFor]);

  const options = data?.data ?? [];

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={open ? query : (selectedLabel || (emptyLabel ?? ''))}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Search employee by name or ID'}
        className={cn(
          'w-full h-11 pl-9 pr-3.5 border border-slate-200 rounded-lg text-sm text-[#0F172A] placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors duration-150',
          className
        )}
      />
      {open && options.length > 0 && (
        <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto scroll-fade">
          {options.map((emp) => (
            <button
              key={emp.emp_pkey}
              type="button"
              onMouseDown={() => {
                onChange(String(emp.emp_pkey));
                setSelectedLabel(personLabel(emp));
                setResolvedFor(String(emp.emp_pkey));
                setOpen(false);
              }}
              className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors duration-150"
            >
              <Avatar name={fullName(emp)} imageUrl={emp.profile_pic} className="w-7 h-7 flex-shrink-0 text-[10px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[#0F172A] font-medium">{fullName(emp)}</span>
                <span className="block truncate text-xs text-slate-400">
                  {emp.emp_id}{emp.desig_name ? ` · ${emp.desig_name}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
