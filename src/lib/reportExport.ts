'use client';

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';

// Shared client-side export helpers for the Reports module — every report screen renders
// the same {label,key}[] columns + row objects, so export logic lives here once instead of
// being duplicated per report.
export interface ReportColumn {
  key: string;
  label: string;
}

export function exportReportToExcel(columns: ReportColumn[], rows: Record<string, unknown>[], filename: string) {
  const data = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) out[col.label] = row[col.key] ?? '';
    return out;
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export function exportReportToPdf(columns: ReportColumn[], rows: Record<string, unknown>[], title: string, filename: string) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  autoTable(doc, {
    startY: 20,
    head: [columns.map((c) => c.label)],
    body: rows.map((row) => columns.map((c) => String(row[c.key] ?? ''))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [79, 70, 229] },
  });
  doc.save(`${filename}.pdf`);
}

// Extends the plain grid exporters above for the 10 Payroll Report subtypes confirmed
// branch-grouped in legacy (bank-grouped for Bank Transfer) — see /reports/payroll's
// `groupRows()`/`SUBTYPE_META[...].groupBy`, which already computes the same groups the
// on-screen view renders. Exports a header/section per group followed by that group's rows and a
// Total row summing the given currency columns, instead of one flat sheet/table. Not a full replica
// of legacy's PHPExcel/PDF output for these subtypes (which also has multi-level merged
// super-headers like "Standard Salary"/"Actual Salary" spanning sub-columns on a few of them) —
// this matches the grouping structure, the main structural gap; the deeper per-subtype header
// nesting is a documented follow-up, not built here.
export interface ReportGroup {
  key: string;
  rows: Record<string, unknown>[];
}

function sumGroupColumn(rows: Record<string, unknown>[], key: string): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

