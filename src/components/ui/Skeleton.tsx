import type { CSSProperties, ReactNode } from 'react';

// Skeleton loading placeholders, shared by the admin dashboard and the ESS pages. Layout uses
// inline styles (ESS resets margins/padding and doesn't load Tailwind utilities for its own
// markup); colours come from the .skeleton class and CSS variables in globals.css, falling back
// from the ESS theme variables to the admin ones so both look right, including ESS dark mode.

const SURFACE = 'var(--bg-card, var(--surface, #fff))';
const LINE = 'var(--border, var(--surface-border, #e2e8f0))';

type Size = number | string;

export function Skeleton({ width = '100%', height = 12, radius = 6, style }: { width?: Size; height?: Size; radius?: Size; style?: CSSProperties }) {
  return <span aria-hidden="true" className="skeleton" style={{ width, height, borderRadius: radius, flexShrink: 0, ...style }} />;
}

// Wraps any skeleton so screen readers announce a single "Loading…" instead of empty shapes.
function Busy({ children, style, label = 'Loading…' }: { children: ReactNode; style?: CSSProperties; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" style={style}>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{label}</span>
      {children}
    </div>
  );
}

const card = (extra?: CSSProperties): CSSProperties => ({ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 14, ...extra });

// A few lines of text; the last one shorter.
export function SkeletonText({ lines = 3, gap = 8, lastWidth = '60%', height = 11 }: { lines?: number; gap?: number; lastWidth?: Size; height?: number }) {
  return (
    <Busy style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} height={height} width={i === lines - 1 && lines > 1 ? lastWidth : '100%'} />)}
    </Busy>
  );
}

// Varying widths so rows don't look like a barcode.
const CELL_WIDTHS = ['72%', '55%', '84%', '46%', '64%', '38%', '78%'];

// <tr> rows for inside an existing <tbody> — keeps the real table header visible while loading.
export function SkeletonTableRows({ rows = 6, cols, cellStyle, cellClassName }: { rows?: number; cols: number; cellStyle?: CSSProperties; cellClassName?: string }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: Math.max(1, cols) }, (_, c) => (
            <td key={c} className={cellClassName} style={cellClassName ? cellStyle : { padding: '12px 14px', ...cellStyle }}>
              <Skeleton height={11} width={c === 0 ? '80%' : CELL_WIDTHS[(r + c) % CELL_WIDTHS.length]} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// A standalone table-shaped block (header strip + rows) for places with no table markup yet.
export function TableSkeleton({ rows = 6, cols = 5, framed = true }: { rows?: number; cols?: number; framed?: boolean }) {
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 16, alignItems: 'center' };
  return (
    <Busy style={framed ? card({ overflow: 'hidden' }) : undefined}>
      <div style={{ ...grid, padding: '12px 16px', borderBottom: `1px solid ${LINE}` }}>
        {Array.from({ length: cols }, (_, c) => <Skeleton key={c} height={9} width={c === 0 ? '50%' : '40%'} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ ...grid, padding: '13px 16px', borderBottom: r === rows - 1 ? 'none' : `1px solid ${LINE}` }}>
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} height={11} width={CELL_WIDTHS[(r + c) % CELL_WIDTHS.length]} />)}
        </div>
      ))}
    </Busy>
  );
}

// Stat / summary cards in a responsive row.
export function CardsSkeleton({ count = 4, height = 96, minWidth = 180 }: { count?: number; height?: number; minWidth?: number }) {
  return (
    <Busy style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`, gap: 14 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={card({ padding: 16, minHeight: height, display: 'flex', flexDirection: 'column', gap: 10 })}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Skeleton width="45%" height={10} />
            <Skeleton width={26} height={26} radius={8} />
          </div>
          <Skeleton width="55%" height={22} radius={6} />
          <Skeleton width="70%" height={9} />
        </div>
      ))}
    </Busy>
  );
}

// People / item cards in a grid (team members, documents…).
export function GridCardsSkeleton({ count = 6, minWidth = 220 }: { count?: number; minWidth?: number }) {
  return (
    <Busy style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap: 14 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={card({ padding: 16, display: 'flex', alignItems: 'center', gap: 12 })}>
          <Skeleton width={42} height={42} radius="50%" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton width="70%" height={11} />
            <Skeleton width="45%" height={9} />
          </div>
        </div>
      ))}
    </Busy>
  );
}

// Label + input pairs in a two-column grid.
export function FormSkeleton({ fields = 8, columns = 2 }: { fields?: number; columns?: number }) {
  return (
    <Busy style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${columns > 1 ? 240 : 320}px, 1fr))`, gap: '16px 20px' }}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton width={i % 3 === 0 ? '35%' : '28%'} height={9} />
          <Skeleton height={34} radius={8} />
        </div>
      ))}
    </Busy>
  );
}

// A profile / record page: avatar header, tab strip, then label/value pairs.
export function DetailSkeleton({ fields = 10 }: { fields?: number }) {
  return (
    <Busy style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card({ padding: 20, display: 'flex', alignItems: 'center', gap: 16 })}>
        <Skeleton width={64} height={64} radius={18} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton width="32%" height={16} />
          <Skeleton width="48%" height={10} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {[90, 110, 80, 100].map((w, i) => <Skeleton key={i} width={w} height={30} radius={999} />)}
      </div>
      <div style={card({ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px 24px' })}>
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Skeleton width="35%" height={9} />
            <Skeleton width={CELL_WIDTHS[i % CELL_WIDTHS.length]} height={12} />
          </div>
        ))}
      </div>
    </Busy>
  );
}

// Whole-page placeholder used by the route-level loading.tsx files and full-page loaders.
//   hero   — a tall banner (ESS home / profile pages)
//   stats  — number of summary cards (0 = none)
//   body   — the main area's shape
export function PageSkeleton({ hero = false, stats = 0, body = 'table', title = true }: {
  hero?: boolean; stats?: number; body?: 'table' | 'split' | 'detail' | 'form' | 'cards' | 'none'; title?: boolean;
}) {
  return (
    <Busy style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {title && !hero && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            <Skeleton width={220} height={18} style={{ maxWidth: '60%' }} />
            <Skeleton width={320} height={10} style={{ maxWidth: '80%' }} />
          </div>
          <Skeleton width={110} height={34} radius={9} />
        </div>
      )}
      {hero && (
        <div style={card({ padding: 22, display: 'flex', alignItems: 'center', gap: 20, borderRadius: 22 })}>
          <Skeleton width={84} height={84} radius={24} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton width="38%" height={22} />
            <Skeleton width="55%" height={11} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[150, 190, 120].map((w, i) => <Skeleton key={i} width={w} height={30} radius={10} />)}
            </div>
          </div>
        </div>
      )}
      {stats > 0 && <CardsSkeleton count={stats} />}
      {body === 'table' && <TableSkeleton rows={8} cols={5} />}
      {body === 'form' && <div style={card({ padding: 20 })}><FormSkeleton /></div>}
      {body === 'detail' && <DetailSkeleton />}
      {body === 'cards' && <GridCardsSkeleton />}
      {body === 'split' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <div style={card({ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, flex: '2 1 420px', minWidth: 0 })}>
            <Skeleton width="30%" height={14} />
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Skeleton width={34} height={34} radius={10} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="55%" height={11} />
                  <Skeleton width="85%" height={9} />
                </div>
              </div>
            ))}
          </div>
          <div style={card({ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 280px', minWidth: 0 })}>
            <Skeleton width="45%" height={14} />
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Skeleton width={30} height={30} radius="50%" />
                <Skeleton width="60%" height={10} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Busy>
  );
}
