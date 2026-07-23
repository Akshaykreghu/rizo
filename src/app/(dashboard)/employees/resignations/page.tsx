'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Ban, Search, Pencil, FileText } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { DataTable } from '@/components/data-table/DataTable';
import { formatDate } from '@/lib/utils';
import type { ColumnDef } from '@tanstack/react-table';

interface ResignationRow {
  Resignation_pkey: number;
  emp_fkey: number;
  authorised_to: number | null;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  branch_name: string | null;
  applied_date: string;
  Reason: string;
  Reason_Desc: string | null;
  Comments_to_manager: string | null;
  Last_workingday: string;
  contact_no: string | null;
  Resignation_status: string;
  last_approved_working_date: string | null;
  remarks: string | null;
  is_authorized: string | null;
  is_approved: string | null;
}

const STATUS_OPTIONS = ['Applied', 'HR Reviewed', 'Approved', 'Completed', 'Cancelled'];

interface SettlementLine {
  salary_head_item_desc: string;
  salary_amount: number;
  type: string;
}
interface LoanRef { emp_loan_pkey: number; loan_amount: number; opening_balance: number | null; closing_balance: number | null }
interface AssetRef { allocate_pkey: number; asset_name: string | null; catalog_name: string | null; damaged_amout: string | number }

interface SettlementResult {
  settlementMessage: string | null;
  settlement: {
    employee: { first_name: string; last_name: string | null };
    additions: SettlementLine[];
    deductions: SettlementLine[];
    netSalary: number;
    noticePay: number;
    encashableLeaveBalance: number;
    resignationPeriodWorkingDays: number;
    resignationPeriodPresentDays: number;
    balanceWorkingDays: number;
  };
  loans: LoanRef[];
  assets: AssetRef[];
}

interface PreviewResult {
  employee: { first_name: string; last_name: string | null };
  resignationDetails: {
    submittedDate: string;
    noticePeriod: number;
    lastWorkingDate: string;
    approvedLastWorkingDate: string;
  };
  noticePeriodAdjustments: {
    resignationPeriodWorkingDays: number;
    resignationPeriodPresentDays: number;
    balanceWorkingDays: number;
    encashableLeaveBalance: number;
  };
  loans: LoanRef[];
  assets: AssetRef[];
}

// Matches legacy's full 19-option Reason For Leaving list (legacy/View/EmployeeResignation/form.ctp) —
// covers non-voluntary exits (Termination, Dismissed, Absconding, Death, Retirement, etc.), not just
// resignation-style reasons.
const REASON_OPTIONS = [
  'Resignation',
  'Absconding',
  'Dismissed',
  'Retirement',
  'Retrenchment',
  'Permanent Disabilities',
  'End of Contract',
  'Death Away From Service',
  'Death In Service',
  'Personal',
  'Relocation',
  'Cessation (Short Service) - Any Other',
  'Cessation (Short Service) - Other Cause',
  'Cessation (Short Service) - The Contraction',
  'Cessation (Short Service) - The Employee Ill',
  'Superannuation',
  'Left Service',
  'Termination',
  'Other',
];

