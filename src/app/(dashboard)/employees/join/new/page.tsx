'use client';

import { useRouter } from 'next/navigation';
import { NewJoinForm } from '@/components/employees/NewJoinForm';

export default function NewJoinPage() {
  const router = useRouter();

  return (
    <NewJoinForm
      onBack={() => router.back()}
      onCreated={(empJoinPkey) => router.push(`/employees/join/${empJoinPkey}`)}
    />
  );
}
