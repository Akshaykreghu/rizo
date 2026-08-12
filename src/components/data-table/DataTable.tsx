'use client';

import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type PaginationState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  pageSize?: number;
  /** If provided, pagination is server-side: set this to total row count */
  totalRows?: number;
  /** Server-side pagination callback */
  onPageChange?: (page: number, pageSize: number) => void;
  isLoading?: boolean;
  className?: string;
  onRowClick?: (row: TData) => void;
  /** Highlights a row (e.g. for single-select) when it returns true. */
  isRowSelected?: (row: TData) => boolean;
}

function getPageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
    result.push(sorted[i]);
  }
  return result;
}

export function DataTable<TData>({
  data,
  columns,
  pageSize: initialPageSize = 25,
  totalRows,
  onPageChange,
  isLoading,
  className,
  onRowClick,
  isRowSelected,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });

  const isServerSide = totalRows !== undefined;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(pagination) : updater;
      setPagination(next);
      if (isServerSide && onPageChange) {
        onPageChange(next.pageIndex + 1, next.pageSize);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: isServerSide,
    pageCount: isServerSide
      ? Math.ceil((totalRows ?? 0) / pagination.pageSize)
      : undefined,
  });

  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount() || 1;
  const pageNumbers = getPageNumbers(pageIndex + 1, pageCount);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="surface-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-white border-b border-slate-100">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        'px-4 py-3 text-left text-[12px] font-semibold text-[#64748B] uppercase tracking-wide whitespace-nowrap',
                        header.column.getCanSort() && 'cursor-pointer select-none hover:text-[#0F172A]',
                        (header.column.columnDef.meta as { className?: string } | undefined)?.className
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="text-slate-400">
                            {header.column.getIsSorted() === 'asc' ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronUp className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                    No records found.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, i) => {
                  const selected = isRowSelected?.(row.original) ?? false;
                  return (
                  <tr
                    key={row.id}
                    className={cn(
                      'group/row h-14 transition-colors duration-[180ms] border-b border-slate-50',
                      i % 2 === 1 && !selected && 'bg-slate-900/[0.015]',
                      selected
                        ? 'bg-[color:var(--color-primary)]/[0.07] shadow-[inset_2px_0_0_var(--color-primary)]'
                        : 'hover:bg-[color:var(--color-primary)]/[0.035]',
                      onRowClick && 'cursor-pointer'
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-4 py-3 text-[#0F172A]',
                          (cell.column.columnDef.meta as { className?: string } | undefined)?.className
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-slate-500 border-t border-slate-100 px-4 py-3">
          <span>
            Page {pageIndex + 1} of {pageCount}
            {isServerSide && totalRows !== undefined && (
              <span className="text-slate-400 ml-2">({totalRows} total)</span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {pageNumbers.map((n, i) =>
              n === '…' ? (
                <span key={`ellipsis-${i}`} className="px-1.5 text-slate-400">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => table.setPageIndex(n - 1)}
                  className={cn(
                    'w-8 h-8 rounded-lg text-sm font-medium transition-all duration-[180ms]',
                    n === pageIndex + 1
                      ? 'bg-[color:var(--color-primary)] text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100'
                  )}
                >
                  {n}
                </button>
              )
            )}
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
