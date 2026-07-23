'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Paperclip, Calculator } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { formatCurrency } from '@/lib/utils';

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
  lines: Line[];
}
interface DeclarationData {
  noFinYear?: true;
  employee: { first_name: string; last_name: string | null };
  finYear?: { fin_year: number; start_month: string; end_month: string };
  heads?: Head[];
}

export default function TaxDeclarationsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user.userGroup === 1;
  const queryClient = useQueryClient();
  const [empId, setEmpId] = useState('');
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

    return (
      <div key={key} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
        <span className="flex-1 text-sm text-gray-800">{line.label}</span>

        <input
          type="number"
          value={value}
          disabled={line.locked}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
          className="w-32 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
        />

        <button
          type="button"
          disabled={line.locked || save.isPending}
          onClick={() => save.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, tax_value: Number(value || 0) })}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-gray-300"
        >
          Save
        </button>

        <label className={`flex items-center gap-1 text-xs ${line.locked ? 'text-gray-300' : 'text-gray-500 hover:text-gray-800 cursor-pointer'}`}>
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
          <span className="text-xs text-gray-400">{files.length} file{files.length > 1 ? 's' : ''}</span>
        )}

        {isAdmin && (
          <button
            type="button"
            title={line.locked ? 'Unlock' : 'Lock'}
            onClick={() => lock.mutate({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, locked: !line.locked })}
            className={line.locked ? 'text-amber-600 hover:text-amber-800' : 'text-gray-300 hover:text-gray-600'}
          >
            {line.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Employee Income Tax Declarations</h1>

      <div className="max-w-sm mb-6">
        <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
      </div>

      {!empId && <p className="text-sm text-gray-400">Select an employee to view their tax declarations.</p>}
      {empId && isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {data?.noFinYear && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">
          No open financial year found for {data.employee.first_name}&apos;s branch. Declarations can&apos;t be entered until one is opened in Company Setup.
        </div>
      )}

      {data?.heads && data.finYear && (
        <div className="space-y-5">
          <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {data.employee.first_name} {data.employee.last_name ?? ''} — FY {data.finYear.fin_year}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Open financial year (auto-selected: most recently started OPEN year for this branch)
              </p>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => lock.mutate({ lockAll: true, locked: true })}
                  className="px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
                >
                  Lock all
                </button>
                <button
                  type="button"
                  onClick={() => lock.mutate({ lockAll: true, locked: false })}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Unlock all
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Regime Comparison</h2>
              <button
                type="button"
                onClick={() => compute.mutate()}
                disabled={compute.isPending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                <Calculator className="w-3.5 h-3.5" />
                {compute.isPending ? 'Computing…' : 'Compute Projection'}
              </button>
            </div>

            {regime && (
              <p className="text-xs text-gray-500 mb-3">
                Current regime: <span className="font-medium text-gray-800">{regime.optionType === 'O' ? 'Old' : 'New'}</span>
              </p>
            )}

            {compute.isError && <p className="text-red-500 text-sm mb-2">{String(compute.error)}</p>}

            {compute.data && (
              <div className="grid grid-cols-2 gap-4">
                {(['old', 'new'] as const).map((key) => {
                  const s = compute.data!.summary[key];
                  const label = key === 'old' ? 'Old Regime' : 'New Regime';
                  const optionType = key === 'old' ? 'O' : 'N';
                  return (
                    <div key={key} className="border border-gray-100 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-800">{label}</span>
                        <button
                          type="button"
                          onClick={() => chooseRegime.mutate(optionType)}
                          disabled={chooseRegime.isPending || regime?.optionType === optionType}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-gray-300"
                        >
                          {regime?.optionType === optionType ? 'Selected' : 'Choose'}
                        </button>
                      </div>
                      {s ? (
                        <div className="space-y-1 text-xs text-gray-600">
                          <div className="flex justify-between"><span>Taxable income</span><span>{formatCurrency(s.taxable_income)}</span></div>
                          {key === 'old' && <div className="flex justify-between"><span>HRA exemption</span><span>{formatCurrency(Math.min(s.hra1 || 0, s.hra2 || 0, s.hra3 || 0))}</span></div>}
                          <div className="flex justify-between"><span>Standard deduction</span><span>{formatCurrency(s.standerd_deduction)}</span></div>
                          <div className="flex justify-between"><span>Surcharge</span><span>{formatCurrency(s.surcharge)}</span></div>
                          <div className="flex justify-between"><span>Cess</span><span>{formatCurrency(s.cess)}</span></div>
                          <div className="flex justify-between"><span>Rebate</span><span>{formatCurrency(s.rebate)}</span></div>
                          <div className="flex justify-between font-medium text-gray-900 pt-1 border-t border-gray-100"><span>Yearly tax</span><span>{formatCurrency(s.tax_yearly)}</span></div>
                          <div className="flex justify-between font-medium text-gray-900"><span>Monthly TDS</span><span>{formatCurrency(s.tax_monthly_proj)}</span></div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">No projection yet.</p>
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
              <div key={type} className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{type}</h2>
                {headsOfType.map((head) => (
                  <div key={head.tax_heads_pkey} className="mt-3 first:mt-0">
                    {head.lines.length > 1 && <p className="text-xs font-medium text-gray-400 mb-1">{head.tax_name}</p>}
                    {head.lines.map((line) => renderLine(head, line))}
                  </div>
                ))}
              </div>
            );
          })}

          {(save.isError || lock.isError || upload.isError) && (
            <p className="text-red-500 text-sm">
              {String(save.error || lock.error || upload.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
