import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import bcrypt from 'bcryptjs';

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
  const pool = await getCompanyPool(session.user.companyCode);

  const [existing] = await pool.execute<RowDataPacket[]>(
    'SELECT user_pkey, user_id FROM user_credentials WHERE emp_fkey = ?',
    [id]
  );

  let userId: string;

  if (existing.length) {
    userId = existing[0].user_id;

    if (body.new_password) {
      const hash = await bcrypt.hash(body.new_password, 12);
      await pool.execute(
        `UPDATE user_credentials
         SET password = ?, reset_login_flag = 'Y', locked = 0, incorrect_login_attempt = 0, access_allowed = ?
         WHERE user_pkey = ?`,
        [hash, body.access_allowed ?? 'Y', existing[0].user_pkey]
      );
    } else {
      const locked = Number(body.locked) === 1 ? 1 : 0;
      if (locked === 0) {
        await pool.execute(
          `UPDATE user_credentials SET access_allowed = ?, locked = 0, incorrect_login_attempt = 0 WHERE user_pkey = ?`,
          [body.access_allowed ?? 'N', existing[0].user_pkey]
        );
      } else {
        await pool.execute(
          `UPDATE user_credentials SET access_allowed = ?, locked = 1 WHERE user_pkey = ?`,
          [body.access_allowed ?? 'N', existing[0].user_pkey]
        );
      }
    }
  } else {
    if (!body.user_id || !body.new_password) {
      return NextResponse.json(
        { error: 'No login exists for this employee yet — provide a username and initial password to create one' },
        { status: 400 }
      );
    }
    const [dupUsername] = await pool.execute<RowDataPacket[]>(
      'SELECT 1 FROM user_credentials WHERE user_id = ?',
      [body.user_id]
    );
    if (dupUsername.length) {
      return NextResponse.json({ error: 'Username already in use' }, { status: 409 });
    }

    const [[emp]] = await pool.execute<RowDataPacket[]>(
      'SELECT first_name, last_name, email FROM emp_details WHERE emp_pkey = ?',
      [id]
    );
    const hash = await bcrypt.hash(body.new_password, 12);
    userId = body.user_id;
    await pool.execute(
      `INSERT INTO user_credentials
         (emp_fkey, company_code, user_id, password, access_allowed, first_name, last_name, email,
          reset_login_flag, locked, incorrect_login_attempt, user_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'N', 0, 0, 1)`,
      [id, session.user.companyCode, userId, hash, body.access_allowed ?? 'Y', emp.first_name, emp.last_name, emp.email]
    );
  }

  if (body.punch_type || body.mobile_allowed !== undefined) {
    const mobileLocked = body.mobile_allowed === 'Y' ? 'N' : 'Y';
    const [existingMobile] = await pool.execute<RowDataPacket[]>(
      'SELECT user_pkey FROM mob_user_credentials WHERE user_id = ?',
      [userId]
    );
    if (existingMobile.length) {
      await pool.execute(
        'UPDATE mob_user_credentials SET locked = ?, punchtype = ? WHERE user_id = ?',
        [mobileLocked, body.punch_type ?? 'W', userId]
      );
    } else {
      const [[emp]] = await pool.execute<RowDataPacket[]>(
        'SELECT first_name, last_name FROM emp_details WHERE emp_pkey = ?',
        [id]
      );
      await pool.execute(
        `INSERT INTO mob_user_credentials
           (user_id, firstname, lastname, password, securitycode, macid, imei, uploaded_time, UID, locked, punchtype)
         VALUES (?, ?, ?, '', '', '', '', NOW(), '', ?, ?)`,
        [userId, emp.first_name, emp.last_name, mobileLocked, body.punch_type ?? 'W']
      );
    }
  }

  return NextResponse.json({ success: true });
}
