'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

// Ported 1:1 from New Rizo's components/ESSLayout.jsx (website-style navbar: logo, primary tabs,
// "More" overflow dropdown, theme toggle + avatar pill). react-router-dom → next/navigation,
// the old AuthContext/ThemeContext → next-auth session + a small localStorage-backed theme state
// scoped to this shell only (admin side keeps its own theme). Visual design is untouched.

const ALL_TABS = [
  { to: '/ess', label: 'Home', emoji: '🏠' },
  { to: '/ess/about', label: 'About Me', emoji: '👤' },
  { to: '/ess/team', label: 'My Team', emoji: '👥' },
  { to: '/ess/presence', label: 'My Presence', emoji: '📊' },
  { to: '/ess/salary', label: 'My Salary', emoji: '💰' },
  // overflow → "More" dropdown
  { to: '/ess/requests', label: 'My Requests', emoji: '📋' },
  { to: '/ess/approvals', label: 'Approvals', emoji: '✅' },
  { to: '/ess/reports', label: 'Reports', emoji: '📊' },
  { to: '/ess/others', label: 'Others', emoji: '⚙️' },
];

const PRIMARY_COUNT = 5;

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none', display: 'block' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function useEssTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    try {
      setIsDark(localStorage.getItem('rizo-ess-theme') === 'dark');
    } catch {
      /* private-mode / blocked storage — default to light */
    }
  }, []);

  const toggle = () => {
    setIsDark((d) => {
      const next = !d;
      try {
        localStorage.setItem('rizo-ess-theme', next ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { isDark, toggle };
}

export function EssLegacyShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const { isDark, toggle: toggleTheme } = useEssTheme();
  const router = useRouter();
  const pathname = usePathname();

  const [moreOpen, setMoreOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const moreRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    setMoreOpen(false);
    setAvatarOpen(false);
  }, [pathname]);

  const primaryTabs = ALL_TABS.slice(0, PRIMARY_COUNT);
  const overflowTabs = ALL_TABS.slice(PRIMARY_COUNT);
  const hasOverflow = overflowTabs.length > 0;
  const overflowActive = overflowTabs.some((t) => pathname === t.to || pathname.startsWith(t.to + '/'));

  const displayName = session?.user.loginUserId || 'Employee';
  const initials = displayName.slice(0, 2).toUpperCase();

  function handleLogout() {
    signOut({ redirect: false }).then(() => router.push('/login'));
  }

  function isTabActive(to: string) {
    return to === '/ess' ? pathname === '/ess' : pathname === to || pathname.startsWith(to + '/');
  }

  return (
    <div className="ess-legacy" data-theme={isDark ? 'dark' : 'light'}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-page)' }}>
        {/* WEBSITE-STYLE NAVBAR */}
        <header
          style={{
            height: 62,
            flexShrink: 0,
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'stretch',
            padding: '0 28px',
            gap: 0,
            zIndex: 300,
            boxShadow: '0 1px 0 var(--border), 0 4px 16px rgba(0,0,0,0.05)',
            position: 'sticky',
            top: 0,
          }}
        >
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginRight: 32, flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/rizo-logo.jpg" alt="Rizo" style={{ height: 36, width: 'auto', flexShrink: 0, borderRadius: 6 }} />
            {session?.user.companyCode && (
              <>
                <div style={{ width: 1, height: 28, background: 'var(--border)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  {session.user.companyCode}
                </span>
              </>
            )}
          </div>

          <div style={{ flex: 1 }} />

          {/* Primary nav links */}
          <nav style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
            {primaryTabs.map((tab) => {
              const active = isTabActive(tab.to);
              return (
                <Link key={tab.to} href={tab.to} style={{ display: 'flex', alignItems: 'stretch', textDecoration: 'none' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      height: '100%',
                      padding: '0 14px',
                      fontSize: 13.5,
                      fontWeight: active ? 700 : 500,
                      color: active ? '#1E516E' : 'var(--text-muted)',
                      borderBottom: `2.5px solid ${active ? '#1E516E' : 'transparent'}`,
                      borderTop: '2.5px solid transparent',
                      whiteSpace: 'nowrap',
                      transition: 'color 0.15s, border-color 0.15s, background 0.12s',
                    }}
                  >
                    <span style={{ fontSize: 15, opacity: active ? 1 : 0.65, lineHeight: 1 }}>{tab.emoji}</span>
                    {tab.label}
                  </span>
                </Link>
              );
            })}

            {/* "More" dropdown */}
            {hasOverflow && (
              <div ref={moreRef} style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
                <button
                  onClick={() => setMoreOpen((o) => !o)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    height: '100%',
                    padding: '0 14px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13.5,
                    fontWeight: moreOpen || overflowActive ? 700 : 500,
                    color: moreOpen || overflowActive ? '#1E516E' : 'var(--text-muted)',
                    background: moreOpen ? 'rgba(30,81,110,0.06)' : 'transparent',
                    borderBottom: `2.5px solid ${moreOpen || overflowActive ? '#1E516E' : 'transparent'}`,
                    borderTop: '2.5px solid transparent',
                    transition: 'color 0.15s, background 0.12s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontSize: 15, opacity: 0.65 }}>☰</span>
                  More
                  <ChevronDown open={moreOpen} />
                </button>

                {moreOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      right: 0,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 16,
                      boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.06)',
                      minWidth: 220,
                      zIndex: 500,
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ padding: '6px 0' }}>
                      {overflowTabs.map((tab) => {
                        const active = isTabActive(tab.to);
                        return (
                          <Link
                            key={tab.to}
                            href={tab.to}
                            onClick={() => setMoreOpen(false)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: '10px 18px',
                              textDecoration: 'none',
                              background: active ? 'rgba(30,81,110,0.07)' : 'transparent',
                            }}
                          >
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                flexShrink: 0,
                                background: active ? 'rgba(30,81,110,0.12)' : 'var(--bg-page)',
                                border: `1.5px solid ${active ? 'rgba(30,81,110,0.2)' : 'var(--border)'}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 16,
                              }}
                            >
                              {tab.emoji}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: active ? 700 : 600, color: active ? '#1E516E' : 'var(--text-primary)' }}>
                              {tab.label}
                            </div>
                            {active && <div style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#1E516E' }} />}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Right controls */}
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 16 }}>
            <div ref={avatarRef} style={{ position: 'relative' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: `1.5px solid ${avatarOpen ? '#1E516E' : 'var(--border)'}`,
                  borderRadius: 30,
                  background: 'var(--bg-page)',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s',
                }}
              >
                <button
                  onClick={toggleTheme}
                  title={isDark ? 'Switch to light' : 'Switch to dark'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 40,
                    border: 'none',
                    borderRight: '1px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    flexShrink: 0,
                  }}
                >
                  {isDark ? <SunIcon /> : <MoonIcon />}
                </button>

                <button
                  onClick={() => setAvatarOpen((o) => !o)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px 5px 8px',
                    border: 'none',
                    background: avatarOpen ? 'rgba(30,81,110,0.06)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #1E516E 0%, #4ab8e8 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 800,
                      color: '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {initials}
                  </div>
                  <ChevronDown open={avatarOpen} />
                </button>
              </div>

              {avatarOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 16,
                    boxShadow: '0 16px 48px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.06)',
                    minWidth: 240,
                    zIndex: 500,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        background: 'linear-gradient(135deg, #1E516E 0%, #4ab8e8 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 17,
                        fontWeight: 800,
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {initials}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{displayName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Employee Self Service</div>
                    </div>
                  </div>

                  <div style={{ padding: '6px 0 6px' }}>
                    <button
                      onClick={handleLogout}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '10px 18px',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#dc2626',
                        textAlign: 'left',
                      }}
                    >
                      <LogoutIcon />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, background: 'var(--bg-page)' }}>{children}</main>
      </div>
    </div>
  );
}
