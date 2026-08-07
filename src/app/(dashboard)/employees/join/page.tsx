'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, UserCircle, Trash2, ArrowRightCircle, Search, Download, Upload } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { DataTable } from '@/components/data-table/DataTable';
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

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

export default function EmployeeJoinPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'joining' | 'all'>('joining');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [uploadResult, setUploadResult] = useState<{ inserted: number; errors: { row: number; message: string }[] } | null>(null);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading } = useQuery<{ data: JoinRow[]; total: number }>({
    queryKey: ['employees/join', page, pageSize, search],
    queryFn: () => fetch(`/api/employees/join?status=1&page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`).then((r) => r.json()),
    enabled: tab === 'joining',
  });

  const discard = useMutation({
    mutationFn: (empJoinPkey: number) => fetch(`/api/employees/join/${empJoinPkey}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/join'] }),
  });

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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  }

  const columns: ColumnDef<JoinRow, unknown>[] = [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (row) => `${row.first_name} ${row.last_name ?? ''}`,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.profile_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.original.profile_image_url} alt="" className="w-7 h-7 rounded-full object-cover border border-gray-200" />
          ) : (
            <UserCircle className="w-7 h-7 text-gray-300 shrink-0" />
          )}
          <span className="font-medium text-gray-900">{row.original.first_name} {row.original.last_name ?? ''}</span>
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
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/employees/join/${row.original.emp_join_pkey}`); }}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Edit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/employees/join/${row.original.emp_join_pkey}/onboard`); }}
            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 font-medium"
          >
            <ArrowRightCircle className="w-3.5 h-3.5" /> Continue Onboarding
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Discard this join record? This cannot be undone.')) {
                discard.mutate(row.original.emp_join_pkey);
              }
            }}
            className="text-gray-400 hover:text-red-500"
            title="Discard"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Employee Join</h1>
        {tab === 'joining' && (
          <div className="flex items-center gap-2">
            <a
              href="/api/employees/join/template"
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Download className="w-4 h-4" /> Download Template
            </a>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> {upload.isPending ? 'Uploading…' : 'Upload File'}
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} />
            <button
              onClick={() => router.push('/employees/join/new')}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Join
            </button>
          </div>
        )}
      </div>

      {uploadResult && (
        <div className="mb-4 p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-emerald-700">{uploadResult.inserted} inserted</span>
              {uploadResult.errors.length > 0 && (
                <span className="text-red-600 ml-2">{uploadResult.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setUploadResult(null)} className="text-gray-400 hover:text-gray-600 text-xs">Dismiss</button>
          </div>
          {uploadResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-600">
              {uploadResult.errors.map((err, i) => (
                <li key={i}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-1 text-sm">
          {[
            { value: 'joining' as const, label: 'Employee Joining' },
            { value: 'all' as const, label: 'All Employees' },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                tab === t.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'joining' && (
          <div className="flex items-center gap-3">
            <form onSubmit={handleSearch} className="flex gap-2 max-w-sm">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or mobile"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button type="submit" className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition-colors">
                Search
              </button>
            </form>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Rows per page
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {tab === 'all' ? (
        <EmployeesPage />
      ) : (
        <DataTable
          key={pageSize}
          data={data?.data ?? []}
          columns={columns}
          pageSize={pageSize}
          totalRows={data?.total ?? 0}
          onPageChange={(p) => setPage(p)}
          isLoading={isLoading}
          onRowClick={(row) => router.push(`/employees/join/${row.emp_join_pkey}`)}
        />
      )}
    </div>
  );
}
