import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2';

// Mirrors legacy TaxationController::uploadFile(): allow-listed proof-document types, a 2MB
// cap, and rejection once admin has locked the head. Legacy sniffs real file bytes via PHP's
// finfo; we check the browser-reported MIME type plus extension, which is weaker but avoids
// pulling in a new dependency for magic-byte sniffing.
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'application/pdf',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_SIZE = 2 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const formData = await request.formData();
  const file = formData.get('file');
  const taxHeadsFkey = Number(formData.get('tax_heads_fkey'));
  const taxHeadsDetailsFkey = Number(formData.get('tax_heads_details_fkey') ?? 0);
  const finYear = Number(formData.get('fin_year'));

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type. Allowed: jpg, png, gif, pdf, xls(x), doc(x)' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File exceeds the 2MB limit' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[existing]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_tax_tran_id, locked, file_name, file_type FROM emp_tax_transactions
     WHERE emp_fkey = ? AND tax_heads_fkey = ? AND tax_heads_details_fkey = ? AND fin_year = ?`,
    [id, taxHeadsFkey, taxHeadsDetailsFkey, finYear]
  );
  if (existing?.locked === 'Y') {
    return NextResponse.json({ error: 'This tax head is locked by admin and cannot be edited' }, { status: 403 });
  }

  const uploadDir = path.join(process.cwd(), 'public', 'uploads', session.user.companyCode, 'taxdocuments');
  await mkdir(uploadDir, { recursive: true });
  const ext = path.extname(file.name) || '';
  const filename = `${crypto.randomUUID()}${ext}`;
  await writeFile(path.join(uploadDir, filename), Buffer.from(await file.arrayBuffer()));

  const fileNames = [existing?.file_name, filename].filter(Boolean).join(',');
  const fileTypes = [existing?.file_type, file.type].filter(Boolean).join(',');

  if (existing) {
    await pool.execute(
      'UPDATE emp_tax_transactions SET file_name = ?, file_type = ?, modified_by = ? WHERE emp_tax_tran_id = ?',
      [fileNames, fileTypes, session.user.loginUserId, existing.emp_tax_tran_id]
    );
  } else {
    await pool.execute(
      `INSERT INTO emp_tax_transactions
         (emp_fkey, tax_heads_fkey, tax_heads_details_fkey, fin_year, file_name, file_type, created_by, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'N')`,
      [id, taxHeadsFkey, taxHeadsDetailsFkey, finYear, filename, file.type, session.user.loginUserId]
    );
  }

  return NextResponse.json({ path: `/uploads/${session.user.companyCode}/taxdocuments/${filename}` }, { status: 201 });
}
