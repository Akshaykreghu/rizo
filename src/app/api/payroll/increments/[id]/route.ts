import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getIncrementBatch, deleteIncrementDraft } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors SalaryIncrementController::viewSalaryIncrementForm() — batch header + per-employee
// (and, for item batches, per-component) detail rows for the review modal.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const batch = await getIncrementBatch(pool, Number(id));
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(batch);
}

// Mirrors SalaryIncrementController::deleteIncrement() — soft delete (salary_hike.status = 0).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await deleteIncrementDraft(pool, Number(id));
  return NextResponse.json({ success: true });
}
