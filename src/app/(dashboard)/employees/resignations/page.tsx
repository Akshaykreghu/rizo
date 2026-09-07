'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Trash2, Search, Pencil, FileText, Info, CircleOff, Lock } from 'lucide-react';
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

// New / Edit Resignation form — slightly larger, more comfortable controls than the app default.
const FORM_LABEL = 'block text-[13px] font-medium text-slate-700 mb-1.5';
const FORM_INPUT = cn(INPUT_CLASS, 'h-10 px-3 text-[14px]');
const FORM_TEXTAREA = cn(INPUT_CLASS, 'px-3 py-2 text-[14px] resize-y');

interface ResignationRow {
  Resignation_pkey: number;
  emp_fkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  branch_name: string | null;
  applied_date: string;
  Reason: string;
  Reason_Desc: string | null;
  Last_workingday: string;
  Resignation_status: string;
  submitted_date: string | null;
  last_applied_date: string | null;
  last_working_date: string | null;
  last_approved_working_date: string | null;
  notice_period: number | null;
  remarks: string | null;
  is_authorized: string | null;
  is_approved: string | null;
}

interface SettlementLine {
  emp_settle_slip_pkey: number;
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
    additionsTotal: number;
    deductionsTotal: number;
    otherAdditions: SettlementLine[];
    otherDeductions: SettlementLine[];
    otherAdditionsTotal: number;
    otherDeductionsTotal: number;
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

interface BalanceRecoveryRow { account: string; status: string; amount: number; balance: number }
interface AllocatedAsset {
  allocate_pkey: number;
  name: string | null;
  type: string | null;
  serial_no: string | null;
  allocated_date: string | null;
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
  balanceRecovery: { rows: BalanceRecoveryRow[]; totalAmountBalance: number };
  allocatedAssets: AllocatedAsset[];
  leaveYearWarning: string | null;
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

function Modal({
  title,
  onClose,
  children,
  size = 'md',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'md' | 'lg' | 'form';
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-h-[90vh] overflow-y-auto animate-modal-in',
          size === 'lg' ? 'max-w-3xl' : size === 'form' ? 'max-w-2xl' : 'max-w-md'
        )}
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

const TODAY = () => new Date().toISOString().slice(0, 10);

export default function ResignationsPage({ embeddedEmpPkey, embeddedEmpName }: ResignationsPageProps = {}) {
  const embedded = embeddedEmpPkey != null;
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newForm, setNewForm] = useState<Record<string, string>>(
    embeddedEmpPkey != null
      ? { emp_fkey: String(embeddedEmpPkey), date_submitted: TODAY() }
      : { emp_fkey: '', date_submitted: TODAY() }
  );
  const [lastWorkingDayTouched, setLastWorkingDayTouched] = useState(false);
  const [appliedDateTouched, setAppliedDateTouched] = useState(false);
  const [lastApprovedTouched, setLastApprovedTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [checklistFor, setChecklistFor] = useState<number | null>(null);
  const [checklistForm, setChecklistForm] = useState<Record<string, string>>({});
  const [approveFor, setApproveFor] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);
  // Edited "Change Amount" values in the step-2 OTHERS block, keyed by emp_settle_slip_pkey.
  const [otherEdits, setOtherEdits] = useState<Record<number, string>>({});
  const [blockers, setBlockers] = useState<string[] | null>(null);

  const { data = [], isLoading } = useQuery<ResignationRow[]>({
    queryKey: ['resignations', search, embeddedEmpPkey ?? null],
    queryFn: () =>
      fetch(
        `/api/resignations?search=${encodeURIComponent(search)}${embedded ? `&emp_fkey=${embeddedEmpPkey}` : ''}`
      ).then((r) => r.json()),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['resignations'] });

  const { data: selectedEmp } = useQuery({
    queryKey: ['employees', newForm.emp_fkey],
    queryFn: () => fetch(`/api/employees/${newForm.emp_fkey}`).then((r) => r.json()),
    enabled: !!newForm.emp_fkey,
  });
  const noticeDays: number | null = selectedEmp?.professional?.notice_days ?? null;

