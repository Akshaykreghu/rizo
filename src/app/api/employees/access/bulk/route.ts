import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import crypto from 'crypto';

const MIN_PASSWORD_LENGTH = 8;

// Ports UserCredentialsController::saveBulkAccess() — calls the real, existing
// `user_access_firstime_only` stored function, which provisions a first-time web+mobile login
// (plus default menu grants) for every employee in the branch who doesn't already have one
// (its own cursor filters to `password IN (NULL,'',' ')` — this is NOT a bulk password reset).
// Deliberate deviations from legacy, both disclosed rather than silently matched:
// 1. The function's `ppasswd` param is VARCHAR(50) — too short for a 60-char bcrypt hash (confirmed
//    via a real ER_DATA_TOO_LONG during testing). Uses a plain SHA1 hex hash instead (40 chars,
//    fits, and is exactly the format `verifyAndUpgradePassword` in src/lib/auth.ts already
//    recognizes and transparently upgrades to bcrypt on the employee's first real login).
// 2. The function's own `pemp_fkey` "apply to whole branch" check (`if pemp_fkey in(null,0,'')`)
//    silently breaks when passed real SQL NULL — `NULL IN (...)` evaluates to NULL/false under
//    SQL's 3-valued logic, so the cursor's `emp_pkey = pemp_fkey` folds to `emp_pkey = NULL`,
//    matching nothing (confirmed directly against the DB: SUCCESS returned, zero rows touched).
//    Legacy's own PHP caller passes the *string* `'null'`, which MySQL coerces to 0 for an int
//    param — accidentally dodging the bug. This port passes literal `0` for the same effect,
//    deliberately rather than by accident.
// 3. Legacy emails each newly-provisioned user their plaintext password via a hardcoded SMTP
//    account (PHPMailer) — this Next.js app has no email-sending infrastructure at all yet, so
//    that step is not ported; the response instead reports what was provisioned so the admin can
//    communicate credentials manually. The function itself also writes the *plaintext* password
//    into `mob_user_credentials.password` — every other write path in this app deliberately
//    leaves that column blank to avoid storing a recoverable password, so a follow-up UPDATE
//    scoped to exactly the rows this call just touched (matched on branch + the SHA1 hash just
//    set) blanks it back out immediately after.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const branchCode = String(body.branch_code ?? '').trim();
  const password = String(body.password ?? '');

  if (!branchCode) {
    return NextResponse.json({ error: 'branch_code is required' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const hash = crypto.createHash('sha1').update(password).digest('hex');

  const [[result]] = await pool.execute<RowDataPacket[]>(
    'SELECT user_access_firstime_only(?, ?, 0, ?, ?) AS response',
    [session.user.companyCode, branchCode, hash, password]
  );
  const response = String(result?.response ?? 'FALSE');

  await pool.execute(
    `UPDATE mob_user_credentials m
       JOIN user_credentials u ON u.user_id = m.user_id
       JOIN emp_details e ON e.emp_pkey = u.emp_fkey
     SET m.password = ''
     WHERE e.branch_code = ? AND u.password = ?`,
    [branchCode, hash]
  );

  if (response === 'FALSE') {
    return NextResponse.json({ error: 'Bulk access provisioning failed' }, { status: 500 });
  }

  const hasIssues = response.includes('Not SUCCESS');
  return NextResponse.json({
    message: hasIssues
      ? `Provisioned with some issues: ${response}`
      : 'Bulk access provisioned for every employee in this branch without an existing login.',
  });
}
