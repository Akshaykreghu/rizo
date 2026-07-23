'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Check, Ban } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { formatDate } from '@/lib/utils';

interface PromotionRow {
  promotion_pkey: number;
  emp_fkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  created_date: string;
  approved_status: string;
  designation: string;
  new_desig_name: string | null;
  current_desig_name: string | null;
  emp_dept: string;
  new_dept_name: string | null;
  current_dept_name: string | null;
  emp_branch: string;
  new_branch_name: string | null;
  annual_gross: string;
  remarks: string;
  promotion_status: string;
}

interface Option { value: string; label: string }

function useLookup(path: string, valueKey: string, labelFn: (r: Record<string, unknown>) => string) {
  return useQuery<Option[]>({
    queryKey: [path],
    queryFn: () => fetch(`/api/${path}`).then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ value: String(r[valueKey]), label: labelFn(r) }))
    ),
  });
}

const STATUS_TABS = [
  { value: 'N', label: 'Pending' },
  { value: 'Y', label: 'Approved' },
  { value: 'R', label: 'Rejected' },
];

export default function PromotionApprovalPage() {
  const queryClient = useQueryClient();
  const [statusTab, setStatusTab] = useState('N');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ emp_fkey: '' });

  const { data = [], isLoading } = useQuery<PromotionRow[]>({
    queryKey: ['promotions', statusTab],
    queryFn: () => fetch(`/api/promotions?status=${statusTab}`).then((r) => r.json()),
  });

  const { data: designations = [] } = useLookup('setup/designations', 'desig_code', (r) => String(r.desig_name));
  const { data: departments = [] } = useLookup('setup/departments', 'dept_code', (r) => String(r.dept_name));
  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));
  const { data: shifts = [] } = useLookup('setup/shifts', 'day_time_seq', (r) => String(r.day_time_desc));
  const { data: leavePolicies = [] } = useLookup('setup/leavepolicy-groups', 'LEAVEPOLICY_GROUP_ID', (r) => String(r.LEAVEPOLICY_GROUP_NAME));
  const { data: structures = [] } = useLookup('setup/salary-structures', 'structure_id', (r) => String(r.structure_name));

  const create = useMutation({
    mutationFn: () => fetch('/api/promotions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to submit request');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setShowModal(false);
      setForm({ emp_fkey: '' });
    },
  });

  const decide = useMutation({
    mutationFn: (vars: { promotion_pkey: number; action: 'approve' | 'reject' }) =>
      fetch(`/api/promotions/${vars.promotion_pkey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: vars.action }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update request');
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotions'] }),
  });

  function f(key: string) {
    return {
      value: form[key] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
    };
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Promotion Approval</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Request Promotion
        </button>
      </div>

      <div className="flex items-center gap-1 text-sm mb-5">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusTab(t.value)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              statusTab === t.value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && data.length === 0 && <p className="text-sm text-gray-400">No requests here.</p>}

      <div className="space-y-3">
        {data.map((row) => (
          <div key={row.promotion_pkey} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-gray-900">
                  {row.first_name} {row.last_name ?? ''} <span className="text-gray-400 text-xs font-normal">({row.emp_id})</span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Requested {formatDate(row.created_date)}</p>
              </div>
              {row.approved_status === 'N' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => decide.mutate({ promotion_pkey: row.promotion_pkey, action: 'approve' })}
                    disabled={decide.isPending}
                    className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => decide.mutate({ promotion_pkey: row.promotion_pkey, action: 'reject' })}
                    disabled={decide.isPending}
                    className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
              {row.new_desig_name && (
                <div>
                  <p className="text-xs text-gray-400">Designation</p>
                  <p className="text-gray-800">{row.current_desig_name ?? '—'} → {row.new_desig_name}</p>
                </div>
              )}
              {row.new_dept_name && (
                <div>
                  <p className="text-xs text-gray-400">Department</p>
                  <p className="text-gray-800">{row.current_dept_name ?? '—'} → {row.new_dept_name}</p>
                </div>
              )}
              {row.new_branch_name && (
                <div>
                  <p className="text-xs text-gray-400">Branch</p>
                  <p className="text-gray-800">{row.new_branch_name}</p>
                </div>
              )}
              {row.annual_gross && (
                <div>
                  <p className="text-xs text-gray-400">New Annual CTC</p>
                  <p className="text-gray-800">{row.annual_gross}</p>
                </div>
              )}
            </div>
            {row.remarks && <p className="text-xs text-gray-500 mt-2">{row.remarks}</p>}
          </div>
        ))}
      </div>

      {decide.isError && <p className="text-red-500 text-sm mt-3">{String(decide.error)}</p>}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Request Promotion</h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
              <div>
                <label className="label">Employee <span className="text-red-500">*</span></label>
                <EmployeeSearch value={form.emp_fkey} onChange={(v) => setForm((f) => ({ ...f, emp_fkey: v }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">New Designation</label>
                  <select className="input" {...f('designation')}>
                    <option value="">No change</option>
                    {designations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">New Department</label>
                  <select className="input" {...f('emp_dept')}>
                    <option value="">No change</option>
                    {departments.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">New Branch</label>
                  <select className="input" {...f('emp_branch')}>
                    <option value="">No change</option>
                    {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Employment Type</label>
                  <select className="input" {...f('emp_type')}>
                    <option value="">No change</option>
                    <option value="Permanent">Permanent</option>
                    <option value="Contract">Contract</option>
                    <option value="Trainee">Trainee</option>
                    <option value="Intern">Intern</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">New Shift</label>
                  <select className="input" {...f('shift')}>
                    <option value="">No change</option>
                    {shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">New Leave Policy</label>
                  <select className="input" {...f('leave')}>
                    <option value="">No change</option>
                    {leavePolicies.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">New Salary Structure</label>
                <select className="input" {...f('salary')}>
                  <option value="">No change</option>
                  {structures.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div>
                <label className="label">New Annual CTC</label>
                <input type="number" className="input" {...f('annual_gross')} />
              </div>

              <div>
                <label className="label">New Reporting Manager</label>
                <EmployeeSearch value={form.hierarch ?? ''} onChange={(v) => setForm((f) => ({ ...f, hierarch: v }))} />
              </div>

              <div>
                <label className="label">Remarks</label>
                <textarea className="input" rows={2} {...f('remarks')} />
              </div>

              {create.isError && <p className="text-red-500 text-sm">{String(create.error)}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!form.emp_fkey || create.isPending}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400"
                >
                  {create.isPending ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
        .input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px #6366f1; border-color: transparent; }
      `}</style>
    </div>
  );
}
