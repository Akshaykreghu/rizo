import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAuthorizerApprover } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Wraps leave_auth_apr_person_fn to pre-fill the apply form's Authorizer/Approver pickers
// (matches legacy's getusers() — resolved from emp_proff.attr1 / emp_config type=LAPPR, the same
// hierarchy data the Employee Hierarchy / Leave Hierarchy movers already maintain).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = searchParams.get('employee');
  if (!employee) return NextResponse.json({ error: 'employee is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const { authorizerFkey, approverFkey } = await getAuthorizerApprover(pool, session.user.companyCode, Number(employee));

  const ids = [authorizerFkey, approverFkey].filter((v): v is number => v != null);
  let names: Record<number, string> = {};
  if (ids.length > 0) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT emp_pkey, first_name, last_name FROM emp_details WHERE emp_pkey IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    names = Object.fromEntries(rows.map((r) => [r.emp_pkey, `${r.first_name} ${r.last_name ?? ''}`.trim()]));
  }

  return NextResponse.json({
    authorizer: authorizerFkey ? { empFkey: authorizerFkey, name: names[authorizerFkey] ?? null } : null,
    approver: approverFkey ? { empFkey: approverFkey, name: names[approverFkey] ?? null } : null,
  });
}
