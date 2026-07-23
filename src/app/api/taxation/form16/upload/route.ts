import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import type { RowDataPacket } from 'mysql2';

const MAX_SIZE = 2 * 1024 * 1024;

// pdf-parse (pdfjs-dist under the hood) dynamically imports its worker module; Turbopack's dev
// bundle doesn't carry that file into its output chunk directory, so the default worker path
// 404s at runtime. Point it directly at the real file on disk instead (still ships with
// node_modules in production, so this isn't dev-only).
PDFParse.setWorker(`file:///${path.join(process.cwd(), 'node_modules', 'pdf-parse', 'dist', 'worker', 'pdf.worker.mjs').split(path.sep).join('/')}`);

// Mirrors TaxController::formSixteen(): admin batch-uploads Form-16 PDFs, each parsed for the
// employee's PAN (regex against the extracted text, same pattern as legacy), matched against
// emp_details.pan_no, and stored under tax_form_documents. Legacy uses Smalot\PdfParser; this
// uses pdf-parse (Node-native) for the same text-extraction step. Files unmatched to a live PAN
// are reported back as rejected rather than silently stored, same as legacy.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const finYear = formData.get('fin_year');
  const files = formData.getAll('files');
  if (!finYear || files.length === 0) {
    return NextResponse.json({ error: 'fin_year and at least one file are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', session.user.companyCode, 'form16');
  await mkdir(uploadDir, { recursive: true });

  const accepted: string[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (typeof file === 'string') continue;
    if (file.type !== 'application/pdf') {
      rejected.push({ name: file.name, reason: 'Not a PDF' });
      continue;
    }
    if (file.size > MAX_SIZE) {
      rejected.push({ name: file.name, reason: 'Exceeds 2MB limit' });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let pan = '';
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      const match = result.text.match(/PAN\s*of\s*the\s*Employee\/Specified\s*senior\s*citizen\s*([A-Za-z0-9]{10})/i);
      pan = match?.[1] ?? '';
    } catch {
      rejected.push({ name: file.name, reason: 'Could not parse PDF' });
      continue;
    }

    if (!pan) {
      rejected.push({ name: file.name, reason: 'PAN not found in document' });
      continue;
    }

    const [[emp]] = await pool.execute<RowDataPacket[]>(
      'SELECT emp_pkey FROM emp_details WHERE pan_no = ?', [pan]
    );
    if (!emp) {
      rejected.push({ name: file.name, reason: `No employee found with PAN ${pan}` });
      continue;
    }

    const filename = `${pan}_${Date.now()}_${Math.floor(Math.random() * 90000 + 10000)}.pdf`;
    await writeFile(path.join(uploadDir, filename), buffer);

    await pool.execute(
      `INSERT INTO tax_form_documents (form_name, pan, fin_year, created_by, created_date, status)
       VALUES (?, ?, ?, ?, NOW(), 1)`,
      [filename, pan, String(finYear), session.user.loginUserId]
    );
    accepted.push(pan);
  }

  return NextResponse.json({ accepted, rejected });
}