export function exportGroupedReportToExcel(
  columns: ReportColumn[], groups: ReportGroup[], currencyKeys: Set<string>, filename: string
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = columns.map((c) => ({ header: c.label, width: 22 }));

  let rowNum = 1;
  for (const group of groups) {
    sheet.mergeCells(rowNum, 1, rowNum, columns.length);
    const header = sheet.getCell(rowNum, 1);
    header.value = group.key;
    header.font = { bold: true, size: 12 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    rowNum++;

    columns.forEach((c, i) => {
      const cell = sheet.getCell(rowNum, i + 1);
      cell.value = c.label;
      cell.font = { bold: true };
    });
    rowNum++;

    for (const row of group.rows) {
      columns.forEach((c, i) => {
        sheet.getCell(rowNum, i + 1).value = (row[c.key] as string | number) ?? '';
      });
      rowNum++;
    }

    columns.forEach((c, i) => {
      const cell = sheet.getCell(rowNum, i + 1);
      cell.font = { bold: true };
      cell.value = i === 0 ? 'Total' : currencyKeys.has(c.key) ? sumGroupColumn(group.rows, c.key) : '';
    });
    rowNum += 2; // blank spacer row before next group
  }

  workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

export function exportGroupedReportToPdf(
  columns: ReportColumn[], groups: ReportGroup[], currencyKeys: Set<string>, title: string, filename: string
) {
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(title, 14, 15);

  let cursorY = 22;
  groups.forEach((group, i) => {
    if (i > 0) cursorY += 6;
    doc.setFontSize(11);
    doc.text(group.key, 14, cursorY);

    const totalRow = columns.map((c, ci) => (
      ci === 0 ? 'Total' : currencyKeys.has(c.key) ? String(sumGroupColumn(group.rows, c.key)) : ''
    ));

    autoTable(doc, {
      startY: cursorY + 3,
      head: [columns.map((c) => c.label)],
      body: [...group.rows.map((row) => columns.map((c) => String(row[c.key] ?? ''))), totalRow],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
      didParseCell: (data) => {
        if (data.row.index === group.rows.length && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [229, 231, 235];
        }
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 4;
  });

  doc.save(`${filename}.pdf`);
}

// Salary Slip is a per-employee payslip document (not a tabular report), so it needs its own
// export shape rather than the generic {columns,rows} form.
export interface SalarySlipLineItem { label: string; amount: number; rate: number }
export interface SalarySlipExportData {
  emp_pkey: number;
  emp_name: string;
  employee_id: string | null;
  login_user_id: string | null;
  designation: string | null;
  department: string | null;
  branch_name: string | null;
  joining_date: string | null;
  termination_date: string | null;
  gender: string | null;
  status: number;
  leave_days: number;
  present_days: number;
  lop_days: number;
  weekoff_days: number;
  holiday_days: number;
  pf_account_no: string | null;
  esi_no: string | null;
  uan_no: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  ifsc_code: string | null;
  account_no: string | null;
  earnings: SalarySlipLineItem[];
  deductions: SalarySlipLineItem[];
  total_earnings: number;
  total_deductions: number;
  net_pay: number;
}

function slipDetailRows(slip: SalarySlipExportData): [string, string][] {
  return [
    ['Department', slip.department ?? ''], ['Gender', slip.gender ?? ''],
    ['Date of Joining', slip.joining_date ?? ''], ['Leave Days', String(slip.leave_days)],
    ['Present Days', String(slip.present_days)], ['LOP Days', String(slip.lop_days)],
    ['No. of Week Off', String(slip.weekoff_days)], ['No. of Holiday', String(slip.holiday_days)],
    ['PF Account No', slip.pf_account_no ?? ''], ['ESI No', slip.esi_no ?? ''],
    ['UAN No', slip.uan_no ?? ''], ['Bank Name', slip.bank_name ?? ''],
    ['Branch', slip.bank_branch ?? ''], ['IFSC Code', slip.ifsc_code ?? ''],
    ['Account Number', slip.account_no ?? ''],
  ];
}

export function exportSalarySlipsToPdf(slips: SalarySlipExportData[], periodLabel: string, filename: string) {
  const doc = new jsPDF({ orientation: 'portrait' });

  slips.forEach((slip, i) => {
    if (i > 0) doc.addPage();

    doc.setFontSize(13);
    doc.text(`Salary Slip - ${periodLabel}`, 105, 15, { align: 'center' });
    doc.setFontSize(11);
    const name = `${slip.emp_name}${slip.status === 2 ? ' (Resigned)' : ''} - ${slip.designation ?? ''} - ${slip.branch_name ?? ''}`;
    doc.text(name, 14, 25);

    autoTable(doc, {
      startY: 30,
      body: slipDetailRows(slip),
      styles: { fontSize: 9 },
      theme: 'grid',
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    });

    const rowCount = Math.max(slip.earnings.length, slip.deductions.length);
    const body = Array.from({ length: rowCount }).map((_, r) => [
      slip.earnings[r]?.label ?? '', slip.earnings[r] ? String(slip.earnings[r].amount) : '',
      slip.deductions[r]?.label ?? '', slip.deductions[r] ? String(slip.deductions[r].amount) : '',
    ]);
    body.push(['Total Earnings', String(slip.total_earnings), 'Total Deductions', String(slip.total_deductions)]);
    body.push(['Net Pay', String(slip.net_pay), '', '']);

    autoTable(doc, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      startY: (doc as any).lastAutoTable.finalY + 5,
      head: [['Earnings', 'Amount', 'Deductions', 'Amount']],
      body,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] },
    });
  });

  doc.save(`${filename}.pdf`);
}

// Mirrors SalaryReportsController.php's PHPExcel export for Salary Slip (case 'excel' in
// generatereport()) field-for-field and style-for-style: a single worksheet — legacy stacks every
// employee's block down the same sheet, not one sheet per employee — with title rows ("Salary
// Slip Report" / company code / "Month - <Month Year>", all merged A:D and centered), then per
// employee: a bold size-14 header row, a bold key:value details grid (exact legacy labels/pairing,
// e.g. "Loss off Pay :" paired with "Week Off :"), a Salary/Rate/Amount list (earnings, a Total
// row, then deductions, then a conditional Total row — legacy only prints it if there are any
// deduction rows), a bold Net Salary row, and a thick outline border drawn around the employee's
// whole block (legacy's $BStyle applied to the full A{start}:D{pos} range).
//
// Uses ExcelJS rather than the `xlsx`/SheetJS package used by every other export in this module:
// SheetJS's free Community Edition (what's installed here) has no cell-styling API at all — bold
// fonts, borders, and alignment are a paid SheetJS Pro feature — so it's structurally incapable of
// reproducing PHPExcel's actual formatting. ExcelJS is free and supports all of it.
//
// Not replicated: legacy's conditional "Settlement Amount" row for resigned (status=2) employees —
// that pulls from `emp_settle_slip`, which isn't wired into generateSalarySlips() (a different,
// not-yet-built area of this migration), so fabricating a zero would be worse than omitting it.
export function exportSalarySlipsToExcel(slips: SalarySlipExportData[], companyCode: string, periodLabel: string, filename: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Salary Slip');
  sheet.columns = [{ width: 40 }, { width: 40 }, { width: 40 }, { width: 40 }];

  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = 'Salary Slip Report';
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:D2');
  sheet.getCell('A2').value = companyCode;
  sheet.getCell('A2').font = { size: 14 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  sheet.mergeCells('A3:D3');
  sheet.getCell('A3').value = `Month - ${periodLabel}`;
  sheet.getCell('A3').font = { size: 14 };
  sheet.getCell('A3').alignment = { horizontal: 'center' };

  const bold = (cell: ExcelJS.Cell, size?: number) => { cell.font = { bold: true, ...(size ? { size } : {}) }; };
  const setPair = (
    row: number, colA: number, labelA: string, valueA: string | number,
    colB: number, labelB: string, valueB: string | number
  ) => {
    bold(Object.assign(sheet.getCell(row, colA), { value: labelA }));
    bold(Object.assign(sheet.getCell(row, colA + 1), { value: valueA }));
    bold(Object.assign(sheet.getCell(row, colB), { value: labelB }));
    bold(Object.assign(sheet.getCell(row, colB + 1), { value: valueB }));
  };

  let rowNum = 5;
  for (const slip of slips) {
    rowNum++;
    const start = rowNum;
    sheet.mergeCells(rowNum, 1, rowNum, 4);
    bold(Object.assign(sheet.getCell(rowNum, 1), {
      value: `Salary Slip - : ${slip.emp_name}${slip.status === 2 ? '  (Resigned)' : ''}`,
    }), 14);
    rowNum += 2;

    setPair(rowNum, 1, 'Employee ID :', slip.employee_id ?? '', 3, 'User ID :', slip.login_user_id ?? '');
    setPair(rowNum + 1, 1, 'Branch Name :', slip.branch_name ?? '', 3, 'Designation :', slip.designation ?? '');
    setPair(rowNum + 2, 1, 'Department Name :', slip.department ?? '', 3, 'Gender :', slip.gender ?? '');
    setPair(rowNum + 3, 1, 'Joining Date :', slip.joining_date ?? '', 3, 'Termination Date :', slip.termination_date ?? '');
    setPair(rowNum + 4, 1, 'Present Days :', slip.present_days, 3, 'Days on Leave :', slip.leave_days);
    setPair(rowNum + 5, 1, 'Loss off Pay :', slip.lop_days, 3, 'Week Off :', slip.weekoff_days);
    setPair(rowNum + 6, 1, 'Holiday :', slip.holiday_days, 3, 'PF account No :', slip.pf_account_no ?? '');
    setPair(rowNum + 7, 1, 'ESI No :', slip.esi_no ?? '', 3, 'UAN No :', slip.uan_no ?? '');
    setPair(rowNum + 8, 1, 'Bank Name :', slip.bank_name ?? '', 3, 'Account Number :', slip.account_no ?? '');
    setPair(rowNum + 9, 1, 'IFSC Code :', slip.ifsc_code ?? '', 3, 'Branch :', slip.bank_branch ?? '');
    rowNum += 9;

    rowNum++;
    bold(Object.assign(sheet.getCell(rowNum, 2), { value: 'Salary Slip' }), 14);
    rowNum += 2;

    const headRow = rowNum;
    sheet.getCell(headRow, 1).value = 'Salary';
    sheet.getCell(headRow, 2).value = 'Rate';
    sheet.getCell(headRow, 3).value = 'Amount';
    for (let c = 1; c <= 3; c++) bold(sheet.getCell(headRow, c), 12);
    rowNum++;

    let earnRateSum = 0, earnAmountSum = 0;
    for (const item of slip.earnings) {
      sheet.getCell(rowNum, 1).value = item.label;
      sheet.getCell(rowNum, 2).value = item.rate;
      sheet.getCell(rowNum, 3).value = item.amount;
      earnRateSum += item.rate; earnAmountSum += item.amount;
      rowNum++;
    }
    sheet.getCell(rowNum, 1).value = 'Total';
    sheet.getCell(rowNum, 2).value = earnRateSum;
    sheet.getCell(rowNum, 3).value = earnAmountSum;
    rowNum++;

    let dedRateSum = 0, dedAmountSum = 0;
    for (const item of slip.deductions) {
      sheet.getCell(rowNum, 1).value = item.label;
      sheet.getCell(rowNum, 2).value = item.rate;
      sheet.getCell(rowNum, 3).value = item.amount;
      dedRateSum += item.rate; dedAmountSum += item.amount;
      rowNum++;
    }
    if (slip.deductions.length > 0) {
      sheet.getCell(rowNum, 1).value = 'Total';
      sheet.getCell(rowNum, 2).value = dedRateSum;
      sheet.getCell(rowNum, 3).value = dedAmountSum;
      rowNum++;
    }

    bold(Object.assign(sheet.getCell(rowNum, 2), { value: 'Net Salary' }));
    bold(Object.assign(sheet.getCell(rowNum, 3), { value: slip.net_pay }));

    // Thick outline border around this employee's whole block, matching legacy's $BStyle.
    const end = rowNum;
    for (let r = start; r <= end; r++) {
      for (let c = 1; c <= 4; c++) {
        const cell = sheet.getCell(r, c);
        const border: Partial<ExcelJS.Borders> = { ...cell.border };
        if (r === start) border.top = { style: 'thick' };
        if (r === end) border.bottom = { style: 'thick' };
        if (c === 1) border.left = { style: 'thick' };
        if (c === 4) border.right = { style: 'thick' };
        cell.border = border;
      }
    }

    rowNum++; // blank spacer row before next employee
  }

  workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
