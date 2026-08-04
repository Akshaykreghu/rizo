'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Users, X } from 'lucide-react';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';

interface DocumentRow {
  document_upload_pkey: number;
  document_name: string;
  document_path: string;
  type: string | null;
  created_by: string;
  creation_date: string;
  document_allocated_by: string | null;
  document_allocated_date: string | null;
}

interface AllocationRow {
  document_allocation_pkey: number;
  emp_fkey: number;
  first_name: string;
  last_name: string;
  emp_company_id: string;
  allocated_date: string;
}

export default function DocumentLibraryPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [allocateFor, setAllocateFor] = useState<DocumentRow | null>(null);
  const [allocateEmp, setAllocateEmp] = useState('');

  const { data: documents = [] } = useQuery<DocumentRow[]>({
    queryKey: ['employees/documents'],
    queryFn: () => fetch('/api/employees/documents').then((r) => r.json()),
  });

  const { data: allocations = [] } = useQuery<AllocationRow[]>({
    queryKey: ['employees/documents/allocate', allocateFor?.document_upload_pkey],
    queryFn: () => fetch(`/api/employees/documents/${allocateFor!.document_upload_pkey}/allocate`).then((r) => r.json()),
    enabled: !!allocateFor,
  });

  const create = useMutation({
    mutationFn: () => fetch('/api/employees/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_name: newName, document_path: newPath }),
    }).then((r) => { if (!r.ok) throw new Error('Upload failed'); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/documents'] });
      setNewName('');
      setNewPath('');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/employees/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/documents'] }),
  });

  const allocate = useMutation({
    mutationFn: () => fetch(`/api/employees/documents/${allocateFor!.document_upload_pkey}/allocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emp_fkey: Number(allocateEmp) }),
    }).then((r) => { if (!r.ok) throw new Error('Already allocated to this employee'); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/documents/allocate', allocateFor?.document_upload_pkey] });
      setAllocateEmp('');
    },
  });

  const revoke = useMutation({
    mutationFn: (allocationPkey: number) =>
      fetch(`/api/employees/documents/${allocateFor!.document_upload_pkey}/allocate/${allocationPkey}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/documents/allocate', allocateFor?.document_upload_pkey] }),
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Document Upload</h1>
      <p className="text-sm text-gray-500 mb-6 max-w-xl">
        Upload company documents once, then allocate them to specific employees.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl mb-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Upload New Document</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Document Name</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Offer Letter Template"
          />
        </div>
        <FileUploadField label="File" value={newPath} onChange={setNewPath} />
        <button
          onClick={() => create.mutate()}
          disabled={!newName || !newPath || create.isPending}
          className="flex items-center gap-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-2 rounded-lg transition-colors"
        >
          <Upload className="w-4 h-4" /> {create.isPending ? 'Saving…' : 'Add to Library'}
        </button>
        {create.isError && <p className="text-xs text-red-500">Failed to save document.</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Document Name</th>
              <th className="text-left px-4 py-2.5">Uploaded By</th>
              <th className="text-left px-4 py-2.5">Date</th>
              <th className="text-right px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.document_upload_pkey} className="border-t border-gray-100">
                <td className="px-4 py-2.5">
                  <a href={doc.document_path} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                    {doc.document_name}
                  </a>
                </td>
                <td className="px-4 py-2.5 text-gray-600">{doc.created_by}</td>
                <td className="px-4 py-2.5 text-gray-500">{new Date(doc.creation_date).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => setAllocateFor(doc)}
                    className="text-gray-400 hover:text-indigo-600 mr-3"
                    title="Allocate to employees"
                  >
                    <Users className="w-4 h-4 inline" />
                  </button>
                  <button
                    onClick={() => confirm('Remove this document?') && remove.mutate(doc.document_upload_pkey)}
                    className="text-gray-400 hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4 inline" />
                  </button>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No documents uploaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {allocateFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setAllocateFor(null)}>
          <div className="bg-white rounded-xl w-96 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold">Allocate: {allocateFor.document_name}</h3>
              <button onClick={() => setAllocateFor(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <EmployeeSearch value={allocateEmp} onChange={setAllocateEmp} />
              <button
                onClick={() => allocate.mutate()}
                disabled={!allocateEmp || allocate.isPending}
                className="mt-2 w-full text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-2 rounded-lg"
              >
                {allocate.isPending ? 'Allocating…' : 'Allocate'}
              </button>
              {allocate.isError && <p className="text-xs text-red-500 mt-1">Already allocated to this employee.</p>}
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Currently Allocated</h4>
              {allocations.length === 0 && <p className="text-sm text-gray-400">No employees allocated yet.</p>}
              {allocations.map((a) => (
                <div key={a.document_allocation_pkey} className="flex items-center justify-between py-1.5 text-sm">
                  <span>{a.first_name} {a.last_name} <span className="text-gray-400">({a.emp_company_id})</span></span>
                  <button onClick={() => revoke.mutate(a.document_allocation_pkey)} className="text-gray-400 hover:text-red-600 text-xs">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
