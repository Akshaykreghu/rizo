'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Users, X, Download, Eye, Search } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

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
  is_allocated: number | boolean;
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
  const { data: session } = useSession();
  const isAdmin = session?.user.userGroup === 1;
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [allocateFor, setAllocateFor] = useState<DocumentRow | null>(null);
  const [allocateEmp, setAllocateEmp] = useState('');
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [deleteError, setDeleteError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: documents = [], isLoading: documentsLoading } = useQuery<DocumentRow[]>({
    queryKey: ['employees/documents', search],
    queryFn: () => fetch(`/api/employees/documents?q=${encodeURIComponent(search)}`).then((r) => r.json()),
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
      setUploadOpen(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/employees/documents/${id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to remove document');
        return r.json();
      }),
    onSuccess: () => {
      setDeleteError('');
      queryClient.invalidateQueries({ queryKey: ['employees/documents'] });
    },
    onError: (err: Error) => setDeleteError(err.message),
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

  const allocateAll = useMutation({
    mutationFn: () => fetch(`/api/employees/documents/${allocateFor!.document_upload_pkey}/allocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emp_fkey: 'all' }),
    }).then((r) => { if (!r.ok) throw new Error('Failed to allocate to all employees'); return r.json(); }),
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
      cell: ({ row }) => <span className="text-[#0F172A]">{row.original.document_name}</span>,
    },
    { accessorKey: 'created_by', header: 'Uploaded By' },
    { id: 'date', header: 'Date', cell: ({ row }) => new Date(row.original.creation_date).toLocaleDateString() },
    {
      id: 'actions',
      header: '',
      meta: { className: isAdmin ? 'w-28' : 'w-10' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setPreviewDoc(row.original); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
            title="View"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          {isAdmin && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setAllocateFor(row.original); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
                title="Allocate to employees"
              >
                <Users className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.original.is_allocated) return;
                  setDeleteError('');
                  if (confirm('Remove this document?')) remove.mutate(row.original.document_upload_pkey);
                }}
                disabled={!!row.original.is_allocated}
                className={cn(
                  'p-1.5 rounded-lg transition-colors duration-150',
                  row.original.is_allocated
                    ? 'text-slate-300 opacity-50 cursor-not-allowed select-none'
                    : 'text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10'
                )}
                title={row.original.is_allocated ? 'Already allocated' : 'Remove'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
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
              {isAdmin ? 'Document Upload' : 'Document View'}
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              {isAdmin
                ? 'Upload company documents once, then allocate them to specific employees'
                : 'Documents allocated to you'}
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by document name"
            className={cn(INPUT_CLASS, 'w-full pl-8')}
          />
        </div>

        {isAdmin && (
          <button
            onClick={() => setUploadOpen(true)}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white shrink-0')}
          >
            <Upload className="w-3.5 h-3.5" /> Add Document
          </button>
        )}
      </div>

      {deleteError && (
        <p className="text-[12.5px] text-[color:var(--color-danger)] mb-3">{deleteError}</p>
      )}

      <DataTable data={documents} columns={columns} isLoading={documentsLoading} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} />

      {uploadOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setUploadOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold">Upload New Document</h3>
              <button onClick={() => setUploadOpen(false)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Document Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className={cn(INPUT_CLASS, 'w-full')}
                  placeholder="e.g. Offer Letter Template"
                />
              </div>
              <DocumentUploadField value={newPath} onChange={setNewPath} accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif" maxBytes={100_000_000} />
              <button
                onClick={() => create.mutate()}
                disabled={!newName || !newPath || create.isPending}
                className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white w-full justify-center')}
              >
                <Upload className="w-3.5 h-3.5" /> {create.isPending ? 'Saving…' : 'Add to Library'}
              </button>
              {create.isError && <p className="text-[11.5px] text-[color:var(--color-danger)]">Failed to save document.</p>}
            </div>
          </div>
        </div>
      )}

      {allocateFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setAllocateFor(null)}>
          <div className="bg-white rounded-xl w-96 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold">Allocate: {allocateFor.document_name}</h3>
              <button onClick={() => setAllocateFor(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <EmployeeSearch value={allocateEmp} onChange={setAllocateEmp} />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => allocate.mutate()}
                  disabled={!allocateEmp || allocate.isPending}
                  className="flex-1 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-2 rounded-lg"
                >
                  {allocate.isPending ? 'Allocating…' : 'Allocate'}
                </button>
                <button
                  onClick={() => allocateAll.mutate()}
                  disabled={allocateAll.isPending}
                  className="flex-1 text-sm text-white bg-slate-700 hover:bg-slate-800 disabled:bg-slate-400 px-3 py-2 rounded-lg"
                >
                  {allocateAll.isPending ? 'Allocating…' : 'Allocate all'}
                </button>
              </div>
              {allocate.isError && <p className="text-xs text-red-500 mt-1">Already allocated to this employee.</p>}
              {allocateAll.isError && <p className="text-xs text-red-500 mt-1">Failed to allocate to all employees.</p>}
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
