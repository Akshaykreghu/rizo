'use client';

import { useParams, useRouter } from 'next/navigation';
import { JoinDetail } from '@/components/employees/JoinDetail';

// Onboarding is now tab 3 of the unified JoinDetail wizard rather than a separate component —
// this route just opens that same wizard straight on the Onboarding tab, keeping the route
// bookmarkable and preserving its "navigate to the new employee's page" behavior.
export default function OnboardPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  return (
    <JoinDetail
      id={id}
      initialStep={2}
      onBack={() => router.back()}
      onOnboarded={(empPkey) => router.push(`/employees/${empPkey}`)}
    />
  );
}
