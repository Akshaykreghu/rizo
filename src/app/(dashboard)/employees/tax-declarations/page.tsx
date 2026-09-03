'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Paperclip, Calculator } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface TaxSummaryRow {
  taxable_income: number; tax_yearly: number; tax_monthly_proj: number;
  surcharge: number; cess: number; rebate: number; hra1: number; hra2: number; hra3: number;
  declared_deduction: number; standerd_deduction: number;
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
  monthly?: { month: string; tds: number; gross: number }[];
  totals?: { projected: number; actual: number; taxable: number };
  components?: { name: string; availed: number; upperLimit: number; taxable: number }[];
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
  const empId = embedded ? String(embeddedEmpPkey) : pickedEmpId;
  const setEmpId = setPickedEmpId;
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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

  function draftKey(headFkey: number, detailFkey: number) {
    return `${headFkey}:${detailFkey}`;
  }

  function renderLine(head: Head, line: Line) {
    const key = draftKey(head.tax_heads_pkey, line.tax_heads_details_pkey);
    const value = drafts[key] ?? (line.tax_value != null ? String(line.tax_value) : '');
    const files = line.file_name ? line.file_name.split(',').filter(Boolean) : [];
    const overCap = head.cap != null && Number(value || 0) > head.cap;

    return (
      <div key={key} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
        <span className="flex-1 text-[13px] text-[#0F172A]">{line.label}</span>

        {head.cap != null && (
          <span className={cn('text-[11px]', overCap ? 'text-[color:var(--color-danger)]' : 'text-slate-400')}>
            max {formatCurrency(head.cap)}
          </span>
        )}

        <input
          type="number"
          value={value}
          disabled={line.locked}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
          className={cn(
            'w-28 px-2.5 py-1.5 border rounded-[9px] text-[12.5px] text-right focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] disabled:bg-slate-50 disabled:text-slate-400 transition-colors',
            overCap ? 'border-[color:var(--color-danger)]' : 'border-slate-200'
          )}
        />

        <button
          type="button"
          disabled={line.locked || save.isPending}
          onClick={() => save.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, tax_value: Number(value || 0) })}
          className="text-[11.5px] font-medium text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] disabled:text-slate-300"
        >
          Save
        </button>

        <label className={cn('flex items-center gap-1 text-[11.5px]', line.locked ? 'text-slate-300' : 'text-slate-500 hover:text-slate-800 cursor-pointer')}>
          <Paperclip className="w-3.5 h-3.5" />
          <input
            type="file"
            disabled={line.locked}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, file });
              e.target.value = '';
            }}
          />
          Proof
        </label>
        {files.length > 0 && (
          <span className="text-[11px] text-slate-400">{files.length} file{files.length > 1 ? 's' : ''}</span>
        )}

        {isAdmin && (
          <button
            type="button"
            title={line.locked ? 'Unlock' : 'Lock'}
            onClick={() => lock.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, locked: !line.locked })}
            className={line.locked ? 'text-[color:var(--color-highlight-dark)] hover:opacity-80' : 'text-slate-300 hover:text-slate-600'}
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

      {!embedded && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 max-w-sm">
          <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
        </div>
      )}

      {!embedded && !empId && <p className="text-[12.5px] text-slate-400">Select an employee to view their tax declarations.</p>}
      {empId && isLoading && <p className="text-[12.5px] text-slate-400">Loading…</p>}

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
            {isAdmin && (
              <div className="flex gap-2">
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
              </div>
            )}
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
                {compute.isPending ? 'Computing…' : 'Compute Projection'}
              </button>
            </div>

            {regime && (
              <p className="text-[11.5px] text-slate-500 mb-3">
                Current regime: <span className="font-medium text-slate-700">{regime.optionType === 'O' ? 'Old' : 'New'}</span>
              </p>
            )}

            {compute.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mb-2">{String(compute.error)}</p>}

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
                        <div className="space-y-1 text-[11.5px] text-slate-500">
                          <div className="flex justify-between"><span>Taxable income</span><span>{formatCurrency(s.taxable_income)}</span></div>
                          {key === 'old' && <div className="flex justify-between"><span>HRA exemption</span><span>{formatCurrency(Math.min(s.hra1 || 0, s.hra2 || 0, s.hra3 || 0))}</span></div>}
                          <div className="flex justify-between"><span>Standard deduction</span><span>{formatCurrency(s.standerd_deduction)}</span></div>
                          <div className="flex justify-between"><span>Surcharge</span><span>{formatCurrency(s.surcharge)}</span></div>
                          <div className="flex justify-between"><span>Cess</span><span>{formatCurrency(s.cess)}</span></div>
                          <div className="flex justify-between"><span>Rebate</span><span>{formatCurrency(s.rebate)}</span></div>
                          <div className="flex justify-between font-medium text-[#0F172A] pt-1 border-t border-slate-100"><span>Yearly tax</span><span>{formatCurrency(s.tax_yearly)}</span></div>
                          <div className="flex justify-between font-medium text-[#0F172A]"><span>Monthly TDS</span><span>{formatCurrency(s.tax_monthly_proj)}</span></div>
                        </div>
                      ) : (
                        <p className="text-[11.5px] text-slate-400">No projection yet.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {['Income', 'Deductions'].map((type) => {
            const headsOfType = data.heads!.filter((h) => h.tax_type === type);
            if (!headsOfType.length) return null;
            return (
              <div key={type} className="surface-card rounded-2xl p-5">
                <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-2">{type}</h2>
                {headsOfType.map((head) => (
                  <div key={head.tax_heads_pkey} className="mt-3 first:mt-0">
                    {head.lines.length > 1 && <p className="text-[11px] font-medium text-slate-400 mb-1">{head.tax_name}</p>}
                    {head.lines.map((line) => renderLine(head, line))}
                  </div>
                ))}
              </div>
            );
          })}

          {(data.otherIncomeTotal != null || data.cappedDeductionTotal != null) && (
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
          )}

          <div className="surface-card rounded-2xl p-5">
            <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Projection Worksheet</h2>
            {!worksheet && <p className="text-[12px] text-slate-400">Loading…</p>}
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
                    <p className="text-[11px] font-medium text-slate-400 mb-1">Exempt allowances</p>
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
              </div>
            )}

            {worksheet && !worksheet.noFinYear && worksheet.slabs && worksheet.slabs.length > 0 && (
              <div className="overflow-x-auto mt-5">
                <p className="text-[11px] font-medium text-slate-400 mb-1">New-regime slabs — FY {worksheet.finYear}</p>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-slate-400 text-left border-b border-slate-100">
                      <th className="py-1.5 font-medium">From</th>
                      <th className="py-1.5 font-medium">To</th>
                      <th className="py-1.5 font-medium text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worksheet.slabs.map((s, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5 text-[#0F172A]">{formatCurrency(s.from)}</td>
                        <td className="py-1.5 text-[#0F172A]">{formatCurrency(s.to)}</td>
                        <td className="py-1.5 text-right text-slate-600">{s.percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

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
