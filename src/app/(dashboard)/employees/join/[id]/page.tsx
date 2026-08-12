'use client';

import { useParams, useRouter } from 'next/navigation';
import { JoinDetail } from '@/components/employees/JoinDetail';

export default function JoinDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  return <JoinDetail id={id} onBack={() => router.push('/employees/join')} />;
}