  const editEmpName = (
    selectedEmp?.employee
      ? `${selectedEmp.employee.first_name} ${selectedEmp.employee.last_name ?? ''}`
      : embeddedEmpName ?? ''
  ).trim();

  // Matches legacy's asper_notice() (form.ctp): last working date = submitted date + (notice_days - 1)
  // calendar days, auto-suggested but always editable — same auto-fill-then-override pattern.
  useEffect(() => {
    if (noticeDays == null || lastWorkingDayTouched || !newForm.date_submitted) return;
    const d = new Date(newForm.date_submitted);
    d.setDate(d.getDate() + Math.max(noticeDays - 1, 0));
    setNewForm((f) => ({ ...f, last_workingday: d.toISOString().slice(0, 10) }));
  }, [noticeDays, lastWorkingDayTouched, newForm.date_submitted]);

  // Legacy auto-fills Last Applied Working Date = submitted date and Last Approved Working Date =
  // the notice-derived last working day, both overridable (form.ctp / details_res echo).
  useEffect(() => {
    if (appliedDateTouched || !newForm.date_submitted) return;
    setNewForm((f) => ({ ...f, applied_date: newForm.date_submitted }));
  }, [newForm.date_submitted, appliedDateTouched]);

  useEffect(() => {
    if (lastApprovedTouched || !newForm.last_workingday) return;
    setNewForm((f) => ({ ...f, last_approved_workingday: newForm.last_workingday }));
  }, [newForm.last_workingday, lastApprovedTouched]);

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
      closeForm();
    },
  });

  function closeForm() {
    setShowNew(false);
    setEditingId(null);
    setNewForm({ emp_fkey: embedded ? String(embeddedEmpPkey) : '', date_submitted: TODAY() });
    setLastWorkingDayTouched(false);
    setAppliedDateTouched(false);
    setLastApprovedTouched(false);
    setFormError(null);
  }

  // Legacy form.ctp: block if applied/approved dates precede the submitted date, then a confirm()
  // dialog ("Do You Want To Save The Form") before the actual save.
  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const submitted = newForm.date_submitted || '';
    const applied = newForm.applied_date || submitted;
    const approved = newForm.last_approved_workingday || newForm.last_workingday || '';
    if (submitted && applied && applied < submitted) {
      setFormError('Last Applied Working Date cannot be before the Resignation Submitted date.');
      return;
    }
    if (submitted && approved && approved < submitted) {
      setFormError('Last Approved Working Date cannot be before the Resignation Submitted date.');
      return;
    }
    if (!confirm(editingId ? 'Save changes to this resignation?' : 'Save this resignation?')) return;
    create.mutate();
  }

  function openEdit(row: ResignationRow) {
    setEditingId(row.Resignation_pkey);
    setNewForm({
      emp_fkey: String(row.emp_fkey),
      reason: row.Reason,
      reason_desc: row.Reason_Desc ?? '',
      date_submitted: (row.submitted_date ?? row.applied_date)?.slice(0, 10) ?? TODAY(),
      applied_date: (row.last_applied_date ?? row.submitted_date ?? row.applied_date)?.slice(0, 10) ?? '',
      last_workingday: (row.last_working_date ?? row.Last_workingday)?.slice(0, 10) ?? '',
      // Legacy resignation_requests rows with no companion termination row (pre-app data) have a
      // null approved date — fall back to the last working day so the field is never blank on Edit.
      last_approved_workingday: (row.last_approved_working_date ?? row.last_working_date ?? row.Last_workingday)?.slice(0, 10) ?? '',
      remarks: row.remarks ?? '',
    });
    setLastWorkingDayTouched(true);
    setAppliedDateTouched(true);
    setLastApprovedTouched(true);
    setFormError(null);
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
    // Legacy approves() (GRTL path) takes no inputs — the server derives the settlement month
    // from the approved last working date and passes present / encashment days as 0.
    mutationFn: () => fetch(`/api/resignations/${approveFor}/approve`, {
      method: 'PUT',
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to approve');
      return res.json();
    }),
    // Keep the same modal open and advance it to step 2 (the settlement summary), mirroring
    // legacy's setup.ctp → approves.ctp flow on one screen.
    onSuccess: (data: SettlementResult) => {
      invalidate();
      setOtherEdits({});
      setSettlementResult(data);
    },
  });

  // Legacy Removeemps() takes no form — a confirm() then one POST. working_days_settled and
  // payroll_days are computed server-side from the resignation window (see finalize route). In
  // legacy this is the slip screen's separate "Submit Termination" button; here it's chained
  // straight off "Generate Full and Final Slip" (see saveSettlementHeads) and then opens the slip.
  const finalize = useMutation({
    mutationFn: (pkey: number) => fetch(`/api/resignations/${pkey}/finalize`, {
      method: 'POST',
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to finalize');
    }),
    onSuccess: () => {
      invalidate();
      window.open(`/employees/resignations/${approveFor}/slip`, '_blank', 'noopener,noreferrer');
      closeFnF();
    },
  });

  // Ports save_heads(): persist the edited OTHERS "Change Amount" values, exactly as legacy's
  // "Generate Full and Final Slip" button submits the #heads form first. Legacy then shows the slip
  // screen with a separate "Submit Termination" (removeemps) button; this app collapses that second
  // step into the same click — save the heads, then run the removal cascade and open the slip.
  const saveSettlementHeads = useMutation({
    mutationFn: () => {
      const s = settlementResult!.settlement;
      const val = (r: SettlementLine) =>
        Number(otherEdits[r.emp_settle_slip_pkey] ?? r.salary_amount) || 0;
      return fetch(`/api/resignations/${approveFor}/settlement-heads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          additions: s.otherAdditions.map((r) => ({ pkey: r.emp_settle_slip_pkey, amount: val(r) })),
          deductions: s.otherDeductions.map((r) => ({ pkey: r.emp_settle_slip_pkey, amount: val(r) })),
        }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save settlement');
      });
    },
    onSuccess: () => {
      finalize.mutate(approveFor!);
    },
  });

  function closeFnF() {
    setApproveFor(null);
    setPreviewData(null);
    setSettlementResult(null);
    setOtherEdits({});
    approve.reset();
    saveSettlementHeads.reset();
    finalize.reset();
  }

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
      id: 'submitted',
      header: 'Resignation Submitted',
      accessorFn: (row) => row.submitted_date ?? row.applied_date,
      cell: ({ getValue }) => formatDate(String(getValue() ?? '')),
    },
    {
      id: 'lastApplied',
      header: 'Last Applied Date',
      accessorFn: (row) => row.last_applied_date ?? row.Last_workingday,
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
                onClick={() => { if (confirm('Delete this resignation? This cancels the resignation and its termination record.')) withdraw.mutate(row.original.Resignation_pkey); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
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
          onClick={() => { closeForm(); setShowNew(true); }}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New Resignation
        </button>
      </div>

      {!embedded && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center gap-3">
          {/* Legacy's list (listemployees) supports a name search only — no status/branch/designation filters. */}
          <form onSubmit={handleSearch} className="flex gap-2 max-w-sm flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by employee name"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={cn(INPUT_CLASS, 'pl-8')}
              />
            </div>
            <button type="submit" className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
              Search
            </button>
          </form>
        </div>
      )}

      <DataTable data={data} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />

      {showNew && (
        <Modal title={editingId ? 'Edit Resignation' : 'New Resignation'} size="form" onClose={closeForm}>
          <p className="-mt-3 mb-6 text-[12.5px] text-slate-500">
            {editingId
              ? `Update resignation details${editEmpName ? ` for ${editEmpName}` : ''}`
              : 'Fill in the details for the new resignation'}
          </p>

          <form onSubmit={handleFormSubmit} className="space-y-7">
            <section className="space-y-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Resignation Details</h3>

              <div>
                {editingId || embedded ? (
                  <>
                    <p className={FORM_LABEL}>Employee</p>
                    <div className="flex items-center gap-2.5 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--color-primary-light)] text-[11px] font-semibold text-[color:var(--color-primary-dark)]">
                        {(editEmpName || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="text-[14px] font-medium text-[#0F172A]">{editEmpName || '…'}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <label className={FORM_LABEL}>Employee <span className="text-[color:var(--color-danger)]">*</span></label>
                    <EmployeeSearch value={newForm.emp_fkey} onChange={(v) => setNewForm((f) => ({ ...f, emp_fkey: v }))} />
                  </>
                )}
              </div>

              <div>
                <label className={FORM_LABEL}>Reason <span className="text-[color:var(--color-danger)]">*</span></label>
                <select required className={FORM_INPUT} value={newForm.reason ?? ''} onChange={(e) => setNewForm((f) => ({ ...f, reason: e.target.value }))}>
                  <option value="">Select</option>
                  {REASON_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={FORM_LABEL}>Reason Description</label>
                <textarea
                  className={cn(FORM_TEXTAREA, 'min-h-[76px]')}
                  rows={2}
                  placeholder="Enter a brief description..."
                  value={newForm.reason_desc ?? ''}
                  onChange={(e) => setNewForm((f) => ({ ...f, reason_desc: e.target.value }))}
                />
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Working Period</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <label className={FORM_LABEL}>Resignation Submitted On <span className="text-[color:var(--color-danger)]">*</span></label>
                  <input
                    required
                    type="date"
                    className={FORM_INPUT}
                    value={newForm.date_submitted ?? ''}
                    onChange={(e) => setNewForm((f) => ({ ...f, date_submitted: e.target.value }))}
                  />
                </div>

                <div>
                  <label className={FORM_LABEL}>Last Applied Working Date <span className="text-[color:var(--color-danger)]">*</span></label>
                  <input
                    required
                    type="date"
                    className={FORM_INPUT}
                    value={newForm.applied_date ?? ''}
                    onChange={(e) => { setAppliedDateTouched(true); setNewForm((f) => ({ ...f, applied_date: e.target.value })); }}
                  />
                </div>

                <div>
                  <label className={FORM_LABEL}>Notice Period (days)</label>
                  <div className="relative">
                    <input
                      readOnly
                      type="number"
                      className={cn(FORM_INPUT, 'bg-slate-50 text-slate-500 pr-9')}
                      value={noticeDays ?? ''}
                    />
                    <Lock className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">Calculated automatically</p>
                </div>

                <div>
                  <label className={FORM_LABEL}>Last Working Day (as per notice) <span className="text-[color:var(--color-danger)]">*</span></label>
                  <input
                    required
                    type="date"
                    className={FORM_INPUT}
                    value={newForm.last_workingday ?? ''}
                    onChange={(e) => { setLastWorkingDayTouched(true); setNewForm((f) => ({ ...f, last_workingday: e.target.value })); }}
                  />
                  {noticeDays != null && (
                    <p className="mt-1 text-[11px] text-slate-400">Auto-suggested from the {noticeDays}-day notice — editable</p>
                  )}
                </div>

                <div>
                  <label className={FORM_LABEL}>Last Approved Working Date <span className="text-[color:var(--color-danger)]">*</span></label>
                  <input
                    required
                    type="date"
                    className={FORM_INPUT}
                    value={newForm.last_approved_workingday ?? ''}
                    onChange={(e) => { setLastApprovedTouched(true); setNewForm((f) => ({ ...f, last_approved_workingday: e.target.value })); }}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Remarks</h3>

              <div>
                <label className={FORM_LABEL}>Remarks <span className="text-[color:var(--color-danger)]">*</span></label>
                <div className="relative">
                  <textarea
                    required
                    maxLength={30}
                    className={cn(FORM_TEXTAREA, 'min-h-[76px] pb-6')}
                    rows={2}
                    placeholder="Enter remarks..."
                    value={newForm.remarks ?? ''}
                    onChange={(e) => setNewForm((f) => ({ ...f, remarks: e.target.value }))}
                  />
                  <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-slate-400">
                    {(newForm.remarks ?? '').length} / 30
                  </span>
                </div>
              </div>
            </section>

            {formError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{formError}</p>}
            {create.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(create.error)}</p>}

            <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <button type="button" onClick={closeForm} className="px-4 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-[10px] transition-colors duration-150">Cancel</button>
              <button type="submit" disabled={!newForm.emp_fkey || create.isPending} className={cn(BTN_BASE, 'px-5 py-2.5 rounded-[10px] text-[13px] bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white shadow-sm')}>
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

      {approveFor !== null && (previewData || settlementResult) && (
        <Modal title="Process Full & Final" size="lg" onClose={closeFnF}>
          <p className="-mt-3 mb-4 text-[12.5px] text-slate-500">
            {(previewData?.employee ?? settlementResult?.settlement.employee)?.first_name}{' '}
            {(previewData?.employee ?? settlementResult?.settlement.employee)?.last_name ?? ''}
          </p>

          <div className="flex items-center gap-3 mb-6">
            <span className={cn('inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-colors', !settlementResult ? 'bg-[color:var(--color-primary)] text-white shadow-sm' : 'bg-slate-100 text-slate-400')}>
              1 · Review
            </span>
            <span className="h-px w-6 bg-slate-200" />
            <span className={cn('inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-colors', settlementResult ? 'bg-[color:var(--color-primary)] text-white shadow-sm' : 'bg-slate-100 text-slate-400')}>
              2 · Settlement Summary
            </span>
          </div>

          {!settlementResult && previewData && (
          <>
          <div className="space-y-5 mb-5">

            {previewData.leaveYearWarning && (
              <p className="text-[11.5px] text-[color:var(--color-highlight-dark)] bg-[color:var(--color-highlight-light)] rounded-lg px-3 py-2">
                {previewData.leaveYearWarning}
              </p>
            )}

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Resignation Details</h3>
              <div className="rounded-xl border border-slate-200 overflow-hidden grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200">
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Resignation Submitted Date</p>
                  <p className="mt-1 text-[13px] font-semibold text-[#0F172A]">{formatDate(previewData.resignationDetails.submittedDate)}</p>
                </div>
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Notice Period</p>
                  <p className="mt-1 text-[13px] font-semibold text-[#0F172A]">{previewData.resignationDetails.noticePeriod}</p>
                </div>
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Last Working Date (as per Notice)</p>
                  <p className="mt-1 text-[13px] font-semibold text-[#0F172A]">{formatDate(previewData.resignationDetails.lastWorkingDate)}</p>
                </div>
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Approved Last Working Date</p>
                  <p className="mt-1 text-[13px] font-semibold text-[#0F172A]">{formatDate(previewData.resignationDetails.approvedLastWorkingDate)}</p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Notice Period Adjustments</h3>
              <div className="rounded-xl border border-slate-200 overflow-hidden grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200">
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Resignation Period Working Days</p>
                  <p className="mt-1 text-[13px] font-medium text-slate-600">{previewData.noticePeriodAdjustments.resignationPeriodWorkingDays}</p>
                </div>
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Resignation Period Present Days</p>
                  <p className="mt-1 text-[13px] font-medium text-slate-600">{previewData.noticePeriodAdjustments.resignationPeriodPresentDays}</p>
                </div>
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Balance Working Days</p>
                  <p className="mt-1 text-[15px] font-bold text-[#0F172A]">{previewData.noticePeriodAdjustments.balanceWorkingDays}</p>
                </div>
                <div className="bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Encashable Leave Balance</p>
                  <p className="mt-1 text-[15px] font-bold text-[color:var(--color-primary-dark)]">{previewData.noticePeriodAdjustments.encashableLeaveBalance}</p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Loans, Advances, Expenses and Assets Adjustments</h3>

              {/* Legacy setup.ctp "Balance Recovery" table */}
              <p className="text-[12px] font-semibold text-slate-600 mb-1.5">Balance Recovery</p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 text-left border-b border-slate-200">
                      <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px]">Accounts</th>
                      <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px]">Status</th>
                      <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px] text-right">Amount</th>
                      <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px] text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.balanceRecovery.rows.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2 text-slate-600">{r.account}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center rounded-full bg-[color:var(--color-highlight-light)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--color-highlight-dark)]">{r.status}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(r.amount).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#0F172A]">{Number(r.balance).toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-3 py-2 font-semibold text-[#0F172A]" colSpan={3}>Total Amount Balance</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-[#0F172A]">{Number(previewData.balanceRecovery.totalAmountBalance).toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Legacy FullandFinalsettlement/Assets: assets still allocated to the employee */}
              <p className="text-[12px] font-semibold text-slate-600 mt-4 mb-1.5">Assets</p>
              {previewData.allocatedAssets.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3.5 py-3 text-[11.5px] text-slate-400">
                  <CircleOff className="w-3.5 h-3.5" />
                  No assets assigned
                </div>
              ) : (
                <>
                  <p className="text-[11.5px] text-[color:var(--color-danger-dark)] bg-[color:var(--color-danger-soft)] rounded-lg px-3 py-2 mb-2">
                    Alert! Please retrieve the following assets before Process Full &amp; Final.
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-[11.5px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-400 text-left border-b border-slate-200">
                          <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px]">Asset</th>
                          <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px]">Type</th>
                          <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px]">Serial Number</th>
                          <th className="px-3 py-2 font-medium uppercase tracking-wide text-[10px]">Date allocated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.allocatedAssets.map((a) => (
                          <tr key={a.allocate_pkey} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 text-slate-600">{a.name ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{a.type ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{a.serial_no ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{a.allocated_date ? formatDate(a.allocated_date) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="mt-5 flex gap-2.5 rounded-xl border border-[color:var(--color-primary-light)] bg-[color:var(--color-primary-light)] px-3.5 py-3">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--color-primary-dark)]" />
            <p className="text-[11.5px] leading-relaxed text-slate-600">
              The Full &amp; Final settlement uses the approved last working date and the adjustments shown above,
              with present and encashment days set to 0 (matching legacy). Attendance isn&apos;t available in this
              app yet, so the settlement procedure may report that attendance is not verified — that&apos;s expected.
            </p>
          </div>

          {approve.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mt-3">{String(approve.error)}</p>}

          <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
            <button type="button" onClick={closeFnF} className="px-4 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-[10px] transition-colors duration-150">Cancel</button>
            <button type="button" onClick={() => approve.mutate()} disabled={approve.isPending} className={cn(BTN_BASE, 'px-5 py-2.5 rounded-[10px] text-[13px] bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white shadow-sm')}>
              {approve.isPending ? 'Processing…' : 'Process Full and Final'}
            </button>
          </div>
          </>
          )}

          {settlementResult && (
          <>
          <div className="space-y-4">
            <p className="text-[13px] font-semibold text-[#0F172A]">Full And Final Settlement Summary</p>
            <p className="text-[13px] font-medium text-[#0F172A]">
              {settlementResult.settlement.employee.first_name} {settlementResult.settlement.employee.last_name ?? ''}
            </p>
            {settlementResult.settlementMessage && (
              <p className="text-[11.5px] text-[color:var(--color-highlight-dark)] bg-[color:var(--color-highlight-light)] rounded-lg px-3 py-2">{settlementResult.settlementMessage}</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
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

            {/* Settlement summary — legacy approves.ctp: ADDITIONS / DEDUCTIONS tables each ending in a Total row */}
            <p className="text-[12px] font-semibold text-[#0F172A]">Settlement summary</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px] border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-left">
                      <th className="px-2 py-1.5 font-medium" colSpan={2}>ADDITIONS</th>
                    </tr>
                    <tr className="bg-slate-50 text-slate-500 text-left">
                      <th className="px-2 py-1.5 font-medium">Item</th>
                      <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementResult.settlement.additions.map((l) => (
                      <tr key={l.emp_settle_slip_pkey} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 text-slate-600">{l.salary_head_item_desc}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{Number(l.salary_amount).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-200 font-semibold text-[#0F172A]">
                      <td className="px-2 py-1.5">Total</td>
                      <td className="px-2 py-1.5 text-right">{settlementResult.settlement.additionsTotal.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px] border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-left">
                      <th className="px-2 py-1.5 font-medium" colSpan={2}>DEDUCTIONS</th>
                    </tr>
                    <tr className="bg-slate-50 text-slate-500 text-left">
                      <th className="px-2 py-1.5 font-medium">Item</th>
                      <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementResult.settlement.deductions.map((l) => (
                      <tr key={l.emp_settle_slip_pkey} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 text-slate-600">{l.salary_head_item_desc}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{Number(l.salary_amount).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-200 font-semibold text-[#0F172A]">
                      <td className="px-2 py-1.5">Total</td>
                      <td className="px-2 py-1.5 text-right">{settlementResult.settlement.deductionsTotal.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* OTHERS — legacy approves.ctp editable "Change Amount" block (ports save_heads()) */}
            <p className="text-[12px] font-semibold text-center text-[#0F172A] pt-1">OTHERS</p>
            {(['otherAdditions', 'otherDeductions'] as const).map((key) => {
              const rows = settlementResult.settlement[key];
              const isDed = key === 'otherDeductions';
              const editedTotal = rows.reduce((s, r) => {
                const v = Number(otherEdits[r.emp_settle_slip_pkey] ?? r.salary_amount) || 0;
                return s + (isDed ? -Math.abs(v) : v);
              }, 0);
              return (
                <div key={key} className="overflow-x-auto">
                  <table className="w-full text-[11.5px] border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-left">
                        <th className="px-2 py-1.5 font-medium" colSpan={3}>{isDed ? 'DEDUCTION' : 'ADDITION'}</th>
                      </tr>
                      <tr className="bg-slate-50 text-slate-500 text-left">
                        <th className="px-2 py-1.5 font-medium">Item</th>
                        <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                        <th className="px-2 py-1.5 font-medium text-right">Change Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.emp_settle_slip_pkey} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-600">{r.salary_head_item_desc}</td>
                          <td className="px-2 py-1.5 text-right text-slate-600">{Math.abs(Number(r.salary_amount)).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              className={cn(INPUT_CLASS, 'w-28 text-right py-1')}
                              value={otherEdits[r.emp_settle_slip_pkey] ?? String(r.salary_amount)}
                              onChange={(e) => setOtherEdits((m) => ({ ...m, [r.emp_settle_slip_pkey]: e.target.value }))}
                            />
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 font-semibold text-[#0F172A]">
                        <td className="px-2 py-1.5">Total</td>
                        <td className="px-2 py-1.5" />
                        <td className="px-2 py-1.5 text-right">{editedTotal.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}

            <div className="flex justify-between text-[11.5px] pt-1 border-t border-slate-200">
              <span className="text-slate-500">Notice Pay (shortfall, informational)</span>
              <span className="text-[#0F172A]">{settlementResult.settlement.noticePay.toFixed(2)}</span>
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
          {saveSettlementHeads.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] pt-2">{String(saveSettlementHeads.error)}</p>}
          {finalize.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] pt-2">{String(finalize.error)}</p>}
          <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
            <button type="button" onClick={closeFnF} className="px-4 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-[10px] transition-colors duration-150">Close</button>
            <button
              type="button"
              onClick={() => {
                if (confirm('Employee Separation process will remove this employee from the application. After submission changes cannot be undone. Hierarchy-assigned employees under this person will also be removed. Do you want to continue?')) {
                  saveSettlementHeads.mutate();
                }
              }}
              disabled={saveSettlementHeads.isPending || finalize.isPending}
              className={cn(BTN_BASE, 'px-5 py-2.5 rounded-[10px] text-[13px] bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white shadow-sm')}
            >
              {saveSettlementHeads.isPending || finalize.isPending ? 'Processing…' : 'Generate Full and Final Slip'}
            </button>
          </div>
          </>
          )}
        </Modal>
      )}
    </div>
  );
}
