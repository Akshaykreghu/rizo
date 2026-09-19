'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { resolveMenuEmoji } from '@/lib/faIconMap';

// Was a static links grid ported from New Rizo's pages/ESS/ESSOthers.jsx. Replaced with a live
// list driven by whatever admin has actually granted the logged-in employee via Menu Allocation
// (emp_menu / user_access — see /api/ess/menu-access) instead of showing the same hardcoded menu
// to every employee regardless of what was allocated to them.
//
// A granted item with a known ESS equivalent (see src/lib/essMenuLinks.ts) renders as a working
// link. A granted item with no ESS equivalent yet (team-wide reports, bulk uploads, payroll
// approval — these stay admin-only pending a real per-grant authorization review) still shows,
// disabled, so the list honestly reflects what was allocated rather than silently dropping it.

interface MenuItem {
  menu_id: number;
  menu_title: string;
  menu_url: string | null;
  parent_title: string | null;
  href: string | null;
  iconCls: string | null;
}

export default function EssOthersPage() {
  const [items, setItems] = useState<MenuItem[] | null>(null);

  useEffect(() => {
    fetch('/api/ess/menu-access')
      .then((r) => (r.ok ? r.json() : []))
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const groups = new Map<string, MenuItem[]>();
  for (const item of items ?? []) {
    const groupTitle = (item.parent_title || 'General').trim();
    if (!groups.has(groupTitle)) groups.set(groupTitle, []);
    groups.get(groupTitle)!.push(item);
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Others</h1>
          <p className="page-subtitle">Menu sections allocated to you by your administrator</p>
        </div>
      </div>

      {items === null ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : groups.size === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">Nothing allocated yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            Your administrator hasn&apos;t allocated any additional menu sections to your account.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {[...groups.entries()].map(([groupTitle, groupItems]) => (
            <div key={groupTitle}>
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
                {groupTitle}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 12,
                }}
              >
                {groupItems.map((item) => {
                  const tile = (
                    <>
                      <span style={{ fontSize: '1.6rem', lineHeight: 1, flexShrink: 0, marginTop: 2 }}>
                        {resolveMenuEmoji(item.iconCls)}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 3 }}>
                          {item.menu_title.trim()}
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
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                          {item.href ? 'Allocated by your administrator' : 'Allocated, but not available in this app yet'}
                        </div>
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
                    <Link key={item.menu_id} href={item.href} style={tileStyle} className="others-tile">
                      {tile}
                    </Link>
                  ) : (
                    <div key={item.menu_id} style={tileStyle}>
                      {tile}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
