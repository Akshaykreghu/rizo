'use client';

import { useRouter } from 'next/navigation';
import { JoinDetail } from '@/components/employees/JoinDetail';

export default function NewJoinPage() {
  const router = useRouter();

  return (
    <JoinDetail
      onBack={() => router.push('/employees/join')}
      onCreated={(empJoinPkey) => router.replace(`/employees/join/${empJoinPkey}`)}
      onFinished={() => router.push('/employees/join')}
    />
  );
}
