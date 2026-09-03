'use client';

import { Suspense, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, PlayCircle, Eye, Trash2, AlertTriangle, Clock, UserX, ChevronDown, ChevronRight } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { Modal } from '@/components/ui/Modal';

interface StructureOption { structure_id: number; structure_name: string; structure_eg_amt: number }
interface BreakupLine {
  salary_head_item_fkey: number;
  head_name: string;
  amount: number;
  is_deduction: 'Y' | 'N';
  is_employer_contribution: boolean;
}
interface StructureLine {
  salary_head_item_fkey: number;
  desc: string;
  value: number;
}
interface EmpCurrentStructure {
  structure_id: number | null;
  monthly_gross: number;
  annual_ctc: number | null;
  next_increment_date: string | null;
  emp: { emp_name: string; emp_company_id: string; branch: string; designation: string; department: string; joining_date: string | null };
  // Only `structure` is user-editable; the other two are read-only and recompute on change.
  structure: StructureLine[];
  structure_indirect: StructureLine[];
  emp_contribution: StructureLine[];
  all_current: Record<number, number>;
}
interface HikeRow {
  salary_hike_pkey: number;
  item: string;
  component_count: number;
  emp_fkey: number;
  emp_name: string;
  with_effect_from: string;
  payout_month: string;
  current_amount: number;
  new_amount: number;
  increment_amount: number;
  increment_percentage: number;
  arrear_salary: string;
  action: string | null;
}
interface PendingEmpRow {
  emp_fkey: number;
  emp_name: string;
  emp_company_id: string;
  branch: string;
  salary_structure: string;
  next_increment_date: string | null;
  status: 'Due' | 'Overdue' | 'NoStructure' | 'None';
}
interface BatchDetail {
  salary_hike_details_pkey: number;
  emp_name: string;
  emp_company_id: string;
  component_name: string | null;
  structure_name: string | null;
  with_effect_from: string | null;
  next_increment_date: string | null;
  payout_month: string | null;
  current_amount: number;
  new_amount: number;
  increment_amount: number;
  increment_percentage: number;
  arrear_salary: string;
  processed: string;
}
interface BatchResponse {
  hike: { salary_hike_pkey: number; item: string; structure_change: string; action: string | null; remarks: string | null };
  details: BatchDetail[];
}

