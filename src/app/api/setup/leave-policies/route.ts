import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { normalizeLeavePolicyBody } from '@/lib/leavePolicies';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const groupId = request.nextUrl.searchParams.get('groupId');
  if (!groupId) return NextResponse.json([]);

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT lp.*, shi.item AS leave_type_name, shi.occurance
     FROM leavepolicy lp
     INNER JOIN salary_head_items shi ON shi.salary_head_item_pkey = lp.salary_head_item_fkey
     WHERE lp.LEAVEPOLICY_GROUP_ID = ? AND lp.status = 1
     ORDER BY shi.item`,
    [groupId]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const data = normalizeLeavePolicyBody(body);
  if (!data.LEAVEPOLICY_GROUP_ID || !data.salary_head_item_fkey) {
    return NextResponse.json({ error: 'Leave Policy Group and Leave Type are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [duplicate] = await pool.execute<RowDataPacket[]>(
    `SELECT LEAVEPOLICYID FROM leavepolicy WHERE LEAVEPOLICY_GROUP_ID = ? AND salary_head_item_fkey = ? AND status = 1`,
    [data.LEAVEPOLICY_GROUP_ID, data.salary_head_item_fkey]
  );
  if (duplicate.length > 0) {
    return NextResponse.json({ error: 'This leave type already has a policy in this group' }, { status: 409 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO leavepolicy
      (LEAVEPOLICY_GROUP_ID, salary_head_item_fkey, leave_policy_type, leave_cycle_start_date, leave_cycle_end_date,
       alloted_leave_forthe_year, alloted_leave_forthe_month, CARRY_FORWARD_LIMIT, sanction_by, REMARKS,
       leave_encash_limit, minimum_leave, maximum_leave, min_day_before_apply, minimum_service,
       IS_SANDWICH, is_leave_encash, ALLOW_NEGETIVE, exceptions, allow_all_leaves, document_mandatory, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      data.LEAVEPOLICY_GROUP_ID, data.salary_head_item_fkey, data.leave_policy_type,
      data.leave_cycle_start_date, data.leave_cycle_end_date,
      data.alloted_leave_forthe_year, data.alloted_leave_forthe_month, data.CARRY_FORWARD_LIMIT,
      data.sanction_by, data.REMARKS, data.leave_encash_limit,
      data.minimum_leave, data.maximum_leave, data.min_day_before_apply, data.minimum_service,
      data.IS_SANDWICH, data.is_leave_encash, data.ALLOW_NEGETIVE, data.exceptions,
      data.allow_all_leaves, data.document_mandatory,
    ]
  );
  return NextResponse.json({ LEAVEPOLICYID: result.insertId }, { status: 201 });
}
