import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { formatCurrency } from '@/lib/utils';

// Ports the real payslip content sections from legacy's SalarySlipReports HTML2PDF template
// (letterhead, employee info grid, earnings/deductions table, net pay) using jsPDF/jspdf-autotable
// instead of HTML2PDF — exact pixel layout isn't required, but the same real data sections are.

interface SlipItem {
  salary_head_item_desc: string | null;
  head_operator: string | null;
  salary_amount: number | null;
}
interface SlipGroup {
  head_desc: string;
  items: SlipItem[];
}
interface SlipHeader {
  emp_name: string;
  branch_code: string;
  month_year: string;
  days_presant: number | null;
  days_leave: number | null;
  loss_of_pay: number | null;
  net_salary: number | null;
  desig: string | null;
  departments: string | null;
  emp_status: number | null;
  bank_details: string | null;
}
interface CompanyInfo {
  business_name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
}

export function generatePayslipPdf(
  header: SlipHeader,
  direct: SlipGroup[],
  indirect: SlipGroup[],
  company: CompanyInfo | null
) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 40;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(company?.business_name ?? 'Company', 40, y);
  y += 18;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const addressLine = [company?.address, company?.city, company?.state, company?.pincode].filter(Boolean).join(', ');
  if (addressLine) { doc.text(addressLine, 40, y); y += 12; }
  const contactLine = [company?.phone, company?.email].filter(Boolean).join('  |  ');
  if (contactLine) { doc.text(contactLine, 40, y); y += 12; }

  y += 10;
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`Salary Slip - ${header.month_year}`, 40, y);
  y += 20;

  const resignedSuffix = header.emp_status === 2 ? ' (Resigned)' : '';
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    body: [
      ['Name', `${header.emp_name}${resignedSuffix}`, 'Branch', header.branch_code],
      ['Designation', header.desig ?? '-', 'Department', header.departments ?? '-'],
      ['Present Days', String(header.days_presant ?? '-'), 'Leave Days', String(header.days_leave ?? '-')],
      ['LOP Days', String(header.loss_of_pay ?? '-'), 'Bank Details', header.bank_details ?? '-'],
    ],
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
  });
  // @ts-expect-error jspdf-autotable augments doc with lastAutoTable at runtime
  y = doc.lastAutoTable.finalY + 20;

  const earningsRows: (string | number)[][] = [];
  let totalEarnings = 0;
  let totalDeductions = 0;
  for (const group of direct) {
    for (const item of group.items) {
      const amt = Number(item.salary_amount) || 0;
      if (item.head_operator === 'Deduction') totalDeductions += amt; else totalEarnings += amt;
      earningsRows.push([group.head_desc, item.salary_head_item_desc ?? '', item.head_operator ?? '', formatCurrency(amt)]);
    }
  }

  autoTable(doc, {
    startY: y,
    head: [['Category', 'Component', 'Type', 'Amount']],
    body: earningsRows,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [79, 70, 229] },
    foot: [['', '', 'Total Earnings', formatCurrency(totalEarnings)], ['', '', 'Total Deductions', formatCurrency(totalDeductions)]],
    footStyles: { fontStyle: 'bold' },
  });
  // @ts-expect-error jspdf-autotable augments doc with lastAutoTable at runtime
  y = doc.lastAutoTable.finalY + 15;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`Net Pay: ${header.net_salary != null ? formatCurrency(header.net_salary) : '-'}`, 40, y);
  y += 25;

  if (indirect.length > 0) {
    const indirectRows: (string | number)[][] = [];
    for (const group of indirect) {
      for (const item of group.items) {
        indirectRows.push([group.head_desc, item.salary_head_item_desc ?? '', formatCurrency(Number(item.salary_amount) || 0)]);
      }
    }
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Employer Contributions', 40, y);
    y += 10;
    autoTable(doc, {
      startY: y,
      head: [['Category', 'Component', 'Amount']],
      body: indirectRows,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [79, 70, 229] },
    });
    // @ts-expect-error jspdf-autotable augments doc with lastAutoTable at runtime
    y = doc.lastAutoTable.finalY + 20;
  }

  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('This is a system generated pay slip and does not require signature.', 40, y);

  doc.save(`Payslip_${header.emp_name.replace(/\s+/g, '_')}_${header.month_year}.pdf`);
}
