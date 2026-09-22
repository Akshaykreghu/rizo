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

/** Turns a report's {label,key}[] column list into ColumnDef[] for the shared DataTable. */
export function toDataTableColumns(columns: ReportColumn[]): import('@tanstack/react-table').ColumnDef<Record<string, unknown>, unknown>[] {
  return columns.map((c) => ({
    id: c.key,
    header: c.label,
    accessorFn: (row: Record<string, unknown>) => row[c.key],
    cell: ({ getValue }: { getValue: () => unknown }) => String(getValue() ?? ''),
    meta: { className: 'whitespace-nowrap' },
  }));
}

const SL_NO_KEY = '__slno';

function sumFlatColumn(rows: Record<string, unknown>[], key: string): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

// Plain (non-styled) path stays on the free `xlsx`/SheetJS package, which every other report screen
// already relies on. `options` opts into ExcelJS instead — SheetJS's free tier has no cell-styling
// API at all (bold/merge is a paid feature), so a title row, Sl No numbering, or a bold Total row
// need the same engine already used by exportGroupedReportToExcel.
export function exportReportToExcel(
  columns: ReportColumn[], rows: Record<string, unknown>[], filename: string,
  options?: { title?: string; slNo?: boolean; totalKeys?: Set<string>; superHeaders?: { label: string; span: number }[] }
) {
  if (!options) {
    const data = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of columns) out[col.label] = row[col.key] ?? '';
      return out;
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
    XLSX.writeFile(workbook, `${filename}.xlsx`);
    return;
  }

  const cols = options.slNo ? [{ key: SL_NO_KEY, label: 'Sl No' }, ...columns] : columns;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = cols.map((c) => ({ header: c.label, width: 22 }));

  let rowNum = 1;
  if (options.title) {
    sheet.mergeCells(rowNum, 1, rowNum, cols.length);
    const titleCell = sheet.getCell(rowNum, 1);
    titleCell.value = options.title;
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center' };
    rowNum++;
  }

  if (options.superHeaders) {
    let col = 1;
    for (const sh of options.superHeaders) {
      if (sh.span <= 0) continue;
      sheet.mergeCells(rowNum, col, rowNum, col + sh.span - 1);
      const cell = sheet.getCell(rowNum, col);
      cell.value = sh.label;
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
      col += sh.span;
    }
    rowNum++;
  }

  cols.forEach((c, i) => {
    const cell = sheet.getCell(rowNum, i + 1);
    cell.value = c.label;
    cell.font = { bold: true };
  });
  rowNum++;

  rows.forEach((row, rIdx) => {
    cols.forEach((c, i) => {
      sheet.getCell(rowNum, i + 1).value = c.key === SL_NO_KEY ? rIdx + 1 : (row[c.key] as string | number) ?? '';
    });
    rowNum++;
  });

  if (options.totalKeys) {
    cols.forEach((c, i) => {
      const cell = sheet.getCell(rowNum, i + 1);
      cell.font = { bold: true };
      cell.value = i === 0 ? 'Total' : options.totalKeys!.has(c.key) ? sumFlatColumn(rows, c.key) : '';
    });
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

export function exportReportToPdf(
  columns: ReportColumn[], rows: Record<string, unknown>[], title: string, filename: string,
  options?: { slNo?: boolean; totalKeys?: Set<string> }
) {
  const cols = options?.slNo ? [{ key: SL_NO_KEY, label: 'Sl No' }, ...columns] : columns;
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  const body = rows.map((row, rIdx) => cols.map((c) => c.key === SL_NO_KEY ? String(rIdx + 1) : String(row[c.key] ?? '')));
  if (options?.totalKeys) {
    body.push(cols.map((c, i) => i === 0 ? 'Total' : options.totalKeys!.has(c.key) ? String(sumFlatColumn(rows, c.key)) : ''));
  }
  autoTable(doc, {
    startY: 20,
    head: [cols.map((c) => c.label)],
    body,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [79, 70, 229] },
    didParseCell: (data) => {
      if (options?.totalKeys && data.row.index === body.length - 1 && data.section === 'body') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [229, 231, 235];
      }
    },
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
  columns: ReportColumn[], groups: ReportGroup[], currencyKeys: Set<string>, filename: string,
  // `groupTotals` defaults true (every other grouped report on this screen has a per-group Total
  // row). GrosssalarySummary's real Excel (SalaryReportsController.php:11499-11637) has neither a
  // Total row nor a blank spacer between branch sections — just the branch header row straight into
  // the next branch's data — so it passes `groupTotals: false`.
  options?: { title?: string; slNo?: boolean; groupTotals?: boolean }
) {
  const groupTotals = options?.groupTotals ?? true;
  const cols = options?.slNo ? [{ key: SL_NO_KEY, label: 'Sl No' }, ...columns] : columns;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = cols.map((c) => ({ header: c.label, width: 22 }));

  let rowNum = 1;
  if (options?.title) {
    sheet.mergeCells(rowNum, 1, rowNum, cols.length);
    const titleCell = sheet.getCell(rowNum, 1);
    titleCell.value = options.title;
    titleCell.font = { bold: true, size: 17 };
    titleCell.alignment = { horizontal: 'center' };
    rowNum++;
  }

  for (const group of groups) {
    sheet.mergeCells(rowNum, 1, rowNum, cols.length);
    const header = sheet.getCell(rowNum, 1);
    header.value = group.key;
    header.font = { bold: true, size: 12 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    rowNum++;

    cols.forEach((c, i) => {
      const cell = sheet.getCell(rowNum, i + 1);
      cell.value = c.label;
      cell.font = { bold: true };
    });
    rowNum++;

    group.rows.forEach((row, rIdx) => {
      cols.forEach((c, i) => {
        sheet.getCell(rowNum, i + 1).value = c.key === SL_NO_KEY ? rIdx + 1 : (row[c.key] as string | number) ?? '';
      });
      rowNum++;
    });

    if (groupTotals) {
      cols.forEach((c, i) => {
        const cell = sheet.getCell(rowNum, i + 1);
        cell.font = { bold: true };
        cell.value = i === 0 ? 'Total' : currencyKeys.has(c.key) ? sumGroupColumn(group.rows, c.key) : '';
      });
      rowNum += 2; // blank spacer row before next group
    }
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
  // Legacy's PDF shows these as two distinct fields (salaryslip_not_exempted.ctp:942-955) — "Non
  // Paying Days" (payroll_master.loss_of_pay) and "LOP Days" (attendance_register.lop_only).
  non_paying_days: number;
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
  settlement_amount: number;
  net_pay: number;
}

// Company letterhead info for the PDF header — same shape/source as payslipPdf.ts's CompanyInfo
// (GET /api/company, comp_contact_info table), reused here rather than re-fetched with a new shape.
export interface SalarySlipCompanyInfo {
  business_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
}

function slipDetailRows(slip: SalarySlipExportData): [string, string, string, string][] {
  // Mirrors legacy's exact row-pairing (salaryslip_not_exempted.ctp:920-1002) — Branch is its own
  // row at the end (colspan 4 in legacy), not paired with anything, so it's appended separately.
  return [
    ['Employee ID', slip.employee_id ?? '', 'Date of Joining', slip.joining_date ?? ''],
    ['Department', slip.department ?? '', 'Gender', slip.gender ?? ''],
    ['Leave Days', String(slip.leave_days), 'Present Days', String(slip.present_days)],
    ['Non Paying Days', String(slip.non_paying_days), 'No. of Week Off', String(slip.weekoff_days)],
    ['LOP Days', String(slip.lop_days), 'No. of Holiday', String(slip.holiday_days)],
    ['PF account No', slip.pf_account_no ?? '', 'ESI No', slip.esi_no ?? ''],
    ['UAN No', slip.uan_no ?? '', 'Bank Name', slip.bank_name ?? ''],
    ['Account Number', slip.account_no ?? '', 'IFSC Code', slip.ifsc_code ?? ''],
  ];
}

// Mirrors legacy's HTML2PDF-rendered salaryslip_not_exempted.ctp (PDF branch, lines 771-1417) —
// same content sections (letterhead, per-employee detail grid, Earnings/Deductions table with a
// conditional Settlement Amount row, footer disclaimer) in the same order and with the same exact
// field labels, via jsPDF/jspdf-autotable instead of HTML2PDF. Not replicated: byte-identical
// HTML2PDF fonts/margins/page numbering (same disclosed jsPDF-vs-HTML2PDF limitation already
// accepted for other reports' PDFs), and the PDF-specific omission of a "(Resigned)" name suffix
// that legacy's screen/Excel outputs include but its PDF header oddly doesn't — kept here since
// dropping it would be less useful and looks like an unintentional legacy gap, not a deliberate one.
export function exportSalarySlipsToPdf(
  slips: SalarySlipExportData[], periodLabel: string, filename: string,
  company?: SalarySlipCompanyInfo | null, downloadedBy?: string
) {
  const doc = new jsPDF({ orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const GRAY: [number, number, number] = [204, 204, 204];

  slips.forEach((slip, i) => {
    if (i > 0) doc.addPage();

    let y = 15;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(company?.business_name ?? '', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    y += 5;
    const addressLine = [company?.address, company?.city && `${company.city} ,PIN - ${company?.pincode ?? ''}`, company?.state]
      .filter(Boolean).join(', ');
    if (addressLine) { doc.text(addressLine, 14, y); y += 5; }
    const contactLine = [company?.phone && `Phone : ${company.phone}`, company?.email && `Email : ${company.email}`].filter(Boolean).join('   ');
    if (contactLine) { doc.text(contactLine, 14, y); y += 5; }
    y += 2;
    doc.setDrawColor(0);
    doc.line(14, y, pageWidth - 14, y);
    y += 8;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    // Legacy's literal title format glues the month to the year with a hyphen, no space
    // (e.g. "Salary Slip - March-2026") — periodLabel comes in as "March 2026".
    doc.text(`Salary Slip - ${periodLabel.replace(' ', '-')}`, pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(11);
    const name = `${slip.emp_name}${slip.status === 2 ? ' (Resigned)' : ''} - ${slip.designation ?? ''} - ${slip.branch_name ?? ''}`;
    doc.text(name, pageWidth / 2, y, { align: 'center' });
    y += 4;

    autoTable(doc, {
      startY: y,
      body: [...slipDetailRows(slip), ['Branch', slip.bank_branch ?? '', '', '']],
      styles: { fontSize: 9 },
      theme: 'grid',
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 }, 2: { fontStyle: 'bold', cellWidth: 40 } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 4;

    const rowCount = Math.max(slip.earnings.length, slip.deductions.length);
    const body = Array.from({ length: rowCount }).map((_, r) => [
      slip.earnings[r]?.label ?? '', slip.earnings[r] ? String(slip.earnings[r].amount) : '',
      slip.deductions[r]?.label ?? '', slip.deductions[r] ? String(slip.deductions[r].amount) : '',
    ]);
    body.push(['Total Earnings', String(slip.total_earnings), 'Total Deductions ', String(slip.total_deductions)]);
    if (slip.status === 2) body.push(['Settlement Amount', String(slip.settlement_amount), '', '']);
    body.push(['Net Pay', String(slip.net_pay), '', '']);

    const totalsStartRow = rowCount;
    autoTable(doc, {
      startY: y,
      head: [['Earnings', 'Amount', 'Deductions', 'Amount']],
      body,
      styles: { fontSize: 9 },
      headStyles: { fillColor: GRAY, textColor: 0, fontStyle: 'bold' },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index >= totalsStartRow) {
          data.cell.styles.fillColor = GRAY;
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text('*This is a System generated pay slip and does not require signature.', 14, y);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    const footerY = pageHeight - 10;
    if (downloadedBy) doc.text(`Downloaded By ${downloadedBy} ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, 14, footerY);
    doc.text(`page ${i + 1}/${slips.length}`, pageWidth - 14, footerY, { align: 'right' });
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

// Monthly CTC Detailed Report is also a per-employee card layout in legacy (monthlyctc.ctp +
// its own Excel branch, SalaryReportsController.php:13152-13369) — a "Branch Name:" legend (Units
// criteria only, when the branch changes), an "Employee Name:" row, an EMP ID/Branch/Designation/
// Department row, a Salary Components/Amount mini-table (Addition items only), and a Grand Total row.
export interface MonthlyCtcExportItem { label: string; amount: number; headType: string | null }
export interface MonthlyCtcExportCard {
  emp_name: string;
  employee_id: string | null;
  branch_name: string | null;
  departments: string | null;
  desig: string | null;
  items: MonthlyCtcExportItem[];
  grand_total: number;
}

// Legacy's Excel rounding differs from its own View (SalaryReportsController.php:13307-13311):
// 'fixed'/'manually'/'limit' head types are shown RAW here (no rounding, no abs) — only every other
// head type rounds to the nearest rupee. Not a typo to "fix" — a genuine View-vs-Excel divergence.
function monthlyCtcExcelItemAmount(item: MonthlyCtcExportItem): number {
  if (item.headType === 'fixed' || item.headType === 'manually' || item.headType === 'limit') return item.amount;
  return Math.round(item.amount);
}

export function exportMonthlyCtcToExcel(
  cards: MonthlyCtcExportCard[], groupByBranch: boolean, monthLabel: string, filename: string, runBy: string
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Monthly CTC');
  sheet.columns = [{ width: 28 }, { width: 24 }, { width: 24 }, { width: 24 }];

  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = `Monthly CTC - ${monthLabel}`;
  sheet.getCell('A1').font = { bold: true, size: 16 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:D2');
  sheet.getCell('A2').value = `(Report Run by ${runBy} at ${new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')})`;
  sheet.getCell('A2').font = { bold: true, size: 13 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  let rowNum = 2;
  if (cards.length === 0) {
    rowNum = 3;
    sheet.mergeCells(`A${rowNum}:F${rowNum}`);
    const cell = sheet.getCell(`A${rowNum}`);
    cell.value = 'There is no data found under this criteria';
    cell.font = { bold: true, size: 12 };
    cell.alignment = { horizontal: 'center' };
  }

  const bold = (cell: ExcelJS.Cell) => { cell.font = { bold: true }; };
  let lastBranchName = '';
  for (const card of cards) {
    if (groupByBranch && card.branch_name !== lastBranchName) {
      rowNum++;
      sheet.mergeCells(rowNum, 1, rowNum, 4);
      bold(Object.assign(sheet.getCell(rowNum, 1), { value: `Branch Name: ${card.branch_name ?? ''}` }));
      lastBranchName = card.branch_name ?? '';
    }

    rowNum++;
    sheet.mergeCells(rowNum, 1, rowNum, 4);
    const nameCell = sheet.getCell(rowNum, 1);
    nameCell.value = `Employee Name: ${card.emp_name}`;
    nameCell.font = { bold: true };
    nameCell.alignment = { horizontal: 'center' };

    rowNum++;
    bold(Object.assign(sheet.getCell(rowNum, 1), { value: `EMP ID : ${card.employee_id ?? ''}` }));
    bold(Object.assign(sheet.getCell(rowNum, 2), { value: `  Branch : ${card.branch_name ?? ''}` }));
    bold(Object.assign(sheet.getCell(rowNum, 3), { value: `  Designation : ${card.desig ?? ''}` }));
    bold(Object.assign(sheet.getCell(rowNum, 4), { value: `  Department : ${card.departments ?? ''}` }));

    rowNum++;
    sheet.mergeCells(rowNum, 1, rowNum, 3);
    bold(Object.assign(sheet.getCell(rowNum, 1), { value: 'Salary Components ' }));
    bold(Object.assign(sheet.getCell(rowNum, 4), { value: 'Amount ' }));

    rowNum++;
    if (card.items.length === 0) {
      sheet.getCell(rowNum, 1).value = 'No employees found under this data';
      continue;
    }
    for (const item of card.items) {
      sheet.mergeCells(rowNum, 1, rowNum, 3);
      sheet.getCell(rowNum, 1).value = item.label;
      sheet.getCell(rowNum, 4).value = monthlyCtcExcelItemAmount(item);
      rowNum++;
    }
    sheet.mergeCells(rowNum, 1, rowNum, 3);
    bold(Object.assign(sheet.getCell(rowNum, 1), { value: 'Grand Total' }));
    bold(Object.assign(sheet.getCell(rowNum, 4), { value: card.grand_total }));
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

export interface PayrollCtcExportItem { label: string; amount: number; rate: number }
export interface PayrollCtcExportRow {
  employee_id: string | null;
  login_user_id: string | null;
  emp_name: string;
  gender: string | null;
  month_year: string;
  desig: string | null;
  departments: string | null;
  branch_name: string | null;
  joining_date: string | null;
  termination_date: string | null;
  present_days: number | null;
  overtime_hours: number | null;
  lop_days: number | null;
  leave_days: number | null;
  weekoff_total: number | null;
  holiday_total: number | null;
  standard_additions: PayrollCtcExportItem[];
  standard_deductions: PayrollCtcExportItem[];
  variable_result: PayrollCtcExportItem[];
  employer_result: PayrollCtcExportItem[];
  actual_addition_result: PayrollCtcExportItem[];
  actual_deduction_result: PayrollCtcExportItem[];
}

// Mirrors generatePayrollCTC()'s Excel branch (SalaryReportsController.php:23028-23320) — the ONLY
// working output of this report; legacy's own View/PDF reference variables generatePayrollCTC()
// never sets, so they're dead code (see reports.ts's PayrollCTC comment / viewAllowed:false in
// page.tsx). Column layout is a literal port of the raw PHPExcel column-by-column writes: Employee
// Details, then 3 "Rate" (structure_det_value) sections — Standard Salary, Other Salary (Variable),
// Employer Contribution (legacy confusingly labels this section's own header 'CTC', not "Employer
// Contribution" twice — kept as-is) — then the same 3 groupings again on the "Amount" (salary_amount)
// side (the second Employer Contribution section is ALSO labeled 'CTC' in legacy), ending in one
// final cell — vertically merged across both header rows, no subheader of its own — holding the true
// CTC figure (Employer Contribution Amount total + Actual Salary Gross).
export function exportPayrollCtcToExcel(rows: PayrollCtcExportRow[], from: string, filename: string, runBy: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll CTC');

  if (rows.length === 0) {
    sheet.mergeCells('A1:J1');
    const cell = sheet.getCell('A1');
    cell.value = 'No data available under the selected criteria';
    workbook.xlsx.writeBuffer().then((buffer) => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
    return;
  }

  const mainHeaderRow = 4;
  const subHeaderRow = 5;
  const setMain = (startCol: number, endCol: number, label: string) => {
    if (endCol > startCol) sheet.mergeCells(mainHeaderRow, startCol, mainHeaderRow, endCol);
    const cell = sheet.getCell(mainHeaderRow, startCol);
    cell.value = label;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
  };
  const setSub = (c: number, label: string) => {
    const cell = sheet.getCell(subHeaderRow, c);
    cell.value = label;
    cell.font = { bold: true };
  };

  // Every row carries the same zero-filled key set (see getPayrollCtcKeys in reports.ts) — the first
  // row's labels define the dynamic column set for all of them.
  const first = rows[0];
  const standardAdditions = first.standard_additions.map((i) => i.label);
  const standardDeductions = first.standard_deductions.map((i) => i.label);
  const variableLabels = first.variable_result.map((i) => i.label);
  const employerLabels = first.employer_result.map((i) => i.label);
  const actualAdditionLabels = first.actual_addition_result.map((i) => i.label);
  const actualDeductionLabels = first.actual_deduction_result.map((i) => i.label);

  let col = 1;
  const empHeaders = ['Sl No', 'Employee ID', 'User ID', 'Employee Name', 'Gender', 'Month', 'Designation', 'Department', 'Branch', 'Date of Joining', 'Date of Termination', 'Present Days', 'Overtime (In Hrs.)', 'LOP Days', 'Leave Days', 'Week Off', 'Holiday'];
  const empStart = col;
  empHeaders.forEach((h) => { setSub(col, h); col++; });
  setMain(empStart, col - 1, 'Employee details');

  const stdStart = col;
  standardAdditions.forEach((l) => { setSub(col, `${l} (Rate)`); col++; });
  setSub(col, 'Gross Salary'); col++;
  standardDeductions.forEach((l) => { setSub(col, `${l} (Rate)`); col++; });
  setSub(col, 'Total Deduction'); col++;
  setSub(col, 'Net Salary'); col++;
  setMain(stdStart, col - 1, 'Standard Salary');

  const otherStart = col;
  variableLabels.forEach((l) => { setSub(col, `${l} (Rate)`); col++; });
  setSub(col, 'Total Variable Salary (Rate)'); col++;
  setMain(otherStart, col - 1, 'Other Salary');

  const employerRateStart = col;
  employerLabels.forEach((l) => { setSub(col, `${l} (Rate)`); col++; });
  setSub(col, 'Total Contribution'); col++;
  setSub(col, 'CTC'); col++;
  setMain(employerRateStart, col - 1, 'Employer Contribution');

  const actualStart = col;
  standardAdditions.forEach((l) => { setSub(col, `${l} (Amount)`); col++; });
  variableLabels.forEach((l) => { setSub(col, `${l} (Amount)`); col++; });
  actualAdditionLabels.forEach((l) => { setSub(col, `${l} (Amount)`); col++; });
  setSub(col, 'Gross Salary'); col++;
  standardDeductions.forEach((l) => { setSub(col, `${l} (Amount)`); col++; });
  actualDeductionLabels.forEach((l) => { setSub(col, `${l} (Amount)`); col++; });
  setSub(col, 'Total Deduction'); col++;
  setSub(col, 'Net Salary'); col++;
  setMain(actualStart, col - 1, 'Actual Salary');

  const employerAmtStart = col;
  employerLabels.forEach((l) => { setSub(col, `${l} (Amount)`); col++; });
  setSub(col, 'Total Contribution'); col++;
  setMain(employerAmtStart, col - 1, 'CTC');

  const finalCtcCol = col;
  sheet.mergeCells(mainHeaderRow, finalCtcCol, subHeaderRow, finalCtcCol);
  const finalCtcCell = sheet.getCell(mainHeaderRow, finalCtcCol);
  finalCtcCell.value = 'CTC';
  finalCtcCell.font = { bold: true };
  finalCtcCell.alignment = { horizontal: 'center', vertical: 'middle' };
  col++;

  const lastCol = col - 1;
  for (let c = 1; c <= lastCol; c++) sheet.getColumn(c).width = 15;

  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `Payroll CTC Report of ${from}`;
  titleCell.font = { bold: true, size: 18 };
  titleCell.alignment = { horizontal: 'center' };

  sheet.mergeCells(2, 1, 2, lastCol);
  const runByCell = sheet.getCell(2, 1);
  runByCell.value = `Report Run by ${runBy} at ${new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')}`;
  runByCell.font = { bold: true };
  runByCell.alignment = { horizontal: 'center' };

  const sum = (items: PayrollCtcExportItem[], field: 'amount' | 'rate') => items.reduce((s, i) => s + Number(i[field] ?? 0), 0);

  const firstDataRow = subHeaderRow + 1;
  let dataRow = firstDataRow;
  rows.forEach((row, i) => {
    let c = 1;
    const write = (v: string | number) => { sheet.getCell(dataRow, c).value = v; c++; };
    write(i + 1);
    write(row.employee_id ?? '');
    write(row.login_user_id ?? '');
    write(row.emp_name);
    write(row.gender ?? '');
    write(row.month_year);
    write(row.desig ?? '');
    write(row.departments ?? '');
    write(row.branch_name ?? '');
    write(row.joining_date ?? '');
    write(row.termination_date ?? '');
    write(row.present_days ?? 0);
    write(row.overtime_hours ?? 0);
    write(row.lop_days ?? 0);
    write(row.leave_days ?? 0);
    write(row.weekoff_total ?? 0);
    write(row.holiday_total ?? 0);

    row.standard_additions.forEach((it) => write(it.rate));
    const grossRate = sum(row.standard_additions, 'rate');
    write(grossRate);
    row.standard_deductions.forEach((it) => write(it.rate));
    const deductionsRate = sum(row.standard_deductions, 'rate');
    write(deductionsRate);
    write(Math.abs(grossRate) - Math.abs(deductionsRate));

    row.variable_result.forEach((it) => write(it.rate));
    const variableRateTotal = sum(row.variable_result, 'rate');
    write(variableRateTotal);

    row.employer_result.forEach((it) => write(it.rate));
    const employerRateTotal = sum(row.employer_result, 'rate');
    write(employerRateTotal);
    write(employerRateTotal + grossRate);

    row.standard_additions.forEach((it) => write(it.amount));
    row.variable_result.forEach((it) => write(it.amount));
    row.actual_addition_result.forEach((it) => write(it.amount));
    const gross = sum(row.standard_additions, 'amount') + sum(row.variable_result, 'amount') + sum(row.actual_addition_result, 'amount');
    write(gross);
    row.standard_deductions.forEach((it) => write(it.amount));
    row.actual_deduction_result.forEach((it) => write(it.amount));
    const deductions = sum(row.standard_deductions, 'amount') + sum(row.actual_deduction_result, 'amount');
    write(deductions);
    write(Math.abs(gross) - Math.abs(deductions));

    row.employer_result.forEach((it) => write(it.amount));
    const employerAmtTotal = sum(row.employer_result, 'amount');
    write(employerAmtTotal);
    write(employerAmtTotal + gross);

    dataRow++;
  });

  // Legacy merges Sl No..Date of Joining (cols 1-10) into one 'TOTAL' label, then sums every
  // remaining column whose value is numeric — including the date-like Date of Termination column,
  // whose total is silently 0 (is_numeric() on a formatted date string is false), a legacy quirk
  // from summing indiscriminately rather than an intentional column selection; replicated as-is.
  const totalRow = dataRow;
  sheet.mergeCells(totalRow, 1, totalRow, 10);
  const totalCell = sheet.getCell(totalRow, 1);
  totalCell.value = 'TOTAL';
  totalCell.font = { bold: true };
  for (let c = 11; c <= lastCol; c++) {
    let s = 0;
    for (let r = firstDataRow; r < totalRow; r++) {
      const v = sheet.getCell(r, c).value;
      if (typeof v === 'number') s += v;
    }
    const cell = sheet.getCell(totalRow, c);
    cell.value = s;
    cell.font = { bold: true };
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
