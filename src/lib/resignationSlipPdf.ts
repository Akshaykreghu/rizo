import { jsPDF } from 'jspdf';
import { autoTable, type RowInput } from 'jspdf-autotable';

// Client-side PDF of the Full & Final Settlement statement, laid out like legacy's non-KWMT
// download.ctp (letterhead = company business name, "Full and Final Settlement Slip", the
// particulars grid, then one bordered ADDITIONS|DEDUCTIONS table with an "Others" band and a
// Net Salary row). Method differs from legacy's server HTML2PDF; the sections and figures match.
// Fed straight from GET /api/resignations/[id]/slip.

export interface SlipLine {
  salary_head_item_desc: string;
  salary_amount: number;
}

export interface ResignationSlipData {
  company: { businessName: string | null };
  employee: {
    first_name: string; last_name: string | null; emp_id: string | null;
    designation: string | null; department: string | null; branch: string | null; joining_date: string | null;
  };
  reason: string;
  resignationDetails: {
    submittedDate: string;
    noticePeriod: number;
    lastWorkingDate: string;
    approvedLastWorkingDate: string;
    relievingDate: string;
  };
  encashedDays: number;
  workingDaysSettled: number;
  payrollDays: number;
  balanceWorkingDays: number;
  settlement: {
    paydAdditions: SlipLine[];
    paydDeductions: SlipLine[];
    extraAdditions: SlipLine[];
    extraDeductions: SlipLine[];
    paydAdditionsTotal: number;
    paydDeductionsTotal: number;
    extraAdditionsTotal: number;
    extraDeductionsTotal: number;
    netSalary: number;
  };
}

const money = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) => {
  if (!d) return '-';
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? String(d)
    : t.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Pair additions[i] with deductions[i] into a 4-column row, exactly as slip.ctp / download.ctp zip
// the two lists by index.
function zipRows(add: SlipLine[], ded: SlipLine[]): RowInput[] {
  const rows: RowInput[] = [];
  const n = Math.max(add.length, ded.length);
  for (let i = 0; i < n; i++) {
    rows.push([
      add[i]?.salary_head_item_desc ?? '',
      add[i] ? money(add[i].salary_amount) : '',
      ded[i]?.salary_head_item_desc ?? '',
      ded[i] ? money(ded[i].salary_amount) : '',
    ]);
  }
  return rows;
}

export function generateResignationSlipPdf(data: ResignationSlipData) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const name = `${data.employee.first_name} ${data.employee.last_name ?? ''}`.trim();
  let y = 44;

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(data.company.businessName ?? 'Company', pageWidth / 2, y, { align: 'center' });
  y += 20;
  doc.setFontSize(12);
  doc.text('Full and Final Settlement Slip', pageWidth / 2, y, { align: 'center' });
  y += 12;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Full And Final Settlement Of ${name}`, pageWidth / 2, y, { align: 'center' });
  y += 18;

  const d = data.resignationDetails;
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
    body: [
      ['Employee Name', name, 'Employee ID', data.employee.emp_id ?? '-'],
      ['Joining Date', fmtDate(data.employee.joining_date), 'Branch', data.employee.branch ?? '-'],
      ['Designation', data.employee.designation ?? '-', 'Department', data.employee.department ?? '-'],
      ['Relieving Date', fmtDate(d.relievingDate), 'Encashed Leaves', String(data.encashedDays)],
      ['Notice Period', String(d.noticePeriod), 'Resignation Period Working Days', String(data.workingDaysSettled)],
      ['Resignation Period Present Days', String(data.payrollDays), 'Balance Working Days', String(data.balanceWorkingDays)],
      ['Reason for Relieving', data.reason || '-', 'Date of Resignation', fmtDate(d.submittedDate)],
    ],
  });
  // @ts-expect-error jspdf-autotable augments doc with lastAutoTable at runtime
  y = doc.lastAutoTable.finalY + 18;

  const s = data.settlement;
  const boldRow = (label: string, addTotal: number, dedTotal: number): RowInput => [
    { content: label, styles: { fontStyle: 'bold' } },
    { content: money(addTotal), styles: { fontStyle: 'bold' } },
    { content: label, styles: { fontStyle: 'bold' } },
    { content: money(dedTotal), styles: { fontStyle: 'bold' } },
  ];
  const bandRow = (text: string): RowInput => [
    { content: text, colSpan: 4, styles: { fontStyle: 'bold', halign: 'center', fillColor: [238, 238, 238] } },
  ];
  const subHeadRow: RowInput = [
    { content: 'ADDITIONS', colSpan: 2, styles: { fontStyle: 'bold', halign: 'center' } },
    { content: 'DEDUCTIONS', colSpan: 2, styles: { fontStyle: 'bold', halign: 'center' } },
  ];
  const netRow: RowInput = [
    { content: 'Net Salary', colSpan: 3, styles: { fontStyle: 'bold' } },
    { content: money(s.netSalary), styles: { fontStyle: 'bold' } },
  ];

  const head: RowInput[] = [
    [
      { content: 'ADDITIONS', colSpan: 2, styles: { halign: 'center' } },
      { content: 'DEDUCTIONS', colSpan: 2, styles: { halign: 'center' } },
    ],
    ['Item', 'Amount', 'Item', 'Amount'],
  ];

  autoTable(doc, {
    startY: y,
    head,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [60, 141, 188] },
    columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
    body: [
      ...zipRows(s.paydAdditions, s.paydDeductions),
      boldRow('Total', s.paydAdditionsTotal, s.paydDeductionsTotal),
      bandRow('Others'),
      subHeadRow,
      ...zipRows(s.extraAdditions, s.extraDeductions),
      boldRow('Total', s.extraAdditionsTotal, s.extraDeductionsTotal),
      netRow,
    ],
  });

  // @ts-expect-error jspdf-autotable augments doc with lastAutoTable at runtime
  y = doc.lastAutoTable.finalY + 22;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('This is a system generated statement which does not require signature.', pageWidth / 2, y, { align: 'center' });

  doc.save(`FnF_Slip_${name.replace(/\s+/g, '_') || 'Employee'}.pdf`);
}
