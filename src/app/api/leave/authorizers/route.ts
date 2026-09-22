import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAuthorizerApprover } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Wraps leave_auth_apr_person_fn to populate the apply form's Authorizer/Approver pickers — matches
// legacy's getusers()/addeditleave_new.ctp, where Approve By is a searchable select2 dropdown (and
// Authorize By a searchable typeahead) because the hierarchy function can return MULTIPLE eligible
// emp_pkeys as a comma-list (confirmed live, e.g. apr='67,2'), not a single fixed person.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = session.user.userGroup === 1 ? searchParams.get('employee') : String(session.user.empFkey);
  if (!employee) return NextResponse.json({ error: 'employee is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const { authorizerIds, approverIds } = await getAuthorizerApprover(pool, session.user.companyCode, Number(employee));

  const ids = [...new Set([...authorizerIds, ...approverIds])];
  let rowsByFkey: Record<number, { emp_pkey: number; first_name: string; last_name: string | null; emp_id: string | null }> = {};
  if (ids.length > 0) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT emp_pkey, first_name, last_name, emp_id FROM emp_details WHERE emp_pkey IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    rowsByFkey = Object.fromEntries(rows.map((r) => [r.emp_pkey, r as typeof rows[number] & { emp_pkey: number }]));
  }

  const toOption = (empFkey: number) => {
    const r = rowsByFkey[empFkey];
    const name = r ? `${r.first_name} ${r.last_name ?? ''}`.trim() : `Employee #${empFkey}`;
    return { empFkey, name: r?.emp_id ? `${name} - ${r.emp_id}` : name };
  };

  return NextResponse.json({
    authorizers: authorizerIds.map(toOption),
    approvers: approverIds.map(toOption),
  });
}
