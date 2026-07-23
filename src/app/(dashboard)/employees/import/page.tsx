'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Upload, ArrowLeft } from 'lucide-react';

interface BranchOption { branch_code: string; branch_name: string }
interface UploadResult { inserted: number; errors: { row: number; message: string }[] }

export default function ImportEmployeePage() {
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
      <button
        onClick={() => router.push('/employees')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Employees
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Import Employee</h1>
      <p className="text-sm text-gray-500 mb-6 max-w-xl">
        Bulk-create employees directly from a spreadsheet. Unlike Employee Join, imported rows become
        active employees immediately — no separate onboarding step. Choose a branch, then upload a
        filled-in copy of the template below; every row in the file is created under that branch.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Select branch</option>
            {branches.map((b) => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/employees/import/template"
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
          >
            <Download className="w-4 h-4" /> Download Template
          </a>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!branch || upload.isPending}
            className="flex items-center gap-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-2 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" /> {upload.isPending ? 'Uploading…' : 'Upload File'}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} />
        </div>
        {!branch && <p className="text-xs text-gray-400">Select a branch before uploading.</p>}
        {upload.isError && <p className="text-sm text-red-500">{String(upload.error)}</p>}
      </div>

      {result && (
        <div className="mt-5 p-4 rounded-lg border border-gray-200 bg-gray-50 text-sm max-w-xl">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-emerald-700">{result.inserted} employee{result.inserted === 1 ? '' : 's'} created</span>
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
