'use client';

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

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
