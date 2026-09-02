'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { UploadCloud, Download } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface Document {
  form_name: string;
  pan: string;
  fin_year: string;
  created_by: string;
  created_date: string;
  path: string;
}

function currentFinYear() {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export default function Form16Page() {
  const { slotEl } = useHeaderSlot();
  const [finYear, setFinYear] = useState(String(currentFinYear()));
  const [files, setFiles] = useState<File[]>([]);
  const [empId, setEmpId] = useState('');
  const [lookupFinYear, setLookupFinYear] = useState('');

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('fin_year', finYear);
      files.forEach((f) => fd.append('files', f));
      const res = await fetch('/api/taxation/form16/upload', { method: 'POST', body: fd });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Upload failed');
      return b as { accepted: string[]; rejected: { name: string; reason: string }[] };
    },
    onSuccess: () => setFiles([]),
  });

  const { data, isLoading } = useQuery<{ documents: Document[] }>({
    queryKey: ['employees', empId, 'form16', lookupFinYear],
    queryFn: () => fetch(`/api/employees/${empId}/form16${lookupFinYear ? `?finYear=${lookupFinYear}` : ''}`).then((r) => r.json()),
    enabled: !!empId,
  });

  const columns: ColumnDef<Document, unknown>[] = [
    { accessorKey: 'fin_year', header: 'Fin. Year' },
    { accessorKey: 'pan', header: 'PAN' },
    { id: 'uploaded', header: 'Uploaded', cell: ({ row }) => new Date(row.original.created_date).toLocaleDateString() },
    {
      id: 'download',
      header: '',
      meta: { className: 'w-14' },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <a
            href={row.original.path}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150 inline-flex"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Form-16 Documents
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Batch-upload and look up employee Form-16 documents
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-2xl p-5">
        <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-4">Batch Upload</h2>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Financial Year (starting)</label>
            <input
              type="number"
              value={finYear}
              onChange={(e) => setFinYear(e.target.value)}
              className={cn(INPUT_CLASS, 'w-28')}
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">PDF files (Form-16, PAN auto-detected)</label>
            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="text-[12.5px]"
            />
          </div>
          <button
            onClick={() => upload.mutate()}
            disabled={!files.length || upload.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            {upload.isPending ? 'Uploading…' : `Upload ${files.length || ''}`}
          </button>
        </div>

        {upload.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mb-2">{String(upload.error)}</p>}
        {upload.data && (
          <div className="text-[12.5px] space-y-1">
            {upload.data.accepted.length > 0 && (
              <p className="text-[color:var(--color-success-dark)]">Accepted: {upload.data.accepted.join(', ')}</p>
            )}
            {upload.data.rejected.length > 0 && (
              <div className="text-[color:var(--color-danger)]">
                Rejected:
                <ul className="list-disc list-inside">
                  {upload.data.rejected.map((r, i) => <li key={i}>{r.name} — {r.reason}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="surface-card rounded-2xl p-5">
        <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-4">Look Up an Employee&apos;s Form-16</h2>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="max-w-sm flex-1">
            <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Financial Year (optional)</label>
            <input
              type="number"
              value={lookupFinYear}
              onChange={(e) => setLookupFinYear(e.target.value)}
              className={cn(INPUT_CLASS, 'w-28')}
            />
          </div>
        </div>

        {!empId && <p className="text-[12.5px] text-slate-400">Select an employee to view their Form-16 documents.</p>}
        {empId && (
          <DataTable data={data?.documents ?? []} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}
