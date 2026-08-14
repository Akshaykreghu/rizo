'use client';

import { useParams, useRouter } from 'next/navigation';
import { OnboardForm } from '@/components/employees/OnboardForm';

export default function OnboardPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  return (
    <OnboardForm
      id={id}
      onBack={() => router.back()}
      onOnboarded={(empPkey) => router.push(`/employees/${empPkey}`)}
    />
  );
}
