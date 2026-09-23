'use client';

import { Suspense, useState } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import styles from './employee-login.module.css';

// Employee (userGroup 2) login door — separate route so the admin login
// (src/app/(auth)/login/page.tsx) is never touched. Visual design is a 1:1
// port of New Rizo's frontend/src/pages/Login/Login.jsx split-panel screen;
// auth wiring reuses the same NextAuth credentials provider as the admin login.

const FEATURES = [
  { icon: '💰', label: 'Automated Payroll Processing' },
  { icon: '📋', label: 'Leave & Attendance Tracking' },
  { icon: '👥', label: 'Employee Lifecycle Management' },
  { icon: '📊', label: 'Real-time HR Analytics' },
];

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;
type ResetInfo = { scope: string; company: string; token: string };

function BrandPanel() {
  return (
    <div className={styles.loginBrand}>
      <div className={styles.loginBrandLogo}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/branding/rizo-logo-full.png" alt="Rizo" />
        <span className={styles.loginBrandLogoText}>HRMS</span>
      </div>
      <h1 className={styles.loginBrandHeadline}>
        Simplify HR.
        <br />
        Empower People.
      </h1>
      <p className={styles.loginBrandSub}>
        Complete HR management for modern businesses — payroll, attendance, leave, and analytics
        in one unified platform.
      </p>
      <div className={styles.loginBrandFeatures}>
        {FEATURES.map((f) => (
          <div key={f.label} className={styles.loginBrandFeature}>
            <div className={styles.loginBrandFeatureIcon}>{f.icon}</div>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitCallbackUrl = searchParams.get('callbackUrl');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetInfo, setResetInfo] = useState<ResetInfo | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(data: LoginForm) {
    setLoading(true);
    setError(null);

    const result = await signIn('credentials', {
      username: data.username,
      password: data.password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      if (result.error === 'LOCKED') {
        setError('Account locked for security reasons. Please contact Administrator.');
        return;
      }
      if (result.error.startsWith('RESET_REQUIRED::')) {
        const [, scope, company, token] = result.error.split('::');
        setResetInfo({ scope, company, token });
        return;
      }
      setError('Invalid username or password.');
      return;
    }

    if (explicitCallbackUrl) {
      router.push(explicitCallbackUrl);
    } else {
      const session = await getSession();
      router.push(session?.user.userGroup === 1 ? '/dashboard' : '/ess');
    }
    router.refresh();
  }

  return (
    <div className={styles.loginBg}>
      <BrandPanel />
      <div className={styles.loginFormPanel}>
        <div className={styles.loginFormHeader}>
          <h2 className={styles.loginFormTitle}>Welcome back</h2>
          <p className={styles.loginFormSubtitle}>Sign in to your Rizo HRMS account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className={styles.loginForm}>
          <div className={styles.loginField}>
            <label>Username</label>
            <input
              {...register('username')}
              type="text"
              autoFocus
              placeholder="Enter your username"
            />
            {errors.username && <p className={styles.loginError}>{errors.username.message}</p>}
          </div>

          <div className={styles.loginField}>
            <label>Password</label>
            <input
              {...register('password')}
              type="password"
              placeholder="••••••••"
            />
            {errors.password && <p className={styles.loginError}>{errors.password.message}</p>}
          </div>

          {error && <p className={styles.loginError}>{error}</p>}

          <button type="submit" className={styles.loginBtn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <p className={styles.altLink}>
          Not an employee? <a href="/login">Admin sign in</a>
        </p>
      </div>

      {resetInfo && (
        <ResetPasswordModal resetInfo={resetInfo} onDone={() => setResetInfo(null)} />
      )}
    </div>
  );
}

const resetSchema = z
  .object({
    oldPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(1, 'New password is required'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New Password and Confirm Password are not matching',
    path: ['confirmPassword'],
  });

type ResetForm = z.infer<typeof resetSchema>;

// Shown in place of navigating to a separate /reset-password route — a client-side route push
// following a NextAuth credentials error proved unreliable on the deployed environment, so the
// reset form is instead rendered as a modal over the same login page.
function ResetPasswordModal({ resetInfo, onDone }: { resetInfo: ResetInfo; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  async function onSubmit(data: ResetForm) {
    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: resetInfo.scope,
        companyCode: resetInfo.company,
        token: resetInfo.token,
        oldPassword: data.oldPassword,
        newPassword: data.newPassword,
        confirmPassword: data.confirmPassword,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Something went wrong. Please try again.');
      return;
    }

    onDone();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-indigo-700">Password Reset Required</h2>
          <p className="text-gray-500 text-sm mt-1">
            Please update your password before continuing.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current Password
            </label>
            <input
              {...register('oldPassword')}
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {errors.oldPassword && (
              <p className="text-red-500 text-xs mt-1">{errors.oldPassword.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              {...register('newPassword')}
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {errors.newPassword && (
              <p className="text-red-500 text-xs mt-1">{errors.newPassword.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm New Password
            </label>
            <input
              {...register('confirmPassword')}
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {errors.confirmPassword && (
              <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function EmployeeLoginPage() {
  return (
    <Suspense fallback={null}>
      <EmployeeLoginForm />
    </Suspense>
  );
}
