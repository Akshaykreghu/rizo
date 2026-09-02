'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Settings } from 'lucide-react';
import { HierarchyMover } from '@/components/employees/HierarchyMover';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

interface Employee { emp_pkey: number; first_name: string; last_name: string | null; emp_id: string }
interface Option { value: string; label: string }

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const SECTIONS: { type: string; title: string; lookupPath: string; valueKey: string; labelFn: (row: Record<string, unknown>) => string }[] = [
  { type: 'SHIFT', title: 'Shift Allocation', lookupPath: 'setup/shifts', valueKey: 'day_time_seq', labelFn: (r) => String(r.day_time_desc) },
  { type: 'LEAVE', title: 'Leave Policy', lookupPath: 'setup/leavepolicy-groups', valueKey: 'LEAVEPOLICY_GROUP_ID', labelFn: (r) => String(r.LEAVEPOLICY_GROUP_NAME) },
  { type: 'HOLIDAY', title: 'Holiday', lookupPath: 'setup/holiday-groups', valueKey: 'HOLIDAY_GROUP_ID', labelFn: (r) => String(r.HOLIDAY_GROUP_NAME) },
  { type: 'SALARY', title: 'Salary Structure', lookupPath: 'setup/salary-structures', valueKey: 'structure_id', labelFn: (r) => String(r.structure_name) },
  { type: 'NOTICEPER', title: 'Notice Period', lookupPath: 'setup/notice-periods', valueKey: 'notice_pkey', labelFn: (r) => `${r.description} (${r.notice_days} days)` },
  { type: 'DIVISION', title: 'Division', lookupPath: 'setup/divisions', valueKey: 'id', labelFn: (r) => String(r.div_name) },
  { type: 'SECTION', title: 'Section', lookupPath: 'setup/sections', valueKey: 'id', labelFn: (r) => String(r.section_name) },
  { type: 'GRADE', title: 'Grade', lookupPath: 'setup/grades', valueKey: 'grade_pkey', labelFn: (r) => String(r.grade_name) },
];

// Tab order mirrors the legacy "Bulk Policy Allocation" page exactly: 8 policy tabs
// plus the two hierarchy movers, one panel visible at a time.
const TABS: { key: string; title: string }[] = [
  { key: 'SHIFT', title: 'Shift Allocation' },
  { key: 'LEAVE', title: 'Leave Policy' },
  { key: 'HOLIDAY', title: 'Holiday' },
  { key: 'HIERARCHY', title: 'Employee Hierarchy' },
  { key: 'SALARY', title: 'Salary Structure' },
  { key: 'NOTICEPER', title: 'Notice Period' },
  { key: 'DIVISION', title: 'Division' },
  { key: 'SECTION', title: 'Section' },
  { key: 'GRADE', title: 'Grade' },
  { key: 'LAPPR', title: 'Leave Hierarchy' },
];

function PolicySection({ type, title, lookupPath, valueKey, labelFn, employees }: {
  type: string; title: string; lookupPath: string; valueKey: string;
  labelFn: (row: Record<string, unknown>) => string; employees: Employee[];
}) {
  const queryClient = useQueryClient();
  const [policyId, setPolicyId] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<{ assigned: number; failed?: number[]; failedNote?: string } | null>(null);

  const { data: options = [] } = useQuery<Option[]>({
    queryKey: [lookupPath],
    queryFn: () => fetch(`/api/${lookupPath}`).then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ value: String(r[valueKey]), label: labelFn(r) }))
    ),
  });

  const assign = useMutation({
    mutationFn: () => fetch('/api/employees/bulk-policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, policy_id: Number(policyId), emp_fkeys: Array.from(selected) }),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to assign');
      return res.json();
    }),
    onSuccess: (data) => {
      setResult(data);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  function toggle(empPkey: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(empPkey)) next.delete(empPkey);
      else next.add(empPkey);
      return next;
    });
  }

  const filtered = employees.filter((e) =>
    `${e.first_name} ${e.last_name ?? ''} ${e.emp_id}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="surface-card rounded-2xl p-5">
      <h2 className="text-[15px] font-semibold text-[#0F172A] mb-4">{title}</h2>

      <div className="mb-4">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Policy</label>
        <select
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          className={cn(INPUT_CLASS, 'w-full max-w-sm')}
        >
          <option value="">Select policy</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="mb-2 relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          type="text"
          placeholder="Filter employees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(INPUT_CLASS, 'w-full pl-8')}
        />
      </div>

      <div className="max-h-56 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50 mb-4">
        {filtered.map((emp) => (
          <label key={emp.emp_pkey} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" checked={selected.has(emp.emp_pkey)} onChange={() => toggle(emp.emp_pkey)} className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40" />
            <span className="text-[#0F172A]">{emp.first_name} {emp.last_name ?? ''}</span>
            <span className="text-slate-400 text-[11px]">({emp.emp_id})</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => assign.mutate()}
          disabled={!policyId || !selected.size || assign.isPending}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          {assign.isPending ? 'Assigning…' : `Assign to ${selected.size} selected`}
        </button>
        {assign.isError && <p className="text-[12.5px] text-[color:var(--color-danger)]">{String(assign.error)}</p>}
      </div>

      {result && (
        <div className="mt-3 text-[12.5px]">
          <span className="text-[color:var(--color-success-dark)] font-medium">{result.assigned} assigned</span>
          {result.failed && result.failed.length > 0 && (
            <span className="text-[color:var(--color-danger)] ml-2">{result.failed.length} failed — {result.failedNote}</span>
          )}
        </div>
      )}
    </section>
  );
}

export default function BulkPoliciesPage() {
  const { slotEl } = useHeaderSlot();
  const [activeTab, setActiveTab] = useState<string>(TABS[0].key);

  const { data } = useQuery<{ data: Employee[] }>({
    queryKey: ['employees', 'bulk-policies-list'],
    queryFn: () => fetch('/api/employees?status=1&pageSize=500').then((r) => r.json()),
  });
  const employees = data?.data ?? [];

  const activeSection = SECTIONS.find((s) => s.type === activeTab);

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Allocate Policies in Bulk
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Assign shift, leave, holiday, salary, and hierarchy policies to many employees at once
            </p>
          </div>,
          slotEl
        )}

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-5">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                activeTab === t.key
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              <Settings className="w-3.5 h-3.5" /> {t.title}
            </button>
          ))}
        </div>
      </div>

      {activeSection && <PolicySection key={activeSection.type} {...activeSection} employees={employees} />}
      {activeTab === 'HIERARCHY' && <HierarchyMover key="HIERARCHY" type="HIERARCHY" title="Employee Hierarchy" employees={employees} />}
      {activeTab === 'LAPPR' && <HierarchyMover key="LAPPR" type="LAPPR" title="Leave Hierarchy" employees={employees} />}
    </div>
  );
}
