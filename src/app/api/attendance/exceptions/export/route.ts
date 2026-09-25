import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAppliedRule, getChangeLog } from '@/lib/exceptionRules';
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

// Mirrors ExceptionRuleController::downloadExceptionExcel()'s PHPExcel sheet cell-for-cell:
// sheet "Exception Logs" with gridlines hidden; A1:K1 merged "Exception Rule Change Log" (bold,
// 16pt, centred); A2:K2 merged "Rule ID: x    Date: y" (centred); row 3 blank; bold headers on
// row 4; data from row 5, or a merged bold-italic centred "no records" line; auto-sized columns.
// Uses ExcelJS rather than SheetJS because SheetJS's free tier can't write any of that styling.
const HEADERS = [
  'Emp ID', 'Attendance Date', 'Employee Name', 'Branch', 'Old In', 'Old Out',
  'New In', 'New Out', 'Change Reason', 'Changed By', 'Timestamp',
];

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const appliedId = Number(new URL(request.url).searchParams.get('appliedId'));
  if (!appliedId) return NextResponse.json({ error: 'appliedId is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const applied = await getAppliedRule(pool, appliedId);
  if (!applied) return NextResponse.json({ error: 'Applied rule not found' }, { status: 404 });

  const appliedDate = String(applied.applied_date instanceof Date ? applied.applied_date.toISOString() : applied.applied_date).slice(0, 10);
  const logs = await getChangeLog(pool, applied.rule_id, applied.branch_code, applied.month_year);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Exception Logs', { views: [{ showGridLines: false }] });

  sheet.mergeCells('A1:K1');
  const title = sheet.getCell('A1');
  title.value = 'Exception Rule Change Log';
  title.font = { bold: true, size: 16 };
  title.alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:K2');
  const subtitle = sheet.getCell('A2');
  subtitle.value = `Rule ID: ${applied.rule_id}    Date: ${appliedDate}`;
  subtitle.alignment = { horizontal: 'center' };

  const headerRow = sheet.getRow(4);
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });

  const rows = logs.map((l) => [l.empId, l.attDate, l.empName, l.branch, l.oldIn, l.oldOut, l.newIn, l.newOut, l.reason, l.changedBy, l.timestamp]);
  if (rows.length === 0) {
    sheet.mergeCells('A5:K5');
    const empty = sheet.getCell('A5');
    empty.value = 'No exception records found for the selected rule and date.';
    empty.font = { bold: true, italic: true };
    empty.alignment = { horizontal: 'center' };
  } else {
    rows.forEach((r, i) => { sheet.getRow(5 + i).values = r; });
  }

  // PHPExcel's setAutoSize(true): width follows the longest header/data value in each column
  // (merged title/subtitle/no-records cells don't count, same as PHPExcel).
  sheet.columns.forEach((col, i) => {
    const longest = Math.max(HEADERS[i].length, ...rows.map((r) => String(r[i] ?? '').length));
    col.width = longest + 3;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Exception_Logs_${applied.rule_id}_${appliedDate}.xlsx"`,
      'Cache-Control': 'max-age=0',
    },
  });
}
