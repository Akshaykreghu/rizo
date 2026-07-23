'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { UploadCloud, Download } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';

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

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Form-16 Documents</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Batch Upload</h2>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Financial Year (starting)</label>
            <input
              type="number"
              value={finYear}
              onChange={(e) => setFinYear(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">PDF files (Form-16, PAN auto-detected)</label>
            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="text-sm"
            />
          </div>
          <button
            onClick={() => upload.mutate()}
            disabled={!files.length || upload.isPending}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UploadCloud className="w-4 h-4" />
            {upload.isPending ? 'Uploading…' : `Upload ${files.length || ''}`}
          </button>
        </div>

        {upload.isError && <p className="text-red-500 text-sm mb-2">{String(upload.error)}</p>}
        {upload.data && (
          <div className="text-sm space-y-1">
            {upload.data.accepted.length > 0 && (
              <p className="text-emerald-600">Accepted: {upload.data.accepted.join(', ')}</p>
            )}
            {upload.data.rejected.length > 0 && (
              <div className="text-red-600">
                Rejected:
                <ul className="list-disc list-inside">
                  {upload.data.rejected.map((r, i) => <li key={i}>{r.name} — {r.reason}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Look Up an Employee&apos;s Form-16</h2>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="max-w-sm flex-1">
            <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Financial Year (optional)</label>
            <input
              type="number"
              value={lookupFinYear}
              onChange={(e) => setLookupFinYear(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28"
            />
          </div>
        </div>

        {!empId && <p className="text-sm text-gray-400">Select an employee to view their Form-16 documents.</p>}
        {empId && isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {data?.documents && (
          data.documents.length === 0 ? (
            <p className="text-sm text-gray-400">No Form-16 documents found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Fin. Year</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">PAN</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Uploaded</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.documents.map((doc, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-gray-800">{doc.fin_year}</td>
                    <td className="px-3 py-2 text-gray-800">{doc.pan}</td>
                    <td className="px-3 py-2 text-gray-600">{new Date(doc.created_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-right">
                      <a href={doc.path} target="_blank" rel="noopener noreferrer" className="inline-flex text-gray-500 hover:text-indigo-600">
                        <Download className="w-4 h-4" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
