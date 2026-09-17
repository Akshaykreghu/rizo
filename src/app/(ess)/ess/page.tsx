import Link from 'next/link';
import { CalendarClock, Wallet } from 'lucide-react';

// Landing/menu page now that there's more than one ESS destination (previously hard-redirected
// straight to Regularisation when it was the only one).
const DESTINATIONS = [
  { href: '/ess/regularisation', label: 'Regularisation', description: 'Raise a request to fix a missed punch', icon: CalendarClock },
  { href: '/ess/leave-encashment', label: 'Leave Encashment', description: 'Apply for and track your leave encashment', icon: Wallet },
];

export default function EssIndexPage() {
  return (
    <div className="space-y-3">
      {DESTINATIONS.map((d) => (
        <Link
          key={d.href}
          href={d.href}
          className="flex items-center gap-3 surface-card rounded-xl px-4 py-4 hover:bg-slate-50 transition-colors duration-150"
        >
          <d.icon className="w-5 h-5 text-[color:var(--color-primary)] flex-shrink-0" />
          <div>
            <div className="font-heading text-[14.5px] font-semibold text-[#0F172A]">{d.label}</div>
            <div className="text-[12.5px] text-slate-500">{d.description}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
