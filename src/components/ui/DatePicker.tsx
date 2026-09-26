'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// A calendar date picker that replaces the native <input type="date">, whose look varies by
// browser and whose year navigation is painful for birth dates. Reads and emits the same plain
// "YYYY-MM-DD" string the native input did, so it drops into existing form state unchanged.
// The calendar is portalled to <body> with fixed positioning so it's never clipped by a modal's
// scroll area, and it opens upward when there isn't room below.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPUP_WIDTH = 296;
const POPUP_HEIGHT = 348;

interface Ymd { y: number; m: number; d: number } // m is 0-based

function parse(value: string | null | undefined): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}
const pad = (n: number) => String(n).padStart(2, '0');
const toValue = ({ y, m, d }: Ymd) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayYmd = (): Ymd => {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
};
const display = (v: Ymd) => `${pad(v.d)} ${MONTHS[v.m].slice(0, 3)} ${v.y}`;

interface DatePickerProps {
  /** "YYYY-MM-DD", or '' for no date. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest / latest selectable date, "YYYY-MM-DD" — dates outside are greyed out. */
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Classes for the trigger (pass the form's own input class so it matches its neighbours). */
  buttonClassName?: string;
  className?: string;
  /** Hide the Clear button (e.g. required fields). */
  required?: boolean;
  'aria-label'?: string;
}

export function DatePicker({
  value, onChange, min, max, placeholder = 'dd-mm-yyyy', disabled, buttonClassName, className, required, ...rest
}: DatePickerProps) {
  const selected = parse(value);
  const minV = min ? parse(min) : null;
  const maxV = max ? parse(max) : null;
  const minStr = minV ? toValue(minV) : null;
  const maxStr = maxV ? toValue(maxV) : null;

  const [open, setOpen] = useState(false);
  // Month being viewed; starts at the selected date, else today (clamped into min..max).
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const base = selected ?? todayYmd();
    return { y: base.y, m: base.m };
  });
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Month/year switchers are our own dropdowns (height-capped, scrollable), not native <select>s —
  // a native one's OS-rendered popup sizes to the full ~100-year option list with no scroll
  // container and no style control, which is what dwarfed the calendar in practice.
  const [monthOpen, setMonthOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const monthWrapRef = useRef<HTMLDivElement>(null);
  const yearWrapRef = useRef<HTMLDivElement>(null);
  const yearListRef = useRef<HTMLDivElement>(null);

  const isDisabledDay = useCallback((v: Ymd) => {
    const s = toValue(v);
    return (!!minStr && s < minStr) || (!!maxStr && s > maxStr);
  }, [minStr, maxStr]);

  // Pulls a date into [min, max] — used to make "Today" land on the nearest allowed date (e.g. the
  // 18-years-ago cutoff on a Date of Birth field) instead of just sitting disabled when the real
  // today is out of range.
  const clampToRange = useCallback((v: Ymd) => {
    if (maxV && toValue(v) > toValue(maxV)) return maxV;
    if (minV && toValue(v) < toValue(minV)) return minV;
    return v;
  }, [minV, maxV]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const top = below >= POPUP_HEIGHT + 8 || r.top < POPUP_HEIGHT + 8 ? r.bottom + 6 : r.top - POPUP_HEIGHT - 6;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - POPUP_WIDTH - 8);
    setPos({ top: Math.max(8, top), left });
  }, []);

  function openPicker() {
    if (disabled) return;
    const base = selected ?? clampToRange(todayYmd());
    setView({ y: base.y, m: base.m });
    setOpen(true);
  }

  // Position before paint, and keep it attached while anything scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Close on outside click / Escape. Escape is caught in the capture phase so a host modal's own
  // Escape handler doesn't close the whole form.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!popupRef.current?.contains(t) && !triggerRef.current?.contains(t)) { setOpen(false); return; }
      if (!monthWrapRef.current?.contains(t)) setMonthOpen(false);
      if (!yearWrapRef.current?.contains(t)) setYearOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (monthOpen) { setMonthOpen(false); return; }
      if (yearOpen) { setYearOpen(false); return; }
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, monthOpen, yearOpen]);

  // Collapse both switchers whenever the calendar itself closes, so reopening never shows one
  // already expanded.
  useEffect(() => {
    if (!open) { setMonthOpen(false); setYearOpen(false); }
  }, [open]);

  // Scroll the selected year into view (centered) each time the year list opens.
  useEffect(() => {
    if (!yearOpen) return;
    const el = yearListRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: 'center' });
  }, [yearOpen]);

  const years = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const from = minV?.y ?? Math.min(1940, selected?.y ?? 1940);
    const to = maxV?.y ?? Math.max(thisYear + 10, selected?.y ?? 0);
    const list: number[] = [];
    for (let y = to; y >= from; y--) list.push(y);
    return list;
  }, [minV?.y, maxV?.y, selected?.y]);

  // 6x7 grid starting on the Sunday on/before the 1st of the viewed month.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const start = new Date(view.y, view.m, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    });
  }, [view.y, view.m]);

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const prevDisabled = !!minV && (view.y < minV.y || (view.y === minV.y && view.m <= minV.m));
  const nextDisabled = !!maxV && (view.y > maxV.y || (view.y === maxV.y && view.m >= maxV.m));

  const pick = (v: Ymd) => {
    if (isDisabledDay(v)) return;
    onChange(toValue(v));
    setOpen(false);
    triggerRef.current?.focus();
  };
  const today = todayYmd();
  const todayStr = toValue(today);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={rest['aria-label']}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left',
          buttonClassName,
          disabled && 'bg-slate-50 text-slate-500 cursor-not-allowed'
        )}
      >
        <span className={cn('truncate', !selected && 'text-slate-400')}>{selected ? display(selected) : placeholder}</span>
        <CalendarDays className={cn('w-4 h-4 flex-shrink-0', open ? 'text-[color:var(--color-primary)]' : 'text-slate-400')} />
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label="Choose date"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPUP_WIDTH }}
          className="z-[1400] bg-white border border-slate-200 rounded-2xl shadow-[0_18px_50px_-12px_rgba(15,23,42,0.35)] p-3 animate-fade-in"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <button type="button" onClick={() => shiftMonth(-1)} disabled={prevDisabled} aria-label="Previous month"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div ref={monthWrapRef} className="relative flex-1 min-w-0">
              <button
                type="button"
                onClick={() => { setMonthOpen((o) => !o); setYearOpen(false); }}
                aria-haspopup="listbox"
                aria-expanded={monthOpen}
                aria-label="Month"
                className="w-full px-2 py-1 rounded-lg text-[13px] font-semibold text-[#0F172A] bg-slate-50 border border-transparent hover:border-slate-200 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 cursor-pointer text-left truncate"
              >
                {MONTHS[view.m]}
              </button>
              {monthOpen && (
                <div role="listbox" aria-label="Month" className="absolute z-10 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                  {MONTHS.map((name, i) => (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={i === view.m}
                      onClick={() => { setView((v) => ({ ...v, m: i })); setMonthOpen(false); }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-[13px]',
                        i === view.m ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] font-semibold' : 'text-[#0F172A] hover:bg-slate-50'
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div ref={yearWrapRef} className="relative w-[84px]">
              <button
                type="button"
                onClick={() => { setYearOpen((o) => !o); setMonthOpen(false); }}
                aria-haspopup="listbox"
                aria-expanded={yearOpen}
                aria-label="Year"
                className="w-full px-2 py-1 rounded-lg text-[13px] font-semibold text-[#0F172A] bg-slate-50 border border-transparent hover:border-slate-200 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 cursor-pointer text-left"
              >
                {view.y}
              </button>
              {yearOpen && (
                <div ref={yearListRef} role="listbox" aria-label="Year" className="absolute z-10 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                  {years.map((y) => (
                    <button
                      key={y}
                      type="button"
                      role="option"
                      aria-selected={y === view.y}
                      data-selected={y === view.y}
                      onClick={() => { setView((v) => ({ ...v, y })); setYearOpen(false); }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-[13px] tabular-nums',
                        y === view.y ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] font-semibold' : 'text-[#0F172A] hover:bg-slate-50'
                      )}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => shiftMonth(1)} disabled={nextDisabled} aria-label="Next month"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w) => (
              <span key={w} className="text-center text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 py-1">{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c) => {
              const s = toValue(c);
              const inMonth = c.m === view.m;
              const isSel = selected && s === toValue(selected);
              const isToday = s === todayStr;
              const off = isDisabledDay(c);
              return (
                <button
                  key={s}
                  type="button"
                  disabled={off}
                  onClick={() => pick(c)}
                  aria-label={display(c)}
                  aria-pressed={!!isSel}
                  className={cn(
                    'h-9 rounded-lg text-[12.5px] tabular-nums transition-colors duration-100',
                    isSel
                      ? 'bg-[color:var(--color-primary)] text-white font-semibold shadow-sm'
                      : off
                        ? 'text-slate-300 cursor-not-allowed'
                        : cn('hover:bg-[color:var(--color-primary-light)]', inMonth ? 'text-[#0F172A]' : 'text-slate-400'),
                    isToday && !isSel && 'ring-1 ring-inset ring-[color:var(--color-primary)] font-semibold text-[color:var(--color-primary)]'
                  )}
                >
                  {c.d}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => pick(clampToRange(today))}
              title={isDisabledDay(today) ? `Today is outside the allowed range — jumps to ${display(clampToRange(today))} instead` : undefined}
              className="px-2.5 py-1 rounded-lg text-[12px] font-semibold text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)]"
            >
              Today
            </button>
            {!required && value && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-slate-500 hover:bg-slate-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
