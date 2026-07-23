import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getCurrentRegime, chooseTaxRegime, getOpenFinYear } from '@/lib/taxation';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const optionType = await getCurrentRegime(pool, Number(id));
  return NextResponse.json({ optionType });
}

// Mirrors TaxController::Choosetax().
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json() as { optionType: 'O' | 'N' };
  if (body.optionType !== 'O' && body.optionType !== 'N') {
    return NextResponse.json({ error: 'optionType must be O or N' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>('SELECT emp_branch FROM emp_proff WHERE emp_fkey = ?', [id]);
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const finYear = await getOpenFinYear(pool, emp.emp_branch);
  if (!finYear) return NextResponse.json({ error: 'No open tax financial year for this branch' }, { status: 400 });

  await chooseTaxRegime(pool, Number(id), finYear.finYear, body.optionType, session.user.loginUserId);
  return NextResponse.json({ success: true });
}
