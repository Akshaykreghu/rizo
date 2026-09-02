'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Check, Ban, Eye, Pencil } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatDate } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface PromotionRow {
  promotion_pkey: number;
  emp_fkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  created_date: string;
  approved_status: string;
  approved_date: string | null;
  designation: string;
  new_desig_name: string | null;
  current_desig_name: string | null;
  emp_dept: string;
  new_dept_name: string | null;
  current_dept_name: string | null;
  emp_branch: string;
  new_branch_name: string | null;
  emp_type: string | null;
  shift: string | null;
  new_shift_name: string | null;
  leave: string | null;
  new_leave_name: string | null;
  salary: string | null;
  new_structure_name: string | null;
  hierarch: string | null;
  new_manager_name: string | null;
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
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [statusTab, setStatusTab] = useState('N');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewRow, setViewRow] = useState<PromotionRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ emp_fkey: '' });

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setForm({ emp_fkey: '' });
  }

  function openCreate() {
    setEditingId(null);
    setForm({ emp_fkey: '' });
    setShowModal(true);
  }

  function openEdit(row: PromotionRow) {
    setEditingId(row.promotion_pkey);
    setForm({
      emp_fkey: String(row.emp_fkey),
      _emp_name: `${row.first_name} ${row.last_name ?? ''} (${row.emp_id})`.trim(),
      designation: row.designation ?? '',
      emp_dept: row.emp_dept ?? '',
      emp_branch: row.emp_branch ?? '',
      emp_type: row.emp_type ?? '',
      shift: row.shift ?? '',
      leave: row.leave ?? '',
      salary: row.salary ?? '',
      annual_gross: row.annual_gross ?? '',
      hierarch: row.hierarch ?? '',
      remarks: row.remarks ?? '',
    });
    setShowModal(true);
  }

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
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { ...form, promotion_pkey: editingId } : form),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to submit request');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      closeModal();
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
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Promotion Approval
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Request and approve employee promotions
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={openCreate}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> Request Promotion
        </button>
      </div>

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-4">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setStatusTab(t.value)}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                statusTab === t.value
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-[12.5px] text-slate-400">Loading…</p>}
      {!isLoading && data.length === 0 && <p className="text-[12.5px] text-slate-400">No requests here.</p>}

      <div className="space-y-3">
        {data.map((row) => (
          <div key={row.promotion_pkey} className="surface-card rounded-2xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium text-[#0F172A]">
                  {row.first_name} {row.last_name ?? ''} <span className="text-slate-400 text-[11px] font-normal">({row.emp_id})</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Requested {formatDate(row.created_date)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewRow(row)}
                  className={cn(BTN_BASE, 'bg-slate-100 hover:bg-slate-200 text-slate-600 shadow-none')}
                >
                  <Eye className="w-3.5 h-3.5" /> View
                </button>
                {row.approved_status === 'N' && (
                  <>
                    <button
                      onClick={() => openEdit(row)}
                      className={cn(BTN_BASE, 'bg-slate-100 hover:bg-slate-200 text-slate-600 shadow-none')}
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => decide.mutate({ promotion_pkey: row.promotion_pkey, action: 'approve' })}
                      disabled={decide.isPending}
                      className={cn(BTN_BASE, 'bg-[color:var(--color-success-soft)] hover:opacity-80 text-[color:var(--color-success-dark)] shadow-none')}
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => decide.mutate({ promotion_pkey: row.promotion_pkey, action: 'reject' })}
                      disabled={decide.isPending}
                      className={cn(BTN_BASE, 'bg-[color:var(--color-danger-soft)] hover:opacity-80 text-[color:var(--color-danger-dark)] shadow-none')}
                    >
                      <Ban className="w-3.5 h-3.5" /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-[12.5px]">
              {row.new_desig_name && (
                <div>
                  <p className="text-[11px] text-slate-400">Designation</p>
                  <p className="text-[#0F172A]">{row.current_desig_name ?? '—'} → {row.new_desig_name}</p>
                </div>
              )}
              {row.new_dept_name && (
                <div>
                  <p className="text-[11px] text-slate-400">Department</p>
                  <p className="text-[#0F172A]">{row.current_dept_name ?? '—'} → {row.new_dept_name}</p>
                </div>
              )}
              {row.new_branch_name && (
                <div>
                  <p className="text-[11px] text-slate-400">Branch</p>
                  <p className="text-[#0F172A]">{row.new_branch_name}</p>
                </div>
              )}
              {row.annual_gross && (
                <div>
                  <p className="text-[11px] text-slate-400">New Annual CTC</p>
                  <p className="text-[#0F172A]">{row.annual_gross}</p>
                </div>
              )}
            </div>
            {row.remarks && <p className="text-[11.5px] text-slate-500 mt-2">{row.remarks}</p>}
          </div>
        ))}
      </div>

      {decide.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mt-3">{String(decide.error)}</p>}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={closeModal}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{editingId ? 'Edit Promotion Request' : 'Request Promotion'}</h2>
              <button onClick={closeModal} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employee <span className="text-[color:var(--color-danger)]">*</span></label>
                {editingId ? (
                  <div className={cn(INPUT_CLASS, 'w-full bg-slate-50 text-slate-500')}>{form._emp_name}</div>
                ) : (
                  <EmployeeSearch value={form.emp_fkey} onChange={(v) => setForm((f) => ({ ...f, emp_fkey: v }))} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Designation</label>
                  <select className={cn(INPUT_CLASS, 'w-full')} {...f('designation')}>
                    <option value="">No change</option>
                    {designations.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Department</label>
                  <select className={cn(INPUT_CLASS, 'w-full')} {...f('emp_dept')}>
                    <option value="">No change</option>
                    {departments.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Branch</label>
                  <select className={cn(INPUT_CLASS, 'w-full')} {...f('emp_branch')}>
                    <option value="">No change</option>
                    {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employment Type</label>
                  <select className={cn(INPUT_CLASS, 'w-full')} {...f('emp_type')}>
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
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Shift</label>
                  <select className={cn(INPUT_CLASS, 'w-full')} {...f('shift')}>
                    <option value="">No change</option>
                    {shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Leave Policy</label>
                  <select className={cn(INPUT_CLASS, 'w-full')} {...f('leave')}>
                    <option value="">No change</option>
                    {leavePolicies.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Salary Structure</label>
                <select className={cn(INPUT_CLASS, 'w-full')} {...f('salary')}>
                  <option value="">No change</option>
                  {structures.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Annual CTC</label>
                <input type="number" className={cn(INPUT_CLASS, 'w-full')} {...f('annual_gross')} />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New Reporting Manager</label>
                <EmployeeSearch value={form.hierarch ?? ''} onChange={(v) => setForm((f) => ({ ...f, hierarch: v }))} />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Remarks</label>
                <textarea className={cn(INPUT_CLASS, 'w-full')} rows={2} {...f('remarks')} />
              </div>

              {create.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(create.error)}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!form.emp_fkey || create.isPending}
                  className={cn(
                    'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                    !form.emp_fkey || create.isPending
                      ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                      : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
                  )}
                >
                  {create.isPending ? 'Saving…' : editingId ? 'Save Changes' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setViewRow(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Promotion Request</h2>
              <button onClick={() => setViewRow(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="space-y-3 text-[12.5px]">
              <div>
                <p className="text-[11px] text-slate-400">Employee</p>
                <p className="text-[#0F172A]">{viewRow.first_name} {viewRow.last_name ?? ''} ({viewRow.emp_id})</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] text-slate-400">Requested</p>
                  <p className="text-[#0F172A]">{formatDate(viewRow.created_date)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400">Status</p>
                  <p className="text-[#0F172A]">{viewRow.promotion_status}{viewRow.approved_date ? ` · ${formatDate(viewRow.approved_date)}` : ''}</p>
                </div>
              </div>

              {[
                ['Designation', viewRow.new_desig_name, `${viewRow.current_desig_name ?? '—'} → ${viewRow.new_desig_name ?? ''}`],
                ['Department', viewRow.new_dept_name, `${viewRow.current_dept_name ?? '—'} → ${viewRow.new_dept_name ?? ''}`],
                ['Branch', viewRow.new_branch_name, viewRow.new_branch_name],
                ['Employment Type', viewRow.emp_type, viewRow.emp_type],
                ['Shift', viewRow.new_shift_name, viewRow.new_shift_name],
                ['Leave Policy', viewRow.new_leave_name, viewRow.new_leave_name],
                ['Salary Structure', viewRow.new_structure_name, viewRow.new_structure_name],
                ['New Annual CTC', viewRow.annual_gross, viewRow.annual_gross],
                ['New Reporting Manager', viewRow.new_manager_name, viewRow.new_manager_name],
              ].filter(([, present]) => present).map(([label, , value]) => (
                <div key={label as string}>
                  <p className="text-[11px] text-slate-400">{label}</p>
                  <p className="text-[#0F172A]">{value}</p>
                </div>
              ))}

              {viewRow.remarks && (
                <div>
                  <p className="text-[11px] text-slate-400">Remarks</p>
                  <p className="text-slate-600">{viewRow.remarks}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
