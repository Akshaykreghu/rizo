'use client';

import { useEffect, useRef, useState } from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EmployeeListFilter } from '@/lib/employeeList';

// The single "Filter" menu of the All Employees list — legacy View/EmployeeJoin/index.ctp's
// #filterPanel (Resigned / Active / Notice Period / This Month / Previous Month), with the Branch
// picker that sat beside it folded into the same menu.
export const FILTER_OPTIONS: { value: EmployeeListFilter; label: string; heading: string }[] = [
  { value: 'active', label: 'Active', heading: 'Active Employees' },
  { value: 'resigned', label: 'Resigned', heading: 'Resigned Employees' },
  { value: 'notice', label: 'Notice Period', heading: 'Notice Period' },
  { value: 'this_month', label: 'This Month', heading: 'Joined This Month' },
  { value: 'previous_month', label: 'Previous Month', heading: 'Joined Previous Month' },
];

interface BranchOption { branch_code: string; branch_name: string }

export function EmployeeFilterMenu({
  filter, onFilterChange, branch, onBranchChange, branches,
}: {
  filter: EmployeeListFilter;
  onFilterChange: (f: EmployeeListFilter) => void;
  branch: string;
  onBranchChange: (b: string) => void;
  branches: BranchOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const activeCount = (filter !== 'active' ? 1 : 0) + (branch ? 1 : 0);
  const current = FILTER_OPTIONS.find((o) => o.value === filter);
  const branchName = branches.find((b) => b.branch_code === branch)?.branch_name;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors duration-[180ms]',
          activeCount
            ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
            : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-white'
        )}
      >
        <Filter className="w-3.5 h-3.5" />
        Filter
        <span className="text-slate-400 font-normal">·</span>
        <span className="max-w-[180px] truncate">{current?.label}{branchName ? `, ${branchName}` : ''}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-3 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12.5px] font-semibold text-[#0F172A]">Filter Employees</p>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => { onFilterChange('active'); onBranchChange(''); }}
                className="flex items-center gap-1 text-[11.5px] font-medium text-slate-500 hover:text-[color:var(--color-primary)]"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            )}
          </div>

          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Status</p>
          <div className="space-y-0.5 mb-3">
            {FILTER_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[12.5px] text-slate-700 hover:bg-slate-50 cursor-pointer">
                <input
                  type="radio"
                  name="employee-filter"
                  checked={filter === o.value}
                  onChange={() => onFilterChange(o.value)}
                  className="accent-[color:var(--color-primary)]"
                />
                {o.label}
              </label>
            ))}
          </div>

          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Branch</p>
          <select
            value={branch}
            onChange={(e) => onBranchChange(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-600 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
