import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { normalizeLeavePolicyBody } from '@/lib/leavePolicies';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const data = normalizeLeavePolicyBody(body);
  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    `UPDATE leavepolicy SET
       leave_policy_type = ?, leave_cycle_start_date = ?, leave_cycle_end_date = ?,
       alloted_leave_forthe_year = ?, alloted_leave_forthe_month = ?, CARRY_FORWARD_LIMIT = ?,
       sanction_by = ?, REMARKS = ?, leave_encash_limit = ?, minimum_leave = ?, maximum_leave = ?,
       min_day_before_apply = ?, minimum_service = ?, IS_SANDWICH = ?, is_leave_encash = ?,
       ALLOW_NEGETIVE = ?, exceptions = ?, allow_all_leaves = ?, document_mandatory = ?
     WHERE LEAVEPOLICYID = ?`,
    [
      data.leave_policy_type, data.leave_cycle_start_date, data.leave_cycle_end_date,
      data.alloted_leave_forthe_year, data.alloted_leave_forthe_month, data.CARRY_FORWARD_LIMIT,
      data.sanction_by, data.REMARKS, data.leave_encash_limit,
      data.minimum_leave, data.maximum_leave, data.min_day_before_apply, data.minimum_service,
      data.IS_SANDWICH, data.is_leave_encash, data.ALLOW_NEGETIVE, data.exceptions,
      data.allow_all_leaves, data.document_mandatory,
      id,
    ]
  );
  return NextResponse.json({ success: true });
}

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
  await pool.execute('UPDATE leavepolicy SET status = 0 WHERE LEAVEPOLICYID = ?', [id]);
  return NextResponse.json({ success: true });
}
