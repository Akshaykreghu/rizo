'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// A 12-hour Hour/Minute/Second spinner + AM/PM toggle that reads and emits 24-hour "HH:MM:SS" —
// swapped in for the native <input type="time" step="1">, whose rendered widget varies wildly by
// browser/OS and looks particularly rough with second-level granularity. Each segment is a boxed
// number with up/down arrows (not a dropdown list) per the requested design. Seconds are kept (not
// simplified away) because legacy's own punch-entry widget (EditPunches/form.ctp's
// `$('#LOGTIME').timepicker(...)`) is configured with `format: 'hh:mm:ss', showSeconds: true` —
// second-level precision on a manually-entered punch is a real legacy behavior.
// Each segment is also directly typeable, not just arrow-steppable: onKeyDown rejects any keystroke
// that isn't a digit, a navigation/editing key, or a keyboard shortcut (Ctrl/Cmd+something), so
// nothing invalid ever lands in the field; onChange further strips non-digits and caps at 2 characters
// as a second line of defense (covers paste, autofill, IME input); and every value that does land is
// clamped (never wrapped) into the segment's valid range on commit.

interface Parsed {
  hour12: number;
  minute: number;
  second: number;
  meridiem: 'AM' | 'PM';
}

function parse24(value: string): Parsed | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value ?? '');
  if (!m) return null;
  const h24 = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] ? Number(m[3]) : 0;
  const meridiem: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, minute, second, meridiem };
}

function to24({ hour12, minute, second, meridiem }: Parsed): string {
  const h24 = (hour12 % 12) + (meridiem === 'PM' ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

/** Wraps n into [min, max] (inclusive), stepping by delta (+1/-1). */
function wrap(n: number, delta: number, min: number, max: number): number {
  const span = max - min + 1;
  return min + (((n - min + delta) % span) + span) % span;
}

/** Current time as an "HH:MM:SS" string, suitable for pre-filling a fresh TimePicker. */
export function nowAsHHMMSS(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Clamps n into [min, max] without wrapping — used for typed input, unlike the arrows' wrap(). */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Keys that are never digits but must still pass through to the browser/input untouched (navigation,
// editing, and the arrow-key stepping this component adds on top of them).
const ALLOWED_CONTROL_KEYS = new Set([
  'Backspace', 'Delete', 'Tab', 'Enter', 'Escape',
  'ArrowLeft', 'ArrowRight', 'Home', 'End',
]);

function SpinnerSegment({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  // Holds the in-progress typed digits while focused (so "1" then "5" can become "15" before it's
  // clamped/committed) — null means "not being typed into", so the box just mirrors `value`.
  const [typed, setTyped] = useState<string | null>(null);
  const displayValue = typed ?? String(value).padStart(2, '0');

  const commit = (raw: string) => {
    setTyped(null);
    if (raw === '') return;
    onChange(clamp(Number(raw), min, max));
  };

  const arrowClass =
    'flex items-center justify-center w-full h-4 text-[#86868B] hover:text-[color:var(--color-primary)] disabled:opacity-30 disabled:hover:text-[#86868B] transition-colors duration-150';
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(wrap(value, 1, min, max))}
        aria-label={`Increase ${label}`}
        className={arrowClass}
      >
        <ChevronUp className="w-3.5 h-3.5" strokeWidth={2.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={displayValue}
        disabled={disabled}
        onFocus={(e) => { setTyped(String(value).padStart(2, '0')); e.target.select(); }}
        onChange={(e) => {
          // Strip anything that isn't a digit and cap at 2 digits — this is the actual guard against
          // typing something inappropriate for a time field (letters, symbols, more than 2 digits).
          const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
          setTyped(digits);
          // Once 2 digits are in, the value is unambiguous — commit (clamped) immediately rather than
          // waiting for blur, so e.g. typing "9" then "9" into minutes settles on 59, not a stray 99.
          if (digits.length === 2) onChange(clamp(Number(digits), min, max));
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(wrap(value, 1, min, max)); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); onChange(wrap(value, -1, min, max)); }
          else if (e.key === 'Enter') { e.currentTarget.blur(); }
          else if (!ALLOWED_CONTROL_KEYS.has(e.key) && !/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
          }
        }}
        className="w-8 h-7 text-center rounded-[8px] border border-black/[0.08] bg-white text-[13px] font-semibold text-[#1D1D1F] tabular-nums focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] disabled:opacity-50"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(wrap(value, -1, min, max))}
        aria-label={`Decrease ${label}`}
        className={arrowClass}
      >
        <ChevronDown className="w-3.5 h-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function TimePicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const parsed = parse24(value) ?? { hour12: 9, minute: 0, second: 0, meridiem: 'AM' as const };

  const update = (patch: Partial<Parsed>) => onChange(to24({ ...parsed, ...patch }));

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <SpinnerSegment label="hour" value={parsed.hour12} min={1} max={12} disabled={disabled} onChange={(hour12) => update({ hour12 })} />
      <span className="text-[#86868B] text-[13px] font-semibold">:</span>
      <SpinnerSegment label="minute" value={parsed.minute} min={0} max={59} disabled={disabled} onChange={(minute) => update({ minute })} />
      <span className="text-[#86868B] text-[13px] font-semibold">:</span>
      <SpinnerSegment label="second" value={parsed.second} min={0} max={59} disabled={disabled} onChange={(second) => update({ second })} />
      <div className="flex flex-col gap-0.5 ml-1">
        {(['AM', 'PM'] as const).map((mer) => (
          <button
            key={mer}
            type="button"
            disabled={disabled}
            onClick={() => update({ meridiem: mer })}
            className={cn(
              'px-1.5 py-[3px] rounded-[6px] text-[11px] font-semibold transition-all duration-150 disabled:cursor-not-allowed',
              parsed.meridiem === mer
                ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]'
                : 'text-[#86868B] hover:text-[#1D1D1F]'
            )}
          >
            {mer}
          </button>
        ))}
      </div>
    </div>
  );
}
