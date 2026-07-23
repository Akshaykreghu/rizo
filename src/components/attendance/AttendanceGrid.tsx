'use client';

import { Fragment } from 'react';
import { getCellColor } from '@/lib/attendance';

export interface AttendanceDay {
  date: string;
  value: string;
  isPolicyLeave: boolean;
  inTime: string | null;
  outTime: string | null;
  duration: number | null;
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
}

export function AttendanceGrid({ rows, selected, onToggleSelect, onCellClick, expandedRow, onToggleExpand, readOnly }: Props) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="text-sm border-collapse w-full">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="sticky left-0 bg-gray-50 p-2 border-b border-gray-200 w-8" />
            <th className="sticky left-8 bg-gray-50 p-2 border-b border-gray-200 min-w-[180px]">Employee Name</th>
            <th className="p-2 border-b border-gray-200 bg-[#cfe3ef] whitespace-nowrap">Calendar Days</th>
            <th className="p-2 border-b border-gray-200 bg-[#cfe3ef] whitespace-nowrap">Week Off</th>
            <th className="p-2 border-b border-gray-200 bg-[#cfe3ef] whitespace-nowrap">Holiday</th>
            <th className="p-2 border-b border-gray-200 bg-[#cfe3ef] whitespace-nowrap">Working Days</th>
            <th className="p-2 border-b border-gray-200 bg-[#a7e7a3] whitespace-nowrap">Present</th>
            <th className="p-2 border-b border-gray-200 bg-[#a7e7a3] whitespace-nowrap">Leaves</th>
            <th className="p-2 border-b border-gray-200 bg-[#ef6b6b] whitespace-nowrap">LOP</th>
            {rows[0]?.days.map((d) => (
              <th key={d.date} className="p-1 border-b border-gray-200 text-center w-10">
                {new Date(d.date).getDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.registerId}>
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="sticky left-0 bg-white p-2">
                  <input type="checkbox" checked={selected.has(row.registerId)} onChange={() => onToggleSelect(row.registerId)} />
                </td>
                <td className="sticky left-8 bg-white p-2 whitespace-nowrap">
                  <button className="text-indigo-600 hover:underline" onClick={() => onToggleExpand(row.registerId)}>
                    {row.empName}
                  </button>
                  <div className="text-xs text-gray-400">{row.empId}</div>
                </td>
                <td className="p-2 text-center bg-[#cfe3ef]">{row.calendarDays}</td>
                <td className="p-2 text-center bg-[#cfe3ef]">{row.weekoffTotal}</td>
                <td className="p-2 text-center bg-[#cfe3ef]">{row.holidayTotal}</td>
                <td className="p-2 text-center bg-[#cfe3ef]">{row.workingDays}</td>
                <td className="p-2 text-center bg-[#a7e7a3]">{row.presentTotal}</td>
                <td className="p-2 text-center bg-[#a7e7a3]">{row.leaveTotal}</td>
                <td className="p-2 text-center bg-[#ef6b6b]">{row.lopTotal}</td>
                {row.days.map((d, i) => {
                  const { bg, fg } = getCellColor(d.value, d.isPolicyLeave);
                  return (
                    <td
                      key={d.date}
                      className={cellClass(readOnly)}
                      style={{ backgroundColor: bg, color: fg }}
                      onClick={() => !readOnly && onCellClick?.(row, i + 1, d)}
                      title={d.value}
                    >
                      {d.value || '—'}
                    </td>
                  );
                })}
              </tr>
              {expandedRow === row.registerId && (
                <>
                  <tr className="text-xs text-gray-500 bg-gray-50">
                    <td className="sticky left-0 bg-gray-50" />
                    <td className="sticky left-8 bg-gray-50 p-1 pl-4">IN</td>
                    {row.days.map((d) => (
                      <td key={d.date} className="p-1 text-center">{formatTime(d.inTime)}</td>
                    ))}
                  </tr>
                  <tr className="text-xs text-gray-500 bg-gray-50">
                    <td className="sticky left-0 bg-gray-50" />
                    <td className="sticky left-8 bg-gray-50 p-1 pl-4">OUT</td>
                    {row.days.map((d) => (
                      <td key={d.date} className="p-1 text-center">{formatTime(d.outTime)}</td>
                    ))}
                  </tr>
                  <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                    <td className="sticky left-0 bg-gray-50" />
                    <td className="sticky left-8 bg-gray-50 p-1 pl-4">Duration (min)</td>
                    {row.days.map((d) => (
                      <td key={d.date} className="p-1 text-center">{d.duration ?? '—'}</td>
                    ))}
                  </tr>
                </>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellClass(readOnly: boolean) {
  return `p-1 text-center text-xs w-10 ${readOnly ? '' : 'cursor-pointer'}`;
}

function formatTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
