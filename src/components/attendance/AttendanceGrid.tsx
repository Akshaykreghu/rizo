'use client';

import { Fragment, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { getCellColor } from '@/lib/attendance';
import { cn } from '@/lib/utils';

export interface AttendanceDay {
  date: string;
  value: string;
  isPolicyLeave: boolean;
  inTime: string | null;
  outTime: string | null;
  duration: number | null;
  otDuration: number | null;
}

export interface MonthlyOt {
  pkey: number | null;
  totalMin: number;
  setMin: number | null;
  effectiveMin: number;
  isVerified: boolean;
  remarks: string | null;
}

export interface AttendanceRow {
  registerId: number;
  empFkey: number;
  empId: string | null;
  empName: string;
  presentTotal: number;
  leaveTotal: number;
  lopTotal: number;
  weekoffTotal: number;
  naWoCount: number;
  holidayTotal: number;
  naHoCount: number;
  workingDays: number;
  calendarDays: number;
  prorateCode: number;
  monthlyOt: MonthlyOt | null;
  days: AttendanceDay[];
}

interface Props {
  rows: AttendanceRow[];
  selected: Set<number>;
  onToggleSelect: (registerId: number) => void;
  onCellClick?: (row: AttendanceRow, dayIndex: number, day: AttendanceDay) => void;
  expandedRow: number | null;
  onToggleExpand: (registerId: number) => void;
  readOnly: boolean;
  /** Show/hide the Calendar Days/Week Off/Holiday/Working Days/Present/Leaves/LOP summary columns. */
  showSummaryCols: boolean;
  /** Monthly OT only exists once attendance is verified for the month — show the column only then. */
  showMonthlyOt: boolean;
  /** Commits an edited Monthly OT value (minutes) for a row. Undefined disables editing entirely. */
  onMonthlyOtSave?: (row: AttendanceRow, minutes: number) => void;
}

// Sticky-column widths, shared by header + body cells so offsets line up exactly.
const CHECKBOX_COL = 'sticky left-0 z-10 w-8';
const NAME_COL = 'sticky left-8 z-10 w-[10.5rem]';
// Divider that reads as "more columns to the right, scroll →" once the sticky section ends.
const STICKY_EDGE = 'shadow-[6px_0_8px_-6px_rgba(15,23,42,0.12)]';
// Visible grid lines — every cell owns its own right/bottom border (border-separate + spacing-0
// means adjacent cells never double these up into a thicker line).
const GRID_LINE = 'border-r border-b border-slate-200';

// Solid (non-translucent) tints — the summary columns are sticky, so their background must be
// fully opaque or the day columns scrolling underneath would show through.
const SUMMARY_GROUPS = {
  neutral: 'bg-slate-50 text-slate-600',
  success: 'bg-[#EAF8F1] text-[color:var(--color-success-dark)]',
  danger: 'bg-[#FDF0F6] text-[color:var(--color-danger-dark)]',
};

interface SummaryColDef {
  key: 'calendarDays' | 'weekoffTotal' | 'holidayTotal' | 'workingDays' | 'presentTotal' | 'leaveTotal' | 'lopTotal';
  label: string;
  widthRem: number;
  group: keyof typeof SUMMARY_GROUPS;
  groupStart?: boolean;
}

// Calendar Days/Week Off/Holiday/Working Days/Present/Leaves/LOP — pinned to the right of the
// Employee column (like a spreadsheet's frozen columns) so they stay visible while scrolling
// through the day-by-day cells. Widths are in rem (not px) and so is every offset derived from
// them below — Tailwind's own spacing scale (w-11, left-11, etc.) is rem-based too, so keeping
// everything in the same unit means the sticky offsets stay correct under browser zoom, OS text
// scaling, or any different root font-size, instead of drifting out of sync with the columns
// they're supposed to line up under.
const SUMMARY_COLUMNS: SummaryColDef[] = [
  { key: 'calendarDays', label: 'Calendar Days', widthRem: 6.5, group: 'neutral', groupStart: true },
  { key: 'weekoffTotal', label: 'Week Off', widthRem: 4, group: 'neutral' },
  { key: 'holidayTotal', label: 'Holiday', widthRem: 3.625, group: 'neutral' },
  { key: 'workingDays', label: 'Working Days', widthRem: 6.5, group: 'neutral' },
  { key: 'presentTotal', label: 'Present', widthRem: 3.625, group: 'success', groupStart: true },
  { key: 'leaveTotal', label: 'Leaves', widthRem: 3.375, group: 'success' },
  { key: 'lopTotal', label: 'LOP', widthRem: 2.875, group: 'danger', groupStart: true },
];

const CHECKBOX_W_REM = 2; // matches CHECKBOX_COL's w-8 (Tailwind's own scale, in rem)
const NAME_W_REM = 10.5; // matches NAME_COL's w-[10.5rem]
const DAY_COL_W_REM = 4.5; // matches the day header's w-[4.5rem]
const SUMMARY_TOTAL_REM = SUMMARY_COLUMNS.reduce((sum, c) => sum + c.widthRem, 0);
const SUMMARY_LEFTS_REM: number[] = (() => {
  let left = CHECKBOX_W_REM + NAME_W_REM;
  return SUMMARY_COLUMNS.map((c) => {
    const l = left;
    left += c.widthRem;
    return l;
  });
})();
// Monthly OT (emp_ot_master) — an 8th sticky column, right after LOP. Rendered separately from the
// generic SUMMARY_COLUMNS loop below since it needs an editable input + verified badge rather than
// a plain number, but it shares the same sticky-offset scheme and is toggled by the same
// showSummaryCols flag.
const MONTHLY_OT_W_REM = 6.5;
const MONTHLY_OT_LEFT_REM = CHECKBOX_W_REM + NAME_W_REM + SUMMARY_TOTAL_REM;
const rem = (n: number) => `${n}rem`;

// Today's date, as a local calendar date (not UTC — new Date().toISOString() would shift by the
// browser's UTC offset near midnight, same class of bug fixed elsewhere in this file for punch
// times). A day column only ever matches this when the currently viewed month actually contains
// today, so no separate "is this the current month" check is needed anywhere else.
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY_COL_BG = 'bg-[color:var(--color-primary)]/[0.05]';
const TODAY_TOP_ACCENT = 'border-t-2 border-t-[color:var(--color-primary)]';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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

// Self-contained pagination (rows in, sliced rows + its own footer out) — mirrors DataTable.tsx's
// proven structure so the pager always lives inside the same bounded card as the table it controls,
// directly below the table's own scroll box, instead of risking becoming a separate sibling element
// elsewhere on the page. Callers should remount this component (e.g. via a `key` tied to
// month/branch/tab) whenever the underlying row set changes context, so page/size state resets.
export function AttendanceGrid({ rows, selected, onToggleSelect, onCellClick, expandedRow, onToggleExpand, readOnly, showSummaryCols, showMonthlyOt, onMonthlyOtSave }: Props) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const today = todayISO();

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRows = rows.slice(clampedPageIndex * pageSize, clampedPageIndex * pageSize + pageSize);

  // table-layout:fixed only reliably locks column widths to what's declared on the first row when
  // the <table> itself also has an explicit width (per spec, a table left at width:auto is allowed
  // to fall back to content-based sizing even with table-layout:fixed set) — so the total width is
  // computed here and applied explicitly below, rather than leaving it to shrink/grow implicitly.
  const dayCount = pagedRows[0]?.days.length ?? 0;
  const totalTableWidthRem = CHECKBOX_W_REM + NAME_W_REM + (showSummaryCols ? SUMMARY_TOTAL_REM : 0) + (showSummaryCols && showMonthlyOt ? MONTHLY_OT_W_REM : 0) + dayCount * DAY_COL_W_REM;

  return (
    <div className="surface-card rounded-2xl overflow-hidden">
      <div className="overflow-auto scroll-fade max-h-[60vh]">
        <table className="text-sm border-separate border-spacing-0 table-fixed" style={{ width: rem(totalTableWidthRem) }}>
          <thead>
            <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10">
              <th className={cn(CHECKBOX_COL, GRID_LINE, '!z-20 bg-slate-50 p-1.5')} />
              <th className={cn(NAME_COL, GRID_LINE, '!z-20 bg-slate-50 px-2 py-1.5 text-left', !showSummaryCols && STICKY_EDGE)}>
                <span className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide">Employee</span>
              </th>
              {showSummaryCols && SUMMARY_COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  className={cn(
                    GRID_LINE,
                    'sticky top-0 !z-20 px-1.5 py-1.5 text-center whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide',
                    SUMMARY_GROUPS[c.group],
                    c.groupStart && 'border-l border-l-slate-300',
                    i === SUMMARY_COLUMNS.length - 1 && !showMonthlyOt && STICKY_EDGE
                  )}
                  style={{ left: rem(SUMMARY_LEFTS_REM[i]), width: rem(c.widthRem), minWidth: rem(c.widthRem) }}
                >
                  {c.label}
                </th>
              ))}
              {showSummaryCols && showMonthlyOt && (
                <th
                  className={cn(
                    GRID_LINE, STICKY_EDGE,
                    'sticky top-0 !z-20 px-1.5 py-1.5 text-center whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide',
                    'bg-[color:var(--color-accent-light)] text-[color:var(--color-accent-dark)] border-l border-l-slate-300'
                  )}
                  style={{ left: rem(MONTHLY_OT_LEFT_REM), width: rem(MONTHLY_OT_W_REM), minWidth: rem(MONTHLY_OT_W_REM) }}
                >
                  Monthly OT
                </th>
              )}
              {pagedRows[0]?.days.map((d) => {
                const isToday = d.date === today;
                return (
                  <th
                    key={d.date}
                    className={cn(
                      GRID_LINE,
                      'py-1 px-1 text-center w-[4.5rem] text-[10.5px] font-semibold',
                      isToday ? cn(TODAY_COL_BG, TODAY_TOP_ACCENT, 'text-[color:var(--color-primary)]') : 'bg-white text-slate-500'
                    )}
                  >
                    {new Date(d.date).getDate()}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => {
              const isSelected = selected.has(row.registerId);
              return (
                <Fragment key={row.registerId}>
                  <tr className={cn('group/row transition-colors duration-150', isSelected ? 'bg-[color:var(--color-primary)]/[0.06]' : 'hover:bg-[color:var(--color-primary)]/[0.03]')}>
                    <td className={cn(CHECKBOX_COL, GRID_LINE, 'bg-white group-hover/row:bg-inherit', isSelected && 'bg-[color:var(--color-primary-light)]', 'p-1.5')}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(row.registerId)}
                        className="w-3.5 h-3.5 rounded-full accent-[color:var(--color-primary)] cursor-pointer"
                      />
                    </td>
                    <td className={cn(NAME_COL, GRID_LINE, 'bg-white', isSelected && 'bg-[color:var(--color-primary-light)]', 'px-2 py-1', !showSummaryCols && STICKY_EDGE)}>
                      <button
                        className="group/expand flex max-w-full items-center gap-1 text-left"
                        onClick={() => onToggleExpand(row.registerId)}
                        aria-expanded={expandedRow === row.registerId}
                        title={expandedRow === row.registerId ? 'Collapse punch details' : 'Show punch details'}
                      >
                        <ChevronRight
                          className={cn(
                            'w-3 h-3 flex-shrink-0 text-slate-400 transition-transform duration-150',
                            expandedRow === row.registerId && 'rotate-90 text-[color:var(--color-primary)]'
                          )}
                        />
                        <span className="truncate text-[12.5px] font-semibold text-[color:var(--color-primary)] group-hover/expand:underline underline-offset-2">
                          {row.empName}
                        </span>
                      </button>
                      <div className="truncate pl-4 text-[10.5px] text-slate-400 leading-tight">{row.empId}</div>
                    </td>
                    {showSummaryCols && SUMMARY_COLUMNS.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          GRID_LINE,
                          'sticky z-10 px-1.5 py-1 text-center text-[11.5px] font-medium tabular-nums',
                          SUMMARY_GROUPS[c.group],
                          c.groupStart && 'border-l border-l-slate-300',
                          i === SUMMARY_COLUMNS.length - 1 && !showMonthlyOt && STICKY_EDGE
                        )}
                        style={{ left: rem(SUMMARY_LEFTS_REM[i]), width: rem(c.widthRem), minWidth: rem(c.widthRem) }}
                      >
                        {row[c.key]}
                      </td>
                    ))}
                    {showSummaryCols && showMonthlyOt && (
                      <td
                        className={cn(
                          GRID_LINE, STICKY_EDGE,
                          'sticky z-10 px-1.5 py-1 text-center text-[11.5px] font-medium tabular-nums',
                          'bg-[color:var(--color-accent-light)] text-[color:var(--color-accent-dark)] border-l border-l-slate-300'
                        )}
                        style={{ left: rem(MONTHLY_OT_LEFT_REM), width: rem(MONTHLY_OT_W_REM), minWidth: rem(MONTHLY_OT_W_REM) }}
                      >
                        <MonthlyOtCell row={row} onSave={onMonthlyOtSave} />
                      </td>
                    )}
                    {row.days.map((d, i) => {
                      const { bg, fg } = getCellColor(d.value, d.isPolicyLeave);
                      const isNa = d.value.trim().toUpperCase() === 'NA';
                      const isToday = d.date === today;
                      return (
                        <td
                          key={d.date}
                          className={cn(GRID_LINE, 'py-0.5 px-1 text-center align-middle', !readOnly && !isNa && 'cursor-pointer', isToday && TODAY_COL_BG)}
                          onClick={() => !readOnly && !isNa && onCellClick?.(row, i + 1, d)}
                          title={d.value}
                        >
                          <span
                            className="inline-flex min-w-[26px] items-center justify-center rounded-md px-1 py-0.5 text-[10.5px] font-semibold leading-none"
                            style={{ backgroundColor: bg, color: fg }}
                          >
                            {d.value || '—'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                  {expandedRow === row.registerId && (
                    <>
                      <ExpandRow index={0} label="IN" values={row.days.map((d) => formatTime(d.inTime))} showSummaryCols={showSummaryCols} showMonthlyOt={showMonthlyOt} />
                      <ExpandRow index={1} label="OUT" values={row.days.map((d) => formatTime(d.outTime))} showSummaryCols={showSummaryCols} showMonthlyOt={showMonthlyOt} />
                      <ExpandRow index={2} label="Duration (min)" values={row.days.map((d) => (d.duration ?? '—').toString())} showSummaryCols={showSummaryCols} showMonthlyOt={showMonthlyOt} />
                      <ExpandRow index={3} label="OT (min)" values={row.days.map((d) => (d.otDuration ?? '—').toString())} showSummaryCols={showSummaryCols} showMonthlyOt={showMonthlyOt} last />
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-slate-500 bg-slate-50 border-t border-slate-200 px-3 py-2">
        <label className="flex items-center gap-1.5">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPageIndex(0); }}
            className="bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-[12px] text-slate-600 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/30"
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-slate-400">({rows.length} total)</span>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={clampedPageIndex === 0}
            className="p-1 rounded-md hover:bg-slate-200/60 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          {getPageNumbers(clampedPageIndex + 1, pageCount).map((n, i) =>
            n === '…' ? (
              <span key={`ellipsis-${i}`} className="px-1 text-slate-400">…</span>
            ) : (
              <button
                type="button"
                key={n}
                onClick={() => setPageIndex(n - 1)}
                className={cn(
                  'w-[26px] h-[26px] rounded-md text-[12px] font-medium transition-colors',
                  n === clampedPageIndex + 1
                    ? 'bg-[color:var(--color-primary)] text-white shadow-sm'
                    : 'text-slate-500 hover:bg-[color:var(--color-primary-light)] hover:text-[color:var(--color-primary)]'
                )}
              >
                {n}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
            disabled={clampedPageIndex >= pageCount - 1}
            className="p-1 rounded-md hover:bg-slate-200/60 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ExpandRow({ index, label, values, last, showSummaryCols, showMonthlyOt }: { index: number; label: string; values: string[]; last?: boolean; showSummaryCols: boolean; showMonthlyOt: boolean }) {
  // Alternating shade across the IN/OUT/Duration/OT detail rows within one expanded employee —
  // purely a readability aid for scanning across a wide row, independent of (and much lighter than)
  // any attendance status color.
  const rowBg = index % 2 === 0 ? 'bg-slate-50/60' : 'bg-white';
  return (
    <tr className={cn('animate-fade-in text-[10.5px] text-slate-500', rowBg, last && 'border-b border-slate-200')}>
      <td className={cn(CHECKBOX_COL, 'border-r border-slate-200', rowBg)} />
      <td className={cn(NAME_COL, 'border-r border-slate-200 py-0.5 pl-4 font-medium text-slate-400', rowBg, !showSummaryCols && STICKY_EDGE)}>{label}</td>
      {showSummaryCols && SUMMARY_COLUMNS.map((c, i) => (
        <td
          key={c.key}
          className={cn(
            'sticky z-10 border-r border-slate-200',
            rowBg,
            c.groupStart && 'border-l border-l-slate-300',
            i === SUMMARY_COLUMNS.length - 1 && !showMonthlyOt && STICKY_EDGE
          )}
          style={{ left: rem(SUMMARY_LEFTS_REM[i]), width: rem(c.widthRem), minWidth: rem(c.widthRem) }}
        />
      ))}
      {showSummaryCols && showMonthlyOt && (
        <td
          className={cn('sticky z-10 border-r border-l border-l-slate-300 border-slate-200', rowBg, STICKY_EDGE)}
          style={{ left: rem(MONTHLY_OT_LEFT_REM), width: rem(MONTHLY_OT_W_REM), minWidth: rem(MONTHLY_OT_W_REM) }}
        />
      )}
      {values.map((v, i) => (
        <td key={i} className={cn('border-r border-slate-200 py-0.5 text-center tabular-nums', rowBg)}>
          {v}
        </td>
      ))}
    </tr>
  );
}

// Monthly OT (emp_ot_master effective value = set_duration ?? total_duration). Read-only once
// verified (matches legacy protecting an approved value from silent edits) or when the caller
// doesn't wire up onSave at all; otherwise an inline, uncontrolled number input that commits on
// blur/Enter — avoids a parent re-render per keystroke across a page full of rows. Keyed by the
// row's monthlyOt identity so a refetch (e.g. after Process/Verify generates the row) resets any
// stale draft rather than fighting it.
function MonthlyOtCell({ row, onSave }: { row: AttendanceRow; onSave?: (row: AttendanceRow, minutes: number) => void }) {
  const ot = row.monthlyOt;

  if (!onSave || ot?.isVerified) {
    if (!ot) return <span className="text-slate-300">—</span>;
    return (
      <span className="inline-flex items-center gap-1 justify-center">
        {ot.effectiveMin}
        {ot.isVerified && <Lock className="w-3 h-3 opacity-60" />}
      </span>
    );
  }

  return (
    <input
      key={`${ot?.pkey ?? 'new'}-${ot?.effectiveMin ?? 0}`}
      type="number"
      min={0}
      defaultValue={ot?.effectiveMin ?? ''}
      placeholder="0"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const next = Number(e.target.value) || 0;
        if (next !== (ot?.effectiveMin ?? 0)) onSave(row, next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="w-full bg-white/70 border border-[color:var(--color-accent)]/30 rounded px-1 py-0.5 text-center text-[11.5px] tabular-nums focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]"
    />
  );
}

// DB connections are opened with timezone: '+00:00' (see lib/db.ts) so mysql2 tags every
// DATETIME it reads as UTC — but the legacy schema only ever stores naive local wall-clock time,
// never real UTC. Rendering with the browser's local zone (the default for toLocaleTimeString)
// re-shifts that already-correct clock reading by the browser's UTC offset. Passing timeZone:
// 'UTC' here reads back the exact wall-clock value that was stored, undoing that double conversion.
function formatTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}
