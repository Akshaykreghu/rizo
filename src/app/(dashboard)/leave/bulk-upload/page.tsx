'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Download, Upload, ArrowLeft } from 'lucide-react';

interface UploadResult { imported: number; errors: { row: number; message: string }[] }

export default function BulkLeaveUploadPage() {
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
      <button
        onClick={() => router.push('/leave/requests')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Leave Requests
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Bulk Leave Upload</h1>
      <p className="text-sm text-gray-500 mb-6 max-w-xl">
        Bulk-apply leave for multiple employees from a spreadsheet. Matches legacy behavior: every
        successfully imported row is applied and <span className="font-medium">auto-approved</span>{' '}
        immediately — no separate authorize/approve step, unlike leave applied through the Leave
        Requests page. Employee ID is the employee&apos;s login username, and Leave Type is its short
        code (see the template).
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl space-y-5">
        <div className="flex items-center gap-2">
          <a
            href="/api/leave/bulk-upload/template"
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
          >
            <Download className="w-4 h-4" /> Download Template
          </a>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            className="flex items-center gap-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-2 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" /> {upload.isPending ? 'Uploading…' : 'Upload File'}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} />
        </div>
        {upload.isError && <p className="text-sm text-red-500">{String(upload.error)}</p>}
      </div>

      {result && (
        <div className="mt-5 p-4 rounded-lg border border-gray-200 bg-gray-50 text-sm max-w-xl">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-emerald-700">{result.imported} leave request{result.imported === 1 ? '' : 's'} applied &amp; approved</span>
              {result.errors.length > 0 && (
                <span className="text-red-600 ml-2">{result.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setResult(null)} className="text-gray-400 hover:text-gray-600 text-xs">Dismiss</button>
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-600">
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
