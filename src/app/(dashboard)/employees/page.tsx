'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSetupRows } from '@/lib/setupOptions';
import { useRouter } from 'next/navigation';
import { Plus, Search, Eye, KeyRound, ListTree, Package, Receipt, TrendingUp, UserMinus, History, FileText, UserCheck, Loader2 } from 'lucide-react';
import { DataTable } from '@/components/data-table/DataTable';
import { CellText } from '@/components/data-table/CellText';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { FloatingActionPanel, type FloatingAction } from '@/components/ui/FloatingActionPanel';
import { EmployeeDetail } from '@/components/employees/EmployeeDetail';
import { AccessManageModal } from '@/components/employees/AccessManageModal';
import { MenuAllocationModal } from '@/components/employees/MenuAllocationModal';
import { EmployeeFilterMenu } from '@/components/employees/EmployeeFilterMenu';
import { EmployeeHistoryModal } from '@/components/employees/EmployeeHistoryModal';

// Lazy-loaded so these heavy pages stay out of the main /employees bundle until a modal opens.
const AllocateAssetsPage = dynamic(() => import('./assets/page'), { ssr: false });
const TaxDeclarationsPage = dynamic(() => import('./tax-declarations/page'), { ssr: false });
const PromotionApprovalPage = dynamic(() => import('./promotions/page'), { ssr: false });
const ResignationsPage = dynamic(() => import('./resignations/page'), { ssr: false });
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn, formatDate } from '@/lib/utils';
import { downloadEmployeeResumePdf } from '@/lib/employeeResumePdf';
import type { EmployeeListFilter } from '@/lib/employeeList';
import type { ColumnDef } from '@tanstack/react-table';

interface Employee {
  emp_pkey: number;
  emp_id: string;
  emp_company_id: string | null;
  first_name: string;
  last_name: string;
  mobile_no: string;
  branch_name: string;
  dept_name: string;
  desig_name: string;
  joining_date: string;
  status: number;
  profile_pic: string | null;
  profile_completion?: number;
}

interface BranchOption {
  branch_code: string;
  branch_name: string;
}

interface EmployeesPageProps {
  /** Set when rendered inside another page (e.g. the Employee Join "All Employees" tab) that already shows its own title. */
  embedded?: boolean;
  /** When embedded, the search term is controlled by the parent's shared search bar. */
  search?: string;
  /** When embedded, rows-per-page is controlled by the parent's shared toolbar. */
  pageSize?: number;
  /** When embedded, the Filter menu selection is controlled by the parent's shared toolbar. */
  filter?: EmployeeListFilter;
  /** When embedded, the branch filter is controlled by the parent's shared toolbar. */
  branch?: string;
  /** Reports the filtered row count, for the parent's summary card. */
  onTotalChange?: (total: number) => void;
}

