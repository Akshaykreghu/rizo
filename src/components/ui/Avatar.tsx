import { cn } from '@/lib/utils';

const PALETTE = [
  'bg-[#2196F3]/12 text-[#1976D2]',
  'bg-[#22C55E]/12 text-[#16A34A]',
  'bg-[#8B5CF6]/12 text-[#7C3AED]',
  'bg-[#FACC15]/18 text-[#A16207]',
  'bg-[#EC4899]/12 text-[#DB2777]',
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
