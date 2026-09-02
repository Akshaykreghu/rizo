'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Users, X, Download } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

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

function previewKind(doc: DocumentRow): 'pdf' | 'image' | 'other' {
  const type = doc.type ?? '';
  const ext = doc.document_path.split('.').pop()?.toLowerCase() ?? '';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  return 'other';
}

export default function DocumentLibraryPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [allocateFor, setAllocateFor] = useState<DocumentRow | null>(null);
  const [allocateEmp, setAllocateEmp] = useState('');
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);

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

  const columns: ColumnDef<DocumentRow, unknown>[] = [
    {
      accessorKey: 'document_name',
      header: 'Document Name',
      cell: ({ row }) => (
        <button onClick={(e) => { e.stopPropagation(); setPreviewDoc(row.original); }} className="text-[color:var(--color-primary)] hover:underline text-left">
          {row.original.document_name}
        </button>
      ),
    },
    { accessorKey: 'created_by', header: 'Uploaded By' },
    { id: 'date', header: 'Date', cell: ({ row }) => new Date(row.original.creation_date).toLocaleDateString() },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-20' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setAllocateFor(row.original); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
            title="Allocate to employees"
          >
            <Users className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); if (confirm('Remove this document?')) remove.mutate(row.original.document_upload_pkey); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Document Upload
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Upload company documents once, then allocate them to specific employees
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-4 max-w-xl mb-4 space-y-3">
        <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide">Upload New Document</h2>
        <div>
          <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Document Name</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={cn(INPUT_CLASS, 'w-full')}
            placeholder="e.g. Offer Letter Template"
          />
        </div>
        <DocumentUploadField value={newPath} onChange={setNewPath} />
        <button
          onClick={() => create.mutate()}
          disabled={!newName || !newPath || create.isPending}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Upload className="w-3.5 h-3.5" /> {create.isPending ? 'Saving…' : 'Add to Library'}
        </button>
        {create.isError && <p className="text-[11.5px] text-[color:var(--color-danger)]">Failed to save document.</p>}
      </div>

      <DataTable data={documents} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} />

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

      {previewDoc && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6"
          onClick={() => setPreviewDoc(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="text-base font-semibold truncate pr-4">{previewDoc.document_name}</h3>
              <div className="flex items-center gap-3 shrink-0">
                <a
                  href={previewDoc.document_path}
                  download
                  className="text-gray-400 hover:text-indigo-600"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button onClick={() => setPreviewDoc(null)}><X className="w-4 h-4 text-gray-400" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-50" onContextMenu={(e) => e.preventDefault()}>
              {previewKind(previewDoc) === 'pdf' && (
                <iframe src={previewDoc.document_path} title={previewDoc.document_name} className="w-full h-[70vh]" />
              )}
              {previewKind(previewDoc) === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewDoc.document_path}
                  alt={previewDoc.document_name}
                  className="max-w-full max-h-[70vh] mx-auto object-contain"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                />
              )}
              {previewKind(previewDoc) === 'other' && (
                <div className="flex flex-col items-center justify-center h-[40vh] text-sm text-gray-500 gap-3">
                  <p>Preview isn&apos;t available for this file type.</p>
                  <a href={previewDoc.document_path} download className="text-indigo-600 hover:underline">
                    Download {previewDoc.document_name}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
