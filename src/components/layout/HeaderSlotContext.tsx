'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface HeaderSlotContextValue {
  slotEl: HTMLDivElement | null;
  setSlotEl: (el: HTMLDivElement | null) => void;
}

const HeaderSlotContext = createContext<HeaderSlotContextValue | null>(null);

/** Wraps the dashboard shell so pages can portal content (e.g. a page-specific search bar) into the global Header. */
export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  return (
    <HeaderSlotContext.Provider value={{ slotEl, setSlotEl }}>
      {children}
    </HeaderSlotContext.Provider>
  );
}

export function useHeaderSlot() {
  const ctx = useContext(HeaderSlotContext);
  if (!ctx) throw new Error('useHeaderSlot must be used within HeaderSlotProvider');
  return ctx;
}
