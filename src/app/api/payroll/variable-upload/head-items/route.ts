import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getVariableHeadItems } from '@/lib/variableUpload';
import { NextResponse } from 'next/server';

// The Salary Head Item dropdown source — mirrors the arr_headitems query in
// VariableController::index()/form(): item_type = 'Manually', value = 'Y', head_occurance = 'variable'.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const items = await getVariableHeadItems(pool);
  return NextResponse.json({ items });
}