const TABS = [
  { key: 'due', label: 'Revision Due' },
  { key: 'pending', label: 'Pending' },
  { key: 'processed', label: 'Processed' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const DUE_FILTERS = [
  { key: '', label: 'All' },
  { key: 'Due', label: 'Due' },
  { key: 'Overdue', label: 'Overdue' },
  { key: 'NoStructure', label: 'No Structure' },
] as const;

// Larger, consistent-height inputs for the Update Salary modal (14px text per the redesign spec).
const MODAL_INPUT =
  'w-full h-[38px] border border-slate-200 bg-white rounded-[10px] px-3 text-[14px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';
const SECTION_LABEL = 'text-[12px] font-semibold text-slate-500 uppercase tracking-[0.04em]';
const FIELD_LABEL = 'block text-[12px] font-medium text-slate-500 mb-1';

const UPDATE_METHODS = [
  { key: 'gross' as const, title: 'Gross Salary', desc: 'Set the total monthly gross' },
  { key: 'components' as const, title: 'Individual Components', desc: 'Edit the salary breakup' },
];

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString();
}

interface IncrementsContentProps {
  /** When set, render ONLY the Salary Update form (own <Modal>), pre-loaded for this employee. */
  embeddedEmpPkey?: number;
  /** Called when the embedded form is closed or saved, so the host can dismiss it. */
  onClose?: () => void;
}

function IncrementsContent({ embeddedEmpPkey, onClose }: IncrementsContentProps = {}) {
  const embedded = embeddedEmpPkey != null;
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('due');
  const [dueFilter, setDueFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(embedded);
  const [empId, setEmpId] = useState(embedded ? String(embeddedEmpPkey) : '');
  const [structureId, setStructureId] = useState('');
  const [newGross, setNewGross] = useState('');
  const [withEffectFrom, setWithEffectFrom] = useState('');
  const [nextIncrementDate, setNextIncrementDate] = useState('');
  const [payoutMonth, setPayoutMonth] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [empStructure, setEmpStructure] = useState<EmpCurrentStructure | null>(null);
  const [mode, setMode] = useState<'gross' | 'components'>('gross');
  const [compNew, setCompNew] = useState<Record<number, string>>({});
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const { data: structures = [] } = useQuery<StructureOption[]>({
    queryKey: ['setup/salary-structures', 'full'],
    queryFn: () => fetch('/api/setup/salary-structures?full=1').then((r) => r.json()),
  });

  const { data: summary } = useQuery<{ noStructure: number; due: number; overDue: number }>({
    queryKey: ['payroll/increments/summary'],
    queryFn: () => fetch('/api/payroll/increments/summary').then((r) => r.json()),
    enabled: tab === 'due',
  });

  const { data: pendingEmps, isLoading: loadingPending } = useQuery<{ rows: PendingEmpRow[] }>({
    queryKey: ['payroll/increments/pending-employees', dueFilter],
    queryFn: () =>
      fetch(`/api/payroll/increments/pending-employees?status=${encodeURIComponent(dueFilter)}`).then((r) => r.json()),
    enabled: tab === 'due',
  });

  const { data, isLoading } = useQuery<{ rows: HikeRow[] }>({
    queryKey: ['payroll/increments', tab],
    queryFn: () => fetch(`/api/payroll/increments?status=${tab}`).then((r) => r.json()),
    enabled: tab !== 'due',
  });
  const rows = data?.rows ?? [];

  const { data: batch } = useQuery<BatchResponse>({
    queryKey: ['payroll/increments/batch', viewId],
    queryFn: () => fetch(`/api/payroll/increments/${viewId}`).then((r) => r.json()),
    enabled: viewId != null,
  });

  // Arrear hint — mirrors legacy onEffectiveDateChange().
  const { data: arrear } = useQuery<{ isProcessed: boolean; message: string }>({
    queryKey: ['payroll/increments/arrear-check', empId, withEffectFrom],
    queryFn: () =>
      fetch(`/api/payroll/increments/arrear-check?empFkey=${empId}&date=${withEffectFrom}`).then((r) => r.json()),
    enabled: !!empId && !!withEffectFrom,
  });

  // Preview the target structure at the new gross — reuses the shared salary-structure
  // breakup endpoint (wraps calculate_emp_salary_breakup).
  const previewGross = Number(newGross);
  const { data: preview } = useQuery<{ data: BreakupLine[]; net: number; employer_cost: number }>({
    queryKey: ['setup/salary-structures/breakup', structureId, previewGross],
    queryFn: () =>
      fetch(`/api/setup/salary-structures/${structureId}/breakup?gross=${previewGross}`).then((r) => r.json()),
    enabled: showForm && !!structureId && previewGross > 0,
  });

  const resetForm = () => {
    setEmpId(''); setStructureId(''); setNewGross(''); setWithEffectFrom('');
    setNextIncrementDate(''); setPayoutMonth(''); setRemarks('');
    setEmpStructure(null); setMode('gross'); setCompNew({});
  };

  // Selecting an employee loads their current state and pre-fills the form
  // (mirrors legacy's "Enter" button + getSalaryStructure()).
  const loadEmployee = async (empPkey: string) => {
    setEmpId(empPkey);
    setStructureId(''); setNewGross(''); setNextIncrementDate(''); setCompNew({});
    setEmpStructure(null);
    if (!empPkey) return;
    const res = await fetch(`/api/payroll/increments/employee/${empPkey}/structure`);
    if (!res.ok) return;
    const s = (await res.json()) as EmpCurrentStructure;
    setEmpStructure(s);
    if (s.structure_id) setStructureId(String(s.structure_id));
    if (s.next_increment_date) setNextIncrementDate(s.next_increment_date);
    if (s.monthly_gross) setNewGross(String(s.monthly_gross));
    const allLines = [...s.structure, ...s.structure_indirect, ...s.emp_contribution];
    setCompNew(Object.fromEntries(allLines.map((c) => [c.salary_head_item_fkey, String(c.value)])));
  };

  const closeForm = () => {
    setShowForm(false);
    onClose?.();
  };

  // Embedded (from the All Employees widget): auto-load the selected employee into the form.
  useEffect(() => {
    if (embedded) void loadEmployee(String(embeddedEmpPkey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Current value per component — the full active-structure map (covers preview lines that fall
  // outside the three editable groups); falls back to the grouped lines if the map is absent.
  const currentByItem = new Map<number, number>(
    empStructure
      ? Object.entries(empStructure.all_current).map(([k, v]) => [Number(k), v])
      : []
  );
  const selectedStructure = structures.find((s) => String(s.structure_id) === structureId);
  const belowMinimum = !!selectedStructure && previewGross > 0 && previewGross < Number(selectedStructure.structure_eg_amt);

  // Mirrors sendIncrementData(): one Monthly Salary Component's new value changed → recompute
  // dependents. Legacy only sends the Direct group's values (`new_value_*`); indirect / contrib
  // tokens resolve to 0 or their proc value.
  const recalcComponent = async (changedItemPkey: number, rawValue: string) => {
    setCompNew((prev) => ({ ...prev, [changedItemPkey]: rawValue }));
    if (!structureId || !empStructure) return;
    const newValue = Number(rawValue) || 0;
    const newValues: Record<string, number> = {};
    for (const c of empStructure.structure) {
      newValues[c.salary_head_item_fkey] =
        c.salary_head_item_fkey === changedItemPkey ? newValue : (Number(compNew[c.salary_head_item_fkey]) || 0);
    }
    const grossAmount = Object.values(newValues).reduce((s, v) => s + v, 0);
    setRecalcBusy(true);
    try {
      const res = await fetch('/api/payroll/increments/component-recalc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structureId: Number(structureId), changedItemPkey, newValue,
          grossAmount, newValues,
        }),
      });
      if (!res.ok) return;
      const { rows } = (await res.json()) as { rows: { salary_head_item_fkey: number; calculated_value: number }[] };
      setCompNew((prev) => {
        const next = { ...prev, [changedItemPkey]: rawValue };
        for (const r of rows) {
          if (r.salary_head_item_fkey === changedItemPkey) continue;
          next[r.salary_head_item_fkey] = String(Math.round(r.calculated_value * 100) / 100);
        }
        return next;
      });
    } finally {
      setRecalcBusy(false);
    }
  };

  const canSave =
    !!empId && !!structureId && !!withEffectFrom && !!nextIncrementDate &&
    (mode === 'gross' ? !!newGross : !!empStructure && empStructure.structure.length > 0);

  // ---- Derived view data (all from existing state / API results — never hardcoded) ----
  const numOf = (v: string | number | undefined) => Number(v) || 0;
  const sumCur = (ls: StructureLine[]) => ls.reduce((s, c) => s + c.value, 0);
  const sumNew = (ls: StructureLine[]) => ls.reduce((s, c) => s + numOf(compNew[c.salary_head_item_fkey] ?? c.value), 0);

  type BRow = { key: number; label: string; current: number; next: number };
  type BGroup = { id: string; title: string; editable: boolean; rows: BRow[] };

  let groups: BGroup[] = [];
  if (mode === 'components' && empStructure) {
    const mk = (ls: StructureLine[]): BRow[] =>
      ls.map((c) => ({
        key: c.salary_head_item_fkey,
        label: c.desc,
        current: c.value,
        next: numOf(compNew[c.salary_head_item_fkey] ?? c.value),
      }));
    groups = [
      { id: 'earnings', title: 'Earnings', editable: true, rows: mk(empStructure.structure) },
      { id: 'employer', title: 'Employer Contributions', editable: false, rows: mk(empStructure.structure_indirect) },
      { id: 'deductions', title: 'Employee Deductions', editable: false, rows: mk(empStructure.emp_contribution) },
    ].filter((g) => g.rows.length > 0);
  } else if (mode === 'gross' && preview?.data?.length) {
    const rows = preview.data.map((l) => ({
      key: l.salary_head_item_fkey,
      label: l.head_name,
      current: currentByItem.get(l.salary_head_item_fkey) ?? 0,
      next: l.amount,
      emp: l.is_employer_contribution,
      ded: l.is_deduction === 'Y',
    }));
    const grp = (id: string, title: string, keep: (r: (typeof rows)[number]) => boolean): BGroup => ({
      id, title, editable: false,
      rows: rows.filter(keep).map((r) => ({ key: r.key, label: r.label, current: r.current, next: r.next })),
    });
    groups = [
      grp('earnings', 'Earnings', (r) => !r.emp && !r.ded),
      grp('employer', 'Employer Contributions', (r) => r.emp),
      grp('deductions', 'Employee Deductions', (r) => r.ded && !r.emp),
    ].filter((g) => g.rows.length > 0);
  }

  const isChanged = (r: BRow) => Math.abs(r.current - r.next) >= 0.5;
  const changedRows = groups.flatMap((g) => g.rows).filter(isChanged);

  let impact: null | { gross: [number, number]; takeHome: [number, number]; ctc: [number, number]; annualDelta: number | null } = null;
  if (empStructure) {
    const curGross = empStructure.monthly_gross;
    const curTakeHome = sumCur(empStructure.structure) + sumCur(empStructure.emp_contribution);
    const curCTC = empStructure.annual_ctc;
    if (mode === 'gross' && preview && previewGross > 0) {
      const newCTCm = previewGross + (preview.employer_cost || 0);
      impact = {
        gross: [curGross, previewGross],
        takeHome: [curTakeHome, preview.net],
        ctc: [curCTC ?? 0, newCTCm * 12],
        annualDelta: curCTC != null ? newCTCm * 12 - curCTC : null,
      };
    } else if (mode === 'components') {
      const newGrossC = sumNew(empStructure.structure);
      const newCTCm = newGrossC + sumNew(empStructure.structure_indirect);
      impact = {
        gross: [curGross, newGrossC],
        takeHome: [curTakeHome, newGrossC + sumNew(empStructure.emp_contribution)],
        ctc: [curCTC ?? 0, newCTCm * 12],
        annualDelta: curCTC != null ? newCTCm * 12 - curCTC : null,
      };
    }
  }

  const dirty =
    changedRows.length > 0 ||
    (mode === 'gross' && previewGross > 0 && Math.abs(previewGross - (empStructure?.monthly_gross ?? 0)) >= 0.5) ||
    remarks.trim().length > 0;

  const deltaClass = (d: number) =>
    Math.abs(d) < 0.5 ? 'text-slate-400' : d > 0 ? 'text-[color:var(--color-success-dark)]' : 'text-[color:var(--color-danger-dark)]';
  const signed = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${formatCurrency(Math.abs(d))}`;

  const create = useMutation({
    mutationFn: async () => {
      const components =
        mode === 'components' && empStructure
          ? [...empStructure.structure, ...empStructure.structure_indirect, ...empStructure.emp_contribution]
              .map((c) => ({
                salaryHeadItemFkey: c.salary_head_item_fkey,
                currentAmount: c.value,
                newAmount: Number(compNew[c.salary_head_item_fkey] ?? c.value) || 0,
              }))
              .filter((c) => c.newAmount !== c.currentAmount)
          : undefined;
      if (mode === 'components' && (!components || components.length === 0)) {
        throw new Error('No component values changed.');
      }
      const res = await fetch('/api/payroll/increments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empId), structureId: Number(structureId),
          newGross: mode === 'gross' ? Number(newGross) : undefined,
          components,
          withEffectFrom, nextIncrementDate, payoutMonth: payoutMonth || undefined, remarks: remarks || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to save increment');
      return b;
    },
    onSuccess: () => {
      setMessage('Increment draft saved.');
      setShowForm(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['payroll/increments'] });
      if (embedded) onClose?.();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const process = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/payroll/increments/${id}/process`, { method: 'POST' });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Processing failed');
      return b as { success: boolean; notProcessed: string[]; invalidSalary: string[] };
    },
    onSuccess: (b) => {
      if (b.notProcessed.length || b.invalidSalary.length) {
        setMessage([...b.notProcessed, ...b.invalidSalary].join('; '));
      } else {
        setMessage('Increment processed.');
      }
      queryClient.invalidateQueries({ queryKey: ['payroll/increments'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/payroll/increments/${id}`, { method: 'DELETE' });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Delete failed');
      return b;
    },
    onSuccess: () => {
      setMessage('Increment draft deleted.');
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['payroll/increments'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const draftFor = (empFkey: number) => {
    setShowForm(true);
    setTab('pending');
    setMessage(null);
    void loadEmployee(String(empFkey));
  };

  const hikeColumns: ColumnDef<HikeRow, unknown>[] = [
    {
      accessorKey: 'emp_name',
      header: 'Employee',
      cell: ({ row }) => (
        <span className="font-medium text-[#0F172A]">
          {row.original.emp_name}
          {row.original.item === 'Y' && (
            <span className="ml-1.5 text-[11px] font-normal text-slate-400">
              · {row.original.component_count} component{row.original.component_count === 1 ? '' : 's'}
            </span>
          )}
        </span>
      ),
    },
    { id: 'effective', header: 'Effective', cell: ({ row }) => fmtDate(row.original.with_effect_from) },
    { id: 'current', header: 'Current', cell: ({ row }) => formatCurrency(row.original.current_amount) },
    { id: 'new', header: 'New', cell: ({ row }) => formatCurrency(row.original.new_amount) },
    {
      id: 'increment',
      header: 'Increment',
      cell: ({ row }) => `${formatCurrency(row.original.increment_amount)} (${row.original.increment_percentage.toFixed(1)}%)`,
    },
    { id: 'arrear', header: 'Arrear?', cell: ({ row }) => (row.original.arrear_salary === 'Y' ? 'Yes' : 'No') },
    {
      id: 'action',
      header: '',
      meta: { className: 'w-40' },
      cell: ({ row }) => (
        <div className="flex justify-end items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); setViewId(row.original.salary_hike_pkey); }}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-[#0F172A] text-[12px] font-medium"
          >
            <Eye className="w-3.5 h-3.5" /> View
          </button>
          {tab === 'pending' && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); process.mutate(row.original.salary_hike_pkey); }}
                disabled={process.isPending}
                className="inline-flex items-center gap-1 text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] text-[12px] font-medium"
              >
                <PlayCircle className="w-3.5 h-3.5" /> Process
              </button>
              {confirmDeleteId === row.original.salary_hike_pkey ? (
                <span className="inline-flex items-center gap-1.5 text-[12px]">
                  <button onClick={(e) => { e.stopPropagation(); remove.mutate(row.original.salary_hike_pkey); }} className="text-red-600 font-medium">Confirm</button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} className="text-slate-400">Cancel</button>
                </span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(row.original.salary_hike_pkey); }}
                  className="inline-flex items-center gap-1 text-red-500 hover:text-red-600 text-[12px] font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  const pendingColumns: ColumnDef<PendingEmpRow, unknown>[] = [
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { accessorKey: 'emp_company_id', header: 'Employee ID' },
    { id: 'nid', header: 'Next Increment', cell: ({ row }) => fmtDate(row.original.next_increment_date) },
    { accessorKey: 'branch', header: 'Branch' },
    { accessorKey: 'salary_structure', header: 'Salary Structure', cell: ({ getValue }) => String(getValue() || '—') },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = row.original.status;
        const cls =
          s === 'Overdue' ? 'bg-red-50 text-red-600'
            : s === 'NoStructure' ? 'bg-amber-50 text-amber-700'
              : s === 'Due' ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)]'
                : 'bg-slate-100 text-slate-500';
        return <span className={cn('px-2 py-0.5 rounded-md text-[11.5px] font-medium', cls)}>{s === 'NoStructure' ? 'No Structure' : s}</span>;
      },
    },
    {
      id: 'action',
      header: '',
      meta: { className: 'w-32' },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <button
            onClick={(e) => { e.stopPropagation(); draftFor(row.original.emp_fkey); }}
            className="inline-flex items-center gap-1 text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] text-[12px] font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Draft Increment
          </button>
        </div>
      ),
    },
  ];

  const cards = [
    { label: 'Revision Due', value: summary?.due ?? '—', icon: Clock, color: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)]' },
    { label: 'Revision Overdue', value: summary?.overDue ?? '—', icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
    { label: 'No Salary Structure', value: summary?.noStructure ?? '—', icon: UserX, color: 'bg-amber-50 text-amber-700' },
  ];

  return (
    <div>
      {!embedded && slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Salary Increments
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Draft and process employee salary hikes
            </p>
          </div>,
          slotEl
        )}

      {!embedded && (
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => { setShowForm(true); setMessage(null); }}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <Plus className="w-3.5 h-3.5" />
            Salary Update
          </button>
        </div>
      )}

      {!embedded && message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}

      <Modal
        open={showForm}
        onClose={closeForm}
        className="!max-w-[1160px] !p-0 !overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-slate-100 pr-14">
          <div className="flex items-center gap-2.5">
            <h2 className="font-heading text-[19px] font-semibold text-[#0F172A] leading-tight">Update Salary</h2>
            {dirty && (
              <span className="inline-flex items-center text-[11px] font-medium text-[color:var(--color-highlight-dark)] bg-[color:var(--color-highlight-light)] border border-[color:var(--color-highlight)]/40 rounded-full px-2 py-0.5">
                Unsaved changes
              </span>
            )}
          </div>
          {empStructure ? (
            <p className="text-[13px] text-slate-500 mt-0.5">
              <span className="font-semibold text-[#0F172A]">{empStructure.emp.emp_name || 'Employee'}</span>
              <span className="text-slate-300"> · </span>{empStructure.emp.emp_company_id || '—'}
            </p>
          ) : (
            <p className="text-[13px] text-slate-400 mt-0.5">Select an employee to begin</p>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto scroll-fade px-6 py-5 space-y-6">
          {/* 1 · Employee */}
          {!empId ? (
            <div className="max-w-md">
              <label className={FIELD_LABEL}>Employee</label>
              <EmployeeSearch value={empId} onChange={(v) => void loadEmployee(v)} placeholder="Search employee by name or ID" />
            </div>
          ) : empStructure ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-slate-500">
                  {[empStructure.emp.designation, empStructure.emp.branch, empStructure.emp.department].filter(Boolean).join(' · ') || '—'}
                </p>
                {!embedded && (
                  <button
                    type="button"
                    onClick={() => void loadEmployee('')}
                    className="text-[12px] font-medium text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] shrink-0"
                  >
                    Change employee
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Current Gross', value: formatCurrency(empStructure.monthly_gross), sub: 'per month' },
                  { label: 'Current CTC', value: empStructure.annual_ctc != null ? formatCurrency(empStructure.annual_ctc) : '—', sub: 'per year' },
                  { label: 'Next Increment', value: fmtDate(empStructure.next_increment_date), sub: '' },
                  { label: 'Joined', value: fmtDate(empStructure.emp.joining_date), sub: '', muted: true },
                ].map((t) => (
                  <div key={t.label} className={cn('rounded-xl border border-slate-200 bg-white px-3.5 py-2.5', t.muted && 'opacity-70')}>
                    <p className="text-[11px] text-slate-400">{t.label}</p>
                    <p className="text-[15px] font-semibold text-[#0F172A] mt-0.5 tabular-nums">{t.value}</p>
                    {t.sub && <p className="text-[11px] text-slate-400">{t.sub}</p>}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {empStructure && (
            <>
              {/* 2 · Update method */}
              <section className="space-y-2">
                <p className={SECTION_LABEL}>Update salary by</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl">
                  {UPDATE_METHODS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMode(m.key)}
                      className={cn(
                        'text-left rounded-xl border px-4 py-3 transition-colors',
                        mode === m.key
                          ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white shadow-sm'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      )}
                    >
                      <div className="text-[13.5px] font-semibold">{m.title}</div>
                      <div className={cn('text-[11.5px] mt-0.5', mode === m.key ? 'text-white/80' : 'text-slate-400')}>{m.desc}</div>
                    </button>
                  ))}
                </div>
              </section>

              {/* 3 · Salary change inputs */}
              <section className="space-y-3">
                <p className={SECTION_LABEL}>{mode === 'gross' ? 'New salary' : 'Effective dates'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
                  <div>
                    <label className={FIELD_LABEL}>Salary Structure</label>
                    <select value={structureId} onChange={(e) => setStructureId(e.target.value)} className={MODAL_INPUT}>
                      <option value="">Select structure</option>
                      {structures.map((s) => (
                        <option key={s.structure_id} value={s.structure_id}>{s.structure_name}</option>
                      ))}
                    </select>
                  </div>
                  {mode === 'gross' && (
                    <div>
                      <label className={FIELD_LABEL}>New Monthly Gross</label>
                      <input type="number" value={newGross} onChange={(e) => setNewGross(e.target.value)} className={MODAL_INPUT} />
                    </div>
                  )}
                  <div>
                    <label className={FIELD_LABEL}>Effective From</label>
                    <input type="date" value={withEffectFrom} onChange={(e) => setWithEffectFrom(e.target.value)} className={MODAL_INPUT} />
                  </div>
                  <div>
                    <label className={FIELD_LABEL}>Next Increment Date</label>
                    <input type="date" value={nextIncrementDate} onChange={(e) => setNextIncrementDate(e.target.value)} className={MODAL_INPUT} />
                  </div>
                  <div>
                    <label className={FIELD_LABEL}>Payout Month <span className="text-slate-300 font-normal">optional</span></label>
                    <input type="month" value={payoutMonth} onChange={(e) => setPayoutMonth(e.target.value)} className={MODAL_INPUT} />
                  </div>
                </div>

                {mode === 'gross' && belowMinimum && (
                  <p className="text-[12px] text-[color:var(--color-danger-dark)] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> New gross is below this structure&apos;s minimum ({formatCurrency(Number(selectedStructure!.structure_eg_amt))}) — it will be rejected on processing.
                  </p>
                )}
                {arrear?.isProcessed && (
                  <p className="text-[12px] text-[color:var(--color-highlight-dark)] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {arrear.message}
                  </p>
                )}

                <div className="pt-1">
                  <label className={FIELD_LABEL}>Remarks <span className="text-slate-300 font-normal">optional</span></label>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Add a note about this salary change..."
                    className={cn(MODAL_INPUT, 'text-[13px] text-slate-600')}
                  />
                </div>
              </section>

              {/* 4 · Salary impact */}
              {impact && (
                <section className="space-y-2">
                  <p className={SECTION_LABEL}>Salary impact</p>
                  <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                    {([
                      { label: 'Monthly Gross', pair: impact.gross },
                      { label: 'Annual CTC', pair: impact.ctc },
                      { label: 'Take Home', pair: impact.takeHome },
                    ] as const).map((r) => {
                      const d = r.pair[1] - r.pair[0];
                      return (
                        <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-[13px] text-slate-500">{r.label}</span>
                          <span className="flex items-center gap-2 text-[14px] tabular-nums">
                            <span className="text-slate-400">{formatCurrency(r.pair[0])}</span>
                            <span className="text-slate-300">→</span>
                            <span className="font-semibold text-[#0F172A]">{formatCurrency(r.pair[1])}</span>
                            <span className={cn('text-[12px] w-24 text-right', deltaClass(d))}>{signed(d)}</span>
                          </span>
                        </div>
                      );
                    })}
                    {impact.annualDelta != null && (
                      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/60">
                        <span className="text-[13px] font-medium text-slate-600">Annual Impact</span>
                        <span className={cn('text-[15px] font-semibold tabular-nums', deltaClass(impact.annualDelta))}>{signed(impact.annualDelta)}</span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* 5 · What changed */}
              {changedRows.length > 0 && (
                <section className="space-y-2">
                  <p className={SECTION_LABEL}>{changedRows.length} component{changedRows.length === 1 ? '' : 's'} changed</p>
                  <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                    {changedRows.map((r) => {
                      const d = r.next - r.current;
                      return (
                        <div key={r.key} className="flex items-center justify-between px-4 py-2">
                          <span className="text-[13px] text-[#0F172A]">{r.label}</span>
                          <span className="flex items-center gap-2 text-[13px] tabular-nums">
                            <span className="text-slate-400">{formatCurrency(r.current)}</span>
                            <span className="text-slate-300">→</span>
                            <span className="font-medium text-[#0F172A]">{formatCurrency(r.next)}</span>
                            <span className={cn('text-[12px] w-24 text-right', deltaClass(d))}>{signed(d)}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 6 · Salary breakdown */}
              {groups.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className={SECTION_LABEL}>Salary breakdown</p>
                    {recalcBusy && <span className="text-[11px] text-slate-400">recalculating…</span>}
                  </div>
                  {mode === 'components' && (
                    <p className="text-[11.5px] text-slate-400">
                      Editable components are shown as input fields. Contributions and deductions are calculated automatically.
                    </p>
                  )}
                  <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                    {groups.map((g) => {
                      const gChanged = g.rows.filter(isChanged).length;
                      const open = openGroups[g.id] ?? (g.id === 'earnings' || gChanged > 0);
                      const gTotal = g.rows.reduce((s, r) => s + r.next, 0);
                      return (
                        <div key={g.id}>
                          <button
                            type="button"
                            onClick={() => setOpenGroups((p) => ({ ...p, [g.id]: !open }))}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50/60 transition-colors"
                          >
                            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0F172A]">
                              {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                              {g.title}
                              <span className={cn('text-[11px] font-normal', gChanged > 0 ? 'text-[color:var(--color-primary)]' : 'text-slate-400')}>
                                · {gChanged > 0 ? `${gChanged} changed` : 'no change'}
                              </span>
                            </span>
                            <span className="text-[13px] font-semibold tabular-nums text-slate-500">{formatCurrency(gTotal)}</span>
                          </button>
                          {open && (
                            <div className="px-4 pb-2 overflow-x-auto">
                              <table className="w-full text-[13px] min-w-[440px]">
                                <thead>
                                  <tr className="text-slate-400 text-[11px]">
                                    <th className="text-left font-medium py-1">Component</th>
                                    <th className="text-right font-medium py-1 w-28">Current</th>
                                    <th className="text-right font-medium py-1 w-32">New</th>
                                    <th className="text-right font-medium py-1 w-24">Change</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.rows.map((r) => {
                                    const d = r.next - r.current;
                                    const changed = isChanged(r);
                                    return (
                                      <tr key={r.key} className="border-t border-slate-100">
                                        <td className={cn('py-1.5', changed ? 'text-[#0F172A]' : 'text-slate-500')}>{r.label}</td>
                                        <td className="py-1.5 text-right tabular-nums text-slate-400">{formatCurrency(r.current)}</td>
                                        <td className="py-1 text-right">
                                          {g.editable ? (
                                            <input
                                              type="number"
                                              value={compNew[r.key] ?? String(r.current)}
                                              onChange={(e) => void recalcComponent(r.key, e.target.value)}
                                              className={cn(
                                                'w-28 h-[32px] border rounded-lg px-2 text-[13px] text-right tabular-nums text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)]',
                                                changed ? 'border-[color:var(--color-primary)]/50' : 'border-slate-200'
                                              )}
                                            />
                                          ) : (
                                            <span className={cn('inline-block w-28 pr-2 tabular-nums', changed ? 'font-medium text-[#0F172A]' : 'text-slate-500')}>
                                              {formatCurrency(r.next)}
                                            </span>
                                          )}
                                        </td>
                                        <td className={cn('py-1.5 text-right tabular-nums text-[12px]', deltaClass(d))}>{changed ? signed(d) : '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {mode === 'gross'
                      ? 'Preview only — computed via calculate_emp_salary_breakup; the structure is regenerated on processing.'
                      : 'Dependent components recompute via calculate_emp_component_breakup. Only changed rows are saved.'}
                  </p>
                </section>
              )}
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-slate-200 bg-slate-50/70">
          {embedded && message && <span className="mr-auto text-[12px] text-[color:var(--color-danger-dark)]">{message}</span>}
          <button
            onClick={closeForm}
            className={cn(BTN_BASE, 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')}
          >
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!canSave || create.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {create.isPending ? 'Saving…' : 'Save Draft'}
          </button>
        </div>
      </Modal>

      {!embedded && (
      <>
      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-4">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                tab === t.key
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'due' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {cards.map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12.5px] text-slate-500">{c.label}</p>
                  <div className={cn('p-1.5 rounded-lg', c.color)}><c.icon className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-bold text-[#0F172A]">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1 flex-wrap text-[12px] mb-3">
            {DUE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setDueFilter(f.key)}
                className={cn(
                  'px-2.5 py-1 rounded-md border font-medium',
                  dueFilter === f.key
                    ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <DataTable
            data={pendingEmps?.rows ?? []}
            columns={pendingColumns}
            pageSize={10}
            pageSizeOptions={[10, 20, 30, 50]}
            isLoading={loadingPending}
            rowClassName={(r) => (r.status === 'Overdue' ? 'text-red-600' : undefined)}
          />
        </>
      ) : (
        <DataTable
          data={rows}
          columns={hikeColumns}
          pageSize={10}
          pageSizeOptions={[10, 20, 30, 50]}
          isLoading={isLoading}
        />
      )}
      </>
      )}

      {!embedded && viewId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setViewId(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[80vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading text-lg font-bold text-[#0F172A]">Increment #{viewId}</h2>
              <button onClick={() => setViewId(null)} className="text-slate-400 hover:text-slate-600 text-sm">Close</button>
            </div>
            {batch?.hike?.structure_change === 'Y' && (
              <p className="text-[12px] text-amber-700 flex items-center gap-1 mb-3">
                <AlertTriangle className="w-3.5 h-3.5" /> This is a structure-change increment. Structure-change processing is not yet available here — processing will skip these employees.
              </p>
            )}
            {batch?.hike?.remarks && <p className="text-[12.5px] text-slate-500 mb-3">Remarks: {batch.hike.remarks}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1.5 pr-3">Employee</th>
                    {batch?.hike?.item === 'Y' && <th className="py-1.5 pr-3">Component</th>}
                    <th className="py-1.5 pr-3">Current</th>
                    <th className="py-1.5 pr-3">New</th>
                    <th className="py-1.5 pr-3">Increment</th>
                    <th className="py-1.5 pr-3">Effective</th>
                    <th className="py-1.5 pr-3">Payout</th>
                    <th className="py-1.5 pr-3">Arrear</th>
                    <th className="py-1.5 pr-3">Processed</th>
                  </tr>
                </thead>
                <tbody>
                  {(batch?.details ?? []).map((d) => (
                    <tr key={d.salary_hike_details_pkey} className={cn('border-b border-slate-100', d.processed === 'N' && 'text-red-600')}>
                      <td className="py-1.5 pr-3">{d.emp_name} <span className="text-slate-400">({d.emp_company_id})</span></td>
                      {batch?.hike?.item === 'Y' && <td className="py-1.5 pr-3">{d.component_name ?? '—'}</td>}
                      <td className="py-1.5 pr-3">{formatCurrency(d.current_amount)}</td>
                      <td className="py-1.5 pr-3">{formatCurrency(d.new_amount)}</td>
                      <td className="py-1.5 pr-3">{formatCurrency(d.increment_amount)} ({d.increment_percentage.toFixed(1)}%)</td>
                      <td className="py-1.5 pr-3">{fmtDate(d.with_effect_from)}</td>
                      <td className="py-1.5 pr-3">{fmtDate(d.payout_month)}</td>
                      <td className="py-1.5 pr-3">{d.arrear_salary === 'Y' ? 'Yes' : 'No'}</td>
                      <td className="py-1.5 pr-3">{d.processed === 'Y' ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Rows in red are not yet processed.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IncrementsPage(props: IncrementsContentProps = {}) {
  return (
    <Suspense fallback={null}>
      <IncrementsContent {...props} />
    </Suspense>
  );
}