// Legacy's Profile Completion bar colours (View/EmployeeJoin/index.ctp).
function completionColor(pct: number) {
  if (pct >= 100) return '#22c55e';
  if (pct >= 70) return '#3b82f6';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

export default function EmployeesPage({
  embedded = false,
  search: searchProp,
  pageSize: pageSizeProp,
  filter: filterProp,
  branch: branchProp,
  onTotalChange,
}: EmployeesPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearchInput = useDebouncedValue(searchInput, 300);
  const [internalFilter, setInternalFilter] = useState<EmployeeListFilter>('active');
  const [internalBranch, setInternalBranch] = useState('');
  const [selectedEmpPkey, setSelectedEmpPkey] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [menuAllocationOpen, setMenuAllocationOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [downloadingPkey, setDownloadingPkey] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const search = embedded ? (searchProp ?? '') : debouncedSearchInput;
  const pageSize = embedded ? (pageSizeProp ?? 25) : 25;
  const filter = embedded ? (filterProp ?? 'active') : internalFilter;
  const branch = embedded ? (branchProp ?? '') : internalBranch;

  useEffect(() => {
    setPage(1);
    setSelectedEmpPkey(null);
  }, [search, filter, branch, pageSize]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const { data: branches = [] } = useSetupRows<BranchOption>('setup/branches', { enabled: !embedded });

  const { data, isLoading } = useQuery<{ data: Employee[]; total: number }>({
    queryKey: ['employees', page, pageSize, search, filter, branch],
    queryFn: () =>
      fetch(
        `/api/employees?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}` +
          `&filter=${filter}&branch=${encodeURIComponent(branch)}&sort=recent&withCompletion=1`
      ).then((r) => r.json()),
  });

  useEffect(() => {
    if (data) onTotalChange?.(Number(data.total ?? 0));
  }, [data, onTotalChange]);

  const activate = useMutation({
    mutationFn: (empPkey: number) =>
      fetch(`/api/employees/${empPkey}/activate`, { method: 'POST' }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Activation failed');
      }),
    onSuccess: () => {
      setToast({ message: 'Employee activated successfully.', type: 'success' });
      setSelectedEmpPkey(null);
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees/summary'] });
    },
    onError: (err: Error) => setToast({ message: err.message, type: 'error' }),
  });

  async function downloadResume(emp: Employee) {
    setDownloadingPkey(emp.emp_pkey);
    try {
      await downloadEmployeeResumePdf(emp.emp_pkey);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Could not create the PDF', type: 'error' });
    } finally {
      setDownloadingPkey(null);
    }
  }

  // Legacy All Employees columns: Image · Employee ID · Full Name · Designation · Joined Date ·
  // Branch Name · Profile Completion · Doc (Department kept from this app's own list).
  const columns: ColumnDef<Employee, unknown>[] = [
    {
      id: 'slNo',
      header: '',
      meta: { className: 'w-12' },
      cell: ({ row, table }) => {
        const { pageIndex, pageSize } = table.getState().pagination;
        return <span className="text-slate-400">{pageIndex * pageSize + row.index + 1}</span>;
      },
    },
    {
      id: 'name',
      header: 'Employee',
      accessorFn: (row) => `${row.first_name} ${row.last_name}`,
      meta: { className: 'w-[24%]' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5 min-w-0 max-w-[260px]">
          <Avatar name={`${row.original.first_name} ${row.original.last_name}`} imageUrl={row.original.profile_pic} className="flex-shrink-0" />
          <div className="leading-tight min-w-0">
            {/* One line, cut with "…" — a long name must not wrap and push the row out of line. */}
            <p
              title={`${row.original.first_name} ${row.original.last_name ?? ''}`.trim()}
              className={cn('font-semibold text-sm truncate', row.original.status === 2 ? 'text-[color:var(--color-danger)] italic' : 'text-[#0F172A]')}
            >
              {row.original.first_name} {row.original.last_name}
            </p>
            {/* Employee ID (emp_proff.emp_company_id) — legacy's list column; defaults to the login
                user ID (e.g. GRTL100016) when none was entered at onboarding. */}
            <p className="text-xs text-slate-400 mt-0.5 truncate">{row.original.emp_company_id || row.original.emp_id}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'desig_name',
      header: 'Designation',
      meta: { className: 'w-[14%]' },
      cell: ({ getValue }) => <CellText value={getValue()} className="text-[#64748B]" maxWidth="max-w-[170px]" />,
    },
    {
      accessorKey: 'dept_name',
      header: 'Department',
      meta: { className: 'w-[13%]' },
      cell: ({ getValue }) => <CellText value={getValue()} className="text-slate-600" maxWidth="max-w-[160px]" />,
    },
    {
      accessorKey: 'joining_date',
      header: 'Joined Date',
      meta: { className: 'w-[11%]' },
      cell: ({ getValue }) => <span className="text-slate-600 whitespace-nowrap">{formatDate(String(getValue() ?? ''))}</span>,
    },
    {
      accessorKey: 'branch_name',
      header: 'Branch',
      meta: { className: 'w-[12%]' },
      cell: ({ getValue }) => <CellText value={getValue()} className="text-slate-600" maxWidth="max-w-[150px]" />,
    },
    {
      accessorKey: 'profile_completion',
      header: 'Profile Completion',
      meta: { className: 'w-[14%]' },
      cell: ({ getValue }) => {
        const pct = Number(getValue() ?? 0);
        const color = completionColor(pct);
        return (
          <div className="flex items-center gap-2 min-w-[110px]" title={`${pct}% complete`}>
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="text-xs font-semibold tabular-nums w-9 text-right" style={{ color }}>{pct}%</span>
          </div>
        );
      },
    },
    {
      id: 'doc',
      header: 'Doc',
      meta: { className: 'w-12' },
      cell: ({ row }) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            downloadResume(row.original);
          }}
          disabled={downloadingPkey === row.original.emp_pkey}
          aria-label="Download employee profile PDF"
          title="Download profile PDF"
          className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-[180ms] disabled:opacity-60"
        >
          {downloadingPkey === row.original.emp_pkey ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        </button>
      ),
    },
    {
      id: 'view',
      header: '',
      meta: { className: 'w-12' },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedEmpPkey(row.original.emp_pkey);
              setModalOpen(true);
            }}
            aria-label="View employee"
            title="View"
            className="p-1.5 rounded-lg bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)] hover:text-white transition-colors duration-[180ms]"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const selectedEmployee = data?.data?.find((e: Employee) => e.emp_pkey === selectedEmpPkey);
  const selectedEmpName = selectedEmployee
    ? `${selectedEmployee.first_name} ${selectedEmployee.last_name ?? ''} (${selectedEmployee.emp_company_id || selectedEmployee.emp_id})`.replace(/\s+/g, ' ').trim()
    : '';
  const historyAction: FloatingAction = { key: 'history', label: 'History', icon: History, variant: 'default', onClick: () => setHistoryOpen(true) };
  // Active employees get the full action set; a resigned one gets History + Activate, which legacy
  // shows in place of Remove under the "Resigned" filter. Inactive (status 0) rows get none.
  const panelActions: FloatingAction[] =
    selectedEmployee?.status === 1
      ? [
          { key: 'access', label: 'Access', icon: KeyRound, variant: 'default', onClick: () => setAccessModalOpen(true) },
          { key: 'menu-allocation', label: 'Menu', icon: ListTree, variant: 'default', onClick: () => setMenuAllocationOpen(true) },
          { key: 'assets', label: 'Assets', icon: Package, variant: 'default', onClick: () => setAssetsOpen(true) },
          { key: 'tax', label: 'Tax', icon: Receipt, variant: 'default', onClick: () => setTaxOpen(true) },
          { key: 'promotion', label: 'Promotion', icon: TrendingUp, variant: 'default', onClick: () => setPromoOpen(true) },
          historyAction,
          { key: 'remove', label: 'Remove', icon: UserMinus, variant: 'danger-solid', onClick: () => setRemoveOpen(true) },
        ]
      : selectedEmployee?.status === 2
        ? [
            historyAction,
            {
              key: 'activate',
              label: activate.isPending ? 'Activating…' : 'Activate',
              icon: UserCheck,
              variant: 'success',
              onClick: () => {
                if (!activate.isPending && window.confirm(`Activate ${selectedEmpName} again?`)) activate.mutate(selectedEmployee.emp_pkey);
              },
            },
          ]
        : [];

  return (
    <div>
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight">Employees</h1>
          <button
            onClick={() => router.push('/employees/join/new')}
            className="flex items-center gap-2 bg-[color:var(--color-primary)] hover:scale-[1.03] text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
          >
            <Plus className="w-4 h-4" />
            Add Employee
          </button>
        </div>
      )}

      {!embedded && (
        <div className="sticky top-0 z-20 glass-card-strong rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search employees by name or ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full h-10 pl-10 pr-3 bg-white/80 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
            />
          </div>
          <div className="ml-auto">
            <EmployeeFilterMenu
              filter={internalFilter}
              onFilterChange={setInternalFilter}
              branch={internalBranch}
              onBranchChange={setInternalBranch}
              branches={branches}
            />
          </div>
        </div>
      )}

      <DataTable
        key={pageSize}
        data={data?.data ?? []}
        columns={columns}
        pageSize={pageSize}
        totalRows={data?.total ?? 0}
        onPageChange={(p) => setPage(p)}
        isLoading={isLoading}
        onRowClick={(row) => setSelectedEmpPkey((prev) => (prev === row.emp_pkey ? null : row.emp_pkey))}
        isRowSelected={(row) => selectedEmpPkey === row.emp_pkey}
        rowClassName={(row) => (row.status === 2 ? 'bg-slate-50' : undefined)}
      />

      <FloatingActionPanel visible={panelActions.length > 0} actions={panelActions} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="max-w-[1100px] max-h-[95vh] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <EmployeeDetail id={String(selectedEmpPkey)} onBack={() => setModalOpen(false)} showBackLink={false} />
        )}
      </Modal>

      <Modal open={accessModalOpen} onClose={() => setAccessModalOpen(false)} className="max-w-[560px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <AccessManageModal
            empPkey={selectedEmpPkey}
            onSaved={() => setAccessModalOpen(false)}
            onNotify={(message, type) => setToast({ message, type })}
          />
        )}
      </Modal>

      <Modal open={menuAllocationOpen} onClose={() => setMenuAllocationOpen(false)} className="max-w-[760px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <MenuAllocationModal empPkey={selectedEmpPkey} onClose={() => setMenuAllocationOpen(false)} />
        )}
      </Modal>

      <Modal open={assetsOpen} onClose={() => setAssetsOpen(false)} className="max-w-[1100px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <AllocateAssetsPage embeddedEmpPkey={selectedEmpPkey} embeddedEmpName={selectedEmpName} />
        )}
      </Modal>

      <Modal open={taxOpen} onClose={() => setTaxOpen(false)} className="max-w-[1100px] rounded-[22px]">
        {selectedEmpPkey !== null && <TaxDeclarationsPage embeddedEmpPkey={selectedEmpPkey} />}
      </Modal>

      <Modal open={promoOpen} onClose={() => setPromoOpen(false)} className="max-w-[1100px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <PromotionApprovalPage embeddedEmpPkey={selectedEmpPkey} embeddedEmpName={selectedEmpName} />
        )}
      </Modal>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} className="max-w-[820px] rounded-[22px]">
        {selectedEmpPkey !== null && <EmployeeHistoryModal empPkey={selectedEmpPkey} empName={selectedEmpName} />}
      </Modal>

      <Modal open={removeOpen} onClose={() => setRemoveOpen(false)} className="max-w-[1100px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <ResignationsPage embeddedEmpPkey={selectedEmpPkey} embeddedEmpName={selectedEmpName} />
        )}
      </Modal>

      {toast && (
        <div
          className={cn(
            'fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white',
            toast.type === 'success' ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-danger)]'
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
