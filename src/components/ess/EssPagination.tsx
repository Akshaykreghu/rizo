'use client';

const BRAND = '#1E516E';

// Shared pagination footer for ESS's hand-rolled grids (none of them use the admin dashboard's
// react-table-based DataTable — different design system entirely). Callers own the slicing
// (`rows.slice((page - 1) * pageSize, page * pageSize)`); this just renders the footer and page
// numbers from the counts they pass in, matching ESS's inline-style/CSS-var convention.
export function EssPagination({
  page,
  pageSize,
  totalItems,
  onChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const pageNumbers: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) pageNumbers.push('…');
    pageNumbers.push(sorted[i]);
  }

  const navBtn = (disabled: boolean): React.CSSProperties => ({
    padding: '4px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-page)',
    color: disabled ? 'var(--border)' : 'var(--text-muted)', fontSize: 12, cursor: disabled ? 'default' : 'pointer',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        {from}–{to} of {totalItems}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} style={navBtn(page <= 1)}>‹ Prev</button>
        {pageNumbers.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} style={{ padding: '0 4px', fontSize: 12, color: 'var(--text-muted)' }}>…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              style={{
                width: 26, height: 26, borderRadius: 6, border: 'none', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                background: n === page ? BRAND : 'transparent', color: n === page ? '#fff' : 'var(--text-muted)',
              }}
            >
              {n}
            </button>
          )
        )}
        <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)} style={navBtn(page >= totalPages)}>Next ›</button>
      </div>
    </div>
  );
}
