import Link from 'next/link';
import type { CSSProperties } from 'react';

// Ported from New Rizo's pages/ESS/ESSOthers.jsx (a static links grid). Destinations are
// remapped to this app's actual /ess/* routes — New Rizo was one SPA where admin and ESS
// shared routes directly (e.g. /payroll/advance); here ESS is a walled-off section, so
// Finance/Tax items point into My Requests / My Salary's relevant tab instead. "Resignation"
// has no equivalent route yet (not part of the current ESS scope) and is shown disabled.

const GROUPS: {
  title: string;
  items: { emoji: string; label: string; desc: string; href?: string }[];
}[] = [
  {
    title: 'Finance',
    items: [
      { emoji: '💸', label: 'Salary Advance', href: '/ess/requests', desc: 'Request an advance on your salary' },
      { emoji: '🏦', label: 'Loan Requests', href: '/ess/requests', desc: 'Apply for or track employee loans' },
      { emoji: '🧾', label: 'My Expenses', href: '/ess/requests', desc: 'Submit and track expense claims' },
      { emoji: '🌴', label: 'Leave Encashment', href: '/ess/leave-encashment', desc: 'Apply for and track your leave encashment' },
    ],
  },
  {
    title: 'Documents & Compliance',
    items: [
      { emoji: '📄', label: 'My Documents', href: '/ess/about', desc: 'View your personal & HR-issued documents' },
      { emoji: '🏛️', label: 'IT Declaration', href: '/ess/salary', desc: 'Declare investments for tax savings' },
    ],
  },
  {
    title: 'Attendance',
    items: [
      { emoji: '✏️', label: 'Regularisation', href: '/ess/regularisation', desc: 'Correct missed or wrong punches' },
    ],
  },
  {
    title: 'Career',
    items: [
      { emoji: '📈', label: 'Increment History', href: '/ess/salary', desc: 'View your salary increment timeline' },
      { emoji: '🚪', label: 'Resignation', desc: 'Initiate your notice period' },
    ],
  },
];

export default function EssOthersPage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Others</h1>
          <p className="page-subtitle">Additional self-service options</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {GROUPS.map((group) => (
          <div key={group.title}>
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                marginBottom: 12,
                paddingLeft: 2,
              }}
            >
              {group.title}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {group.items.map((item) => {
                const tile = (
                  <>
                    <span style={{ fontSize: '1.6rem', lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{item.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 3 }}>
                        {item.label}
                        {!item.href && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1px 8px',
                              borderRadius: 20,
                              background: 'var(--bg-page)',
                              color: 'var(--text-muted)',
                              border: '1px solid var(--border)',
                              verticalAlign: 'middle',
                            }}
                          >
                            Coming soon
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.desc}</div>
                    </div>
                  </>
                );
                const tileStyle: CSSProperties = {
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  padding: '16px 18px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  textAlign: 'left',
                  textDecoration: 'none',
                  opacity: item.href ? 1 : 0.55,
                  cursor: item.href ? 'pointer' : 'default',
                };
                return item.href ? (
                  <Link key={item.label} href={item.href} style={tileStyle} className="others-tile">
                    {tile}
                  </Link>
                ) : (
                  <div key={item.label} style={tileStyle}>
                    {tile}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
