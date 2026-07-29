import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { EMPLOYEE_FIELD_MAP } from '@/lib/reports';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const fields = Object.entries(EMPLOYEE_FIELD_MAP).map(([key, v]) => ({ key, label: v.label }));
  return NextResponse.json({ fields });
}