const STATUS_COLORS: Record<string, string> = {
  Applied: 'bg-amber-50 text-amber-700',
  'HR Reviewed': 'bg-blue-50 text-blue-700',
  Approved: 'bg-emerald-50 text-emerald-700',
  Completed: 'bg-gray-100 text-gray-600',
  Cancelled: 'bg-red-50 text-red-700',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ResignationsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newForm, setNewForm] = useState<Record<string, string>>({ emp_fkey: '' });
  const [lastWorkingDayTouched, setLastWorkingDayTouched] = useState(false);
  const [checklistFor, setChecklistFor] = useState<number | null>(null);
  const [checklistForm, setChecklistForm] = useState<Record<string, string>>({});
  const [approveFor, setApproveFor] = useState<number | null>(null);
  const [approveForm, setApproveForm] = useState<Record<string, string>>({});
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [finalizeFor, setFinalizeFor] = useState<number | null>(null);
  const [finalizeForm, setFinalizeForm] = useState<Record<string, string>>({});

  const { data = [], isLoading } = useQuery<ResignationRow[]>({
    queryKey: ['resignations', statusFilter, search],
    queryFn: () =>
      fetch(`/api/resignations?status=${encodeURIComponent(statusFilter)}&search=${encodeURIComponent(search)}`).then((r) => r.json()),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['resignations'] });

  const { data: selectedEmp } = useQuery({
    queryKey: ['employees', newForm.emp_fkey],
    queryFn: () => fetch(`/api/employees/${newForm.emp_fkey}`).then((r) => r.json()),
    enabled: !!newForm.emp_fkey,
  });
  const noticeDays: number | null = selectedEmp?.professional?.notice_days ?? null;

  // Matches legacy's asper_notice() (form.ctp): last working date = today + (notice_days - 1)
  // calendar days, auto-suggested but always editable — same auto-fill-then-override pattern.
  useEffect(() => {
    if (noticeDays == null || lastWorkingDayTouched) return;
    const d = new Date();
    d.setDate(d.getDate() + Math.max(noticeDays - 1, 0));
    setNewForm((f) => ({ ...f, last_workingday: d.toISOString().slice(0, 10) }));
  }, [noticeDays, lastWorkingDayTouched]);

  const create = useMutation({
    mutationFn: () => fetch(editingId ? `/api/resignations/${editingId}` : '/api/resignations', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newForm),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to submit');
    }),
    onSuccess: () => {
      invalidate();
      setShowNew(false);
      setEditingId(null);
      setNewForm({ emp_fkey: '' });
      setLastWorkingDayTouched(false);
    },
  });

  function openEdit(row: ResignationRow) {
    setEditingId(row.Resignation_pkey);
    setNewForm({
      emp_fkey: String(row.emp_fkey),
      authorised_to: row.authorised_to != null ? String(row.authorised_to) : '',
      reason: row.Reason,
      reason_desc: row.Reason_Desc ?? '',
      comments_to_manager: row.Comments_to_manager ?? '',
      last_workingday: row.Last_workingday?.slice(0, 10) ?? '',
      contact_no: row.contact_no ?? '',
    });
    setLastWorkingDayTouched(true);
    setShowNew(true);
  }

  const checklist = useMutation({
    mutationFn: () => fetch(`/api/resignations/${checklistFor}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checklistForm),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save checklist');
    }),
    onSuccess: () => { invalidate(); setChecklistFor(null); setChecklistForm({}); },
  });

  const checkEligibility = useMutation({
    mutationFn: async (pkey: number) => {
      const eligRes = await fetch(`/api/resignations/${pkey}/eligibility`);
      const elig = await eligRes.json();
      if (!eligRes.ok || !elig.ok) {
        const blockers = Array.isArray(elig?.blockers) ? elig.blockers : [elig?.error ?? 'Could not check eligibility.'];
        return { ok: false as const, blockers };
      }
      const previewRes = await fetch(`/api/resignations/${pkey}/preview`);
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        return { ok: false as const, blockers: [preview?.error ?? 'Could not load preview.'] };
      }
      return { ok: true as const, preview: preview as PreviewResult };
    },
    onSuccess: (data, pkey) => {
      if (data.ok) { setApproveFor(pkey); setPreviewData(data.preview); }
      else setBlockers(data.blockers);
    },
  });

  const approve = useMutation({
    mutationFn: () => fetch(`/api/resignations/${approveFor}/approve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(approveForm),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to approve');
      return res.json();
    }),
    onSuccess: (data: SettlementResult) => {
      invalidate();
      setApproveFor(null);
      setApproveForm({});
      setPreviewData(null);
      setSettlementResult(data);
    },
  });

  const finalize = useMutation({
    mutationFn: () => fetch(`/api/resignations/${finalizeFor}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalizeForm),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to finalize');
    }),
    onSuccess: () => { invalidate(); setFinalizeFor(null); setFinalizeForm({}); },
  });

  const withdraw = useMutation({
    mutationFn: (pkey: number) => fetch(`/api/resignations/${pkey}/withdraw`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  const columns: ColumnDef<ResignationRow, unknown>[] = [
    {
      id: 'name',
      header: 'Full Name',
      accessorFn: (row) => `${row.first_name} ${row.last_name ?? ''}`,
      cell: ({ row }) => (
        <div>
          <span className="font-medium text-gray-900">{row.original.first_name} {row.original.last_name ?? ''}</span>
          <span className="text-gray-400 text-xs ml-1">({row.original.emp_id})</span>
        </div>
      ),
    },
    { accessorKey: 'branch_name', header: 'Branch', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'Reason', header: 'Reason' },
    {
      accessorKey: 'applied_date',
      header: 'Resignation Submitted',
      cell: ({ getValue }) => formatDate(String(getValue() ?? '')),
    },
    {
      accessorKey: 'Last_workingday',
      header: 'Last Applied Date',
      cell: ({ getValue }) => formatDate(String(getValue() ?? '')),
    },
    {
      accessorKey: 'last_approved_working_date',
      header: 'Last Approved',
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? formatDate(v) : '—';
      },
    },
    { accessorKey: 'remarks', header: 'Remarks', cell: ({ getValue }) => (getValue() as string) || '—' },
    {
      accessorKey: 'Resignation_status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as string;
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-600'}`}>{s}</span>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const status = row.original.Resignation_status;
        return (
          <div className="flex items-center gap-2">
            {status === 'Applied' && (
              <button
                onClick={() => setChecklistFor(row.original.Resignation_pkey)}
                className="text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors"
              >
                Checklist
              </button>
            )}
            {(status === 'Applied' || status === 'HR Reviewed') && (
              <button
                onClick={() => checkEligibility.mutate(row.original.Resignation_pkey)}
                disabled={checkEligibility.isPending}
                className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
              >
                Process Full &amp; Final
              </button>
            )}
            {status === 'Approved' && (
              <button
                onClick={() => setFinalizeFor(row.original.Resignation_pkey)}
                className="text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg transition-colors"
              >
                Finalize
              </button>
            )}
            {status !== 'Completed' && (
              <button
                onClick={() => openEdit(row.original)}
                className="text-gray-400 hover:text-indigo-600"
                title="Edit"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {status === 'Completed' && (
              <a
                href={`/employees/resignations/${row.original.Resignation_pkey}/slip`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-indigo-600"
                title="View Slip"
              >
                <FileText className="w-4 h-4" />
              </a>
            )}
            {status !== 'Completed' && status !== 'Cancelled' && (
              <button
                onClick={() => { if (confirm('Withdraw this resignation?')) withdraw.mutate(row.original.Resignation_pkey); }}
                className="text-gray-400 hover:text-red-500"
                title="Withdraw"
              >
                <Ban className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Remove Employee</h1>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New Resignation
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="flex gap-2 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, ID, or reason"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button type="submit" className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition-colors">
            Search
          </button>
        </form>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <DataTable data={data} columns={columns} isLoading={isLoading} />

      {showNew && (
        <Modal title={editingId ? 'Edit Resignation' : 'New Resignation'} onClose={() => { setShowNew(false); setEditingId(null); }}>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
            <div>
              <label className="label">Employee <span className="text-red-500">*</span></label>
              {editingId ? (
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                  {selectedEmp?.employee ? `${selectedEmp.employee.first_name} ${selectedEmp.employee.last_name ?? ''}` : '…'}
                </p>
              ) : (
                <EmployeeSearch value={newForm.emp_fkey} onChange={(v) => setNewForm((f) => ({ ...f, emp_fkey: v }))} />
              )}
            </div>
            <div>
              <label className="label">Authorised To (Manager) <span className="text-red-500">*</span></label>
              <EmployeeSearch value={newForm.authorised_to ?? ''} onChange={(v) => setNewForm((f) => ({ ...f, authorised_to: v }))} />
            </div>
            <div>
              <label className="label">Reason <span className="text-red-500">*</span></label>
              <select required className="input" value={newForm.reason ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, reason: e.target.value }))}>
                <option value="">Select</option>
                {REASON_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Reason Description</label>
              <textarea className="input" rows={2} value={newForm.reason_desc ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, reason_desc: e.target.value }))} />
            </div>
            <div>
              <label className="label">Comments to Manager</label>
              <textarea className="input" rows={2} value={newForm.comments_to_manager ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, comments_to_manager: e.target.value }))} />
            </div>
            <div>
              <label className="label">
                Last Working Day <span className="text-red-500">*</span>
                {noticeDays != null && (
                  <span className="text-gray-400 font-normal ml-1">
                    (auto-suggested from {noticeDays}-day notice — editable)
                  </span>
                )}
              </label>
              <input
                required
                type="date"
                className="input"
                value={newForm.last_workingday ?? ''}
                onChange={(e) => { setLastWorkingDayTouched(true); setNewForm((f) => ({ ...f, last_workingday: e.target.value })); }}
              />
            </div>
            <div>
              <label className="label">Contact Number</label>
              <input className="input" value={newForm.contact_no ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, contact_no: e.target.value }))} />
            </div>
            {create.isError && <p className="text-red-500 text-sm">{String(create.error)}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setShowNew(false); setEditingId(null); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button type="submit" disabled={!newForm.emp_fkey || create.isPending} className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors">
                {create.isPending ? 'Saving…' : editingId ? 'Save Changes' : 'Submit'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {checklistFor !== null && (
        <Modal title="Handover Checklist" onClose={() => setChecklistFor(null)}>
          <form onSubmit={(e) => { e.preventDefault(); checklist.mutate(); }} className="space-y-4">
            <div>
              <label className="label">Handover To <span className="text-red-500">*</span></label>
              <EmployeeSearch value={checklistForm.handover_to ?? ''} onChange={(v) => setChecklistForm((f) => ({ ...f, handover_to: v }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={checklistForm.chek_formalities === '1'} onChange={(e) => setChecklistForm((f) => ({ ...f, chek_formalities: e.target.checked ? '1' : '0' }))} />
              Exit formalities completed
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={checklistForm.chek_assets === '1'} onChange={(e) => setChecklistForm((f) => ({ ...f, chek_assets: e.target.checked ? '1' : '0' }))} />
              Assets returned
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={checklistForm.chek_leave === '1'} onChange={(e) => setChecklistForm((f) => ({ ...f, chek_leave: e.target.checked ? '1' : '0' }))} />
              Leave balance reviewed
            </label>
            <div>
              <label className="label">HR Comment</label>
              <textarea className="input" rows={2} value={checklistForm.hr_comment ?? ''} onChange={(e) => setChecklistForm((f) => ({ ...f, hr_comment: e.target.value }))} />
            </div>
            {checklist.isError && <p className="text-red-500 text-sm">{String(checklist.error)}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setChecklistFor(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button type="submit" disabled={!checklistForm.handover_to || checklist.isPending} className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors">
                {checklist.isPending ? 'Saving…' : 'Save Checklist'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {blockers != null && (
        <Modal title="Cannot Process Full & Final" onClose={() => setBlockers(null)}>
          <ul className="space-y-2">
            {blockers.map((b, i) => (
              <li key={i} className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{b}</li>
            ))}
          </ul>
          <div className="flex justify-end pt-4">
            <button onClick={() => setBlockers(null)} className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors">
              Close
            </button>
          </div>
        </Modal>
      )}

      {approveFor !== null && previewData && (
        <Modal title="Process Full & Final" onClose={() => { setApproveFor(null); setPreviewData(null); }}>
          <div className="space-y-4 mb-5">
            <p className="text-sm font-medium text-gray-900">
              {previewData.employee.first_name} {previewData.employee.last_name ?? ''}
            </p>

            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Resignation Details</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Resignation Submitted Date</p>
                  <p className="font-medium text-gray-900">{formatDate(previewData.resignationDetails.submittedDate)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Notice Period</p>
                  <p className="font-medium text-gray-900">{previewData.resignationDetails.noticePeriod}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Last Working Date (as per Notice)</p>
                  <p className="font-medium text-gray-900">{formatDate(previewData.resignationDetails.lastWorkingDate)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Approved Last Working Date</p>
                  <p className="font-medium text-gray-900">{formatDate(previewData.resignationDetails.approvedLastWorkingDate)}</p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Notice Period Adjustments</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Resignation Period Working Days</p>
                  <p className="font-medium text-gray-900">{previewData.noticePeriodAdjustments.resignationPeriodWorkingDays}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Resignation Period Present Days</p>
                  <p className="font-medium text-gray-900">{previewData.noticePeriodAdjustments.resignationPeriodPresentDays}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Balance Working Days</p>
                  <p className="font-medium text-gray-900">{previewData.noticePeriodAdjustments.balanceWorkingDays}</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">Encashable Leave Balance</p>
                  <p className="font-medium text-gray-900">{previewData.noticePeriodAdjustments.encashableLeaveBalance}</p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Loans, Advances, Expenses and Assets Adjustments</p>
              {previewData.loans.length === 0 && previewData.assets.length === 0 && (
                <p className="text-xs text-gray-400">No loans or damaged assets found for this employee.</p>
              )}
              {previewData.loans.map((l) => (
                <div key={l.emp_loan_pkey} className="flex justify-between text-xs text-gray-600">
                  <span>Loan #{l.emp_loan_pkey} — Amount {l.loan_amount}</span>
                  <span>Balance {l.closing_balance ?? l.opening_balance ?? '—'}</span>
                </div>
              ))}
              {previewData.assets.map((a) => (
                <div key={a.allocate_pkey} className="flex justify-between text-xs text-gray-600">
                  <span>{a.asset_name ?? a.catalog_name ?? 'Asset'}</span>
                  <span>{a.damaged_amout}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-500 mb-4 border-t border-gray-200 pt-4">
            Clicking below calls the real Full &amp; Final settlement procedure. Since Attendance isn&apos;t built in this app yet,
            it will likely report &quot;Attendance not verified&quot; until that exists — that&apos;s expected, not a bug.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); approve.mutate(); }} className="space-y-4">
            <div>
              <label className="label">Settlement Month (yyyy-mm) <span className="text-red-500">*</span></label>
              <input required placeholder="2026-07" className="input" value={approveForm.month_year ?? ''} onChange={(e) => setApproveForm((f) => ({ ...f, month_year: e.target.value }))} />
            </div>
            <div>
              <label className="label">Present Days</label>
              <input type="number" className="input" value={approveForm.presant_days ?? ''} onChange={(e) => setApproveForm((f) => ({ ...f, presant_days: e.target.value }))} />
            </div>
            <div>
              <label className="label">Leave Encashment Days</label>
              <input type="number" className="input" value={approveForm.encash_days ?? ''} onChange={(e) => setApproveForm((f) => ({ ...f, encash_days: e.target.value }))} />
            </div>
            {approve.isError && <p className="text-red-500 text-sm">{String(approve.error)}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setApproveFor(null); setPreviewData(null); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button type="submit" disabled={!approveForm.month_year || approve.isPending} className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors">
                {approve.isPending ? 'Processing…' : 'Process Full & Final'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {settlementResult !== null && (
        <Modal title="Full & Final Settlement Summary" onClose={() => setSettlementResult(null)}>
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-900">
              {settlementResult.settlement.employee.first_name} {settlementResult.settlement.employee.last_name ?? ''}
            </p>
            {settlementResult.settlementMessage && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{settlementResult.settlementMessage}</p>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-gray-400">Resignation Period Working Days</p>
                <p className="font-medium text-gray-900">{settlementResult.settlement.resignationPeriodWorkingDays}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-gray-400">Resignation Period Present Days</p>
                <p className="font-medium text-gray-900">{settlementResult.settlement.resignationPeriodPresentDays}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-gray-400">Balance Working Days</p>
                <p className="font-medium text-gray-900">{settlementResult.settlement.balanceWorkingDays}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-gray-400">Encashable Leave Balance</p>
                <p className="font-medium text-gray-900">{settlementResult.settlement.encashableLeaveBalance}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Additions</p>
                <div className="space-y-1">
                  {settlementResult.settlement.additions.length === 0 && <p className="text-xs text-gray-400">None</p>}
                  {settlementResult.settlement.additions.map((l, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-gray-600">{l.salary_head_item_desc}</span>
                      <span className="text-gray-900">{Number(l.salary_amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Deductions</p>
                <div className="space-y-1">
                  {settlementResult.settlement.deductions.length === 0 && <p className="text-xs text-gray-400">None</p>}
                  {settlementResult.settlement.deductions.map((l, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-gray-600">{l.salary_head_item_desc}</span>
                      <span className="text-gray-900">{Number(l.salary_amount).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs pt-1 border-t border-gray-200">
                    <span className="text-gray-600">Notice Pay (shortfall, informational)</span>
                    <span className="text-gray-900">{settlementResult.settlement.noticePay.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between text-sm font-semibold border-t border-gray-200 pt-2">
              <span>Net Salary</span>
              <span>{settlementResult.settlement.netSalary.toFixed(2)}</span>
            </div>

            {settlementResult.loans.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Loans (reference only, not netted)</p>
                {settlementResult.loans.map((l) => (
                  <div key={l.emp_loan_pkey} className="flex justify-between text-xs text-gray-600">
                    <span>Loan #{l.emp_loan_pkey} — Amount {l.loan_amount}</span>
                    <span>Balance {l.closing_balance ?? l.opening_balance ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {settlementResult.assets.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Damaged Assets (reference only, not netted)</p>
                {settlementResult.assets.map((a) => (
                  <div key={a.allocate_pkey} className="flex justify-between text-xs text-gray-600">
                    <span>{a.asset_name ?? a.catalog_name ?? 'Asset'}</span>
                    <span>{a.damaged_amout}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end pt-4">
            <button onClick={() => setSettlementResult(null)} className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors">
              Close
            </button>
          </div>
        </Modal>
      )}

      {finalizeFor !== null && (
        <Modal title="Finalize Removal" onClose={() => setFinalizeFor(null)}>
          <p className="text-xs text-gray-500 mb-4">
            This is irreversible: it deactivates the employee, clears hierarchy references, and settles
            outstanding payroll/leave records. Enter final settlement figures below.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); finalize.mutate(); }} className="grid grid-cols-2 gap-3">
            {[
              ['working_days_settled', 'Working Days Settled'],
              ['leave_balance', 'Leave Balance'],
              ['approved_balance', 'Approved Balance'],
              ['days_attendance', 'Days Attendance'],
              ['encashed_days', 'Encashed Days'],
              ['payroll_days', 'Payroll Days'],
              ['amt_paid_by_empaddition', 'Amount Paid to Employee'],
              ['amt_paid_by_empdeduction', 'Amount Deducted'],
            ].map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input type="number" className="input" value={finalizeForm[key] ?? ''} onChange={(e) => setFinalizeForm((f) => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            {finalize.isError && <p className="text-red-500 text-sm col-span-2">{String(finalize.error)}</p>}
            <div className="col-span-2 flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setFinalizeFor(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button type="submit" disabled={finalize.isPending} className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-300 transition-colors">
                {finalize.isPending ? 'Finalizing…' : 'Finalize Removal'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <style jsx>{`
        .label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
        .input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px #6366f1; border-color: transparent; }
      `}</style>
    </div>
  );
}
