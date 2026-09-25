'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SkeletonText } from '@/components/ui/Skeleton';

// Shift Allocation tab of "Allocate Policies in Bulk" — the 3-panel per-employee multi-shift
// manager from legacy EmployeeConfig/index.ctp tab12. One employee is selected at a time;
// shifts are added/removed one at a time (matches legacy's drag-one-row interaction).
// First shift added becomes the primary (emp_config type='SHIFT' status=1); further shifts
// are secondary (type='MSHIFT' status=2). Removing the primary promotes the newest secondary.
// See legacy/Bulk_Policy_Shift_Allocation_Migration_Plan.md.

interface EmployeeRow { emp_pkey: number; name: string; branch_name: string }
interface ShiftRow { day_time_seq: number; day_time_desc: string; primary?: boolean }

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';
const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function ListPanel<T>({
  rows, getKey, isSelected, onSelect, renderRow, emptyText,
}: {
  rows: T[];
  getKey: (row: T) => number;
  isSelected: (row: T) => boolean;
  onSelect: (row: T) => void;
  renderRow: (row: T) => React.ReactNode;
  emptyText: React.ReactNode;
}) {
  return (
    <div className="h-[360px] overflow-y-auto border border-slate-100 rounded-xl">
      {rows.length === 0 && (
        <div className="px-2.5 py-3 text-slate-400 text-[11.5px]">{emptyText}</div>
      )}
      <ul className="divide-y divide-slate-50">
        {rows.map((row) => (
          <li
            key={getKey(row)}
            onClick={() => onSelect(row)}
            className={cn(
              'cursor-pointer hover:bg-slate-50 px-2.5 py-1.5 text-[12px]',
              isSelected(row) && 'bg-[color:var(--color-primary-light)] hover:bg-[color:var(--color-primary-light)]'
            )}
          >
            {renderRow(row)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShiftAllocator() {
  const queryClient = useQueryClient();
  const [empPkey, setEmpPkey] = useState<number | null>(null);
  const [empSearch, setEmpSearch] = useState('');
  const [unallocSearch, setUnallocSearch] = useState('');
  const [allocSearch, setAllocSearch] = useState('');
  const [unallocSelected, setUnallocSelected] = useState<number | null>(null);
  const [allocSelected, setAllocSelected] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data: empData } = useQuery<{ employees: EmployeeRow[] }>({
    queryKey: ['bulk-shift', 'employees'],
    queryFn: () => fetch('/api/employees/bulk-policies/shifts').then((r) => r.json()),
  });
  const employees = useMemo(() => empData?.employees ?? [], [empData]);

  const { data: shiftData, isLoading } = useQuery<{ allocated: ShiftRow[]; unallocated: ShiftRow[] }>({
    queryKey: ['bulk-shift', empPkey],
    queryFn: () => fetch(`/api/employees/bulk-policies/shifts?emp_fkey=${empPkey}`).then((r) => r.json()),
    enabled: empPkey != null,
  });

  const mutation = useMutation({
    mutationFn: ({ method, day_time_seq }: { method: 'POST' | 'DELETE'; day_time_seq: number }) =>
      fetch('/api/employees/bulk-policies/shifts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emp_fkey: empPkey, day_time_seq }),
      }).then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Request failed');
        return json as { success: boolean; action?: string; promoted?: number | null };
      }),
    onSuccess: (result, vars) => {
      setUnallocSelected(null);
      setAllocSelected(null);
      if (vars.method === 'POST') {
        setMsg({ kind: 'ok', text: 'Shift allocated' });
      } else {
        setMsg({
          kind: 'ok',
          text: result.promoted != null ? 'Shift removed — a secondary shift was promoted to primary' : 'Shift removed',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['bulk-shift', empPkey] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => setMsg({ kind: 'err', text: String(err instanceof Error ? err.message : err) }),
  });

  const filteredEmployees = useMemo(() => {
    const q = empSearch.toLowerCase();
    return employees.filter((e) => `${e.name} ${e.branch_name}`.toLowerCase().includes(q));
  }, [employees, empSearch]);

  const unallocated = useMemo(() => {
    const q = unallocSearch.toLowerCase();
    return (shiftData?.unallocated ?? []).filter((s) => s.day_time_desc.toLowerCase().includes(q));
  }, [shiftData?.unallocated, unallocSearch]);

  const allocated = useMemo(() => {
    const q = allocSearch.toLowerCase();
    return (shiftData?.allocated ?? []).filter((s) => s.day_time_desc.toLowerCase().includes(q));
  }, [shiftData?.allocated, allocSearch]);

  function doAdd() {
    if (unallocSelected == null) return;
    mutation.mutate({ method: 'POST', day_time_seq: unallocSelected });
  }
  function doRemove() {
    if (allocSelected == null) return;
    const row = allocated.find((s) => s.day_time_seq === allocSelected);
    if (row?.primary && !window.confirm('This is the primary shift. Removing it will promote the most recent secondary shift (if any). Continue?')) return;
    mutation.mutate({ method: 'DELETE', day_time_seq: allocSelected });
  }

  return (
    <section className="surface-card rounded-2xl p-5">
      <h2 className="text-[15px] font-semibold text-[#0F172A] mb-4">Shift Allocation</h2>

      {msg && (
        <p className={cn('mb-3 text-[12.5px]', msg.kind === 'ok' ? 'text-[color:var(--color-success-dark)]' : 'text-[color:var(--color-danger)]')}>
          {msg.text}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Employees */}
        <div>
          <h3 className="text-[12.5px] font-semibold text-[#0F172A] mb-2">Employees</h3>
          <div className="mb-2 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by name or branch"
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
              className={cn(INPUT_CLASS, 'w-full pl-8')}
            />
          </div>
          <ListPanel
            rows={filteredEmployees}
            getKey={(e) => e.emp_pkey}
            isSelected={(e) => e.emp_pkey === empPkey}
            onSelect={(e) => {
              setEmpPkey(e.emp_pkey);
              setUnallocSelected(null);
              setAllocSelected(null);
              setMsg(null);
            }}
            renderRow={(e) => (
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[#0F172A]">{e.name}</span>
                <span className="text-slate-400 text-[11px] whitespace-nowrap">{e.branch_name || '—'}</span>
              </div>
            )}
            emptyText="No active employees."
          />
        </div>

        {/* Unallocated shifts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12.5px] font-semibold text-[#0F172A]">Shifts</h3>
            <button
              onClick={doAdd}
              disabled={empPkey == null || unallocSelected == null || mutation.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              Add →
            </button>
          </div>
          <div className="mb-2 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter"
              value={unallocSearch}
              onChange={(e) => setUnallocSearch(e.target.value)}
              className={cn(INPUT_CLASS, 'w-full pl-8')}
            />
          </div>
          <ListPanel
            rows={unallocated}
            getKey={(s) => s.day_time_seq}
            isSelected={(s) => s.day_time_seq === unallocSelected}
            onSelect={(s) => setUnallocSelected(s.day_time_seq)}
            renderRow={(s) => <span className="text-[#0F172A]">{s.day_time_desc}</span>}
            emptyText={empPkey == null ? 'Select an employee.' : isLoading ? <SkeletonText lines={3} height={10} /> : 'No unallocated shifts.'}
          />
        </div>

        {/* Allocated shifts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12.5px] font-semibold text-[#0F172A]">Allocated Shifts</h3>
            <button
              onClick={doRemove}
              disabled={empPkey == null || allocSelected == null || mutation.isPending}
              className={cn(BTN_BASE, 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')}
            >
              ← Remove
            </button>
          </div>
          <div className="mb-2 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter"
              value={allocSearch}
              onChange={(e) => setAllocSearch(e.target.value)}
              className={cn(INPUT_CLASS, 'w-full pl-8')}
            />
          </div>
          <ListPanel
            rows={allocated}
            getKey={(s) => s.day_time_seq}
            isSelected={(s) => s.day_time_seq === allocSelected}
            onSelect={(s) => setAllocSelected(s.day_time_seq)}
            renderRow={(s) => (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#0F172A]">{s.day_time_desc}</span>
                {s.primary && (
                  <span className="text-[10.5px] font-semibold text-[color:var(--color-success-dark)] bg-[color:var(--color-success-dark)]/10 rounded px-1.5 py-0.5 whitespace-nowrap">
                    Primary
                  </span>
                )}
              </div>
            )}
            emptyText={empPkey == null ? 'Select an employee.' : isLoading ? <SkeletonText lines={3} height={10} /> : 'No shifts allocated.'}
          />
        </div>
      </div>
    </section>
  );
}
