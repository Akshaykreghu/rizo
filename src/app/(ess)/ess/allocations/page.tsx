'use client';

import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import {
  Package, X, Coins, Tag, Settings, Barcode, ShieldCheck, Calendar, FileText, History as HistoryIcon,
  Download, ChevronDown, ChevronUp,
} from 'lucide-react';
import AppTabs from '@/components/ess/AppTabs';
import { EssPagination } from '@/components/ess/EssPagination';

// New page — no legacy source to port from. Backs the two real emp_menu items admin can grant an
// employee that had no ESS destination yet: id 1283 "My Documents" (menu_url
// DocumentManager/documentMaster, the Document Upload library's employee-facing read view — NOT
// the profile page's Personal/HR Documents section) and id 1284 "My Asset" (menu_url
// Asset/empview). See src/lib/essMenuLinks.ts for the menu_url -> ?tab= wiring and
// TAB_MENU_GATES.allocations for the nav-tab gate.

const PAGE_SIZE = 10;
const BRAND = '#1E516E';
const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' };
const thS: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-page)', textTransform: 'uppercase', letterSpacing: '0.3px' };
const tdS: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' };

// AssetDetailModal is a bespoke fixed-overlay div (not the shared components/ui/Modal, which
// already locks scroll) — without this, the mouse wheel still scrolls the page behind the
// overlay while the modal is open, same pattern used for the other bespoke modals in this app.
function useLockBodyScroll() {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);
}

// The redesigned AssetDetailModal uses vivid light-tinted accent colors (badge circles, stat
// tiles) that need a real dark-mode variant, not just reuse as-is — a light pastel bg reads as a
// jarring bright patch on the dark theme otherwise (same lesson as presence/page.tsx's STATUS_CFG
// bg/bgDark split).
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.querySelector('.ess-legacy');
    if (!root) return;
    const update = () => setIsDark(root.getAttribute('data-theme') === 'dark');
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{text}</div>;
}

// Matches the admin employees/assets page's ASSET_STATE_LABEL — same asset_state codes.
const ASSET_STATE_LABEL: Record<number, string> = { 1: 'Good', 2: 'Damaged But Working', 3: 'Not Working' };
const ASSET_STATE_COLOR: Record<number, { bg: string; color: string }> = {
  1: { bg: '#f0fdf4', color: '#166534' },
  2: { bg: '#fefce8', color: '#854d0e' },
  3: { bg: '#fef2f2', color: '#991b1b' },
};

interface AssetRow {
  allocate_pkey: number;
  asset_name: string;
  model: string | null;
  brand: string | null;
  type: string | null;
  specifications: string | null;
  asset_value: number | string | null;
  s_no: string | null;
  warranty: string | null;
  allocated_date: string;
  retreived_date: string | null;
  status: string;
  asset_state: number | null;
  description: string | null;
}

// Theme-aware accent palette for the modal's colored badges/tiles/banner — each pair picked so
// the light-mode tint doesn't just get reused unchanged as a jarring bright patch on the dark
// theme (same lesson as presence/page.tsx's STATUS_CFG bg/bgDark split).
function useAssetAccents(isDark: boolean) {
  return {
    blueBg: isDark ? 'rgba(96,165,250,0.14)' : '#eff6ff',
    blueBorder: isDark ? 'rgba(96,165,250,0.3)' : '#bfdbfe',
    blueIcon: isDark ? '#60a5fa' : '#2563eb',
    blueText: isDark ? '#93c5fd' : '#1d4ed8',
    purpleBg: isDark ? 'rgba(192,132,252,0.14)' : '#f3e8ff',
    purpleBorder: isDark ? 'rgba(192,132,252,0.3)' : '#e9d5ff',
    purpleIcon: isDark ? '#d8b4fe' : '#7e22ce',
    greenBg: isDark ? 'rgba(74,222,128,0.16)' : '#dcfce7',
    greenText: isDark ? '#4ade80' : '#16a34a',
  };
}

