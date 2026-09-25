'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Paperclip, Calculator, FileText, Search, CheckCircle2, Circle } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Modal } from '@/components/ui/Modal';
import Form16Page from '@/app/(dashboard)/taxation/form16/page';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { FormSkeleton, SkeletonText } from '@/components/ui/Skeleton';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const DECL_TABS = [
  { key: 'income', label: 'Income' },
  { key: 'deductions', label: 'Deductions' },
  { key: 'other', label: 'Other Totals' },
  { key: 'worksheet', label: 'Projection Worksheet' },
] as const;
type DeclTab = (typeof DECL_TABS)[number]['key'];

interface TaxSummaryRow {
  taxable_income: number; tax_yearly: number; tax_monthly_proj: number;
  surcharge: number; cess: number; rebate: number; hra1: number; hra2: number; hra3: number;
  declared_deduction: number; standerd_deduction: number; marginal_relief?: number;
  // Per-slab income/tax split, already computed by tax_salary_distribution_fn/_new_fn.
  // Old regime (3 bands) uses first_portion_tax/second_portion_tx/third_portion_tx (legacy's own
  // typo on the last two — matches the live DB columns). New regime (7 bands) uses forth_portion
  // (income) but fourth_portion_tax (tax) — same inconsistent spelling as legacy's schema/view.
  first_portion?: number; second_portion?: number; third_portion?: number;
  forth_portion?: number; fifth_portion?: number; sixth_portion?: number; seventh_portion?: number;
  first_portion_tax?: number; second_portion_tax?: number; second_portion_tx?: number;
  third_portion_tax?: number; third_portion_tx?: number; fourth_portion_tax?: number;
  fifth_portion_tax?: number; sixth_portion_tax?: number; seventh_portion_tax?: number;
}
interface TaxComputeResult {
  finYear: number;
  summary: { old: TaxSummaryRow | null; new: TaxSummaryRow | null };
}

interface Line {
  tax_heads_details_pkey: number;
  label: string;
  tax_value: number | null;
  locked: boolean;
  file_name: string | null;
}
interface Head {
  tax_heads_pkey: number;
  tax_name: string;
  tax_type: string;
  cap?: number | null;
  lines: Line[];
}
interface DeclarationData {
  noFinYear?: true;
  employee: { first_name: string; last_name: string | null };
  finYear?: { fin_year: number; start_month: string; end_month: string };
  heads?: Head[];
  otherIncomeTotal?: number;
  cappedDeductionTotal?: number;
}

interface WorksheetData {
  noFinYear?: true;
  finYear?: number;
  hasPayroll?: boolean;
  monthly?: { month: string; tds: number; gross: number; actual: boolean }[];
  totals?: { projected: number; actual: number; taxable: number };
  components?: { name: string; availed: number; upperLimit: number; taxable: number }[];
  componentsNew?: { name: string; availed: number; upperLimit: number; taxable: number }[];
  slabs?: { from: number; to: number; percent: number; stdDeduction: number; rebate: number; cessPercent: number }[];
}

interface TaxDeclarationsPageProps {
  /** When set, the page runs scoped to this one employee: no picker, no header title. */
  embeddedEmpPkey?: number;
}

