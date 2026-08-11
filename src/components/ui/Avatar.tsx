import { cn } from '@/lib/utils';

const PALETTE = [
  'bg-indigo-100 text-indigo-600',
  'bg-emerald-100 text-emerald-600',
  'bg-purple-100 text-purple-600',
  'bg-amber-100 text-amber-600',
  'bg-sky-100 text-sky-600',
  'bg-rose-100 text-rose-600',
  'bg-teal-100 text-teal-600',
];

function hashSeed(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  className?: string;
}

export function Avatar({ name, imageUrl, className }: AvatarProps) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={cn('w-8 h-8 rounded-full object-cover border-2 border-white shadow-sm', className)} />;
  }

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

  const colorClass = PALETTE[hashSeed(name) % PALETTE.length];

  return (
    <span
      className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
        colorClass,
        className
      )}
    >
      {initials}
    </span>
  );
}
