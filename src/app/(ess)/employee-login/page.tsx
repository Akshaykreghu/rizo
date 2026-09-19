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
        router.push(
          `/reset-password?scope=${scope}&company=${encodeURIComponent(company)}&token=${token}`
        );
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
