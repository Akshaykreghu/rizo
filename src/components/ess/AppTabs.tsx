'use client';

import type { ReactNode, CSSProperties } from 'react';

// Ported 1:1 from New Rizo's components/AppTabs.jsx — glassmorphism sliding-pill tab bar.
// The CSS (.app-tabs / .app-tab-indicator / .app-tab) was already ported into ess-legacy.css
// when the ESS shell was built, but this component itself was never brought over, so pages built
// since then (My Requests, My Salary, Approvals) used plain underline tabs instead — visually
// different from New Rizo's sliding-pill animation. This restores the real thing.

interface Tab {
  key: string;
  label: string;
  icon?: ReactNode;
}

export default function AppTabs({ tabs, active, onChange, compact }: { tabs: Tab[]; active: string; onChange: (key: string) => void; compact?: boolean }) {
  const activeIdx = Math.max(0, tabs.findIndex((t) => t.key === active));
  return (
    <div
      className={`app-tabs${compact ? ' app-tabs-compact' : ''}`}
      style={{ '--app-tab-count': tabs.length } as CSSProperties}
    >
      <div className="app-tab-indicator" style={{ transform: `translateX(calc(${activeIdx} * 100%))` }} />
      {tabs.map((t) => (
        <button key={t.key} className={`app-tab${active === t.key ? ' active' : ''}`} onClick={() => onChange(t.key)}>
          {t.icon && <span className="app-tab-icon">{t.icon}</span>}
          {t.label}
        </button>
      ))}
    </div>
  );
}