export default function TaxDeclarationsPage({ embeddedEmpPkey }: TaxDeclarationsPageProps = {}) {
  const embedded = embeddedEmpPkey != null;
  const { slotEl } = useHeaderSlot();
  const { data: session } = useSession();
  const isAdmin = session?.user.userGroup === 1;
  const queryClient = useQueryClient();
  const [pickedEmpId, setPickedEmpId] = useState('');
  // Matches legacy TaxController::Tabs(): admins get the picker; a regular
  // employee is taken straight to their own record (session emp_fkey), no picker shown.
  const selfEmpId = session?.user.empFkey != null ? String(session.user.empFkey) : '';
  const showPicker = !embedded && isAdmin;
  const empId = embedded ? String(embeddedEmpPkey) : isAdmin ? pickedEmpId : selfEmpId;
  const setEmpId = setPickedEmpId;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showComputeModal, setShowComputeModal] = useState(false);
  const [showForm16Modal, setShowForm16Modal] = useState(false);
  const [declTab, setDeclTab] = useState<DeclTab>('income');
  const [declSearch, setDeclSearch] = useState('');
  const [declFilter, setDeclFilter] = useState<'all' | 'added' | 'not_added'>('all');
  const [selectedCategory, setSelectedCategory] = useState<number | 'all' | null>(null);

  const { data, isLoading } = useQuery<DeclarationData>({
    queryKey: ['employees', empId, 'tax-declarations'],
    queryFn: () => fetch(`/api/employees/${empId}/tax-declarations`).then((r) => r.json()),
    enabled: !!empId,
  });

  const finYear = data?.finYear?.fin_year;

  const save = useMutation({
    mutationFn: (vars: { tax_heads_fkey: number; tax_heads_details_fkey: number; tax_value: number }) =>
      fetch(`/api/employees/${empId}/tax-declarations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...vars, fin_year: finYear }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees', empId, 'tax-declarations'] }),
  });

  const lock = useMutation({
    mutationFn: (vars: { tax_heads_fkey?: number; tax_heads_details_fkey?: number; locked: boolean; lockAll?: boolean }) =>
      fetch(`/api/employees/${empId}/tax-declarations/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...vars, fin_year: finYear }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees', empId, 'tax-declarations'] }),
  });

  const { data: regime } = useQuery<{ optionType: 'O' | 'N' }>({
    queryKey: ['employees', empId, 'tax-regime'],
    queryFn: () => fetch(`/api/employees/${empId}/tax-regime`).then((r) => r.json()),
    enabled: !!empId,
  });

  const { data: worksheet } = useQuery<WorksheetData>({
    queryKey: ['employees', empId, 'tax-declarations', 'worksheet'],
    queryFn: () => fetch(`/api/employees/${empId}/tax-declarations/worksheet`).then((r) => r.json()),
    enabled: !!empId,
  });

  const compute = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/employees/${empId}/tax-compute`, { method: 'POST' });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Computation failed');
      return b as TaxComputeResult;
    },
    // Matches legacy's Process button, which reloads the whole Tax/setup screen after computing:
    // the DB functions rewrite the worksheet totals/components too, so refetch those alongside
    // the regime summary this mutation already returns directly. Unlike legacy's full-page reload,
    // the result is surfaced in a modal instead of inline.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', empId, 'tax-declarations'] });
      setShowComputeModal(true);
    },
  });

  const chooseRegime = useMutation({
    mutationFn: (optionType: 'O' | 'N') =>
      fetch(`/api/employees/${empId}/tax-regime`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionType }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save regime');
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees', empId, 'tax-regime'] }),
  });

  const upload = useMutation({
    mutationFn: async (vars: { tax_heads_fkey: number; tax_heads_details_fkey: number; file: File }) => {
      const fd = new FormData();
      fd.append('file', vars.file);
      fd.append('tax_heads_fkey', String(vars.tax_heads_fkey));
      fd.append('tax_heads_details_fkey', String(vars.tax_heads_details_fkey));
      fd.append('fin_year', String(finYear));
      const res = await fetch(`/api/employees/${empId}/tax-declarations/upload`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees', empId, 'tax-declarations'] }),
  });

  // Mirrors legacy's client-side Tax Deducted / Balance Tax logic (setup.ctp ~1562-1580): TDS
  // already withheld this FY (worksheet.monthly, same source both regimes use) vs. the regime's
  // yearly liability, gated by legacy's own hardcoded rebate thresholds — NOT the DB function's
  // `rebate` field, which legacy deliberately re-checks independently here.
  const REBATE_THRESHOLD = { old: 500000, new: 700000 } as const;
  function taxSettlement(s: TaxSummaryRow, key: 'old' | 'new') {
    const tdsSum = (worksheet?.monthly ?? []).reduce((sum, m) => sum + m.tds, 0);
    const withinRebate = s.taxable_income <= REBATE_THRESHOLD[key];
    // "total" mirrors legacy's separate $nettotal_new/$nettotal row (setup.ctp ~624-631) — distinct
    // from "Total Tax" (tax_yearly alone): tax_yearly + surcharge + cess, zeroed under the same
    // rebate-threshold check, same as Tax Deducted / Balance Tax below it.
    if (withinRebate) return { total: 0, taxDeducted: 0, balanceTax: 0 };
    const total = s.tax_yearly + s.surcharge + s.cess;
    return { total, taxDeducted: tdsSum, balanceTax: total - tdsSum };
  }

  function draftKey(headFkey: number, detailFkey: number) {
    return `${headFkey}:${detailFkey}`;
  }

  function isAddedLine(line: Line) {
    return line.tax_value != null && line.tax_value !== 0;
  }

  // Row version of a single declaration line — same handlers/state as before (drafts,
  // save/upload/lock mutations), just laid out horizontally like legacy instead of as a card.
  // showCategory adds a small category tag next to the label, used when browsing "All" or search
  // results where lines from multiple categories are mixed together.
  function renderDeclarationCard(head: Head, line: Line, showCategory: boolean) {
    const key = draftKey(head.tax_heads_pkey, line.tax_heads_details_pkey);
    const value = drafts[key] ?? (line.tax_value != null ? String(line.tax_value) : '');
    const files = line.file_name ? line.file_name.split(',').filter(Boolean) : [];
    const overCap = head.cap != null && Number(value || 0) > head.cap;
    const added = isAddedLine(line);

    return (
      <div key={key} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap',
            added
              ? 'bg-[color:var(--color-success-light)] text-[color:var(--color-success-dark)]'
              : 'bg-slate-100 text-slate-400'
          )}
        >
          {added ? <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> : <Circle className="w-3 h-3" aria-hidden="true" />}
          {added ? 'Added' : 'Not Added'}
        </span>

        <span className="flex-1 text-[13px] text-[#0F172A] min-w-0">
          {line.label}
          {showCategory && <span className="text-[10.5px] text-slate-400"> — {head.tax_name}</span>}
        </span>

        {head.cap != null && (
          <span className={cn('text-[11px] shrink-0', overCap ? 'text-[color:var(--color-danger)]' : 'text-slate-400')}>
            max {formatCurrency(head.cap)}
          </span>
        )}

        <input
          type="number"
          value={value}
          disabled={line.locked}
          aria-label={`${line.label} declared amount`}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
          className={cn(
            'w-28 shrink-0 px-2.5 py-1.5 border rounded-[9px] text-[12.5px] text-right focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] disabled:bg-slate-50 disabled:text-slate-400 transition-colors',
            overCap ? 'border-[color:var(--color-danger)]' : 'border-slate-200'
          )}
        />

        <button
          type="button"
          disabled={line.locked || save.isPending}
          onClick={() => save.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, tax_value: Number(value || 0) })}
          className="text-[11.5px] font-medium text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] disabled:text-slate-300 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40 rounded"
        >
          Save
        </button>

        <label
          className={cn(
            'flex items-center gap-1 text-[11.5px] shrink-0 rounded focus-within:ring-2 focus-within:ring-[color:var(--color-primary)]/40',
            line.locked ? 'text-slate-300' : 'text-slate-500 hover:text-slate-800 cursor-pointer'
          )}
        >
          <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
          <input
            type="file"
            disabled={line.locked}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, file });
              e.target.value = '';
            }}
          />
          Proof
        </label>
        {files.length > 0 && (
          <span className="text-[11px] text-slate-400 shrink-0">{files.length} file{files.length > 1 ? 's' : ''}</span>
        )}

        {isAdmin && (
          <button
            type="button"
            title={line.locked ? 'Unlock' : 'Lock'}
            onClick={() => lock.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, locked: !line.locked })}
            className={cn(
              'shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40 rounded',
              line.locked ? 'text-[color:var(--color-highlight-dark)] hover:opacity-80' : 'text-slate-300 hover:text-slate-600'
            )}
          >
            {line.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {!embedded && slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Employee Income Tax Declarations
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Declarations, proofs, regime comparison, and projection per employee
            </p>
          </div>,
          slotEl
        )}

      {embedded && (
        <h2 className="font-heading text-[20px] font-bold text-[#0F172A] tracking-tight mb-4">Income Tax Declarations</h2>
      )}

      {showPicker && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 max-w-sm">
          <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
        </div>
      )}

      {showPicker && !empId && <p className="text-[12.5px] text-slate-400">Select an employee to view their tax declarations.</p>}
      {!embedded && !isAdmin && !selfEmpId && (
        <p className="text-[12.5px] text-slate-400">No employee record is linked to your account.</p>
      )}
      {empId && isLoading && <FormSkeleton fields={8} />}

      {data?.noFinYear && (
        <div className="surface-card rounded-2xl p-6 text-[13px] text-slate-500">
          No open financial year found for {data.employee.first_name}&apos;s branch. Declarations can&apos;t be entered until one is opened in Company Setup.
        </div>
      )}

      {data?.heads && data.finYear && (
        <div className="space-y-4">
          <div className="flex items-center justify-between surface-card rounded-xl px-4 py-2.5">
            <div>
              <p className="text-[13px] font-medium text-[#0F172A]">
                {data.employee.first_name} {data.employee.last_name ?? ''} — FY {data.finYear.fin_year}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Open financial year (auto-selected: most recently started OPEN year for this branch)
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowForm16Modal(true)}
                className={cn(BTN_BASE, 'bg-slate-100 text-slate-600 hover:bg-slate-200 shadow-none')}
              >
                <FileText className="w-3.5 h-3.5" />
                Form 16
              </button>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => lock.mutate({ lockAll: true, locked: true })}
                    className={cn(BTN_BASE, 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)] hover:opacity-80 shadow-none')}
                  >
                    Lock all
                  </button>
                  <button
                    type="button"
                    onClick={() => lock.mutate({ lockAll: true, locked: false })}
                    className={cn(BTN_BASE, 'bg-slate-100 text-slate-600 hover:bg-slate-200 shadow-none')}
                  >
                    Unlock all
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="surface-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide">Regime Comparison</h2>
              <button
                type="button"
                onClick={() => compute.mutate()}
                disabled={compute.isPending}
                className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
              >
                <Calculator className="w-3.5 h-3.5" />
                {compute.isPending ? 'Processing…' : 'Process'}
              </button>
            </div>

            {regime && (
              <p className="text-[11.5px] text-slate-500 mb-3">
                Current regime: <span className="font-medium text-slate-700">{regime.optionType === 'O' ? 'Old' : 'New'}</span>
              </p>
            )}

            {compute.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mb-2">{String(compute.error)}</p>}

            {compute.data && !showComputeModal && (
              <button
                type="button"
                onClick={() => setShowComputeModal(true)}
                className="text-[11.5px] font-medium text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)]"
              >
                View last projection result
              </button>
            )}
          </div>

          <Modal open={showComputeModal && !!compute.data} onClose={() => setShowComputeModal(false)} className="max-w-6xl">
            <h2 className="text-[15px] font-semibold text-[#0F172A] mb-4">Regime Comparison Result</h2>
            {compute.data && (
              <div className="grid grid-cols-2 gap-4">
                {(['old', 'new'] as const).map((key) => {
                  const s = compute.data!.summary[key];
                  const label = key === 'old' ? 'Old Regime' : 'New Regime';
                  const optionType = key === 'old' ? 'O' : 'N';
                  return (
                    <div key={key} className="border border-slate-100 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] font-medium text-slate-700">{label}</span>
                        <button
                          type="button"
                          onClick={() => chooseRegime.mutate(optionType)}
                          disabled={chooseRegime.isPending || regime?.optionType === optionType}
                          className="text-[11.5px] font-medium text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] disabled:text-slate-300"
                        >
                          {regime?.optionType === optionType ? 'Selected' : 'Choose'}
                        </button>
                      </div>
                      {s ? (
                        <div className="space-y-3 text-[11.5px] text-slate-500">
                          {/* Summary Calculation — mirrors legacy's first box (setup.ctp Summary Calculation) */}
                          <div className="space-y-1">
                            <div className="flex justify-between"><span>Taxable income</span><span>{formatCurrency(s.taxable_income)}</span></div>
                            {key === 'old' && <div className="flex justify-between"><span>HRA exemption</span><span>{formatCurrency(Math.min(s.hra1 || 0, s.hra2 || 0, s.hra3 || 0))}</span></div>}
                            <div className="flex justify-between"><span>Standard deduction</span><span>{formatCurrency(s.standerd_deduction)}</span></div>
                            {key === 'new' && (
                              <div className="flex justify-between">
                                <span>Marginal relief {s.taxable_income >= 1200001 && s.taxable_income <= 1275000 ? '' : '(NA)'}</span>
                                <span>{formatCurrency(s.marginal_relief ?? 0)}</span>
                              </div>
                            )}
                          </div>

                          {/* Tax Details — same rows, same order, same labels as legacy's Tax Details box
                              (setup.ctp ~600-648 new, ~1085-1099 old) so the two can be checked side by side. */}
                          {(() => {
                            const { total, taxDeducted, balanceTax } = taxSettlement(s, key);
                            return (
                              <div className="space-y-1 pt-2 border-t border-slate-100">
                                <p className="text-[11px] font-medium text-slate-400">Tax Details</p>
                                <div className="flex justify-between"><span>Total Tax</span><span>{formatCurrency(s.tax_yearly)}</span></div>
                                <div className="flex justify-between"><span>Cess</span><span>{formatCurrency(s.cess)}</span></div>
                                <div className="flex justify-between"><span>Surcharge</span><span>{formatCurrency(s.surcharge)}</span></div>
                                <div className="flex justify-between"><span>Rebate</span><span>{formatCurrency(s.rebate)}</span></div>
                                <div className="flex justify-between font-medium text-[#0F172A]"><span>Total</span><span>{formatCurrency(total)}</span></div>
                                <div className="flex justify-between"><span>Tax Deducted</span><span>{formatCurrency(taxDeducted)}</span></div>
                                <div className="flex justify-between"><span>Balance Tax</span><span>{formatCurrency(balanceTax)}</span></div>
                                <div className="flex justify-between font-medium text-[#0F172A]"><span>Monthly Tax</span><span>{formatCurrency(s.tax_monthly_proj)}</span></div>
                              </div>
                            );
                          })()}

                          {/* Salary for the Year — legacy repeats this per regime (setup.ctp ~698-812 new,
                              ~1160-1268 old); same source data both regimes (actual payroll), but months
                              without processed payroll fall back to this regime's own projected monthly
                              tax, shown in red, instead of a bare 0. */}
                          {worksheet?.monthly && worksheet.monthly.length > 0 && (
                            <div className="pt-2 border-t border-slate-100">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[11px] font-medium text-slate-400">Salary for the Year</p>
                                <p className="text-[10px] text-slate-400">
                                  <span className="text-[#0F172A] font-medium">Actual</span> · <span className="text-[color:var(--color-danger)] font-medium">Projected</span>
                                </p>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-slate-400 text-left border-b border-slate-100">
                                      <th className="py-1 font-medium">Month</th>
                                      <th className="py-1 font-medium text-right">Salary</th>
                                      <th className="py-1 font-medium text-right">Tax</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {worksheet.monthly.map((m) => (
                                      <tr key={m.month} className="border-b border-slate-50">
                                        <td className="py-1 text-[#0F172A]">{m.month}</td>
                                        <td className={cn('py-1 text-right', m.actual ? 'text-[#0F172A]' : 'text-[color:var(--color-danger)]')}>{formatCurrency(m.gross)}</td>
                                        <td className={cn('py-1 text-right', m.actual ? 'text-[#0F172A]' : 'text-[color:var(--color-danger)]')}>
                                          {formatCurrency(m.actual ? m.tds : (s.tax_monthly_proj ?? 0))}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11.5px] text-slate-400">No projection yet.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Modal>

          <Modal open={showForm16Modal} onClose={() => setShowForm16Modal(false)} className="max-w-6xl">
            <Form16Page embedded initialEmpId={empId} />
          </Modal>

          <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5 w-fit">
            {DECL_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setDeclTab(t.key)}
                className={cn(
                  'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                  declTab === t.key
                    ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                    : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {(declTab === 'income' || declTab === 'deductions') && (() => {
            const type = declTab === 'income' ? 'Income' : 'Deductions';
            const headsOfType = data.heads!.filter((h) => h.tax_type === type);

            if (headsOfType.length === 0) {
              return (
                <div className="surface-card rounded-2xl p-5">
                  <p className="text-[12.5px] text-slate-400">No {type.toLowerCase()} tax heads configured.</p>
                </div>
              );
            }

            const catPkeys = headsOfType.map((h) => h.tax_heads_pkey);
            const effectiveCategory: number | 'all' =
              selectedCategory === 'all'
                ? 'all'
                : catPkeys.includes(selectedCategory as number)
                  ? (selectedCategory as number)
                  : headsOfType[0].tax_heads_pkey;

            const search = declSearch.trim().toLowerCase();
            const passesFilter = (line: Line) => {
              const added = isAddedLine(line);
              if (declFilter === 'added') return added;
              if (declFilter === 'not_added') return !added;
              return true;
            };

            let entries: { head: Head; line: Line }[];
            let showCategoryTag: boolean;
            if (search) {
              entries = headsOfType.flatMap((h) =>
                h.lines.filter((l) => l.label.toLowerCase().includes(search)).map((l) => ({ head: h, line: l }))
              );
              showCategoryTag = true;
            } else if (effectiveCategory === 'all') {
              entries = headsOfType.flatMap((h) => h.lines.map((l) => ({ head: h, line: l })));
              showCategoryTag = true;
            } else {
              const h = headsOfType.find((x) => x.tax_heads_pkey === effectiveCategory)!;
              entries = h.lines.map((l) => ({ head: h, line: l }));
              showCategoryTag = false;
            }
            entries = entries.filter(({ line }) => passesFilter(line));

            const totalCount = headsOfType.reduce((sum, h) => sum + h.lines.length, 0);
            const totalAdded = headsOfType.reduce((sum, h) => sum + h.lines.filter(isAddedLine).length, 0);
            const paneTitle = search
              ? `Search results for "${declSearch.trim()}"`
              : effectiveCategory === 'all'
                ? `All ${type}`
                : headsOfType.find((h) => h.tax_heads_pkey === effectiveCategory)?.tax_name ?? type;

            return (
              <div className="surface-card rounded-2xl overflow-hidden">
                {/* Sticky search + Added/Not Added filter bar — stays visible while the card grid below scrolls. */}
                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 p-3 flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[180px] max-w-xs">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      type="text"
                      value={declSearch}
                      onChange={(e) => setDeclSearch(e.target.value)}
                      placeholder="Search declarations…"
                      aria-label="Search declarations"
                      className="w-full pl-8 pr-2.5 py-1.5 border border-slate-200 rounded-[9px] text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-slate-900/[0.03] rounded-lg p-0.5 text-[11.5px]">
                    {([
                      { key: 'all', label: 'All' },
                      { key: 'added', label: 'Added' },
                      { key: 'not_added', label: 'Not Added' },
                    ] as const).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setDeclFilter(f.key)}
                        className={cn(
                          'px-2.5 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40',
                          declFilter === f.key
                            ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                            : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-400 ml-auto">
                    {totalAdded} / {totalCount} added
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row">
                  {/* Category sidebar — sticky while the card grid scrolls, so it stays reachable
                      without needing to scroll back up (req 9). */}
                  <aside className="sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-slate-100 p-2 sm:sticky sm:top-[57px] sm:self-start sm:max-h-[70vh] sm:overflow-y-auto">
                    <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-x-visible">
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('all')}
                        className={cn(
                          'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40',
                          effectiveCategory === 'all'
                            ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] font-medium'
                            : 'text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <span>All</span>
                        <span className="text-[10.5px] text-slate-400">{totalCount}</span>
                      </button>
                      {headsOfType.map((h) => {
                        const addedInCat = h.lines.filter(isAddedLine).length;
                        return (
                          <button
                            key={h.tax_heads_pkey}
                            type="button"
                            onClick={() => setSelectedCategory(h.tax_heads_pkey)}
                            className={cn(
                              'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left whitespace-nowrap sm:whitespace-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40',
                              effectiveCategory === h.tax_heads_pkey
                                ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] font-medium'
                                : 'text-slate-600 hover:bg-slate-50'
                            )}
                          >
                            <span className="truncate">{h.tax_name}</span>
                            <span className="text-[10.5px] text-slate-400 shrink-0">{addedInCat}/{h.lines.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  </aside>

                  <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide truncate">{paneTitle}</h3>
                      <span className="text-[11px] text-slate-400 shrink-0 ml-2">{entries.length} shown</span>
                    </div>
                    {entries.length === 0 ? (
                      <p className="text-[12.5px] text-slate-400 py-6 text-center">No declarations match.</p>
                    ) : (
                      <div>
                        {entries.map(({ head, line }) => renderDeclarationCard(head, line, showCategoryTag))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {declTab === 'other' && (
            (data.otherIncomeTotal != null || data.cappedDeductionTotal != null) ? (
              <div className="surface-card rounded-2xl p-5 grid grid-cols-2 gap-4 text-[12.5px]">
                <div>
                  <p className="text-[11px] text-slate-400">Income from other sources (declared)</p>
                  <p className="text-[15px] font-semibold text-[#0F172A]">{formatCurrency(data.otherIncomeTotal ?? 0)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400">Effective deductions (after statutory caps)</p>
                  <p className="text-[15px] font-semibold text-[#0F172A]">{formatCurrency(data.cappedDeductionTotal ?? 0)}</p>
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-slate-400">No totals available.</p>
            )
          )}

          {declTab === 'worksheet' && (
          <div className="surface-card rounded-2xl p-5">
            <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Projection Worksheet</h2>
            {!worksheet && <SkeletonText lines={6} />}
            {worksheet?.noFinYear && <p className="text-[12px] text-slate-400">No open financial year for this branch.</p>}
            {worksheet && !worksheet.noFinYear && !worksheet.hasPayroll && (
              <p className="text-[12px] text-slate-400">
                No processed payroll yet for this employee in FY {worksheet.finYear}. Month-wise TDS and projected
                salary appear here once payroll has been run and approved.
              </p>
            )}
            {worksheet && worksheet.hasPayroll && (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-4 text-[12.5px]">
                  <div><p className="text-[11px] text-slate-400">Projected salary</p><p className="text-[15px] font-semibold text-[#0F172A]">{formatCurrency(worksheet.totals?.projected ?? 0)}</p></div>
                  <div><p className="text-[11px] text-slate-400">Actual salary received</p><p className="text-[15px] font-semibold text-[#0F172A]">{formatCurrency(worksheet.totals?.actual ?? 0)}</p></div>
                  <div><p className="text-[11px] text-slate-400">Taxable salary</p><p className="text-[15px] font-semibold text-[#0F172A]">{formatCurrency(worksheet.totals?.taxable ?? 0)}</p></div>
                </div>

                {worksheet.monthly && worksheet.monthly.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-slate-400 text-left border-b border-slate-100">
                          <th className="py-1.5 font-medium">Month</th>
                          <th className="py-1.5 font-medium text-right">Gross paid</th>
                          <th className="py-1.5 font-medium text-right">TDS deducted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {worksheet.monthly.map((m) => (
                          <tr key={m.month} className="border-b border-slate-50">
                            <td className="py-1.5 text-[#0F172A]">{m.month}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(m.gross)}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(m.tds)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {worksheet.components && worksheet.components.length > 0 && (
                  <div className="overflow-x-auto">
                    <p className="text-[11px] font-medium text-slate-400 mb-1">Exempt allowances — Old regime</p>
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-slate-400 text-left border-b border-slate-100">
                          <th className="py-1.5 font-medium">Component</th>
                          <th className="py-1.5 font-medium text-right">Availed</th>
                          <th className="py-1.5 font-medium text-right">Upper limit</th>
                          <th className="py-1.5 font-medium text-right">Taxable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {worksheet.components.map((c, i) => (
                          <tr key={`${c.name}-${i}`} className="border-b border-slate-50">
                            <td className="py-1.5 text-[#0F172A]">{c.name}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(c.availed)}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(c.upperLimit)}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(c.taxable)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {worksheet.componentsNew && worksheet.componentsNew.length > 0 && (
                  <div className="overflow-x-auto mt-4">
                    <p className="text-[11px] font-medium text-slate-400 mb-1">Exempt allowances — New regime</p>
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-slate-400 text-left border-b border-slate-100">
                          <th className="py-1.5 font-medium">Component</th>
                          <th className="py-1.5 font-medium text-right">Availed</th>
                          <th className="py-1.5 font-medium text-right">Upper limit</th>
                          <th className="py-1.5 font-medium text-right">Taxable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {worksheet.componentsNew.map((c, i) => (
                          <tr key={`${c.name}-${i}`} className="border-b border-slate-50">
                            <td className="py-1.5 text-[#0F172A]">{c.name}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(c.availed)}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(c.upperLimit)}</td>
                            <td className="py-1.5 text-right text-slate-600">{formatCurrency(c.taxable)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {worksheet && !worksheet.noFinYear && worksheet.slabs && worksheet.slabs.length > 0 && (() => {
              // Zips the slab schedule against the already-computed per-band income/tax split
              // (legacy setup.ctp ~400-452: $income_portions / $tax_portions arrays, positional).
              const newSummary = compute.data?.summary.new;
              const incomeKeys = ['first_portion', 'second_portion', 'third_portion', 'forth_portion', 'fifth_portion', 'sixth_portion', 'seventh_portion'] as const;
              const taxKeys = ['first_portion_tax', 'second_portion_tax', 'third_portion_tax', 'fourth_portion_tax', 'fifth_portion_tax', 'sixth_portion_tax', 'seventh_portion_tax'] as const;
              const totalIncome = incomeKeys.reduce((sum, k) => sum + (newSummary?.[k] ?? 0), 0);
              const totalTax = taxKeys.reduce((sum, k) => sum + (newSummary?.[k] ?? 0), 0);
              return (
                <div className="overflow-x-auto mt-5">
                  <p className="text-[11px] font-medium text-slate-400 mb-1">New-regime slabs — FY {worksheet.finYear}</p>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-slate-400 text-left border-b border-slate-100">
                        <th className="py-1.5 font-medium">From</th>
                        <th className="py-1.5 font-medium">To</th>
                        <th className="py-1.5 font-medium text-right">Rate</th>
                        <th className="py-1.5 font-medium text-right">Income</th>
                        <th className="py-1.5 font-medium text-right">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worksheet.slabs!.map((s, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="py-1.5 text-[#0F172A]">{formatCurrency(s.from)}</td>
                          <td className="py-1.5 text-[#0F172A]">{i === worksheet.slabs!.length - 1 ? 'and beyond' : formatCurrency(s.to)}</td>
                          <td className="py-1.5 text-right text-slate-600">{s.percent}%</td>
                          <td className="py-1.5 text-right text-slate-600">{formatCurrency(newSummary?.[incomeKeys[i]] ?? 0)}</td>
                          <td className="py-1.5 text-right text-slate-600">{formatCurrency(newSummary?.[taxKeys[i]] ?? 0)}</td>
                        </tr>
                      ))}
                      <tr className="font-medium text-[#0F172A]">
                        <td className="py-1.5" colSpan={3}>Total</td>
                        <td className="py-1.5 text-right">{formatCurrency(totalIncome)}</td>
                        <td className="py-1.5 text-right">{formatCurrency(totalTax)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {worksheet && !worksheet.noFinYear && compute.data?.summary.old && (() => {
              // Old regime's slab bands are hardcoded in legacy too (setup.ctp ~898-958) — not
              // sourced from income_tax_slab, which is only ever queried for regime='NEW'.
              const s = compute.data.summary.old!;
              const rows = [
                { label: 'Rs.0 - Rs.2,50,000', rate: '0%', income: 0, tax: 0 },
                { label: 'Rs.2,50,000 - Rs.5,00,000', rate: '5%', income: s.first_portion ?? 0, tax: s.first_portion_tax ?? 0 },
                { label: 'Rs.5,00,000 - Rs.10,00,000 +', rate: '20%', income: s.second_portion ?? 0, tax: s.second_portion_tx ?? 0 },
                { label: 'Rs.10,00,000 and beyond +', rate: '30%', income: s.third_portion ?? 0, tax: s.third_portion_tx ?? 0 },
              ];
              const totalIncome = rows.reduce((sum, r) => sum + r.income, 0);
              return (
                <div className="overflow-x-auto mt-5">
                  <p className="text-[11px] font-medium text-slate-400 mb-1">Old-regime slabs — FY {worksheet.finYear}</p>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-slate-400 text-left border-b border-slate-100">
                        <th className="py-1.5 font-medium">Band</th>
                        <th className="py-1.5 font-medium text-right">Rate</th>
                        <th className="py-1.5 font-medium text-right">Income</th>
                        <th className="py-1.5 font-medium text-right">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="py-1.5 text-[#0F172A]">{r.label}</td>
                          <td className="py-1.5 text-right text-slate-600">{r.rate}</td>
                          <td className="py-1.5 text-right text-slate-600">{formatCurrency(r.income)}</td>
                          <td className="py-1.5 text-right text-slate-600">{formatCurrency(r.tax)}</td>
                        </tr>
                      ))}
                      <tr className="font-medium text-[#0F172A]">
                        <td className="py-1.5" colSpan={2}>Total</td>
                        <td className="py-1.5 text-right">{formatCurrency(totalIncome)}</td>
                        <td className="py-1.5 text-right">{formatCurrency(s.tax_yearly)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
          )}

          {(save.isError || lock.isError || upload.isError) && (
            <p className="text-[color:var(--color-danger)] text-[12.5px]">
              {String(save.error || lock.error || upload.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
