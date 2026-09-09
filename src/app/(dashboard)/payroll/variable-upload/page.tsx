'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, Upload, Trash2, Pencil, Lock } from 'lucide-react';
import { useRef } from 'react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useSetupOptions } from '@/lib/setupOptions';
import { cn, formatCurrency, currentYearMonth } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

interface HeadItem {
  salary_head_item_pkey: number;
  item: string;
  head_operator: string;
}

interface VariableRow {
  emp_variables_upload_pkey: number;
  emp_fkey: number;
  emp_name: string;
  month_year: string; // 'MM-YYYY'
  salary_head_item_fkey: number;
  salary_head_item_desc: string;
  uploaded_amount: number;
  head_operator: string;
  head_type: string;
  item_part: string;
  remarks: string | null;
  action: string | null;
  is_machine_row: 0 | 1;
}

interface BulkResult {
  imported: number;
  errors: { row: number; message: string }[];
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function evuToMonthInput(evu: string): string {
  const m = /^(\d{2})-(\d{4})$/.exec(evu ?? '');
  return m ? `${m[2]}-${m[1]}` : '';
}

interface FormState {
  pkey?: number;
  empId: string;
  month: string;
  salaryHeadItemFkey: string;
  amount: string;
  remarks: string;
}

const EMPTY_FORM: FormState = { empId: '', month: '', salaryHeadItemFkey: '', amount: '', remarks: '' };

export default function VariableUploadPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [month, setMonth] = useState(currentYearMonth());
  const [branch, setBranch] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [headFilter, setHeadFilter] = useState('');

  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkResult | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data: headData } = useQuery<{ items: HeadItem[] }>({
    queryKey: ['variable-upload/head-items'],
    queryFn: () => fetch('/api/payroll/variable-upload/head-items').then((r) => r.json()),
  });
  const headItems = headData?.items ?? [];

  const listParams = new URLSearchParams();
  if (month) listParams.set('month', month);
  if (branch) listParams.set('branch', branch);
  if (empFilter) listParams.set('empFkey', empFilter);
  if (headFilter) listParams.set('salaryHeadItemFkey', headFilter);

  const { data, isLoading } = useQuery<{ rows: VariableRow[]; total: number }>({
    queryKey: ['variable-upload', month, branch, empFilter, headFilter],
    queryFn: () => fetch(`/api/payroll/variable-upload?${listParams.toString()}`).then((r) => r.json()),
  });
  const rows = data?.rows ?? [];

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const res = await fetch('/api/payroll/variable-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pkey: f.pkey,
          empFkey: Number(f.empId),
          salaryHeadItemFkey: Number(f.salaryHeadItemFkey),
          month: f.month,
          amount: Number(f.amount),
          remarks: f.remarks || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to save');
      return b;
    },
    onSuccess: () => {
      setMessage(form?.pkey ? 'Variable updated.' : 'Variable saved.');
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['variable-upload'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const remove = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch('/api/payroll/variable-upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      return res.json() as Promise<{ deleted: number; skipped: number[] }>;
    },
    onSuccess: (r) => {
      setChecked(new Set());
      setMessage(
        r.skipped.length > 0
          ? `${r.deleted} removed. ${r.skipped.length} payroll-generated row(s) skipped.`
          : `${r.deleted} removed.`
      );
      queryClient.invalidateQueries({ queryKey: ['variable-upload'] });
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('salaryHeadItemFkey', headFilter);
      fd.append('month', month);
      const res = await fetch('/api/payroll/variable-upload/upload', { method: 'POST', body: fd });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Upload failed');
      return b as BulkResult;
    },
    onSuccess: (r) => {
      setBulk(r);
      queryClient.invalidateQueries({ queryKey: ['variable-upload'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!headFilter) {
      setMessage('Select a Salary Head Item before uploading.');
    } else {
      upload.mutate(file);
    }
    e.target.value = '';
  }

  function startEdit(row: VariableRow) {
    setForm({
      pkey: row.emp_variables_upload_pkey,
      empId: String(row.emp_fkey),
      month: evuToMonthInput(row.month_year),
      salaryHeadItemFkey: String(row.salary_head_item_fkey),
      amount: String(row.uploaded_amount),
      remarks: row.remarks ?? '',
    });
    setMessage(null);
  }

  const allChecked = rows.length > 0 && rows.every((r) => r.is_machine_row || checked.has(r.emp_variables_upload_pkey));
  const formValid = form && form.empId && form.salaryHeadItemFkey && form.month && form.amount !== '' && Number(form.amount) >= 0;

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Variable Upload
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Record one-off variable pay (bonus, incentive, ad-hoc additions) per employee per month
            </p>
          </div>,
          slotEl
        )}

      {/* Filters */}
      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setChecked(new Set()); }} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Salary Head Item</label>
          <select value={headFilter} onChange={(e) => setHeadFilter(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[200px]')}>
            <option value="">All</option>
            {headItems.map((h) => (
              <option key={h.salary_head_item_pkey} value={h.salary_head_item_pkey}>
                {h.item} ({h.head_operator})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => { setBranch(e.target.value); setChecked(new Set()); }} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">All branches</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={empFilter} onChange={setEmpFilter} placeholder="All employees" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => { setForm({ ...EMPTY_FORM, month }); setMessage(null); }}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
        <a
          href={`/api/payroll/variable-upload/template?branch=${branch}&empFkey=${empFilter}`}
          className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
        >
          <Download className="w-3.5 h-3.5" /> Download Template
        </a>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          title={headFilter ? undefined : 'Select a Salary Head Item first'}
        >
          <Upload className="w-3.5 h-3.5" /> {upload.isPending ? 'Uploading…' : 'Upload File'}
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        {checked.size > 0 && (
          <button
            onClick={() => remove.mutate(Array.from(checked))}
            disabled={remove.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger-dark)] hover:bg-[color:var(--color-danger)]/20')}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete ({checked.size})
          </button>
        )}
      </div>

      {message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}

      {bulk && (
        <div className="mb-4 surface-card rounded-xl px-4 py-3 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success-dark)]">{bulk.imported} row(s) imported</span>
              {bulk.errors.length > 0 && (
                <span className="text-[color:var(--color-danger)] ml-2">{bulk.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setBulk(null)} className="text-slate-400 hover:text-slate-600 text-[11.5px]">Dismiss</button>
          </div>
          {bulk.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-[color:var(--color-danger)] max-h-40 overflow-y-auto">
              {bulk.errors.map((err, i) => <li key={i}>Row {err.row}: {err.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* New / Edit form */}
      {form && (
        <div className="surface-card rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[#0F172A]">{form.pkey ? 'Edit Variable' : 'New Variable'}</h2>
            <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600 text-[11.5px]">Cancel</button>
          </div>
          <div className="max-w-sm">
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
            <EmployeeSearch value={form.empId} onChange={(v) => setForm((f) => f && { ...f, empId: v })} placeholder="Search employee by name or ID" />
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-lg">
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
              <input type="month" value={form.month} onChange={(e) => setForm((f) => f && { ...f, month: e.target.value })} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Salary Head Item</label>
              <select value={form.salaryHeadItemFkey} onChange={(e) => setForm((f) => f && { ...f, salaryHeadItemFkey: e.target.value })} className={cn(INPUT_CLASS, 'w-full')}>
                <option value="">[--Select--]</option>
                {headItems.map((h) => (
                  <option key={h.salary_head_item_pkey} value={h.salary_head_item_pkey}>{h.item} ({h.head_operator})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Amount (₹)</label>
              <input type="number" min="0" value={form.amount} onChange={(e) => setForm((f) => f && { ...f, amount: e.target.value })} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Remark</label>
              <input type="text" value={form.remarks} onChange={(e) => setForm((f) => f && { ...f, remarks: e.target.value })} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
          </div>
          <button
            onClick={() => form && save.mutate(form)}
            disabled={!formValid || save.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* List */}
      <div className="surface-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No variable entries for this filter</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) =>
                      setChecked(
                        e.target.checked
                          ? new Set(rows.filter((r) => !r.is_machine_row).map((r) => r.emp_variables_upload_pkey))
                          : new Set()
                      )
                    }
                  />
                </th>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Salary Head</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium">Operator</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Item Part</th>
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 font-medium">Remarks</th>
                <th className="px-4 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const machine = !!row.is_machine_row;
                return (
                  <tr key={row.emp_variables_upload_pkey} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        disabled={machine}
                        checked={checked.has(row.emp_variables_upload_pkey)}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.emp_variables_upload_pkey);
                            else next.delete(row.emp_variables_upload_pkey);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-2 font-medium text-[#0F172A]">{row.emp_name}</td>
                    <td className="px-4 py-2">
                      {row.salary_head_item_desc?.trim()}
                      {machine && (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-[10.5px] text-slate-400" title="Generated by payroll processing">
                          <Lock className="w-3 h-3" /> auto
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{formatCurrency(row.uploaded_amount)}</td>
                    <td className="px-4 py-2">{row.head_operator}</td>
                    <td className="px-4 py-2">{row.head_type}</td>
                    <td className="px-4 py-2">{row.item_part}</td>
                    <td className="px-4 py-2">{row.month_year}</td>
                    <td className="px-4 py-2">{row.remarks || '-'}</td>
                    <td className="px-4 py-2">
                      {!machine && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(row)}
                            title="Edit"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => remove.mutate([row.emp_variables_upload_pkey])}
                            title="Remove"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {data && data.total > rows.length && (
        <p className="text-[11.5px] text-slate-400 mt-2">Showing first {rows.length} of {data.total}. Narrow the filters to see more.</p>
      )}
    </div>
  );
}
