'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Settings } from 'lucide-react';
import { HierarchyMover } from '@/components/employees/HierarchyMover';

interface Employee { emp_pkey: number; first_name: string; last_name: string | null; emp_id: string }
interface Option { value: string; label: string }

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
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Policy</label>
        <select
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select policy</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="mb-2 relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Filter employees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="max-h-56 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50 mb-4">
        {filtered.map((emp) => (
          <label key={emp.emp_pkey} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={selected.has(emp.emp_pkey)} onChange={() => toggle(emp.emp_pkey)} />
            <span>{emp.first_name} {emp.last_name ?? ''}</span>
            <span className="text-gray-400 text-xs">({emp.emp_id})</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => assign.mutate()}
          disabled={!policyId || !selected.size || assign.isPending}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {assign.isPending ? 'Assigning…' : `Assign to ${selected.size} selected`}
        </button>
        {assign.isError && <p className="text-red-500 text-sm">{String(assign.error)}</p>}
      </div>

      {result && (
        <div className="mt-3 text-sm">
          <span className="text-emerald-700 font-medium">{result.assigned} assigned</span>
          {result.failed && result.failed.length > 0 && (
            <span className="text-red-600 ml-2">{result.failed.length} failed — {result.failedNote}</span>
          )}
        </div>
      )}
    </section>
  );
}

export default function BulkPoliciesPage() {
  const [activeTab, setActiveTab] = useState<string>(TABS[0].key);

  const { data } = useQuery<{ data: Employee[] }>({
    queryKey: ['employees', 'bulk-policies-list'],
    queryFn: () => fetch('/api/employees?status=1&pageSize=500').then((r) => r.json()),
  });
  const employees = data?.data ?? [];

  const activeSection = SECTIONS.find((s) => s.type === activeTab);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Allocate Policies in Bulk</h1>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
              activeTab === t.key
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Settings className="w-4 h-4" /> {t.title}
          </button>
        ))}
      </div>

      {activeSection && <PolicySection key={activeSection.type} {...activeSection} employees={employees} />}
      {activeTab === 'HIERARCHY' && <HierarchyMover key="HIERARCHY" type="HIERARCHY" title="Employee Hierarchy" employees={employees} />}
      {activeTab === 'LAPPR' && <HierarchyMover key="LAPPR" type="LAPPR" title="Leave Hierarchy" employees={employees} />}
    </div>
  );
}
