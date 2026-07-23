import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { controlPool, getCompanyPool } from '@/lib/db';

async function verifyOldPassword(pool: mysql.Pool, oldPassword: string, storedHash: string) {
  const isSha1 = /^[a-f0-9]{40}$/.test(storedHash);
  if (isSha1) {
    return crypto.createHash('sha1').update(oldPassword).digest('hex') === storedHash;
  }
  return bcrypt.compare(oldPassword, storedHash);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { scope, companyCode, token, oldPassword, newPassword, confirmPassword } = body;

  if (!token || !oldPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { error: 'New Password and Confirm Password are not matching' },
      { status: 400 }
    );
  }

  const pool =
    scope === 'admin' ? controlPool : await getCompanyPool(companyCode);

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT user_pkey, password FROM user_credentials WHERE attr1 = ?`,
    [token]
  );

  if (!rows.length) {
    return NextResponse.json(
      { error: 'Token Corrupted. Please Retry, the reset link works only for once.' },
      { status: 400 }
    );
  }

  const user = rows[0];
  const oldPasswordValid = await verifyOldPassword(pool, oldPassword, user.password || '');
  if (!oldPasswordValid) {
    return NextResponse.json({ error: 'Current Password is not matching' }, { status: 400 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const updateSql =
    scope === 'admin'
      ? `UPDATE user_credentials SET password = ?, reset_login_flag = 'N', locked = '0', attr1 = '' WHERE user_pkey = ?`
      : `UPDATE user_credentials SET password = ?, reset_login_flag = 'N', locked = 0, incorrect_login_attempt = 0, attr1 = '' WHERE user_pkey = ?`;
  await pool.execute(updateSql, [newHash, user.user_pkey]);

  return NextResponse.json({ success: true });
}
