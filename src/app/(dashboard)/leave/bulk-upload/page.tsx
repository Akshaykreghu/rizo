'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Download, Upload, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface UploadResult { imported: number; errors: { row: number; message: string }[] }

export default function BulkLeaveUploadPage() {
  const { slotEl } = useHeaderSlot();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch('/api/leave/bulk-upload', { method: 'POST', body: formData }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
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
              Bulk Leave Upload
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Apply leave for multiple employees from a spreadsheet
            </p>
          </div>,
          slotEl
        )}

      <button
        onClick={() => router.push('/leave/requests')}
        className="flex items-center gap-1.5 text-[12.5px] text-slate-500 hover:text-slate-800 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Leave Requests
      </button>

      <p className="text-[12.5px] text-slate-500 mb-4 max-w-xl">
        Matches legacy behavior: every successfully imported row is applied and <span className="font-medium">auto-approved</span>{' '}
        immediately — no separate authorize/approve step, unlike leave applied through the Leave
        Requests page. Employee ID is the employee&apos;s login username, and Leave Type is its short
        code (see the template).
      </p>

      <div className="surface-card rounded-xl px-4 py-4 max-w-xl space-y-3">
        <div className="flex items-center gap-2">
          <a
            href="/api/leave/bulk-upload/template"
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
        </div>
        {upload.isError && <p className="text-[12.5px] text-[color:var(--color-danger)]">{String(upload.error)}</p>}
      </div>

      {result && (
        <div className="mt-4 surface-card rounded-xl px-4 py-3 text-[12.5px] max-w-xl">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success-dark)]">{result.imported} leave request{result.imported === 1 ? '' : 's'} applied &amp; approved</span>
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
