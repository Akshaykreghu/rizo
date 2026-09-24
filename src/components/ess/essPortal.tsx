'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ESS pages sit inside `.page-content > * { position: relative; z-index: 1 }` (ess-legacy.css),
// so a `fixed` overlay rendered in place is trapped in that z-index:1 layer and the sticky
// header (z-index 300) paints over its top. Portaling to `.ess-legacy` escapes the trap while
// keeping the theme's CSS variables in scope; the z-index:1000 wrapper then lifts the whole
// overlay (whatever z-index its own classes use) above the header. Only call this for overlays
// that open after a user action — document is always available by then.
export function essPortal(node: ReactNode) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div style={{ position: 'relative', zIndex: 1000 }}>{node}</div>,
    document.querySelector('.ess-legacy') ?? document.body
  );
}
