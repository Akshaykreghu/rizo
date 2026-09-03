'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Ban, Search, Pencil, FileText } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { DataTable } from '@/components/data-table/DataTable';
import { cn, formatDate } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import type { ColumnDef } from '@tanstack/react-table';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors w-full';

const LABEL_CLASS = 'block text-[12px] font-medium text-slate-600 mb-1.5';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

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
  Applied: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
  'HR Reviewed': 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
  Approved: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  Completed: 'bg-slate-100 text-slate-600',
  Cancelled: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface ResignationsPageProps {
  /** When set, the page runs scoped to this one employee: no header title, no filters, employee locked. */
  embeddedEmpPkey?: number;
  embeddedEmpName?: string;
}

export default function ResignationsPage({ embeddedEmpPkey, embeddedEmpName }: ResignationsPageProps = {}) {
  const embedded = embeddedEmpPkey != null;
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newForm, setNewForm] = useState<Record<string, string>>(
    embeddedEmpPkey != null ? { emp_fkey: String(embeddedEmpPkey) } : { emp_fkey: '' }
  );
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
    queryKey: ['resignations', statusFilter, search, embeddedEmpPkey ?? null],
    queryFn: () =>
      fetch(
        `/api/resignations?status=${encodeURIComponent(statusFilter)}&search=${encodeURIComponent(search)}${embedded ? `&emp_fkey=${embeddedEmpPkey}` : ''}`
      ).then((r) => r.json()),
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
      setNewForm({ emp_fkey: embedded ? String(embeddedEmpPkey) : '' });
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
          <span className="font-medium text-[#0F172A]">{row.original.first_name} {row.original.last_name ?? ''}</span>
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
        return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[s] ?? 'bg-slate-100 text-slate-600'}`}>{s}</span>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const status = row.original.Resignation_status;
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {status === 'Applied' && (
              <button
                onClick={() => setChecklistFor(row.original.Resignation_pkey)}
                className="text-[11.5px] font-medium text-[color:var(--color-primary)] bg-[color:var(--color-primary-light)] hover:opacity-80 px-2.5 py-1 rounded-lg transition-colors"
              >
                Checklist
              </button>
            )}
            {(status === 'Applied' || status === 'HR Reviewed') && (
              <button
                onClick={() => checkEligibility.mutate(row.original.Resignation_pkey)}
                disabled={checkEligibility.isPending}
                className="text-[11.5px] font-medium text-[color:var(--color-success-dark)] bg-[color:var(--color-success-soft)] hover:opacity-80 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
              >
                Process Full &amp; Final
              </button>
            )}
            {status === 'Approved' && (
              <button
                onClick={() => setFinalizeFor(row.original.Resignation_pkey)}
                className="text-[11.5px] font-medium text-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] hover:opacity-80 px-2.5 py-1 rounded-lg transition-colors"
              >
                Finalize
              </button>
            )}
            {status !== 'Completed' && (
              <button
                onClick={() => openEdit(row.original)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {status === 'Completed' && (
              <a
                href={`/employees/resignations/${row.original.Resignation_pkey}/slip`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150 inline-flex"
                title="View Slip"
              >
                <FileText className="w-3.5 h-3.5" />
              </a>
            )}
            {status !== 'Completed' && status !== 'Cancelled' && (
              <button
                onClick={() => { if (confirm('Withdraw this resignation?')) withdraw.mutate(row.original.Resignation_pkey); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
                title="Withdraw"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      {!embedded && slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Remove Employee
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Resignations, exit checklist, full &amp; final settlement, and finalization
            </p>
          </div>,
          slotEl
        )}

      {embedded && (
        <h2 className="font-heading text-[20px] font-bold text-[#0F172A] tracking-tight mb-4">Remove Employee</h2>
      )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setShowNew(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New Resignation
        </button>
      </div>

      {!embedded && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearch} className="flex gap-2 max-w-sm flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, ID, or reason"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={cn(INPUT_CLASS, 'pl-8')}
              />
            </div>
            <button type="submit" className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
              Search
            </button>
          </form>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={cn(INPUT_CLASS, 'w-auto min-w-[160px]')}
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      <DataTable data={data} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />

      {showNew && (
        <Modal title={editingId ? 'Edit Resignation' : 'New Resignation'} onClose={() => { setShowNew(false); setEditingId(null); }}>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
            <div>
              <label className={LABEL_CLASS}>Employee <span className="text-[color:var(--color-danger)]">*</span></label>
              {editingId || embedded ? (
                <p className="text-[13px] text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
                  {selectedEmp?.employee
                    ? `${selectedEmp.employee.first_name} ${selectedEmp.employee.last_name ?? ''}`
                    : embeddedEmpName ?? '…'}
                </p>
              ) : (
                <EmployeeSearch value={newForm.emp_fkey} onChange={(v) => setNewForm((f) => ({ ...f, emp_fkey: v }))} />
              )}
            </div>
            <div>
              <label className={LABEL_CLASS}>Authorised To (Manager) <span className="text-[color:var(--color-danger)]">*</span></label>
              <EmployeeSearch value={newForm.authorised_to ?? ''} onChange={(v) => setNewForm((f) => ({ ...f, authorised_to: v }))} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Reason <span className="text-[color:var(--color-danger)]">*</span></label>
              <select required className={INPUT_CLASS} value={newForm.reason ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, reason: e.target.value }))}>
                <option value="">Select</option>
                {REASON_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Reason Description</label>
              <textarea className={INPUT_CLASS} rows={2} value={newForm.reason_desc ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, reason_desc: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Comments to Manager</label>
              <textarea className={INPUT_CLASS} rows={2} value={newForm.comments_to_manager ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, comments_to_manager: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL_CLASS}>
                Last Working Day <span className="text-[color:var(--color-danger)]">*</span>
                {noticeDays != null && (
                  <span className="text-gray-400 font-normal ml-1">
                    (auto-suggested from {noticeDays}-day notice — editable)
                  </span>
                )}
              </label>
              <input
                required
                type="date"
                className={INPUT_CLASS}
                value={newForm.last_workingday ?? ''}
                onChange={(e) => { setLastWorkingDayTouched(true); setNewForm((f) => ({ ...f, last_workingday: e.target.value })); }}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Contact Number</label>
              <input className={INPUT_CLASS} value={newForm.contact_no ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, contact_no: e.target.value }))} />
            </div>
            {create.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(create.error)}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setShowNew(false); setEditingId(null); }} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">Cancel</button>
              <button type="submit" disabled={!newForm.emp_fkey || create.isPending} className={cn(BTN_BASE, 'px-4 py-2.5 rounded-xl text-sm bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
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
              <label className={LABEL_CLASS}>Handover To <span className="text-[color:var(--color-danger)]">*</span></label>
              <EmployeeSearch value={checklistForm.handover_to ?? ''} onChange={(v) => setChecklistForm((f) => ({ ...f, handover_to: v }))} />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={checklistForm.chek_formalities === '1'} onChange={(e) => setChecklistForm((f) => ({ ...f, chek_formalities: e.target.checked ? '1' : '0' }))} className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40" />
              Exit formalities completed
            </label>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={checklistForm.chek_assets === '1'} onChange={(e) => setChecklistForm((f) => ({ ...f, chek_assets: e.target.checked ? '1' : '0' }))} className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40" />
              Assets returned
            </label>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={checklistForm.chek_leave === '1'} onChange={(e) => setChecklistForm((f) => ({ ...f, chek_leave: e.target.checked ? '1' : '0' }))} className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40" />
              Leave balance reviewed
            </label>
            <div>
              <label className={LABEL_CLASS}>HR Comment</label>
              <textarea className={INPUT_CLASS} rows={2} value={checklistForm.hr_comment ?? ''} onChange={(e) => setChecklistForm((f) => ({ ...f, hr_comment: e.target.value }))} />
            </div>
            {checklist.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(checklist.error)}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setChecklistFor(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">Cancel</button>
              <button type="submit" disabled={!checklistForm.handover_to || checklist.isPending} className={cn(BTN_BASE, 'px-4 py-2.5 rounded-xl text-sm bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
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
              <li key={i} className="text-[13px] text-[color:var(--color-danger-dark)] bg-[color:var(--color-danger-soft)] rounded-lg px-3 py-2">{b}</li>
            ))}
          </ul>
          <div className="flex justify-end pt-4">
            <button onClick={() => setBlockers(null)} className={cn(BTN_BASE, 'px-4 py-2.5 rounded-xl text-sm bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {approveFor !== null && previewData && (
        <Modal title="Process Full & Final" onClose={() => { setApproveFor(null); setPreviewData(null); }}>
          <div className="space-y-4 mb-5">
            <p className="text-[13px] font-medium text-[#0F172A]">
              {previewData.employee.first_name} {previewData.employee.last_name ?? ''}
            </p>

            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">Resignation Details</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Resignation Submitted Date</p>
                  <p className="font-medium text-[#0F172A]">{formatDate(previewData.resignationDetails.submittedDate)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Notice Period</p>
                  <p className="font-medium text-[#0F172A]">{previewData.resignationDetails.noticePeriod}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Last Working Date (as per Notice)</p>
                  <p className="font-medium text-[#0F172A]">{formatDate(previewData.resignationDetails.lastWorkingDate)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Approved Last Working Date</p>
                  <p className="font-medium text-[#0F172A]">{formatDate(previewData.resignationDetails.approvedLastWorkingDate)}</p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">Notice Period Adjustments</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Resignation Period Working Days</p>
                  <p className="font-medium text-[#0F172A]">{previewData.noticePeriodAdjustments.resignationPeriodWorkingDays}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Resignation Period Present Days</p>
                  <p className="font-medium text-[#0F172A]">{previewData.noticePeriodAdjustments.resignationPeriodPresentDays}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Balance Working Days</p>
                  <p className="font-medium text-[#0F172A]">{previewData.noticePeriodAdjustments.balanceWorkingDays}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400">Encashable Leave Balance</p>
                  <p className="font-medium text-[#0F172A]">{previewData.noticePeriodAdjustments.encashableLeaveBalance}</p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">Loans, Advances, Expenses and Assets Adjustments</p>
              {previewData.loans.length === 0 && previewData.assets.length === 0 && (
                <p className="text-[11px] text-slate-400">No loans or damaged assets found for this employee.</p>
              )}
              {previewData.loans.map((l) => (
                <div key={l.emp_loan_pkey} className="flex justify-between text-[11.5px] text-slate-500">
                  <span>Loan #{l.emp_loan_pkey} — Amount {l.loan_amount}</span>
                  <span>Balance {l.closing_balance ?? l.opening_balance ?? '—'}</span>
                </div>
              ))}
              {previewData.assets.map((a) => (
                <div key={a.allocate_pkey} className="flex justify-between text-[11.5px] text-slate-500">
                  <span>{a.asset_name ?? a.catalog_name ?? 'Asset'}</span>
                  <span>{a.damaged_amout}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11.5px] text-slate-500 mb-4 border-t border-slate-200 pt-4">
            Clicking below calls the real Full &amp; Final settlement procedure. Since Attendance isn&apos;t built in this app yet,
            it will likely report &quot;Attendance not verified&quot; until that exists — that&apos;s expected, not a bug.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); approve.mutate(); }} className="space-y-4">
            <div>
              <label className={LABEL_CLASS}>Settlement Month (yyyy-mm) <span className="text-[color:var(--color-danger)]">*</span></label>
              <input required placeholder="2026-07" className={INPUT_CLASS} value={approveForm.month_year ?? ''} onChange={(e) => setApproveForm((f) => ({ ...f, month_year: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Present Days</label>
              <input type="number" className={INPUT_CLASS} value={approveForm.presant_days ?? ''} onChange={(e) => setApproveForm((f) => ({ ...f, presant_days: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Leave Encashment Days</label>
              <input type="number" className={INPUT_CLASS} value={approveForm.encash_days ?? ''} onChange={(e) => setApproveForm((f) => ({ ...f, encash_days: e.target.value }))} />
            </div>
            {approve.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(approve.error)}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setApproveFor(null); setPreviewData(null); }} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">Cancel</button>
              <button type="submit" disabled={!approveForm.month_year || approve.isPending} className={cn(BTN_BASE, 'px-4 py-2.5 rounded-xl text-sm bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
                {approve.isPending ? 'Processing…' : 'Process Full & Final'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {settlementResult !== null && (
        <Modal title="Full & Final Settlement Summary" onClose={() => setSettlementResult(null)}>
          <div className="space-y-4">
            <p className="text-[13px] font-medium text-[#0F172A]">
              {settlementResult.settlement.employee.first_name} {settlementResult.settlement.employee.last_name ?? ''}
            </p>
            {settlementResult.settlementMessage && (
              <p className="text-[11.5px] text-[color:var(--color-highlight-dark)] bg-[color:var(--color-highlight-light)] rounded-lg px-3 py-2">{settlementResult.settlementMessage}</p>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Resignation Period Working Days</p>
                <p className="font-medium text-[#0F172A]">{settlementResult.settlement.resignationPeriodWorkingDays}</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Resignation Period Present Days</p>
                <p className="font-medium text-[#0F172A]">{settlementResult.settlement.resignationPeriodPresentDays}</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Balance Working Days</p>
                <p className="font-medium text-[#0F172A]">{settlementResult.settlement.balanceWorkingDays}</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-400">Encashable Leave Balance</p>
                <p className="font-medium text-[#0F172A]">{settlementResult.settlement.encashableLeaveBalance}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-1">Additions</p>
                <div className="space-y-1">
                  {settlementResult.settlement.additions.length === 0 && <p className="text-[11px] text-slate-400">None</p>}
                  {settlementResult.settlement.additions.map((l, i) => (
                    <div key={i} className="flex justify-between text-[11.5px]">
                      <span className="text-slate-500">{l.salary_head_item_desc}</span>
                      <span className="text-[#0F172A]">{Number(l.salary_amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-1">Deductions</p>
                <div className="space-y-1">
                  {settlementResult.settlement.deductions.length === 0 && <p className="text-[11px] text-slate-400">None</p>}
                  {settlementResult.settlement.deductions.map((l, i) => (
                    <div key={i} className="flex justify-between text-[11.5px]">
                      <span className="text-slate-500">{l.salary_head_item_desc}</span>
                      <span className="text-[#0F172A]">{Number(l.salary_amount).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-[11.5px] pt-1 border-t border-slate-200">
                    <span className="text-slate-500">Notice Pay (shortfall, informational)</span>
                    <span className="text-[#0F172A]">{settlementResult.settlement.noticePay.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between text-[13px] font-semibold border-t border-slate-200 pt-2 text-[#0F172A]">
              <span>Net Salary</span>
              <span>{settlementResult.settlement.netSalary.toFixed(2)}</span>
            </div>

            {settlementResult.loans.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-1">Loans (reference only, not netted)</p>
                {settlementResult.loans.map((l) => (
                  <div key={l.emp_loan_pkey} className="flex justify-between text-[11.5px] text-slate-500">
                    <span>Loan #{l.emp_loan_pkey} — Amount {l.loan_amount}</span>
                    <span>Balance {l.closing_balance ?? l.opening_balance ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {settlementResult.assets.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-1">Damaged Assets (reference only, not netted)</p>
                {settlementResult.assets.map((a) => (
                  <div key={a.allocate_pkey} className="flex justify-between text-[11.5px] text-slate-500">
                    <span>{a.asset_name ?? a.catalog_name ?? 'Asset'}</span>
                    <span>{a.damaged_amout}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end pt-4">
            <button onClick={() => setSettlementResult(null)} className={cn(BTN_BASE, 'px-4 py-2.5 rounded-xl text-sm bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {finalizeFor !== null && (
        <Modal title="Finalize Removal" onClose={() => setFinalizeFor(null)}>
          <p className="text-[11.5px] text-slate-500 mb-4">
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
                <label className={LABEL_CLASS}>{label}</label>
                <input type="number" className={INPUT_CLASS} value={finalizeForm[key] ?? ''} onChange={(e) => setFinalizeForm((f) => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            {finalize.isError && <p className="text-red-500 text-sm col-span-2">{String(finalize.error)}</p>}
            <div className="col-span-2 flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setFinalizeFor(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">Cancel</button>
              <button type="submit" disabled={finalize.isPending} className={cn(BTN_BASE, 'px-4 py-2.5 rounded-xl text-sm bg-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-dark)] text-white')}>
                {finalize.isPending ? 'Finalizing…' : 'Finalize Removal'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
