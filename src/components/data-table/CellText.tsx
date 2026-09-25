import { cn } from '@/lib/utils';

// One-line table cell text: long values are cut with "…" at `maxWidth` instead of wrapping, so
// every row keeps the same height and the columns stay aligned. The full value shows on hover.
export function CellText({
  value,
  className,
  maxWidth = 'max-w-[180px]',
}: {
  value: unknown;
  className?: string;
  maxWidth?: string;
}) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return <span className="text-slate-300">—</span>;
  return (
    <span title={text} className={cn('block truncate', maxWidth, className)}>
      {text}
    </span>
  );
}
