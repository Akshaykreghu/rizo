import { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { controlPool, getCompanyPool } from './db';

const MAX_LOGIN_ATTEMPTS = 3;

type AuthUser = {
  id: string;
  name: string;
  email: string;
  controlPkey: number;
  companyCode: string;
  userGroup: number;
  empFkey: number | null;
  loginUserId: string;
  planId: number | null;
};

async function verifyAndUpgradePassword(
  pool: mysql.Pool,
  plainPassword: string,
  storedHash: string,
  userPkeyColumn: string,
  userPkey: number
): Promise<boolean> {
  const isSha1 = /^[a-f0-9]{40}$/.test(storedHash);

  if (isSha1) {
    const sha1 = crypto.createHash('sha1').update(plainPassword).digest('hex');
    const valid = sha1 === storedHash;
    if (valid) {
      const hash = await bcrypt.hash(plainPassword, 12);
      await pool.execute(`UPDATE user_credentials SET password = ? WHERE ${userPkeyColumn} = ?`, [
        hash,
        userPkey,
      ]);
    }
    return valid;
  }

  return bcrypt.compare(plainPassword, storedHash);
}

async function tryAdminLogin(username: string, password: string): Promise<AuthUser | null> {
  const [rows] = await controlPool.execute<mysql.RowDataPacket[]>(
    `SELECT user_pkey, password, company_code, reset_login_flag, plan_id
     FROM user_credentials
     WHERE (user_id = ? OR email = ?) AND UPPER(access_allowed) = 'Y'`,
    [username, username]
  );

  if (!rows.length) return null;
  const user = rows[0];

  const passwordValid = await verifyAndUpgradePassword(
    controlPool,
    password,
    user.password,
    'user_pkey',
    user.user_pkey
  );
  if (!passwordValid) return null;

  if (user.reset_login_flag === 'Y') {
    const token = crypto.randomBytes(32).toString('hex');
    await controlPool.execute(`UPDATE user_credentials SET attr1 = ? WHERE user_pkey = ?`, [
      token,
      user.user_pkey,
    ]);
    throw new Error(`RESET_REQUIRED::admin::::${token}`);
  }

  const companyCode = String(user.company_code).toUpperCase();

  const [companyRows] = await controlPool.execute<mysql.RowDataPacket[]>(
    `SELECT control_pkey FROM central_control
     WHERE company_code = ? AND active = 'active' AND end_date_effective >= CURDATE()`,
    [companyCode]
  );

  if (!companyRows.length) return null;

  return {
    id: String(user.user_pkey),
    name: username,
    email: '',
    controlPkey: companyRows[0].control_pkey as number,
    companyCode,
    userGroup: 1,
    empFkey: null,
    loginUserId: username.toUpperCase(),
    planId: (user.plan_id as number) || null,
  };
}

async function tryEmployeeLogin(username: string, password: string): Promise<AuthUser | null> {
  const companyCode = username.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (!companyCode) return null;

  const [companyRows] = await controlPool.execute<mysql.RowDataPacket[]>(
    `SELECT control_pkey FROM central_control
     WHERE company_code = ? AND active = 'active' AND end_date_effective >= CURDATE()`,
    [companyCode]
  );
  if (!companyRows.length) return null;
  const controlPkey = companyRows[0].control_pkey as number;

  let companyPool: mysql.Pool;
  try {
    companyPool = await getCompanyPool(companyCode);
  } catch {
    return null;
  }

  const [rows] = await companyPool.execute<mysql.RowDataPacket[]>(
    `SELECT user_pkey, password, emp_fkey, access_allowed, locked, incorrect_login_attempt,
            end_date, reset_login_flag
     FROM user_credentials
     WHERE user_id = ?`,
    [username]
  );
  if (!rows.length) return null;
  const user = rows[0];

  if (user.locked) {
    throw new Error('LOCKED');
  }

  if (String(user.access_allowed).toUpperCase() !== 'Y') return null;

  const passwordValid = await verifyAndUpgradePassword(
    companyPool,
    password,
    user.password || '',
    'user_pkey',
    user.user_pkey
  );

  if (passwordValid && user.reset_login_flag === 'Y') {
    const token = crypto.randomBytes(32).toString('hex');
    await companyPool.execute(`UPDATE user_credentials SET attr1 = ? WHERE user_pkey = ?`, [
      token,
      user.user_pkey,
    ]);
    throw new Error(`RESET_REQUIRED::employee::${companyCode}::${token}`);
  }

  if (!passwordValid) {
    const today = new Date().toISOString().slice(0, 10);
    const lastAttemptDate = user.end_date
      ? new Date(user.end_date).toISOString().slice(0, 10)
      : null;
    const attempts = lastAttemptDate === today ? (user.incorrect_login_attempt || 0) + 1 : 1;
    const locked = attempts >= MAX_LOGIN_ATTEMPTS;

    await companyPool.execute(
      `UPDATE user_credentials
       SET incorrect_login_attempt = ?, end_date = CURDATE(), locked = ?
       WHERE user_pkey = ?`,
      [attempts, locked ? 1 : 0, user.user_pkey]
    );

    if (locked) throw new Error('LOCKED');
    return null;
  }

  await companyPool.execute(
    `UPDATE user_credentials SET incorrect_login_attempt = 0 WHERE user_pkey = ?`,
    [user.user_pkey]
  );

  return {
    id: String(user.user_pkey),
    name: username,
    email: '',
    controlPkey,
    companyCode,
    userGroup: 2,
    empFkey: (user.emp_fkey as number) || null,
    loginUserId: username.toUpperCase(),
    planId: null,
  };
}

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const { username, password } = credentials;

        const adminUser = await tryAdminLogin(username, password);
        if (adminUser) return adminUser;

        return tryEmployeeLogin(username, password);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const authUser = user as unknown as AuthUser;
        token.controlPkey = authUser.controlPkey;
        token.companyCode = authUser.companyCode;
        token.userGroup = authUser.userGroup;
        token.empFkey = authUser.empFkey;
        token.loginUserId = authUser.loginUserId;
        token.planId = authUser.planId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.controlPkey = token.controlPkey as number;
      session.user.companyCode = token.companyCode as string;
      session.user.userGroup = token.userGroup as number;
      session.user.empFkey = token.empFkey as number | null;
      session.user.loginUserId = token.loginUserId as string;
      session.user.planId = token.planId as number | null;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
};
