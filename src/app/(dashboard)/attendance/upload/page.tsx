'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSetupOptions } from '@/lib/setupOptions';
import { Download, Upload, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

// Ports EmployeeAttendanceUploadController's upload/list/delete screen. See
// api/attendance/upload/route.ts for the full behavior notes (trigger-driven promotion into
// device_attandance, the added already-verified guard).

const useLookup = useSetupOptions;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface UploadResult { imported: number; errors: { row: number; message: string }[] }
interface LogRow {
  emp_detailed_attendance_pkey: number; emp_fkey: number; att_date: string; att_time: string; c1: 'in' | 'out';
  emp_id: string; first_name: string; last_name: string; branch_name: string | null;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function AttendanceUploadPage() {
  const { slotEl } = useHeaderSlot();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading, refetch } = useQuery<{ data: LogRow[] }>({
    queryKey: ['attendance-upload-log', month, branch],
    queryFn: () => fetch(`/api/attendance/upload?month=${month}&branch=${branch}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch('/api/attendance/upload', { method: 'POST', body: formData }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
        return res.json();
      });
    },
    onSuccess: (data: UploadResult) => { setResult(data); refetch(); },
  });

  const remove = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(checked) }),
      }).then((r) => r.json()),
    onSuccess: () => { setChecked(new Set()); refetch(); },
  });

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  }

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Attendance Upload
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Bulk-upload punch times for multiple employees from a spreadsheet
            </p>
          </div>,
          slotEl
        )}

      <p className="text-[12.5px] text-slate-500 mb-4 max-w-2xl">
        Employee ID is the employee&apos;s login username. Each row covers one direction — fill in a
        row with Direction &quot;in&quot; and another with &quot;out&quot; if you need both for the same employee.
        Rows for a month that&apos;s already verified are skipped.
      </p>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setChecked(new Set()); }} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => { setBranch(e.target.value); setChecked(new Set()); }} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">All branches</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <a
          href={`/api/attendance/upload/template?month=${month}&branch=${branch}`}
          className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
        >
          <Download className="w-3.5 h-3.5" /> Download Template
        </a>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Upload className="w-3.5 h-3.5" /> {upload.isPending ? 'Uploading…' : 'Upload File'}
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} />
        {checked.size > 0 && (
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger-dark)] hover:bg-[color:var(--color-danger)]/20')}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete ({checked.size})
          </button>
        )}
      </div>

      {upload.isError && <p className="text-[12.5px] text-[color:var(--color-danger)] mb-3">{String(upload.error)}</p>}

      {result && (
        <div className="mb-4 surface-card rounded-xl px-4 py-3 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success-dark)]">{result.imported} punch{result.imported === 1 ? '' : 'es'} uploaded</span>
              {result.errors.length > 0 && (
                <span className="text-[color:var(--color-danger)] ml-2">{result.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600 text-[11.5px]">Dismiss</button>
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-[color:var(--color-danger)] max-h-40 overflow-y-auto">
              {result.errors.map((err, i) => (
                <li key={i}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="surface-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No uploaded records for this month</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((r) => checked.has(r.emp_detailed_attendance_pkey))}
                    onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.emp_detailed_attendance_pkey)) : new Set())}
                  />
                </th>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Direction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.emp_detailed_attendance_pkey} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={checked.has(row.emp_detailed_attendance_pkey)}
                      onChange={(e) => setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(row.emp_detailed_attendance_pkey); else next.delete(row.emp_detailed_attendance_pkey);
                        return next;
                      })}
                    />
                  </td>
                  <td className="px-4 py-2">{row.first_name} {row.last_name} <span className="text-slate-400 text-[11px]">({row.emp_id})</span></td>
                  <td className="px-4 py-2">{row.branch_name}</td>
                  <td className="px-4 py-2">{row.att_date?.slice(0, 10)}</td>
                  <td className="px-4 py-2">{row.att_time?.slice(11, 19)}</td>
                  <td className="px-4 py-2 capitalize">{row.c1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
