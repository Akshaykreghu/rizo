'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Upload, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface BranchOption { branch_code: string; branch_name: string }
interface UploadResult { inserted: number; errors: { row: number; message: string }[] }

export default function ImportEmployeePage() {
  const { slotEl } = useHeaderSlot();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [branch, setBranch] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('branch', branch);
      return fetch('/api/employees/import', { method: 'POST', body: formData }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Import failed');
        return res.json();
      });
    },
    onSuccess: (data: UploadResult) => setResult(data),
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
              Import Employee
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Bulk-create active employees from a spreadsheet
            </p>
          </div>,
          slotEl
        )}

      <button
        onClick={() => router.push('/employees')}
        className="flex items-center gap-1.5 text-[12.5px] text-slate-500 hover:text-slate-800 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Employees
      </button>

      <p className="text-[12.5px] text-slate-500 mb-4 max-w-xl">
        Unlike Employee Join, imported rows become active employees immediately — no separate
        onboarding step. Choose a branch, then upload a filled-in copy of the template below; every
        row in the file is created under that branch.
      </p>

      <div className="surface-card rounded-xl px-4 py-4 max-w-xl space-y-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className={cn(INPUT_CLASS, 'w-full')}
          >
            <option value="">Select branch</option>
            {branches.map((b) => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/employees/import/template"
            className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> Download Template
          </a>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!branch || upload.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <Upload className="w-3.5 h-3.5" /> {upload.isPending ? 'Uploading…' : 'Upload File'}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} />
        </div>
        {!branch && <p className="text-[11.5px] text-slate-400">Select a branch before uploading.</p>}
        {upload.isError && <p className="text-[12.5px] text-[color:var(--color-danger)]">{String(upload.error)}</p>}
      </div>

      {result && (
        <div className="mt-4 surface-card rounded-xl px-4 py-3 text-[12.5px] max-w-xl">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success-dark)]">{result.inserted} employee{result.inserted === 1 ? '' : 's'} created</span>
              {result.errors.length > 0 && (
                <span className="text-[color:var(--color-danger)] ml-2">{result.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600 text-[11.5px]">Dismiss</button>
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-[color:var(--color-danger)]">
              {result.errors.map((err, i) => (
                <li key={i}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
