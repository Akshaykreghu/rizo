'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, ArrowRightCircle, Search, Download, UploadCloud, Users, UserCheck, UserPlus, FileSpreadsheet, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { DataTable } from '@/components/data-table/DataTable';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { FloatingActionPanel, type FloatingAction } from '@/components/ui/FloatingActionPanel';
import { JoinDetail } from '@/components/employees/JoinDetail';
import { NewJoinForm } from '@/components/employees/NewJoinForm';
import { OnboardForm } from '@/components/employees/OnboardForm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { ColumnDef } from '@tanstack/react-table';
import EmployeesPage from '../page';

interface JoinRow {
  emp_join_pkey: number;
  first_name: string;
  last_name: string | null;
  email: string;
  mobile_no: string;
  date_of_birth: string;
  district: string;
  profile_image_url: string | null;
}

interface BranchOption {
  branch_code: string;
  branch_name: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

export default function EmployeeJoinPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'joining' | 'all'>('joining');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; errors: { row: number; message: string }[] } | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [selectedJoinId, setSelectedJoinId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [allStatus, setAllStatus] = useState('1');
  const [allBranch, setAllBranch] = useState('');
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [newJoinOpen, setNewJoinOpen] = useState(false);
  const [onboardId, setOnboardId] = useState<number | null>(null);
  const [joinEditDirty, setJoinEditDirty] = useState(false);

  function closeJoinEditModal() {
    if (joinEditDirty && !window.confirm('You have unsaved changes. Discard them and close?')) return;
    setModalOpen(false);
  }

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
    enabled: tab === 'all',
  });

  useEffect(() => {
    setPage(1);
  }, [search]);

  const { data, isLoading } = useQuery<{ data: JoinRow[]; total: number }>({
    queryKey: ['employees/join', page, pageSize, search],
    queryFn: () => fetch(`/api/employees/join?status=1&page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`).then((r) => r.json()),
    enabled: tab === 'joining',
  });

  const { data: joiningCount } = useQuery<{ total: number }>({
    queryKey: ['employees/join/count'],
    queryFn: () => fetch('/api/employees/join?status=1&page=1&pageSize=1').then((r) => r.json()),
  });

  const { data: statusCounts } = useQuery({
    queryKey: ['employees/status-counts'],
    queryFn: async () => {
      const [active, inactive, resigned] = await Promise.all([
        fetch('/api/employees?pageSize=1&status=1').then((r) => r.json()),
        fetch('/api/employees?pageSize=1&status=0').then((r) => r.json()),
        fetch('/api/employees?pageSize=1&status=2').then((r) => r.json()),
      ]);
      return {
        active: active.total ?? 0,
        total: (active.total ?? 0) + (inactive.total ?? 0) + (resigned.total ?? 0),
      };
    },
  });

  const discard = useMutation({
    mutationFn: (empJoinPkey: number) => fetch(`/api/employees/join/${empJoinPkey}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/join'] }),
  });

  function handleJoinCreated(empJoinPkey: number) {
    setNewJoinOpen(false);
    queryClient.invalidateQueries({ queryKey: ['employees/join'] });
    queryClient.invalidateQueries({ queryKey: ['employees/join/count'] });
    setSelectedJoinId(empJoinPkey);
    setModalOpen(true);
  }

  function handleOnboarded() {
    setOnboardId(null);
    queryClient.invalidateQueries({ queryKey: ['employees/join'] });
    queryClient.invalidateQueries({ queryKey: ['employees/join/count'] });
    queryClient.invalidateQueries({ queryKey: ['employees'] });
    queryClient.invalidateQueries({ queryKey: ['employees/status-counts'] });
    setSelectedJoinId(null);
    setTab('all');
  }

  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch('/api/employees/join/upload', { method: 'POST', body: formData }).then((r) => r.json());
    },
    onSuccess: (result) => {
      setUploadResult(result);
      queryClient.invalidateQueries({ queryKey: ['employees/join'] });
    },
  });

  function processSelectedFile(file: File) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setFileError('Please select an Excel file (.xlsx or .xls).');
      setPendingFile(null);
      return;
    }
    setFileError(null);
    setPendingFile(file);
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processSelectedFile(file);
    e.target.value = '';
  }

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processSelectedFile(file);
  }

  function closeBulkUploadModal() {
    setBulkUploadOpen(false);
    setPendingFile(null);
    setFileError(null);
    setDragActive(false);
  }

  function confirmUpload() {
    if (!pendingFile) return;
    upload.mutate(pendingFile, {
      onSuccess: () => {
        setBulkUploadOpen(false);
        setPendingFile(null);
        setFileError(null);
      },
    });
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const columns: ColumnDef<JoinRow, unknown>[] = [
    {
      id: 'slNo',
      header: 'Sl No',
      cell: ({ row, table }) => {
        const { pageIndex, pageSize } = table.getState().pagination;
        return <span className="text-slate-400">{pageIndex * pageSize + row.index + 1}</span>;
      },
    },
    {
      id: 'name',
      header: 'Name',
      accessorFn: (row) => `${row.first_name} ${row.last_name ?? ''}`,
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar
            name={`${row.original.first_name} ${row.original.last_name ?? ''}`}
            imageUrl={row.original.profile_image_url}
          />
          <span className="font-medium text-slate-800">{row.original.first_name} {row.original.last_name ?? ''}</span>
        </div>
      ),
    },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'mobile_no', header: 'Mobile' },
    {
      accessorKey: 'date_of_birth',
      header: 'Date of Birth',
      cell: ({ getValue }) => formatDate(String(getValue() ?? '')),
    },
    { accessorKey: 'district', header: 'District' },
  ];

  const selectedJoinRow = data?.data?.find((r) => r.emp_join_pkey === selectedJoinId);
  const joinPanelActions: FloatingAction[] = selectedJoinRow
    ? [
        {
          key: 'edit',
          label: 'Edit',
          icon: Pencil,
          variant: 'primary',
          onClick: () => setModalOpen(true),
        },
        {
          key: 'onboard',
          label: 'Continue Onboarding',
          icon: ArrowRightCircle,
          variant: 'success',
          onClick: () => setOnboardId(selectedJoinRow.emp_join_pkey),
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: Trash2,
          variant: 'danger',
          onClick: () => {
            if (confirm('Discard this join record? This cannot be undone.')) {
              discard.mutate(selectedJoinRow.emp_join_pkey);
              setSelectedJoinId(null);
            }
          },
        },
      ]
    : [];

  const kpis = [
    { label: 'Total Employees', value: statusCounts?.total, icon: Users, color: 'primary' as const },
    { label: 'Active', value: statusCounts?.active, icon: UserCheck, color: 'success' as const },
    { label: 'Joining', value: joiningCount?.total, icon: UserPlus, color: 'accent' as const },
  ];
  const kpiColorClass: Record<'primary' | 'success' | 'accent', string> = {
    primary: 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]',
    success: 'bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]',
    accent: 'bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]',
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
        <div className="flex items-center gap-5 flex-wrap">
          <div>
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight">
              {tab === 'joining' ? 'Employee Join' : 'All Employees'}
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5">
              {tab === 'joining' ? 'Manage and track employee joining details' : 'Browse and manage all employees'}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {kpis.map((k) => (
              <div key={k.label} className="glass-card lift-on-hover rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 min-w-[120px]">
                <span className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', kpiColorClass[k.color])}>
                  <k.icon className="w-4 h-4" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="text-lg font-bold text-[#0F172A] leading-none">{k.value ?? '—'}</p>
                  <p className="text-[11px] text-[#64748B] mt-1">{k.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        {tab === 'joining' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBulkUploadOpen(true)}
              className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-[color:var(--color-primary)] px-3 py-2 rounded-xl glass-panel transition-all duration-[180ms]"
            >
              <UploadCloud className="w-4 h-4" /> Bulk Upload
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} />
            <button
              onClick={() => setNewJoinOpen(true)}
              className="flex items-center gap-2 bg-[color:var(--color-primary)] hover:scale-[1.03] text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
            >
              <Plus className="w-4 h-4" />
              New Join
            </button>
          </div>
        ) : null}
      </div>

      {uploadResult && (
        <div className="mb-4 p-3 rounded-xl glass-panel text-sm">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success)]">{uploadResult.inserted} inserted</span>
              {uploadResult.errors.length > 0 && (
                <span className="text-[color:var(--color-danger)] ml-2">{uploadResult.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setUploadResult(null)} className="text-slate-400 hover:text-slate-600 text-xs">Dismiss</button>
          </div>
          {uploadResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[color:var(--color-danger)]">
              {uploadResult.errors.map((err, i) => (
                <li key={i}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sticky top-0 z-20 glass-card-strong rounded-2xl px-3 py-2.5 flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-1 text-sm bg-slate-900/[0.03] rounded-xl p-1">
          {[
            { value: 'joining' as const, label: 'Employee Join' },
            { value: 'all' as const, label: 'All Employees' },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg transition-all duration-[180ms] font-medium',
                tab === t.value
                  ? 'nav-pill-active text-[color:var(--color-primary)]'
                  : 'text-slate-500 hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={tab === 'joining' ? 'Search employees by name or mobile' : 'Search employees by name or ID'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full h-10 pl-10 pr-3 bg-white/80 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
            />
          </div>

          {tab === 'all' && (
            <>
              <div className="flex items-center gap-1 text-sm">
                {[
                  { value: '1', label: 'Active' },
                  { value: '0', label: 'Inactive' },
                  { value: '2', label: 'Resigned' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setAllStatus(opt.value)}
                    className={cn(
                      'px-3 py-2 rounded-xl transition-all duration-[180ms] font-medium',
                      allStatus === opt.value
                        ? 'bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]'
                        : 'bg-white/80 text-slate-500 hover:bg-white border border-slate-200'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <select
                value={allBranch}
                onChange={(e) => setAllBranch(e.target.value)}
                className="px-3 py-2 bg-white/80 border border-slate-200 rounded-xl text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
                ))}
              </select>
            </>
          )}

          {tab === 'joining' && (
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Rows per page
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="bg-white/80 border border-slate-200 rounded-xl px-2 py-1.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
              >
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {tab === 'all' ? (
        <EmployeesPage
          embedded
          search={search}
          pageSize={pageSize}
          status={allStatus}
          onStatusChange={setAllStatus}
          branch={allBranch}
          onBranchChange={setAllBranch}
        />
      ) : (
        <DataTable
          key={pageSize}
          data={data?.data ?? []}
          columns={columns}
          pageSize={pageSize}
          totalRows={data?.total ?? 0}
          onPageChange={(p) => setPage(p)}
          isLoading={isLoading}
          onRowClick={(row) => setSelectedJoinId((prev) => (prev === row.emp_join_pkey ? null : row.emp_join_pkey))}
          isRowSelected={(row) => selectedJoinId === row.emp_join_pkey}
        />
      )}

      {tab === 'joining' && (
        <>
          <FloatingActionPanel visible={selectedJoinId !== null} actions={joinPanelActions} />
          <Modal open={modalOpen} onClose={closeJoinEditModal} className="max-w-[1000px] rounded-[22px]">
            {selectedJoinId !== null && (
              <JoinDetail
                id={String(selectedJoinId)}
                onBack={closeJoinEditModal}
                showBackLink={false}
                onDirtyChange={setJoinEditDirty}
                onFinished={() => setModalOpen(false)}
              />
            )}
          </Modal>

          <Modal open={newJoinOpen} onClose={() => setNewJoinOpen(false)}>
            <NewJoinForm onBack={() => setNewJoinOpen(false)} onCreated={handleJoinCreated} showBackLink={false} />
          </Modal>

          <Modal open={onboardId !== null} onClose={() => setOnboardId(null)}>
            {onboardId !== null && (
              <OnboardForm id={String(onboardId)} onBack={() => setOnboardId(null)} onOnboarded={handleOnboarded} showBackLink={false} />
            )}
          </Modal>
        </>
      )}

      <Modal open={bulkUploadOpen} onClose={closeBulkUploadModal} className="max-w-[560px] rounded-[22px]">
        <div className="pr-6">
          <h2 className="font-heading text-[21px] font-bold text-[#0F172A] tracking-tight">Bulk Upload</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            Upload multiple employee joining records from an Excel file.
          </p>
        </div>

        <a
          href="/api/employees/join/template"
          className="flex items-center gap-3 mt-5 px-4 py-3 rounded-2xl bg-white border border-slate-200 hover:border-[color:var(--color-primary)]/30 shadow-sm transition-all duration-[180ms] group"
        >
          <span className="w-9 h-9 rounded-xl bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
            <Download className="w-4 h-4" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-medium text-[#0F172A] group-hover:text-[color:var(--color-primary)]">
              Download Template
            </span>
            <span className="block text-xs text-slate-400 mt-0.5">Start with the RIZO Excel template</span>
          </span>
        </a>

        <div className="mt-4">
          {pendingFile ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border border-[color:var(--color-success)]/25 bg-[color:var(--color-success)]/[0.06]">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-white text-[color:var(--color-success)] flex items-center justify-center flex-shrink-0 shadow-sm">
                  <FileSpreadsheet className="w-4 h-4" />
                </span>
                <span className="leading-tight min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-[#0F172A]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--color-success)] flex-shrink-0" />
                    <span className="truncate">{pendingFile.name}</span>
                  </span>
                  <span className="block text-xs text-slate-400 mt-0.5">{formatFileSize(pendingFile.size)}</span>
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-[color:var(--color-primary)] hover:bg-white transition-colors duration-[180ms]"
                >
                  Change
                </button>
                <button
                  onClick={() => { setPendingFile(null); setFileError(null); }}
                  aria-label="Remove selected file"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-white transition-colors duration-[180ms]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleFileDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              className={cn(
                'flex flex-col items-center justify-center gap-1.5 text-center px-4 py-8 rounded-2xl border-2 border-dashed cursor-pointer transition-colors duration-[180ms]',
                dragActive
                  ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/[0.06]'
                  : 'border-slate-200 bg-[color:var(--color-primary)]/[0.03] hover:border-[color:var(--color-primary)]/40'
              )}
            >
              <span className="w-10 h-10 rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] flex items-center justify-center mb-1">
                <UploadCloud className="w-5 h-5" />
              </span>
              <p className="text-sm font-medium text-[#0F172A]">Choose Excel File</p>
              <p className="text-xs text-slate-400">Drag &amp; drop your file here, or browse</p>
              <p className="text-[11px] text-slate-300 mt-1">.xlsx or .xls</p>
            </div>
          )}

          {fileError && (
            <div className="flex items-start gap-2 mt-2.5 px-3.5 py-2.5 rounded-xl bg-[color:var(--color-danger)]/[0.06] text-[color:var(--color-danger)]">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span className="text-xs leading-relaxed">{fileError}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-6 pt-5 border-t border-slate-100">
          <button
            onClick={closeBulkUploadModal}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition-all duration-[180ms]"
          >
            Cancel
          </button>
          <button
            onClick={confirmUpload}
            disabled={!pendingFile || upload.isPending}
            className="flex items-center gap-2 bg-[color:var(--color-primary)] hover:scale-[1.03] text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
