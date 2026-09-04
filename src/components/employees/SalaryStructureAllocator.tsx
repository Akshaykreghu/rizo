'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// Salary Structure tab of "Allocate Policies in Bulk" — the 3-panel allocate / de-allocate
// workflow from legacy EmployeeConfig/index.ctp tab5. One employee is moved at a time
// (single-select, no checkboxes), matching legacy's drag-one-row interaction.

interface EmpRow {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  branch_name: string | null;
  desig_name: string | null;
  gross: number | null;
}
interface StructureOption { structure_id: number; structure_name: string; structure_eg_amt: number; structure_active: number }

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';
const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const ASSIGN_CONFIRM =
  'You are about to change the policy/rule/settings of the selected employee(s). The previous settings will be lost and new ones will be applied. Do you still need to proceed?';
const REMOVE_CONFIRM =
  'After completing the salary structure allocation, please upload any components again if you have them.';

function EmpTable({
  rows, selected, onSelect, showGross, emptyText,
}: {
  rows: EmpRow[];
  selected: number | null;
  onSelect: (id: number) => void;
  showGross: boolean;
  emptyText: string;
}) {
  return (
    <div className="h-[360px] overflow-y-auto border border-slate-100 rounded-xl">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-slate-50 text-slate-500">
          <tr>
            <th className="text-left font-medium px-2.5 py-1.5">Name</th>
            <th className="text-left font-medium px-2.5 py-1.5">Branch</th>
            <th className="text-left font-medium px-2.5 py-1.5">Designation</th>
            {showGross && <th className="text-right font-medium px-2.5 py-1.5">Gross</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <tr><td colSpan={showGross ? 4 : 3} className="px-2.5 py-3 text-slate-400 text-[11.5px]">{emptyText}</td></tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.emp_pkey}
              onClick={() => onSelect(r.emp_pkey)}
              className={cn(
                'cursor-pointer hover:bg-slate-50',
                selected === r.emp_pkey && 'bg-[color:var(--color-primary-light)] hover:bg-[color:var(--color-primary-light)]'
              )}
            >
              <td className="px-2.5 py-1.5 text-[#0F172A] whitespace-nowrap">
                {r.first_name} {r.last_name ?? ''}
                <span className="text-slate-400 text-[11px] ml-1">({r.emp_id})</span>
              </td>
              <td className="px-2.5 py-1.5 text-slate-600">{r.branch_name ?? '—'}</td>
              <td className="px-2.5 py-1.5 text-slate-600">{r.desig_name ?? '—'}</td>
              {showGross && <td className="px-2.5 py-1.5 text-right text-slate-600">{r.gross ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalaryStructureAllocator() {
  const queryClient = useQueryClient();
  const [structureId, setStructureId] = useState<number | null>(null);
  const [candSearch, setCandSearch] = useState('');
  const [allocSearch, setAllocSearch] = useState('');
  const [candSelected, setCandSelected] = useState<number | null>(null);
  const [allocSelected, setAllocSelected] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data: structures = [] } = useQuery<StructureOption[]>({
    queryKey: ['salary-structures', 'full'],
    queryFn: () => fetch('/api/setup/salary-structures?full=1').then((r) => r.json()),
    select: (rows) => rows.filter((s) => Number(s.structure_active) === 1),
  });

  const { data, isLoading } = useQuery<{ candidates: EmpRow[]; allocated: EmpRow[] }>({
    queryKey: ['bulk-salary', structureId],
    queryFn: () => fetch(`/api/employees/bulk-policies/salary?structureId=${structureId}`).then((r) => r.json()),
    enabled: structureId != null,
  });

  const mutation = useMutation({
    mutationFn: (payload: { action: 'assign' | 'remove'; empFkey: number }) =>
      fetch('/api/employees/bulk-policies/salary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, structureId }),
      }).then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Request failed');
        return json as { success: boolean; failedNote?: string; formulaWarnings?: string[] };
      }),
    onSuccess: (result, vars) => {
      setCandSelected(null);
      setAllocSelected(null);
      if (result.success) {
        const warn = result.formulaWarnings?.length ? ` (${result.formulaWarnings.length} formula warning(s))` : '';
        setMsg({ kind: 'ok', text: vars.action === 'assign' ? `Employee added to salary structure${warn}` : `Employee removed from salary structure` });
      } else {
        setMsg({ kind: 'err', text: result.failedNote ?? 'Could not allocate employee' });
      }
      queryClient.invalidateQueries({ queryKey: ['bulk-salary', structureId] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => setMsg({ kind: 'err', text: String(err instanceof Error ? err.message : err) }),
  });

  const candidates = useMemo(() => {
    const q = candSearch.toLowerCase();
    return (data?.candidates ?? []).filter((e) =>
      `${e.first_name} ${e.last_name ?? ''} ${e.emp_id} ${e.branch_name ?? ''} ${e.desig_name ?? ''}`.toLowerCase().includes(q)
    );
  }, [data?.candidates, candSearch]);

  const allocated = useMemo(() => {
    const q = allocSearch.toLowerCase();
    return (data?.allocated ?? []).filter((e) =>
      `${e.first_name} ${e.last_name ?? ''} ${e.emp_id} ${e.branch_name ?? ''} ${e.desig_name ?? ''}`.toLowerCase().includes(q)
    );
  }, [data?.allocated, allocSearch]);

  // Gross column is hidden by the API (returns null) under the legacy privacy rule.
  const showGross = (data?.candidates ?? data?.allocated ?? []).some((r) => r.gross != null)
    || (data != null && (data.candidates.length + data.allocated.length) === 0);

  function doAssign() {
    if (candSelected == null || !window.confirm(ASSIGN_CONFIRM)) return;
    mutation.mutate({ action: 'assign', empFkey: candSelected });
  }
  function doRemove() {
    if (allocSelected == null || !window.confirm(REMOVE_CONFIRM)) return;
    mutation.mutate({ action: 'remove', empFkey: allocSelected });
  }

  return (
    <section className="surface-card rounded-2xl p-5">
      <h2 className="text-[15px] font-semibold text-[#0F172A] mb-4">Salary Structure</h2>

      <div className="mb-4">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Salary Allocation</label>
        <select
          value={structureId ?? ''}
          onChange={(e) => {
            setStructureId(e.target.value ? Number(e.target.value) : null);
            setCandSelected(null);
            setAllocSelected(null);
            setMsg(null);
          }}
          className={cn(INPUT_CLASS, 'w-full max-w-md')}
        >
          <option value="">Select salary structure</option>
          {structures.map((s) => (
            <option key={s.structure_id} value={s.structure_id}>
              {s.structure_name} - {s.structure_eg_amt}
            </option>
          ))}
        </select>
      </div>

      {msg && (
        <p className={cn('mb-3 text-[12.5px]', msg.kind === 'ok' ? 'text-[color:var(--color-success-dark)]' : 'text-[color:var(--color-danger)]')}>
          {msg.text}
        </p>
      )}

      {structureId == null ? (
        <p className="text-[12.5px] text-slate-400">Select a salary structure to see allocated and non-allocated employees.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12.5px] font-semibold text-[#0F172A]">Non-Allocated Employees</h3>
              <button
                onClick={doAssign}
                disabled={candSelected == null || mutation.isPending}
                className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
              >
                Assign →
              </button>
            </div>
            <div className="mb-2 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filter"
                value={candSearch}
                onChange={(e) => setCandSearch(e.target.value)}
                className={cn(INPUT_CLASS, 'w-full pl-8')}
              />
            </div>
            <EmpTable
              rows={candidates}
              selected={candSelected}
              onSelect={setCandSelected}
              showGross={showGross}
              emptyText={isLoading ? 'Loading…' : 'No eligible non-allocated employees.'}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12.5px] font-semibold text-[#0F172A]">Employees in selected salary structure</h3>
              <button
                onClick={doRemove}
                disabled={allocSelected == null || mutation.isPending}
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
            <EmpTable
              rows={allocated}
              selected={allocSelected}
              onSelect={setAllocSelected}
              showGross={showGross}
              emptyText={isLoading ? 'Loading…' : 'No employees in this salary structure yet.'}
            />
          </div>
        </div>
      )}
    </section>
  );
}
