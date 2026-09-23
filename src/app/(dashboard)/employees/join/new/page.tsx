'use client';

import { useRouter } from 'next/navigation';
import { JoinDetail } from '@/components/employees/JoinDetail';

export default function NewJoinPage() {
  const router = useRouter();

  return (
    <JoinDetail
      onBack={() => router.push('/employees/join')}
      // A router.replace() here would swap in /employees/join/[id]/page.tsx — a different route
      // component — which unmounts and remounts JoinDetail, discarding the very step/form state
      // (e.g. Nationality) the wizard's justCreated/seeded refs exist to preserve. Updating the
      // URL bar directly keeps the same component instance alive (refresh/bookmark still lands
      // correctly on the edit route since the id is now in the URL).
      onCreated={(empJoinPkey) => window.history.replaceState(null, '', `/employees/join/${empJoinPkey}`)}
      onOnboarded={(empPkey) => router.push(`/employees/${empPkey}`)}
    />
  );
}
