import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { controlPool, getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports DeviceEmployeeInfoController.php — maps an employee to the specific biometric device
// they're registered on (a genuinely different concept from Punch Type / mobile-reset, which
// controls the MODE of punching, not which physical device). Table lives in
// mypayrol_control_db.emp_device_comp_branch, denormalizing employee name/username/emp_id at
// save time exactly like legacy does (no live join back to the company DB on read).
// Deliberate deviation from legacy: legacy's own saveEmpDev() only UPDATEs an existing row —
// there's no reachable create path in its controller (editEmpDev() exits immediately if no
// seq is given), leaving this screen unusable for a still-empty table. Added a real POST here.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [rows] = await controlPool.execute<RowDataPacket[]>(
    `SELECT edcb.emp_device_comp_branch_seq, edcb.deviceid, edcb.emp_device_id, edcb.emp_fkey,
            edcb.emp_username, edcb.emp_name, d.DeviceFName, d.SerialNumber
     FROM emp_device_comp_branch edcb
     LEFT JOIN devices d ON d.DeviceId = edcb.deviceid AND d.company_code = edcb.Company_code
     WHERE edcb.Company_code = ? AND edcb.status = 1
     ORDER BY edcb.creation_date DESC`,
    [session.user.companyCode]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const empPkey = Number(body.emp_fkey);
  const deviceId = Number(body.deviceid);
  if (!empPkey || !deviceId) {
    return NextResponse.json({ error: 'Employee and Device are required' }, { status: 400 });
  }

  const companyPool = await getCompanyPool(session.user.companyCode);
  const [[emp]] = await companyPool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, ed.emp_id, TRIM(CONCAT(ed.first_name, ' ', ed.last_name)) AS emp_name,
            uc.user_id AS emp_username, ep.emp_branch
     FROM emp_details ed
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     LEFT JOIN user_credentials uc ON uc.emp_fkey = ed.emp_pkey
     WHERE ed.emp_pkey = ? AND ed.status = 1`,
    [empPkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const [existing] = await controlPool.execute<RowDataPacket[]>(
    'SELECT emp_device_comp_branch_seq FROM emp_device_comp_branch WHERE emp_fkey = ? AND Company_code = ? AND status = 1',
    [empPkey, session.user.companyCode]
  );
  if (existing.length) {
    return NextResponse.json({ error: 'This employee already has a device mapping — edit it instead' }, { status: 409 });
  }

  const [result] = await controlPool.execute<ResultSetHeader>(
    `INSERT INTO emp_device_comp_branch
       (deviceid, emp_device_id, emp_name, Company_code, branch_code, emp_id, emp_username, emp_fkey, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      deviceId, Number(body.emp_device_id) || 0, emp.emp_name ?? '', session.user.companyCode,
      emp.emp_branch ?? '', emp.emp_id ?? 0, emp.emp_username ?? '', empPkey,
    ]
  );
  return NextResponse.json({ emp_device_comp_branch_seq: result.insertId }, { status: 201 });
}
