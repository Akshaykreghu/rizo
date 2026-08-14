import { cn } from '@/lib/utils';

const PALETTE = [
  'bg-[#E8F4FF] text-[#1687E8]',
  'bg-[#E9F9F1] text-[#16945B]',
  'bg-[#FFF8DC] text-[#C89B00]',
  'bg-[#F1ECFF] text-[#7041D8]',
  'bg-[#FFF0F6] text-[#C93673]',
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