function GF({ icon: Icon, label, value, mono, accent }: { icon: React.ElementType; label: string; value?: string | null; mono?: boolean; accent: { blueBg: string; blueIcon: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ width: 20, height: 20, borderRadius: 6, background: accent.blueBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={10} color={accent.blueIcon} strokeWidth={2.25} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-muted)', marginBottom: 1 }}>{label}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-word' }}>{value || '—'}</div>
      </div>
    </div>
  );
}

function SecBar({ icon: Icon, title, accent }: { icon: React.ElementType; title: string; accent: { blueBg: string; blueIcon: string; blueText: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderRadius: 8, background: accent.blueBg, marginBottom: 10 }}>
      <Icon size={12} color={accent.blueIcon} strokeWidth={2.25} />
      <span style={{ fontSize: 10.5, fontWeight: 800, color: accent.blueText }}>{title}</span>
    </div>
  );
}

interface AssetHistoryRow {
  allocate_pkey: number;
  first_name: string | null;
  last_name: string | null;
  emp_id: string | null;
  allocated_date: string;
  retreived_date: string | null;
  status: string;
  description: string | null;
}

function AssetDetailModal({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  useLockBodyScroll();
  const isDark = useIsDarkTheme();
  const accent = useAssetAccents(isDark);
  const state = asset.asset_state ?? 1;
  const stateColor = ASSET_STATE_COLOR[state] ?? ASSET_STATE_COLOR[1];
  const hasValue = asset.asset_value != null && asset.asset_value !== '';

  const [history, setHistory] = useState<AssetHistoryRow[] | null>(null);
  useEffect(() => {
    fetch(`/api/employees/assets/${asset.allocate_pkey}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [asset.allocate_pkey]);

  // Portaled into .ess-legacy (not document.body) — rendered in-tree, this fixed-position overlay
  // could end up trapped inside an ancestor's stacking context (e.g. the sticky nav header's own
  // z-index) at some zoom levels, putting the modal's top edge underneath the header instead of
  // above it. document.body would dodge that, but every var(--bg-card)/--text-primary/etc. color
  // in this app is scoped to .ess-legacy[data-theme] (src/styles/ess-legacy.css), not defined
  // globally — a modal portaled straight to body renders outside that scope, so the whole body
  // (everything but the hardcoded-color header) comes out with no background/text color at all.
  // .ess-legacy wraps the entire ESS shell including the header, so portaling there instead still
  // escapes the stacking-context trap while staying inside the CSS variable scope.
  // No state/effect needed — this modal only ever renders client-side after a user click
  // (well after hydration), so document is always available by the time this runs.
  const portalTarget = document.querySelector('.ess-legacy') ?? document.body;

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 14, width: 540, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        {/* Modal chrome header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', background: isDark ? 'rgba(96,165,250,0.06)' : 'linear-gradient(135deg, #eff6ff, var(--bg-card))', borderRadius: '14px 14px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: accent.blueBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Package size={13} color={accent.blueIcon} strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>Asset Allocation Details</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>View complete details of the allocated asset.</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, lineHeight: 1, display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Asset identity card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: accent.blueBg, border: `1px solid ${accent.blueBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Package size={19} color={accent.blueIcon} strokeWidth={1.75} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{asset.asset_name}</div>
            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9.5, fontWeight: 700, background: stateColor.bg, color: stateColor.color }}>
              ✓ {ASSET_STATE_LABEL[state] ?? 'Good'}
            </span>
            {asset.type && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{asset.type}</div>}
          </div>
          <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
            {hasValue && (
              <div style={{ textAlign: 'center', padding: '6px 10px', borderRadius: 9, background: accent.blueBg, border: `1px solid ${accent.blueBorder}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Coins size={11} color={accent.blueIcon} />
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: accent.blueText }}>₹{Number(asset.asset_value).toLocaleString('en-IN')}</span>
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-muted)', marginTop: 2 }}>Value</div>
              </div>
            )}
            {asset.type && (
              <div style={{ textAlign: 'center', padding: '6px 10px', borderRadius: 9, background: accent.purpleBg, border: `1px solid ${accent.purpleBorder}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Tag size={11} color={accent.purpleIcon} />
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: accent.purpleIcon }}>{asset.type}</span>
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-muted)', marginTop: 2 }}>Type</div>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: 14 }}>
          <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
            <SecBar icon={FileText} title="Asset Details" accent={accent} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              <GF icon={Settings} label="Model" value={asset.model} accent={accent} />
              <GF icon={Tag} label="Brand" value={asset.brand} accent={accent} />
              <GF icon={Barcode} label="Serial Number" value={asset.s_no} mono accent={accent} />
              <GF icon={ShieldCheck} label="Warranty" value={asset.warranty} accent={accent} />
              {asset.specifications && <div style={{ gridColumn: '1 / -1' }}><GF icon={Settings} label="Specifications" value={asset.specifications} accent={accent} /></div>}
            </div>
          </div>
        </div>

        {history && history.length > 0 && (
          <div style={{ padding: '0 14px 14px' }}>
            <SecBar icon={HistoryIcon} title="Asset History" accent={accent} />
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Employee', 'Allocated On', 'Status', 'Returned On', 'Notes'].map((h) => <th key={h} style={{ ...thS, padding: '6px 10px', fontSize: 9 }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const initials = [h.first_name?.trim()[0], h.last_name?.trim()[0]].filter(Boolean).join('').toUpperCase() || '?';
                    const cellS = { ...tdS, padding: '6px 10px', fontSize: 11 };
                    return (
                      <tr key={h.allocate_pkey} style={h.allocate_pkey === asset.allocate_pkey ? { background: accent.blueBg } : undefined}>
                        <td style={cellS}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{ width: 19, height: 19, borderRadius: '50%', background: accent.blueBg, color: accent.blueIcon, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, flexShrink: 0 }}>
                              {initials}
                            </div>
                            <div>
                              <div style={{ fontWeight: h.allocate_pkey === asset.allocate_pkey ? 800 : 600 }}>
                                {[h.first_name, h.last_name].filter(Boolean).join(' ').trim() || '—'}
                              </div>
                              {h.emp_id && <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>({h.emp_id})</div>}
                            </div>
                          </div>
                        </td>
                        <td style={cellS}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Calendar size={10} color="var(--text-muted)" />
                            {fmtDate(h.allocated_date)}
                          </div>
                        </td>
                        <td style={cellS}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, color: h.status === 'Allocated' ? accent.greenText : 'var(--text-muted)' }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: h.status === 'Allocated' ? accent.greenText : 'var(--text-muted)' }} />
                            {h.status}
                          </span>
                        </td>
                        <td style={cellS}>{h.retreived_date ? fmtDate(h.retreived_date) : '—'}</td>
                        <td style={{ ...cellS, color: 'var(--text-muted)' }}>{h.description || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 7, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Close</button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}

function MyAssetsTab() {
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<AssetRow | null>(null);

  useEffect(() => {
    fetch('/api/employees/assets')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setRows(d.data || []))
      .catch(() => setRows([]));
  }, []);

  if (rows === null) return <EmptyState text="Loading…" />;
  if (rows.length === 0) return <EmptyState text="No assets have been allocated to you yet." />;

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Sl.No', 'Asset', 'Type', 'Model / Brand', 'Serial No.', 'Allocated On', 'Condition', ''].map((h) => <th key={h} style={thS}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const state = r.asset_state ?? 1;
              const stateColor = ASSET_STATE_COLOR[state] ?? ASSET_STATE_COLOR[1];
              return (
                <tr key={r.allocate_pkey}>
                  <td style={{ ...tdS, color: 'var(--text-muted)' }}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ ...tdS, fontWeight: 700 }}>{r.asset_name}</td>
                  <td style={tdS}>{r.type || '—'}</td>
                  <td style={tdS}>{[r.brand, r.model].filter(Boolean).join(' / ') || '—'}</td>
                  <td style={tdS}>{r.s_no || '—'}</td>
                  <td style={tdS}>{fmtDate(r.allocated_date)}</td>
                  <td style={tdS}>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: stateColor.bg, color: stateColor.color }}>
                      {ASSET_STATE_LABEL[state] ?? 'Good'}
                    </span>
                  </td>
                  <td style={{ ...tdS, textAlign: 'right' }}>
                    <button onClick={() => setViewing(r)} style={{ background: 'none', border: 'none', color: BRAND, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onChange={setPage} />
      {viewing && <AssetDetailModal asset={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

interface DocumentRow {
  document_upload_pkey: number;
  document_name: string;
  document_path: string;
  type: string | null;
  document_allocated_date: string | null;
  creation_date: string;
}

function fileEmoji(doc: DocumentRow) {
  const ext = doc.document_path.split('.').pop()?.toLowerCase() ?? '';
  if (doc.type === 'application/pdf' || ext === 'pdf') return '📕';
  if ((doc.type ?? '').startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
  return '📄';
}

// Documents migrated from the legacy CakePHP app carry that server's own absolute filesystem
// path (e.g. "/var/www/html/mpm/app/webroot/document/file/..."), which isn't a URL this app can
// serve — following it 404s. Only a real URL or a path this app's own /api/upload route hands out
// (S3/Spaces, or its local-disk "/uploads/<company>/..." fallback) is actually viewable here.
function isViewablePath(path: string) {
  return /^https?:\/\//i.test(path) || path.startsWith('/uploads/');
}

function MyDocumentsTab() {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/employees/documents')
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (rows === null) return <EmptyState text="Loading…" />;
  if (rows.length === 0) return <EmptyState text="No documents have been allocated to you yet." />;

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div style={card}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pageRows.map((d, i) => {
          const viewable = isViewablePath(d.document_path);
          const isOpen = expandedId === d.document_upload_pkey;
          return (
            <div key={d.document_upload_pkey} style={{ borderRadius: 10, background: 'var(--bg-page)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
                <div style={{ width: 22, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{(page - 1) * PAGE_SIZE + i + 1}</div>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(30,81,110,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{fileEmoji(d)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{d.document_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Allocated: {fmtDate(d.document_allocated_date || d.creation_date)}</div>
                </div>
                {viewable ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => setExpandedId(isOpen ? null : d.document_upload_pkey)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: BRAND, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: '4px 8px' }}
                    >
                      View {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <a
                      href={d.document_path}
                      download={d.document_name}
                      title="Download"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, color: 'var(--text-muted)' }}
                    >
                      <Download size={15} />
                    </a>
                  </div>
                ) : (
                  <span title="This document was migrated from the legacy system and isn't available to view here yet." style={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: 12.5, cursor: 'default', flexShrink: 0 }}>
                    Not available
                  </span>
                )}
              </div>
              {isOpen && viewable && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <iframe src={d.document_path} title={d.document_name} style={{ width: '100%', height: 480, border: 'none', display: 'block' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onChange={setPage} />
    </div>
  );
}

const TABS = [
  { key: 'assets', label: 'My Asset', icon: '📦' },
  { key: 'documents', label: 'My Documents', icon: '📄' },
] as const;
type TabId = typeof TABS[number]['key'];

function EssAllocationsContent() {
  const { data: session } = useSession();
  // Deep-linked via ?tab= from the Others page / a granted menu item (see essMenuLinks.ts) —
  // falls back to 'assets' when absent or not a real tab key.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab = (TABS.some((t) => t.key === requestedTab) ? requestedTab : 'assets') as TabId;
  const [tab, setTab] = useState<TabId>(initialTab);

  if (!session?.user.empFkey) return null;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Allocations</h1>
          <p className="page-subtitle">Assets and documents your administrator has allocated to you</p>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <AppTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))} active={tab} onChange={(k) => setTab(k as TabId)} />
      </div>

      {tab === 'assets' && <MyAssetsTab />}
      {tab === 'documents' && <MyDocumentsTab />}
    </div>
  );
}

export default function EssAllocationsPage() {
  return (
    <Suspense fallback={null}>
      <EssAllocationsContent />
    </Suspense>
  );
}
