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
import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SkeletonTableRows } from '@/components/ui/Skeleton';

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  pageSize?: number;
  /** If provided, pagination is server-side: set this to total row count */
  totalRows?: number;
  /** Server-side pagination callback */
  onPageChange?: (page: number, pageSize: number) => void;
  /** Server-side: the 1-based page the parent actually fetched. When given, the footer and
   *  pager follow it instead of an internal counter that can drift from the parent's state. */
  page?: number;
  /** If provided, shows a "Rows per page" selector in the pagination footer with these choices. */
  pageSizeOptions?: number[];
  isLoading?: boolean;
  className?: string;
  onRowClick?: (row: TData) => void;
  /** Highlights a row (e.g. for single-select) when it returns true. */
  isRowSelected?: (row: TData) => boolean;
  /** Extra class names applied to a row's <tr>, layered on top of the default striping/hover. */
  rowClassName?: (row: TData) => string | undefined;
  /** Rows scroll inside the grid (header row pinned) and the grid is sized to end at the bottom
   *  of the window, so the page itself doesn't scroll the rows under the controls above it. */
  fitToViewport?: boolean;
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
  page,
  onPageChange,
  pageSizeOptions,
  isLoading,
  className,
  onRowClick,
  isRowSelected,
  rowClassName,
  fitToViewport,
}: DataTableProps<TData>) {
  // fitToViewport: the scroll area's max height = window height − its top − the pager footer and
  // page padding below it. Measured in a rAF/resize callback (not synchronously in the effect).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollMaxHeight, setScrollMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!fitToViewport) return;
    const measure = () => {
      const el = scrollRef.current;
      if (!el) return;
      const FOOTER_AND_PADDING = 76; // pager row + bottom breathing room
      setScrollMaxHeight(Math.max(240, window.innerHeight - el.getBoundingClientRect().top - FOOTER_AND_PADDING));
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [fitToViewport, data.length]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });

  const isServerSide = totalRows !== undefined;
  // Server-side: the parent's page (what was actually fetched) wins over this table's own
  // counter, so the footer never shows "Page 1" while page 2's (empty) rows are on screen — e.g.
  // after the parent resets to page 1 on a new search/filter, or this table is re-mounted on a
  // tab switch while the parent is still on a later page.
  const serverPageCount = isServerSide ? Math.ceil((totalRows ?? 0) / pagination.pageSize) : 0;
  const requestedIndex = isServerSide && page !== undefined ? Math.max(0, page - 1) : pagination.pageIndex;
  // Never display a page past the last one (see the clamp effect below).
  const effectivePagination: PaginationState = {
    ...pagination,
    pageIndex: isServerSide && serverPageCount > 0 ? Math.min(requestedIndex, serverPageCount - 1) : requestedIndex,
  };

  // A re-mounted table starts at page 1; bring an uncontrolled parent back in line with it.
  useEffect(() => {
    if (isServerSide && page === undefined) onPageChange?.(1, pagination.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // Rows removed (delete, onboard, a narrower filter) can leave the current page past the last
  // one: the server returns no rows yet a non-zero total. Step back to the last real page.
  // The footer is already clamped above; this makes the parent actually fetch that page.
  useEffect(() => {
    if (!isServerSide || isLoading || serverPageCount === 0) return;
    if (requestedIndex >= serverPageCount) onPageChange?.(serverPageCount, pagination.pageSize);
  }, [isServerSide, isLoading, serverPageCount, requestedIndex, pagination.pageSize, onPageChange]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination: effectivePagination },
    onSortingChange: setSorting,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(effectivePagination) : updater;
      setPagination(next);
      if (isServerSide && onPageChange) {
        onPageChange(next.pageIndex + 1, next.pageSize);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: isServerSide,
    pageCount: isServerSide ? serverPageCount : undefined,
  });

  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount() || 1;
  const pageNumbers = getPageNumbers(pageIndex + 1, pageCount);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="surface-card rounded-2xl overflow-hidden">
        <div
          ref={scrollRef}
          className={fitToViewport ? 'overflow-auto' : 'overflow-x-auto'}
          style={fitToViewport && scrollMaxHeight ? { maxHeight: scrollMaxHeight } : undefined}
        >
          <table className="w-full text-[13px] border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        'px-4 py-2.5 text-left text-[11px] font-semibold text-[#64748B] uppercase tracking-wide whitespace-nowrap',
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
                <SkeletonTableRows rows={Math.min(pagination.pageSize, 8)} cols={columns.length} cellClassName="px-4 py-3.5" />
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
                      'group/row h-10 transition-colors duration-[180ms]',
                      i % 2 === 1 && !selected && 'bg-slate-900/[0.035]',
                      selected
                        ? 'bg-[color:var(--color-primary)]/[0.07] shadow-[inset_2px_0_0_var(--color-primary)]'
                        : 'hover:bg-[color:var(--color-primary)]/[0.025]',
                      onRowClick && 'cursor-pointer',
                      rowClassName?.(row.original)
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-4 py-1.5 text-[#0F172A]',
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
        <div className="flex items-center justify-between text-[11.5px] text-slate-500 bg-slate-100 border-t border-slate-200 px-3 py-1.5">
          <div className="flex items-center gap-3">
            {pageSizeOptions && (
              <label className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                Rows per page
                <select
                  value={pagination.pageSize}
                  onChange={(e) => table.setPageSize(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-[11.5px] text-slate-600 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
                >
                  {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <span>
              Page {pageIndex + 1} of {pageCount}
              {isServerSide && totalRows !== undefined && (
                <span className="text-slate-400 ml-1.5">({totalRows} total)</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="p-1 rounded-md hover:bg-slate-200/70 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-1 rounded-md hover:bg-slate-200/70 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {pageNumbers.map((n, i) =>
              n === '…' ? (
                <span key={`ellipsis-${i}`} className="px-1 text-slate-400">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => table.setPageIndex(n - 1)}
                  className={cn(
                    'w-6 h-6 rounded-md text-[11.5px] font-medium transition-all duration-[180ms]',
                    n === pageIndex + 1
                      ? 'bg-[color:var(--color-primary)] text-white shadow-sm'
                      : 'text-slate-500 hover:bg-[color:var(--color-primary-light)] hover:text-[#1687E8]'
                  )}
                >
                  {n}
                </button>
              )
            )}
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-1 rounded-md hover:bg-slate-200/70 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              className="p-1 rounded-md hover:bg-slate-200/70 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
