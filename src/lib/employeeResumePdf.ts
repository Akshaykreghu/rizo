import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { photoUrl } from '@/lib/utils';

// Employee profile ("resume") PDF behind the Doc icon on the All Employees list — ports legacy
// EmployeeController::downloadResume(): company letterhead, name + photo, contact block, a
// professional-details grid, identity/statutory and bank grids, then Education and Experience
// tables. Built client-side with jsPDF like the payslip, from the same APIs the Employee Details
// form already uses.

type Row = Record<string, unknown>;

const txt = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s === '0' || s === 'null' ? '' : s;
};

function fmtDate(v: unknown) {
  const s = txt(v);
  if (!s) return '';
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

async function toDataUrl(url: string): Promise<{ data: string; format: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const format = blob.type.includes('png') ? 'PNG' : blob.type.includes('jpe') || blob.type.includes('jpg') ? 'JPEG' : null;
    if (!format) return null;
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return { data, format };
  } catch {
    return null;
  }
}

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function downloadEmployeeResumePdf(empPkey: number) {
  const [detail, education, experience, company] = await Promise.all([
    getJson<{ employee?: Row; professional?: Row | null } | null>(`/api/employees/${empPkey}`, null),
    getJson<Row[]>(`/api/employees/${empPkey}/education`, []),
    getJson<Row[]>(`/api/employees/${empPkey}/experience`, []),
    getJson<Row | null>('/api/company', null),
  ]);
  const e = detail?.employee;
  if (!e) throw new Error('Could not load this employee');
  const p = detail?.professional ?? {};

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 40;
  const right = doc.internal.pageSize.getWidth() - 40;
  let y = 40;

  // Letterhead
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(txt(company?.business_name) || 'Company', left, y);
  y += 14;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const contact = [txt(company?.email), txt(company?.website)].filter(Boolean).join('  |  ');
  if (contact) { doc.text(contact, left, y); y += 12; }
  doc.setDrawColor(200);
  doc.line(left, y, right, y);
  y += 26;

  // Name + photo + contact block
  const fullName = `${txt(e.first_name)} ${txt(e.last_name)}`.trim();
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(fullName, doc.internal.pageSize.getWidth() / 2, y, { align: 'center' });
  y += 24;

  const photoTop = y;
  const photo = photoUrl(e.profile_pic) ? await toDataUrl(photoUrl(e.profile_pic)!) : null;
  if (photo) doc.addImage(photo.data, photo.format, right - 90, photoTop, 90, 105);

  doc.setFontSize(10);
  const line = (label: string, value: string) => {
    if (!value) return;
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}: `, left, y);
    doc.setFont('helvetica', 'normal');
    const wrapped = doc.splitTextToSize(value, right - left - 110 - doc.getTextWidth(`${label}: `));
    doc.text(wrapped, left + doc.getTextWidth(`${label}: `), y);
    y += 14 * wrapped.length;
  };
  const address = [txt(e.address), txt(e.city), txt(e.state), txt(e.pincode)].filter(Boolean).join(', ');
  line('Address', address);
  line('Gender', txt(e.classification) ? txt(e.classification)[0].toUpperCase() + txt(e.classification).slice(1) : '');
  line('Birth Date', fmtDate(e.date_of_birth));
  line('Email', txt(e.email));
  y = Math.max(y, photo ? photoTop + 115 : y) + 10;

  const grid = (body: string[][]) => {
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 }, 2: { fontStyle: 'bold', cellWidth: 100 } },
      body,
    });
    // @ts-expect-error jspdf-autotable augments doc with lastAutoTable at runtime
    y = doc.lastAutoTable.finalY + 14;
  };

  grid([
    ['Joining Date', fmtDate(p.joining_date), 'Employee ID', txt(p.emp_company_id) || txt(e.emp_id)],
    ['Department', txt(e.dept_name), 'Designation', txt(e.desig_name)],
    ['Branch', txt(e.emp_branch_name), 'Employee Type', txt(p.emp_type)],
    ['Phone Number', txt(e.mobile_no), 'Grade', txt(e.grade_name)],
  ]);
  grid([
    ['Aadhaar ID', txt(e.id_card), 'Blood Group', txt(e.blood)],
    ['Guardian Name', txt(e.guradian), 'Relation', txt(e.relation_guardian)],
    ['Marital Status', txt(e.maritual_status), 'Education', txt(e.education)],
    // emp_details.pf holds the UAN number and emp_details.company_pf holds the PF number —
    // legacy's own onboarding step swaps them when copying emp_join into emp_details (see
    // components/employees/EmployeeDetail.tsx's fieldValidators comment for the full story).
    ['ESI', txt(e.esi), 'UAN', txt(e.pf)],
    ['PF', txt(e.company_pf), 'PAN', txt(e.pan_no)],
  ]);
  grid([
    ['Bank Name', txt(e.bank_name), 'Branch', txt(e.branch_name)],
    ['IFSC', txt(e.ifsc_code), 'Account Number', txt(e.account_no)],
  ]);

  const section = (title: string, head: string[], body: string[][]) => {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(title, left, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [head],
      body: body.length ? body : [[{ content: 'No records', colSpan: head.length, styles: { halign: 'center', textColor: 150 } } as unknown as string]],
      styles: { fontSize: 9, cellPadding: 5, halign: 'center' },
      headStyles: { fillColor: [30, 81, 110] },
    });
    // @ts-expect-error jspdf-autotable augments doc with lastAutoTable at runtime
    y = doc.lastAutoTable.finalY + 18;
  };

  section('Education', ['Course', 'University/College', 'Duration', 'Percentage/Marks'],
    education.map((r) => [txt(r.degree), txt(r.university), txt(r.duration), txt(r.marks)]));
  section('Experience', ['Company', 'Department', 'Designation', 'From Date', 'To Date', 'CTC'],
    experience.map((r) => [txt(r.company_name), txt(r.department), txt(r.designation), fmtDate(r.from_date), fmtDate(r.to_date), txt(r.salary)]));

  doc.save(`${fullName || 'employee'}.pdf`);
}

// "No Salary Structure" / "Joined This Month" card downloads — legacy downloadMissingSalary() and
// thisMonthJoining() (a titled PDF table).
export function downloadEmployeeListPdf(title: string, columns: string[], rows: string[][], fileName: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, doc.internal.pageSize.getWidth() / 2, 44, { align: 'center' });
  autoTable(doc, {
    startY: 60,
    head: [['Sl No', ...columns]],
    body: rows.length
      ? rows.map((r, i) => [String(i + 1), ...r])
      : [[{ content: 'No employees', colSpan: columns.length + 1, styles: { halign: 'center', textColor: 150 } } as unknown as string]],
    styles: { fontSize: 9, cellPadding: 5, halign: 'center' },
    headStyles: { fillColor: [30, 81, 110] },
  });
  doc.save(fileName);
}
